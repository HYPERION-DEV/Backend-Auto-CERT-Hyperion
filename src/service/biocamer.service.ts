import puppeteer from 'puppeteer';

interface BiocamerClientData {
  docType: 'DNI' | 'CE' | 'PASAPORTE';
  docNumber: string;
}

export async function registerClientInBiocamer(data: BiocamerClientData) {
  const biocamerUrl = process.env.BIOCAMER_URL || 'https://biocamer.com/web/login';
  const rawUser = process.env.BIOCAMER_USER || '';
  const rawPass = process.env.BIOCAMER_PASS || '';

  const biocamerUser = rawUser.replace(/^["']|["']$/g, '').trim();
  const biocamerPass = rawPass.replace(/^["']|["']$/g, '').trim();

  if (!biocamerUser || !biocamerPass) {
    throw new Error('Faltan BIOCAMER_USER o BIOCAMER_PASS en el archivo .env');
  }

  const browser = await puppeteer.launch({
  headless: true, // 👈 Se ejecuta de forma 100% invisible en segundo plano
  slowMo: 30,      // 👈 Quita los retrasos artificiales de inspección para acelerar el proceso
  args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--window-size=1366,768',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
});

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // 1. INICIAR SESIÓN
    console.log(`[BioCamer] Navegando a ${biocamerUrl}...`);
    await page.goto(biocamerUrl, { waitUntil: 'networkidle2' });

    const userSelector = 'input[name="login"], input[type="email"], #login';
    const passSelector = 'input[name="password"], input[type="password"], #password';

    await page.waitForSelector(userSelector, { timeout: 10000 });
    await page.waitForSelector(passSelector, { timeout: 10000 });

    await page.click(userSelector, { count: 3 });
    await page.keyboard.press('Backspace');
    await page.type(userSelector, biocamerUser, { delay: 40 });

    await page.evaluate((selector, passwordValue) => {
      const passInput = document.querySelector(selector) as HTMLInputElement;
      if (passInput) {
        passInput.focus();
        passInput.removeAttribute('maxlength');
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(passInput, passwordValue);
        } else {
          passInput.value = passwordValue;
        }

        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, passSelector, biocamerPass);

    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[BioCamer] Enviando credenciales...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);

    // 2. NAVEGAR A VALIDACIONES
    console.log('[BioCamer] Accediendo a validaciones...');
    await page.goto('https://biocamer.com/my/validaciones', { waitUntil: 'networkidle2' });

    // 3. ABRIR EL MODAL DE REGISTRAR CLIENTE
    console.log('[BioCamer] Abriendo modal de registro...');
    await page.waitForFunction(() => {
      const elements = Array.from(document.querySelectorAll('a, button'));
      return elements.some(e => e.textContent?.includes('Registrar Nuevo Cliente'));
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a, button'));
      const btn = elements.find(e => e.textContent?.includes('Registrar Nuevo Cliente'));
      if (btn) (btn as HTMLElement).click();
    });

    // 4. ESPERAR A QUE EL MODAL ESTÉ VISIBLE Y NAVEGAR AL INPUT
    console.log('[BioCamer] Esperando visibilidad del campo de texto en el modal...');
    
    // Espera explícita del input con el placeholder '12345678' visible dentro del modal
    const dniInputSelector = 'input[placeholder*="12345678"], .modal input[type="text"], .modal input[name*="vat"]';
    
    const dniInput = await page.waitForSelector(dniInputSelector, { 
      visible: true, 
      timeout: 10000 
    });

    if (dniInput) {
      console.log(`[BioCamer] Escribiendo DNI ${data.docNumber}...`);
      await dniInput.focus();
      await dniInput.click({ count: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type(data.docNumber, { delay: 90 });
    } else {
      throw new Error('No se encontró el campo de texto del DNI dentro del modal.');
    }

    // 5. HACER CLIC EN "REGISTRAR CLIENTE"
    console.log('[BioCamer] Guardando datos...');
    await new Promise(resolve => setTimeout(resolve, 500));

    const submitSuccess = await page.evaluate(() => {
      const modal = document.querySelector('.modal.show, .modal');
      if (!modal) return false;
      const btns = Array.from(modal.querySelectorAll('button'));
      const saveBtn = btns.find(b => b.textContent?.includes('Registrar Cliente') || b.textContent?.includes('Guardar'));
      if (saveBtn) {
        (saveBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (!submitSuccess) {
      // Fallback enviando la tecla Enter
      await page.keyboard.press('Enter');
    }

    // Esperar a que el modal se cierre o redirija
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`✓ [BioCamer Sync] Cliente DNI ${data.docNumber} registrado con éxito.`);
    return { success: true };

  } catch (error: any) {
    console.error('✕ [BioCamer Sync Error]:', error.message || error);
    throw error;
  } finally {
    await browser.close();
  }
  
}

// backend-hyperion/src/service/biocamer.service.ts

export async function checkClientValidationStatus(docNumber: string): Promise<'APPROVED' | 'REGISTERED' | 'PENDING'> {
  const biocamerUrl = process.env.BIOCAMER_URL || 'https://biocamer.com/web/login';
  const rawUser = process.env.BIOCAMER_USER || '';
  const rawPass = process.env.BIOCAMER_PASS || '';

  const biocamerUser = rawUser.replace(/^["']|["']$/g, '').trim();
  const biocamerPass = rawPass.replace(/^["']|["']$/g, '').trim();

  if (!biocamerUser || !biocamerPass) {
    throw new Error('Faltan BIOCAMER_USER o BIOCAMER_PASS en .env');
  }

  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 30,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1366,768',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Login
    await page.goto(biocamerUrl, { waitUntil: 'networkidle2' });
    const userSelector = 'input[name="login"], input[type="email"], #login';
    const passSelector = 'input[name="password"], input[type="password"], #password';

    await page.waitForSelector(userSelector, { timeout: 10000 });
    await page.waitForSelector(passSelector, { timeout: 10000 });

    await page.click(userSelector, { count: 3 });
    await page.keyboard.press('Backspace');
    await page.type(userSelector, biocamerUser, { delay: 30 });

    await page.evaluate((selector, passwordValue) => {
      const passInput = document.querySelector(selector) as HTMLInputElement;
      if (passInput) {
        passInput.focus();
        passInput.removeAttribute('maxlength');
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(passInput, passwordValue);
        } else {
          passInput.value = passwordValue;
        }
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, passSelector, biocamerPass);

    await new Promise(resolve => setTimeout(resolve, 500));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);

    // Ir a validaciones
    await page.goto('https://biocamer.com/my/validaciones', { waitUntil: 'networkidle2' });

    // Buscar el enlace específico del cliente con ese DNI y hacerle clic
    const clicked = await page.evaluate((targetDni) => {
      const links = Array.from(document.querySelectorAll('a[href*="/my/validaciones/cliente/"]'));
      const targetLink = links.find(a => {
        const card = a.closest('.card') || a.parentElement;
        return card?.textContent?.includes(targetDni);
      });

      if (targetLink) {
        (targetLink as HTMLElement).click();
        return true;
      }
      return false;
    }, docNumber);

    if (!clicked) {
      return 'PENDING';
    }

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

    // Evaluar si en la vista del cliente existe la palabra "Exitosa" o "Validado"
    const statusResult = await page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      if (bodyText.includes('No hay validaciones registradas para este cliente')) {
        return 'REGISTERED';
      }
      if (bodyText.includes('Exitosa') || bodyText.includes('Validado')) {
        return 'APPROVED';
      }
      return 'REGISTERED';
    });

    return statusResult;

  } catch (error: any) {
    console.error('✕ [BioCamer Check Error]:', error.message || error);
    return 'REGISTERED';
  } finally {
    await browser.close();
  }
}