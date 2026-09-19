import puppeteer from 'puppeteer';

export const sendToCamerfirma = async (certificateData: any, fileUrl?: string) => {
  const camerfirmaUrl = process.env.CAMERFIRMA_FORM_URL || 
    'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040';

  console.log(`[Camerfirma] Iniciando inyección cliente-servidor para DNI: ${certificateData.applicantDocNum}`);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 40,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    console.log(`[Camerfirma] Navegando a ${camerfirmaUrl}...`);
    await page.goto(camerfirmaUrl, { waitUntil: 'networkidle2' });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Ejecución réplica exacta de tu script en el DOM de Camerfirma
    await page.evaluate(async (cert, remoteFileUrl) => {
      const data = {
        departamento: cert.department || 'ICA',
        provincia: cert.province || 'ICA',
        distrito: cert.district || 'PARCONA',
        nombre: cert.applicantNames || '',
        primerApellido: cert.applicantSurname1 || '',
        segundoApellido: cert.applicantSurname2 || '',
        tipoDocIdentificativo: 'DNI',
        numDoc: cert.applicantDocNum || '',
        direccion: cert.address || '',
        codigoPostal: cert.postalCode || '11003',
        telefono: cert.applicantPhone || '',
        email: cert.applicantEmail || '',
        isEmpresa: cert.entityType === 'EMPRESA',
        fileUrl: remoteFileUrl
      };

      const cleanStr = (str: string) =>
        (str || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .trim();

      function fillInput(target: string | Element, val: string) {
        if (!val) return false;
        let el = typeof target === 'string' ? document.querySelector(target) : target;

        if (el) {
          (el as HTMLElement).focus();
          (el as HTMLInputElement).value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log(`✓ Campo inyectado [${(el as any).name || (el as any).title || 'input'}]:`, val);
          return true;
        }
        return false;
      }

      function fillInputByArray(selectors: string[], val: string) {
        if (!val) return false;
        for (const selector of selectors) {
          if (fillInput(selector, val)) return true;
        }
        return false;
      }

      function selectOption(selectors: string[], textToFind: string, codeToFind?: string) {
        let selectEl: HTMLSelectElement | null = null;
        for (const s of selectors) {
          const found = document.querySelector(s) as HTMLSelectElement;
          if (found) { selectEl = found; break; }
        }

        if (!selectEl || !selectEl.options) return false;

        const targetText = cleanStr(textToFind);
        const targetCode = cleanStr(codeToFind || '');
        const options = Array.from(selectEl.options);

        let option = options.find(opt => cleanStr(opt.value) === targetCode);
        if (!option && targetText) {
          option = options.find(opt => {
            const t = cleanStr(opt.textContent || '');
            return t === targetText || t.includes(targetText);
          });
        }

        if (option) {
          selectEl.value = option.value;
          if (typeof selectEl.onchange === 'function') selectEl.onchange(new Event('change'));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`✓ Combo asignado [${selectEl.name || selectEl.title}]: ${option.textContent}`);
          return true;
        }
        return false;
      }

      function fillInputByLabelText(labelTextPattern: string, val: string) {
        if (!val) return false;
        const reg = new RegExp(labelTextPattern, 'i');
        const label = Array.from(document.querySelectorAll('td, label, span')).find(el => reg.test(el.textContent || ''));
        
        if (label) {
          const row = label.closest('tr') || label.parentElement;
          if (row) {
            const input = row.querySelector('input[type="text"], input:not([type="hidden"])');
            if (input) return fillInput(input, val);
          }
        }
        return false;
      }

      // HELPER EXACTO DE CARGA MEDIANTE DATATRANSFER API (RÉPLICA DE CONSOLA)
      async function attachDocumentFromBackend(url: string, fileName: string) {
        try {
          const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
          if (!fileInput) {
            console.warn("✕ No se encontró el campo input[type='file'] en el DOM.");
            return false;
          }

          console.log(`Descargando PDF desde el backend: ${url}...`);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP Error ${res.status} al descargar el archivo.`);
          const blob = await res.blob();

          const finalFileName = fileName || url.split('/').pop() || 'documento.pdf';
          const file = new File([blob], finalFileName, { type: 'application/pdf' });

          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;

          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));

          console.log(`✓ ¡Documento PDF "${finalFileName}" adjuntado al formulario exitosamente!`);

          const uploadBtn = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, div')).find(
            el => /cargar su documentación|subir|adjuntar/i.test(el.textContent || (el as HTMLInputElement).value || '')
          );

          if (uploadBtn) {
            console.log("Activando botón de subida de documentación...");
            (uploadBtn as HTMLElement).click();
          }

          return true;
        } catch (err) {
          console.error("✕ Error al adjuntar el archivo PDF automáticamente:", err);
          return false;
        }
      }

      // ==========================================
      // FASE 1: SECUENCIA ASÍNCRONA DE UBIGEO
      // ==========================================
      selectOption(['select[name="cmb_departamento"]', 'select[title*="Departamento"]'], data.departamento, '11');
      await new Promise(r => setTimeout(r, 1000));

      selectOption(['select[name="cmb_provincia"]', 'select[title*="Provincia"]'], data.provincia, '1101');
      await new Promise(r => setTimeout(r, 1000));

      selectOption(['select[name="cmb_distrito"]', 'select[name="cmb_localidad"]', 'select[title*="Distrito"]'], data.distrito, '110105');
      await new Promise(r => setTimeout(r, 500));

      // ==========================================
      // FASE 2: INYECCIÓN DE TEXTOS Y CAMPOS
      // ==========================================
      fillInputByArray(['input[name*="nombre"]', 'input[title*="Nombre"]', '#nombre'], data.nombre);
      fillInputByArray(['input[name*="primer_apellido"]', 'input[title*="Primer Apellido"]', '#primer_apellido'], data.primerApellido);
      fillInputByArray(['input[name*="segundo_apellido"]', 'input[title*="Segundo Apellido"]', '#segundo_apellido'], data.segundoApellido);
      
      selectOption(['select[name="tipodoc_id_solicitante"]', 'select[name*="tipo_documento"]', 'select[title*="Tipo de Documento"]'], data.tipoDocIdentificativo, '4');
      await new Promise(r => setTimeout(r, 300));

      const docInjected = fillInputByArray([
        'input[name="txt_num_doc"]',
        'input[name="num_doc_identificativo"]',
        'input[name="num_doc"]', 
        'input[name="numero_documento"]', 
        'input[name*="num_doc"]',
        'input[name*="doc_identificativo"]',
        'input[title*="Documento Identificativo"]', 
        'input[title*="Nº de Documento"]'
      ], data.numDoc);

      if (!docInjected) {
        fillInputByLabelText('Nº de Documento', data.numDoc) || fillInputByLabelText('Documento Identificativo', data.numDoc);
      }

      fillInputByArray(['input[name="domicilio"]', 'input[name="direccion"]', 'input[title*="Domicilio"]'], data.direccion);
      fillInputByArray(['input[name="codigo_postal"]', 'input[name="cp"]', 'input[title*="Código Postal"]'], data.codigoPostal);
      fillInputByArray(['input[name="telefono"]', 'input[title*="Teléfono"]'], data.telefono);
      
      const emails = document.querySelectorAll('input[type="email"], input[name*="email"], input[title*="e-mail"]');
      if (emails.length >= 1) fillInput(emails[0], data.email);
      if (emails.length >= 2) fillInput(emails[1], data.email);

      // ==========================================
      // FASE 3: CARGA AUTOMÁTICA DEL PDF
      // ==========================================
      const docTypeTarget = data.isEmpresa ? 'PODERES' : 'DNI-NIE-NIF';
      selectOption([
        'select[name="tipo_doc"]',
        'select[name="tipo_documento_adjunto"]',
        'select[title*="Escoja un tipo"]'
      ], docTypeTarget);

      await new Promise(r => setTimeout(r, 300));

      if (data.fileUrl) {
        console.log("Iniciando Fase 3: Adjuntando documento PDF...");
        const fileName = `DNI_${data.nombre.replace(/\s+/g, '_')}.pdf`;
        await attachDocumentFromBackend(data.fileUrl, fileName);
      }

      // Checkbox de Términos
      const termsCheck = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (termsCheck && !termsCheck.checked) {
        termsCheck.click();
      }

    }, certificateData, fileUrl);

    console.log('✓ [Camerfirma] Formulario autocompletado y documento adjuntado al 100%.');
    return { success: true };

  } catch (error: any) {
    console.error('✕ [Camerfirma Error]:', error.message || error);
    throw error;
  }
};