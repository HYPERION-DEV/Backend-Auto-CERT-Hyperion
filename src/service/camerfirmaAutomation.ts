import { chromium } from 'playwright';

interface AutomationPayload {
  entityType: 'PERSONA_NATURAL' | 'EMPRESA';
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
  companyRuc?: string;
  companyName?: string;
  fileDniPath?: string;
  fileRucPath?: string;
  fileVigenciaPath?: string;
}

export async function submitCamerfirmaForm(data: AutomationPayload) {
  const url = data.entityType === 'EMPRESA'
    ? 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=1D1AGUUN&num_perfil=13080'
    : 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040';

  const browser = await chromium.launch({ headless: process.env.NODE_ENV === 'production' });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    if (data.entityType === 'EMPRESA') {
      await page.selectOption('select[name*="tipo_doc_emp"]', { label: 'RUC' });
      await page.fill('input[name*="organizacion"]', data.companyName || '');
      await page.fill('input[name*="num_doc_emp"]', data.companyRuc || '');
      
      if (data.department) await page.selectOption('select[name*="dep_emp"]', { label: data.department.toUpperCase() });
      if (data.province) await page.selectOption('select[name*="prov_emp"]', { label: data.province.toUpperCase() });
      if (data.district) await page.selectOption('select[name*="dist_emp"]', { label: data.district.toUpperCase() });

      await page.fill('input[name*="domicilio_emp"]', data.address || 'LIMA');
      await page.fill('input[name*="telefono_emp"]', data.phone);
    }

    await page.fill('input[name*="nombre"]', data.firstNames);
    await page.fill('input[name*="apellido1"]', data.lastName1);
    await page.fill('input[name*="apellido2"]', data.lastName2);

    await page.selectOption('select[name*="tipo_doc_sol"]', { label: 'DNI' });
    await page.fill('input[name*="num_doc_sol"]', data.documentNumber);

    if (data.entityType === 'PERSONA_NATURAL') {
      if (data.department) await page.selectOption('select[name*="dep_sol"]', { label: data.department.toUpperCase() });
      if (data.province) await page.selectOption('select[name*="prov_sol"]', { label: data.province.toUpperCase() });
      if (data.district) await page.selectOption('select[name*="dist_sol"]', { label: data.district.toUpperCase() });
      
      await page.fill('input[name*="domicilio_sol"]', data.address || 'LIMA');
      await page.fill('input[name*="telefono_sol"]', data.phone);
    } else {
      await page.fill('input[name*="cargo"]', data.cargo || 'GERENTE GENERAL');
    }

    await page.fill('input[name*="email"]', data.email);
    await page.fill('input[name*="rep_email"]', data.email);

    if (data.fileDniPath) {
      await page.selectOption('select[name*="tipo_documento"]', { index: 1 });
      await page.setInputFiles('input[type="file"]', data.fileDniPath);
    }

    await page.check('input[type="checkbox"]');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('input[type="submit"], button:has-text("Enviar")'),
    ]);

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