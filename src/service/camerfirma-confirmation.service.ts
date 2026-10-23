import { chromium } from 'playwright';

export interface ConfirmationResult {
  alreadyConfirmed: boolean;
  downloadCode: string | null;
}

export class CamerfirmaConfirmationService {
  static async confirmAndExtractCode(verificationUrl: string): Promise<ConfirmationResult> {
    const t0 = performance.now();
    console.log(`🤖 [Playwright] Navegando a la URL de confirmación de Camerfirma:\n   ${verificationUrl}`);

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();

      // 1. Cargar la página de confirmación inicial (paso_a_solicitud_1.php)
      await page.goto(verificationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Helper para leer el código exacto <span class="error"><b>código</b></span>
      const extractCodeFromDom = async (): Promise<string | null> => {
        return await page.evaluate(() => {
          const cleanStr = (s: string) => (s || '').trim();

          // 🎯 Estrategia 1: Buscar elemento exacto span.error b (capturado en devtools)
          const spanB = document.querySelector('span.error b') || document.querySelector('span.error');
          if (spanB && spanB.textContent) {
            const val = cleanStr(spanB.textContent);
            if (val && val.length >= 5) return val;
          }

          // 🎯 Estrategia 2: Regex sobre todo el texto plano acumulado
          const bodyText = document.body.innerText || '';
          const match = bodyText.match(/Su\s+c[óo]digo\s+de\s+descarga\s+es\s*[:\=]?\s*([A-Za-z0-9\=\_\-]{5,40})/i);
          if (match && match[1]) return cleanStr(match[1]);

          return null;
        });
      };

      // 2. Comprobar si la solicitud ya figuraba confirmada
      const bodyTextInitial = await page.evaluate(() => document.body.innerText || '');
      const isAlreadyConfirmed = /ya se ha confirmado|solicitud.*confirmada|procesada previamente/i.test(bodyTextInitial);

      if (isAlreadyConfirmed) {
        console.log('ℹ️ [Playwright] La solicitud ya estaba confirmada anteriormente.');
        const code = await extractCodeFromDom();
        await browser.close();
        return { alreadyConfirmed: true, downloadCode: code };
      }

      // 3. Marcar el Checkbox (SI)
      console.log('🤖 [Playwright] Seleccionando la casilla de aceptación de términos (SI)...');
      await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]')) as HTMLInputElement[];
        for (const cb of checkboxes) {
          cb.checked = true;
          cb.dispatchEvent(new Event('input', { bubbles: true }));
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('click', { bubbles: true }));
        }
      });

      // 4. Presionar "Enviar" y esperar la carga de paso_a_solicitud_2.php
      console.log('🤖 [Playwright] Presionando el botón "Enviar" y esperando respuesta de Camerfirma...');

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
          console.log('⚠️ [Playwright] Espera de navegación finalizada.');
        }),
        page.evaluate(() => {
          if (typeof (window as any).enviar === 'function') {
            try { (window as any).enviar(); return; } catch (e) {}
          }
          const btn = (
            document.querySelector('input[value="Enviar"]') ||
            document.querySelector('input[type="submit"]') ||
            document.querySelector('button[type="submit"]') ||
            document.querySelector('a#btnEnviar')
          ) as HTMLElement;

          if (btn) btn.click();
          else if (document.forms.length > 0) document.forms[0].submit();
        }),
      ]);

      // 5. ESPERA ACTIVA: Esperar a que aparezca el elemento <span class="error"> en el DOM
      console.log('🤖 [Playwright] Esperando renderizado de span.error con el código...');
      await page.waitForSelector('span.error', { timeout: 15000 }).catch(() => {
        console.log('⚠️ [Playwright] Timeout esperando span.error, procediendo a extracción alternativa.');
      });

      // Pausa de estabilización
      await page.waitForTimeout(2000);

      // 6. Extraer el código devuelto
      const downloadCode = await extractCodeFromDom();
      const currentUrl = page.url();

      console.log(`🎯 [Playwright] URL alcanzada: ${currentUrl}`);
      console.log(`🎯 [Playwright] Código de descarga capturado: ${downloadCode || 'NO DETECTADO'}`);

      await browser.close();
      console.log(`⏱️ [Playwright Total]: ${(performance.now() - t0).toFixed(2)}ms`);

      return { alreadyConfirmed: false, downloadCode };
    } catch (error: any) {
      await browser.close();
      console.error('💥 [Playwright Error]:', error.message);
      return { alreadyConfirmed: false, downloadCode: null };
    }
  }
}