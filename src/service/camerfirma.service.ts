import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocationService } from '@/lib/ubigeo-service';

export const sendToCamerfirma = async (certificateData: any, fileUrl?: string) => {
  const isEmpresa = certificateData.entityType === 'EMPRESA';

  const resolvedLocation = await LocationService.resolveLocationAndZip(
    certificateData.department,
    certificateData.province,
    certificateData.district
  );

  const calculatedPostalCode = certificateData.postalCode || resolvedLocation.postalCode || '11003';
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || 'lectordnie.com';
  const targetEmail = certificateData.useTempEmail !== false
    ? `${certificateData.applicantDocNum}@${inboundDomain}`
    : certificateData.applicantEmail;

  const camerfirmaUrl = isEmpresa
    ? 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=1D1AGUUN&num_perfil=13080'
    : 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040';

  console.log(`🤖 [Camerfirma Service] Iniciando con evasión Anti-Bot/CAPTCHA para DNI: ${certificateData.applicantDocNum}`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camerfirma-session-'));

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    userDataDir: tempUserDataDir,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ]
  });

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      (window as any).chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(camerfirmaUrl, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // 1. DATOS PERSONALES
    await page.evaluate((cert) => {
      const cleanStr = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
      function forceInputValue(el: HTMLInputElement, val: string) {
        if (!el || !val) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const nameEl = document.querySelector('input[name*="nombre"], #nombre') as HTMLInputElement;
      if (nameEl) forceInputValue(nameEl, cert.applicantNames || '');

      const surname1El = document.querySelector('input[name*="primer_apellido"], input[name*="apellido1"]') as HTMLInputElement;
      if (surname1El) forceInputValue(surname1El, cert.applicantSurname1 || '');

      const surname2El = document.querySelector('input[name*="segundo_apellido"], input[name*="apellido2"]') as HTMLInputElement;
      if (surname2El) forceInputValue(surname2El, cert.applicantSurname2 || '');

      const docSelect = document.querySelector('select[name="tipodoc_id_solicitante"], select[name*="tipo_doc_sol"]') as HTMLSelectElement;
      if (docSelect) {
        const opt = Array.from(docSelect.options).find(o => cleanStr(o.textContent || '').includes('DNI'));
        if (opt) {
          docSelect.value = opt.value;
          docSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, certificateData);

    await new Promise(r => setTimeout(r, 1000));

    // 2. UBIGEO EXACTO (#cmb_departamento, #cmb_provincia, #cmb_municipio)
    await page.evaluate(async (deptText, provText, distText) => {
      const cleanStr = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

      function selectAndTrigger(selectId: string, targetValueText: string) {
        const selectEl = document.getElementById(selectId) as HTMLSelectElement;
        if (!selectEl || !selectEl.options) return false;

        const target = cleanStr(targetValueText);
        const options = Array.from(selectEl.options);

        let opt = options.find(o => cleanStr(o.textContent || '') === target);
        if (!opt) opt = options.find(o => cleanStr(o.textContent || '').includes(target));

        if (opt) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          selectEl.dispatchEvent(new Event('blur', { bubbles: true }));
          if (typeof selectEl.onchange === 'function') {
            selectEl.onchange(new Event('change'));
          }
          return opt.textContent;
        }
        return false;
      }

      // Departamento
      if (selectAndTrigger('cmb_departamento', deptText)) {
        if (typeof (window as any).GuardarDepartamento === 'function') {
          (window as any).GuardarDepartamento(document.getElementById('cmb_departamento'));
        }
        if (typeof (window as any).ActualizaProvincias === 'function') {
          (window as any).ActualizaProvincias();
        }
      }
      await new Promise(r => setTimeout(r, 1500));

      // Provincia
      if (selectAndTrigger('cmb_provincia', provText)) {
        if (typeof (window as any).GuardaCodigoProv === 'function') {
          (window as any).GuardaCodigoProv(document.getElementById('cmb_provincia'));
        }
        if (typeof (window as any).ActualizaMunicipios === 'function') {
          (window as any).ActualizaMunicipios();
        }
      }
      await new Promise(r => setTimeout(r, 1500));

      // Municipio / Distrito
      if (selectAndTrigger('cmb_municipio', distText)) {
        if (typeof (window as any).GuardaCodigo === 'function') {
          (window as any).GuardaCodigo(document.getElementById('cmb_municipio'));
        }
      }
    }, resolvedLocation.department, resolvedLocation.province, resolvedLocation.district);

    await new Promise(r => setTimeout(r, 1500));

    // 3. DIRECCIÓN Y CORREOS
    await page.evaluate((cert, finalPostalCode, injectedEmail) => {
      function forceInputValue(el: HTMLInputElement, val: string) {
        if (!el || !val) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      function fillFirst(selectors: string[], val: string) {
        for (const s of selectors) {
          const el = document.querySelector(s) as HTMLInputElement;
          if (el) { forceInputValue(el, val); break; }
        }
      }

      fillFirst(['#nif_solicitante', 'input[name="nif_solicitante"]', 'input[name="txt_num_doc"]', 'input[name="num_doc_sol"]'], cert.applicantDocNum || '');
      fillFirst(['input[name="domicilio"]', 'input[name="direccion"]'], cert.address || '');
      fillFirst(['input[name="cp_solicitante"]', 'input[name="codigo_postal"]', 'input[name="cp"]'], finalPostalCode);
      fillFirst(['input[name="telefono"]'], cert.applicantPhone || '');

      const emails = document.querySelectorAll('input[type="email"], input[name*="email"]');
      if (emails[0]) forceInputValue(emails[0] as HTMLInputElement, injectedEmail);
      if (emails[1]) forceInputValue(emails[1] as HTMLInputElement, injectedEmail);
    }, certificateData, calculatedPostalCode, targetEmail);

    // 4. ADJUNTAR DOCUMENTACIÓN PDF
    if (fileUrl) {
      await page.evaluate((isCompany) => {
        const cleanStr = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
        const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
        const docTypeSelect = selects.find((s) => s.name.includes('tipo_doc') || s.id.includes('tipo_doc') || s.name.includes('documento'));

        if (docTypeSelect) {
          const targetText = isCompany ? 'PODERES' : 'DNI';
          const opt = Array.from(docTypeSelect.options).find((o) => cleanStr(o.textContent || '').includes(targetText)) || docTypeSelect.options[1];
          if (opt) {
            docTypeSelect.value = opt.value;
            docTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }, isEmpresa);

      await new Promise(r => setTimeout(r, 1000));

      const fileInputHandle = await page.$('input[type="file"]');
      if (fileInputHandle) {
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const tempPath = path.join(os.tmpdir(), `temp_dni_${Date.now()}.pdf`);
        fs.writeFileSync(tempPath, buffer);

        await fileInputHandle.uploadFile(tempPath);
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, input, a, div')) as HTMLElement[];
          const uploadBtn = elements.find((el) => /cargar su documentación|subir|adjuntar/i.test(el.textContent || (el as HTMLInputElement).value || ''));
          if (uploadBtn) uploadBtn.click();
        });

        await new Promise(r => setTimeout(r, 2000));
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }

    // 5. REVISAR CAPTCHA
    const hasCaptcha = await page.evaluate(() => {
      const captchaFrame = document.querySelector('iframe[src*="captcha"], iframe[src*="recaptcha"], div.g-recaptcha');
      return !!captchaFrame;
    });

    if (hasCaptcha) {
      console.log('⚠️ [CAPTCHA DETECTADO] Se ha identificado una prueba anti-bot en la pantalla.');
      await new Promise(r => setTimeout(r, 5000));
    }

    // 🎯 6. MARCAR CHECKBOX Y ENVIAR CON EL BOTÓN EXACTO <a id="btnEnviar">
    const termsCheckHandle = await page.$('input[type="checkbox"]');
    if (termsCheckHandle) {
      await termsCheckHandle.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('🚀 Presionando el botón "Enviar" (<a id="btnEnviar"> / submit_formulario)...');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {}),
      page.evaluate(() => {
        // 1. Invocar la función nativa del script de Camerfirma
        if (typeof (window as any).submit_formulario === 'function') {
          (window as any).submit_formulario(0);
          return;
        }

        // 2. Hacer click directo al botón con ID btnEnviar
        const btnEnviar = document.getElementById('btnEnviar') as HTMLElement;
        if (btnEnviar) {
          btnEnviar.click();
          return;
        }

        // 3. Buscar enlace con la clase o texto Enviar
        const links = Array.from(document.querySelectorAll('a')) as HTMLElement[];
        const sendLink = links.find(l => l.id === 'btnEnviar' || (l.textContent || '').includes('Enviar'));
        if (sendLink) {
          sendLink.click();
        }
      })
    ]);

    await new Promise(r => setTimeout(r, 2000));

    // 7. PANTALLA SECUNDARIA (CHECKBOX AY)
    const checkboxAyHandle = await page.$('input[name="AY"]');
    if (checkboxAyHandle) {
      console.log('☑️ Marcando checkbox "AY" (SI)...');
      await checkboxAyHandle.click();
      await new Promise(r => setTimeout(r, 1200));

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        page.evaluate(() => {
          const sendLink = document.querySelector('a[href*="enviar"], a.boton, input[value="Enviar"]') as HTMLElement;
          if (sendLink) {
            sendLink.click();
          } else if (typeof (window as any).enviar === 'function') {
            (window as any).enviar();
          }
        })
      ]);

      console.log('🎉 Presolicitud enviada y confirmada en Camerfirma.');
    }

    return { success: true };

  } catch (error: any) {
    console.error('✕ [Camerfirma Service Error]:', error.message || error);
    throw error;
  }
};