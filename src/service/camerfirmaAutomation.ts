import { chromium } from 'playwright';
import { obtenerLinkCamerfirma } from '../service/email-reader.service'; // Adjust the import path as needed

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

  // 🎯 1. Usar el correo de Gmail configurado en tu .env para las pruebas
  const targetEmail = process.env.GMAIL_USER || data.email;

  const browser = await chromium.launch({ 
    headless: process.env.NODE_ENV === 'production',
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();

  try {
    console.log(`🤖 [Camerfirma Playwright] Navegando a solicitud (${data.entityType})...`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // 🎯 2. Formulario Empresa
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

    // 🎯 3. Formulario Datos Personales del Titular / Representante
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

    // 🎯 4. Inyección del correo de prueba en Gmail
    console.log(`📧 [Camerfirma Playwright] Inyectando e-mail de recepción: ${targetEmail}`);
    
    await page.fill('input[name*="email"]', targetEmail);
    await page.dispatchEvent('input[name*="email"]', 'input');
    await page.dispatchEvent('input[name*="email"]', 'change');
    await page.dispatchEvent('input[name*="email"]', 'blur');

    await page.fill('input[name*="rep_email"]', targetEmail);
    await page.dispatchEvent('input[name*="rep_email"]', 'input');
    await page.dispatchEvent('input[name*="rep_email"]', 'change');
    await page.dispatchEvent('input[name*="rep_email"]', 'blur');

    // 🎯 5. Adjuntar Documentación requerida
    if (data.fileDniPath) {
      console.log('📄 [Camerfirma Playwright] Adjuntando PDF de identidad...');
      await page.selectOption('select[name*="tipo_documento"]', { index: 1 });
      await page.setInputFiles('input[type="file"]', data.fileDniPath);
      await page.waitForTimeout(1000);
    }

    // 🎯 6. Aceptación de Términos y Condiciones
    console.log('☑️ [Camerfirma Playwright] Marcando casilla de Términos y Condiciones...');
    const checkbox = page.locator('input[type="checkbox"]').first();
    await checkbox.check();
    await checkbox.dispatchEvent('change');

    await page.waitForTimeout(500);

    // 🎯 7. Envío de Solicitud
    console.log('🚀 [Camerfirma Playwright] Enviando formulario...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click('input[type="submit"], button:has-text("Enviar")'),
    ]);

    const finalUrl = page.url();
    console.log('✅ Formulario enviado con éxito a Camerfirma. URL de respuesta:', finalUrl);

    // 🎯 8. Esperar enlace de verificación en la bandeja de Gmail
    console.log('⏳ [IMAP Reader] Esperando correo de verificación de Camerfirma en Gmail...');
    const verificationUrl = await obtenerLinkCamerfirma(60000); // Espera hasta 60s
    console.log(`🔗 [IMAP Reader] ¡Enlace encontrado!: ${verificationUrl}`);

    // 🎯 9. Abrir el enlace de verificación para completar la activación
    console.log('🚀 [Camerfirma Playwright] Navegando a la URL de verificación...');
    await page.goto(verificationUrl, { waitUntil: 'networkidle' });
    console.log('🎉 [Camerfirma Playwright] ¡Verificación completada con éxito!');

    await browser.close();
    return { success: true, finalUrl, verificationUrl };

  } catch (error: any) {
    await browser.close();
    console.error('❌ Error realizando web scraping en Camerfirma:', error.message || error);
    throw new Error(`Error en automatización de Camerfirma: ${error.message}`);
  }
}