// backend-hyperion/src/services/camerfirmaAutomation.ts

import { chromium } from 'playwright';

interface AutomationPayload {
  entityType: 'PERSONA_NATURAL' | 'EMPRESA';
  // Datos Solicitante
  documentNumber: string;
  firstNames: string;
  lastName1: string;
  lastName2: string;
  email: string;
  phone: string;
  address?: string;
  department?: string;
  province?: string;
  district?: string;
  cargo?: string;
  // Datos Empresa (Si aplica)
  companyRuc?: string;
  companyName?: string;
  // Rutas de Archivos en Servidor
  fileDniPath?: string;
  fileRucPath?: string;
  fileVigenciaPath?: string;
}

export async function submitCamerfirmaForm(data: AutomationPayload) {
  // Configuración de URL según perfil
  const url = data.entityType === 'EMPRESA'
    ? 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=1D1AGUUN&num_perfil=13080'
    : 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040';

  const browser = await chromium.launch({ headless: false }); // Cambiar a false para depurar visualmente
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // -------------------------------------------------------------
    // SECCIÓN 1: DATOS DE LA ENTIDAD (SOLO PERSONA JURÍDICA / 13080)
    // -------------------------------------------------------------
    if (data.entityType === 'EMPRESA') {
      // Selección de Tipo de Doc Empresarial (RUC)
      await page.selectOption('select[name*="tipo_doc_emp"]', { label: 'RUC' });
      await page.fill('input[name*="organizacion"]', data.companyName || '');
      await page.fill('input[name*="num_doc_emp"]', data.companyRuc || '');
      
      // Ubigeo Empresa
      if (data.department) await page.selectOption('select[name*="dep_emp"]', { label: data.department.toUpperCase() });
      if (data.province) await page.selectOption('select[name*="prov_emp"]', { label: data.province.toUpperCase() });
      if (data.district) await page.selectOption('select[name*="dist_emp"]', { label: data.district.toUpperCase() });

      await page.fill('input[name*="domicilio_emp"]', data.address || 'LIMA');
      await page.fill('input[name*="telefono_emp"]', data.phone);
    }

    // -------------------------------------------------------------
    // SECCIÓN 2: DATOS DEL SOLICITANTE / PERSONA NATURAL
    // -------------------------------------------------------------
    await page.fill('input[name*="nombre"]', data.firstNames);
    await page.fill('input[name*="apellido1"]', data.lastName1);
    await page.fill('input[name*="apellido2"]', data.lastName2);

    // Tipo y Número de Documento Solicitante
    await page.selectOption('select[name*="tipo_doc_sol"]', { label: 'DNI' });
    await page.fill('input[name*="num_doc_sol"]', data.documentNumber);

    if (data.entityType === 'PERSONA_NATURAL') {
      // Ubigeo Persona Natural
      if (data.department) await page.selectOption('select[name*="dep_sol"]', { label: data.department.toUpperCase() });
      if (data.province) await page.selectOption('select[name*="prov_sol"]', { label: data.province.toUpperCase() });
      if (data.district) await page.selectOption('select[name*="dist_sol"]', { label: data.district.toUpperCase() });
      
      await page.fill('input[name*="domicilio_sol"]', data.address || 'LIMA');
      await page.fill('input[name*="telefono_sol"]', data.phone);
    } else {
      // Campos extra en Empresa
      await page.fill('input[name*="cargo"]', data.cargo || 'GERENTE GENERAL');
    }

    // Correos Electrónicos
    await page.fill('input[name*="email"]', data.email);
    await page.fill('input[name*="rep_email"]', data.email);

    // -------------------------------------------------------------
    // SECCIÓN 3: CARGA DE DOCUMENTACIÓN PDF
    // -------------------------------------------------------------
    if (data.fileDniPath) {
      // Seleccionar tipo de documento DNI en la lista desplegable
      await page.selectOption('select[name*="tipo_documento"]', { index: 1 });
      // Adjuntar archivo PDF al input file
      await page.setInputFiles('input[type="file"]', data.fileDniPath);
    }

    // -------------------------------------------------------------
    // SECCIÓN 4: ACEPTAR TÉRMINOS Y ENVIAR
    // -------------------------------------------------------------
    // Marcar la casilla de Términos y Condiciones
    await page.check('input[type="checkbox"]');

    // Click en el botón Enviar
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('input[type="submit"], button:has-text("Enviar")'),
    ]);

    // Obtener la URL resultante o el código de confirmación generado
    const finalUrl = page.url();
    console.log('✅ Formulario enviado con éxito a Camerfirma. URL:', finalUrl);

    await browser.close();
    return { success: true, finalUrl };

  } catch (error: any) {
    await browser.close();
    console.error('❌ Error realizando web scraping en Camerfirma:', error);
    throw new Error(`Error en automatización de Camerfirma: ${error.message}`);
  }
}