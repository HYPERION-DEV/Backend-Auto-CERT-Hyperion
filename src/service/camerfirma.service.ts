import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocationService } from '@/lib/ubigeo-service';

export const sendToCamerfirma = async (certificateData: any, fileUrl?: string) => {
  const isEmpresa = certificateData.entityType === 'EMPRESA';

  // 1. RESOLVER UBICACIÓN Y CÓDIGO POSTAL DESDE LA BASE DE DATOS
  const resolvedLocation = await LocationService.resolveLocationAndZip(
    certificateData.department || 'ICA',
    certificateData.province || 'ICA',
    certificateData.district || 'PARCONA'
  );

  const calculatedPostalCode = certificateData.postalCode || resolvedLocation.postalCode || '11003';

  const camerfirmaUrl = isEmpresa
    ? 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=1D1AGUUN&num_perfil=13080'
    : 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040';

  console.log(`🤖 [Camerfirma Service] Perfil: ${isEmpresa ? 'EMPRESA (13080)' : 'PERSONA NATURAL (13040)'}`);
  console.log(`🌐 [Camerfirma Service] Navegando a ${camerfirmaUrl}...`);

  // Perfil dinámico en carpeta temporal única para evitar el error "userDataDir in use"
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
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(camerfirmaUrl, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ==========================================
    // FASE 1: INYECCIÓN DE CAMPOS Y COMBOS REALES
    // ==========================================
    await page.evaluate(async (cert, isCompany, remoteFileUrl, finalPostalCode, resolvedDept, resolvedProv, resolvedDist) => {
      const cleanStr = (str: string) =>
        (str || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .trim();

      function forceInputValue(el: HTMLInputElement, val: string) {
        if (!el || !val) return false;
        el.disabled = false;
        el.readOnly = false;
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, val);
        } else {
          el.value = val;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }

      function fillInputByArray(selectors: string[], val: string) {
        if (!val) return false;
        for (const selector of selectors) {
          const el = document.querySelector(selector) as HTMLInputElement;
          if (el && forceInputValue(el, val)) return true;
        }
        return false;
      }

      function selectOptionSmart(selectors: string[], targetText: string) {
        let selectEl: HTMLSelectElement | null = null;
        for (const s of selectors) {
          const found = document.querySelector(s) as HTMLSelectElement;
          if (found) { selectEl = found; break; }
        }

        if (!selectEl || !selectEl.options) return false;

        const target = cleanStr(targetText);
        const options = Array.from(selectEl.options);

        let option = options.find(opt => cleanStr(opt.textContent || '') === target);
        if (!option) {
          option = options.find(opt => cleanStr(opt.textContent || '').includes(target));
        }

        // Si no lo encuentra por texto, selecciona el valor de opción por defecto no vacío
        if (!option && options.length > 1) {
          option = options.find(opt => opt.value !== '' && opt.value !== 'SELECCIONAR' && opt.value !== '0');
        }

        if (option) {
          selectEl.value = option.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          selectEl.dispatchEvent(new Event('blur', { bubbles: true }));
          if (typeof selectEl.onchange === 'function') {
            selectEl.onchange(new Event('change'));
          }
          return true;
        }
        return false;
      }

      // 1. Nombres y Apellidos
      fillInputByArray(['input[name*="nombre"]', '#nombre'], cert.applicantNames || '');
      fillInputByArray(['input[name*="primer_apellido"]', 'input[name*="apellido1"]'], cert.applicantSurname1 || '');
      fillInputByArray(['input[name*="segundo_apellido"]', 'input[name*="apellido2"]'], cert.applicantSurname2 || '');

      // 2. 🎯 SELECCIÓN FORZADA DEL "TIPO DE DOCUMENTO IDENTIFICATIVO"
      selectOptionSmart([
        'select[name="tipodoc_id_solicitante"]',
        'select[name*="tipo_doc_sol"]',
        'select[name*="tipodoc_id"]',
        'select[name*="tipo_doc"]'
      ], 'DNI');

      await new Promise(r => setTimeout(r, 600));

      // 3. Ubigeo Asíncrono
      const deptSelectors = isCompany
        ? ['select[name="dep_emp"]', 'select[name="cmb_departamento"]']
        : ['select[name="cmb_departamento"]', 'select[name="dep_sol"]'];

      const provSelectors = isCompany
        ? ['select[name="prov_emp"]', 'select[name="cmb_provincia"]']
        : ['select[name="cmb_provincia"]', 'select[name="prov_sol"]'];

      const distSelectors = isCompany
        ? ['select[name="dist_emp"]', 'select[name="cmb_distrito"]', 'select[name="cmb_localidad"]']
        : ['select[name="cmb_distrito"]', 'select[name="cmb_localidad"]', 'select[name="dist_sol"]'];

      selectOptionSmart(deptSelectors, resolvedDept);
      await new Promise(r => setTimeout(r, 1000));

      selectOptionSmart(provSelectors, resolvedProv);
      await new Promise(r => setTimeout(r, 1000));

      selectOptionSmart(distSelectors, resolvedDist);
      await new Promise(r => setTimeout(r, 800));

      // 4. Inyección NIF / DNI / Dirección / CP / Teléfono
      fillInputByArray([
        '#nif_solicitante',
        'input[name="nif_solicitante"]',
        'input[name="txt_num_doc"]',
        'input[name="num_doc_sol"]'
      ], cert.applicantDocNum || '');

      fillInputByArray(['input[name="domicilio"]', 'input[name="direccion"]'], cert.address || '');
      fillInputByArray(['input[name="cp_solicitante"]', 'input[name="codigo_postal"]', 'input[name="cp"]'], finalPostalCode);
      fillInputByArray(['input[name="telefono"]'], cert.applicantPhone || '');

      const emails = document.querySelectorAll('input[type="email"], input[name*="email"]');
      if (emails[0]) forceInputValue(emails[0] as HTMLInputElement, cert.applicantEmail || '');
      if (emails[1]) forceInputValue(emails[1] as HTMLInputElement, cert.applicantEmail || '');

      // 5. 🎯 SELECCIÓN FORZADA DEL "ESCOJA UN TIPO DE DOCUMENTO" (ADJUNTO)
      const docTypeTarget = isCompany ? 'PODERES' : 'DNI-NIE-NIF';
      selectOptionSmart([
        'select[name="tipo_doc"]',
        'select[name="tipo_documento_adjunto"]',
        'select[name*="tipo_documento"]'
      ], docTypeTarget);

      await new Promise(r => setTimeout(r, 800));

    }, certificateData, isEmpresa, fileUrl, calculatedPostalCode, resolvedLocation.department, resolvedLocation.province, resolvedLocation.district);

    // ==========================================
    // FASE 2: SUBIDA DEL PDF DEL DNI Y CLIC EN EL BOTÓN
    // ==========================================
    if (fileUrl) {
      console.log('📄 [Camerfirma Service] Subiendo archivo PDF...');
      
      const fileInputHandle = await page.$('input[type="file"]');
      if (fileInputHandle) {
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const tempPath = path.join(os.tmpdir(), `temp_dni_${Date.now()}.pdf`);
        fs.writeFileSync(tempPath, buffer);

        // Subir archivo al input file
        await fileInputHandle.uploadFile(tempPath);
        await new Promise(r => setTimeout(r, 1000));

        // Pulsar el botón celeste "Haga clic aquí para cargar su documentación"
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, div'));
          const uploadBtn = buttons.find(
            el => /cargar su documentación|subir|adjuntar/i.test(el.textContent || (el as HTMLInputElement).value || '')
          );
          if (uploadBtn) {
            (uploadBtn as HTMLElement).click();
          }
        });

        await new Promise(r => setTimeout(r, 2000));

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }

    // ==========================================
    // FASE 3: MARCAR TÉRMINOS Y HABILITAR BOTÓN ENVIAR
    // ==========================================
    await page.evaluate(() => {
      const termsCheck = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (termsCheck && !termsCheck.checked) {
        termsCheck.click();
        termsCheck.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    console.log('✓ [Camerfirma Service] Todo el formulario, combos y documento han sido completados.');
    return { success: true };

  } catch (error: any) {
    console.error('✕ [Camerfirma Service Error]:', error.message || error);
    throw error;
  }
};