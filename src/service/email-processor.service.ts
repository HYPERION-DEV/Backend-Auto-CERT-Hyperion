import imaps from 'imap-simple';
import { PrismaClient } from '@prisma/client';
import puppeteer, { Browser } from 'puppeteer';
import { forwardCamerfirmaEmailToUser } from './email.service';

const prisma = new PrismaClient() as any;

function cleanQuotedPrintable(rawBody: string): string {
  if (!rawBody) return '';
  return rawBody
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=26/gi, '&')
    .replace(/&amp;/g, '&');
}

/**
 * 🎯 Extrae únicamente la parte HTML/Texto limpia del correo,
 * descartando cabeceras de red (Delivered-To, ARC-Seal, etc.).
 */
function extractCleanHtmlBody(parts: any[]): string {
  let htmlBody = '';

  for (const part of parts) {
    if (part.which === 'TEXT' || part.which === '1' || part.which === '1.2' || !part.which) {
      const bodyStr = typeof part.body === 'string' ? part.body : '';
      if (bodyStr) {
        htmlBody += bodyStr;
      }
    }
  }

  let clean = cleanQuotedPrintable(htmlBody);

  // 🎯 1. Eliminar delimitadores de límite Multipart si existen
  clean = clean.replace(/--==Multipart_Boundary_[^\r\n]+/gi, '');
  clean = clean.replace(/Content-Type:[^\r\n]+/gi, '');
  clean = clean.replace(/Content-Transfer-Encoding:[^\r\n]+/gi, '');

  // 🎯 2. Extraer desde el primer tag HTML si hay cabeceras previas
  if (clean.includes('Delivered-To:') || clean.includes('Received:')) {
    const htmlStartMatch = clean.match(/(<html|<div|<p|Solicitud de Certificado|Estimado)/i);
    if (htmlStartMatch && htmlStartMatch.index !== undefined) {
      clean = clean.substring(htmlStartMatch.index);
    }
  }

  // 🎯 3. Si el correo viene repetido por multipart, tomar solo el primer bloque HTML completo
  const htmlEndIndex = clean.toLowerCase().lastIndexOf('</html>');
  const firstHtmlIndex = clean.toLowerCase().indexOf('<html');

  if (firstHtmlIndex !== -1 && htmlEndIndex !== -1 && htmlEndIndex > firstHtmlIndex) {
    clean = clean.substring(firstHtmlIndex, htmlEndIndex + 7);
  }

  return clean.trim();
}

export class EmailProcessorService {
  static async processIncomingEmailsForDni(dni: string, existingPage?: any) {
    const domain = process.env.INBOUND_EMAIL_DOMAIN || 'lectordnie.com';
    const targetRecipient = `${dni}@${domain}`;

    const imapConfig = {
      imap: {
        user: process.env.GMAIL_USER || process.env.IMAP_USER || '',
        password: process.env.GMAIL_APP_PASSWORD || process.env.IMAP_PASS || '',
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: Number(process.env.IMAP_PORT) || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      },
    };

    let connection: any;

    try {
      const certModel = prisma.certificateRequest || prisma.CertificateRequest;
      const certRequest = await certModel.findFirst({
        where: { applicantDocNum: dni },
      });

      if (!certRequest) {
        console.error(`✕ [Email Processor] No existe expediente para DNI: ${dni}`);
        return { error: 'Expediente no encontrado' };
      }

      console.log(`📡 [Email Processor] Revisando bandeja para DNI ${dni}...`);
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');

      const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: true };
      const messages = await connection.search(['ALL'], fetchOptions);

      if (messages.length === 0) {
        connection.end();
        return { processed: 0 };
      }

      let step1ConfirmUrl: string | null = null;
      let validationEmailBody: string | null = null;
      let validationSubject: string | null = null;

      for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        let subject = '';

        const headerPart = item.parts.find((p: any) => p.which === 'HEADER');
        if (headerPart && headerPart.body && headerPart.body.subject) {
          subject = headerPart.body.subject[0] || '';
        }

        // 🎯 1. Extraer ÚNICAMENTE el HTML/Texto limpio de la parte correspondiente
        const cleanBody = extractCleanHtmlBody(item.parts);

        // A. Detectar correo de Confirmación de Validación (Correo Final)
        if (
          subject.toLowerCase().includes('confirmación de validación') ||
          cleanBody.includes('HA VALIDADO SU SOLICITUD DE PETICIÓN DE CERTIFICADO')
        ) {
          validationEmailBody = cleanBody;
          validationSubject = subject;
          break;
        }

        // B. Detectar enlace del Paso 1 (Solo si aún no se ha confirmado)
        if (!step1ConfirmUrl && (cleanBody.includes(dni) || cleanBody.includes(targetRecipient))) {
          const match = cleanBody.match(/https?:\/\/secure\.camerfirma\.com\/solicitudes_status\/paso_a_solicitud_1[^\s"'>]+/gi);
          if (match && match.length > 0) {
            step1ConfirmUrl = match[0];
          }
        }
      }

      const personalEmail = certRequest.applicantEmail; // m.conde@hyperion.com.pe / o.martinez@hyperion.com.pe

      // 🎯 SI YA LLEGÓ EL CORREO FINAL DE VALIDACIÓN: REENVIAR LIMPIO, GUARDAR LOG Y TERMINAR
      // 🎯 DENTRO DE src/service/email-processor.service.ts

      if (validationEmailBody && personalEmail) {
        const emailLogModel = prisma.camerfirmaEmailLog || prisma.CamerfirmaEmailLog;

        // 🎯 1. Verificar si este correo de validación ya fue guardado previamente
        const existingLog = await emailLogModel.findFirst({
          where: {
            certificateRequestId: certRequest.id,
            subject: validationSubject || 'Confirmación de Validación de Solicitud de Certificado Digital',
          },
        });

        // 🎯 2. Si NO existe en la BD, lo reenviamos y creamos el registro por única vez
        if (!existingLog) {
          console.log(`✉️ [Email Processor] Reenviando correo oficial limpio a ${personalEmail}...`);

          await forwardCamerfirmaEmailToUser({
            to: personalEmail,
            subject: validationSubject || 'Confirmación de Validación de Solicitud de Certificado Digital',
            originalHtmlBody: validationEmailBody,
            certificateId: certRequest.id,
          });

          await emailLogModel.create({
            data: {
              certificateRequestId: certRequest.id,
              fromEmail: 'certificados@camerfirma.com',
              toEmail: targetRecipient,
              subject: validationSubject || 'Confirmación de Validación de Solicitud de Certificado Digital',
              bodyHtml: validationEmailBody,
              emailSequenceNumber: 1,
              isFinalForwarded: true,
            },
          });

          await certModel.updateMany({
            where: { applicantDocNum: dni },
            data: { status: 'APROBADO' },
          });
        } else {
          console.log(`ℹ️ [Email Processor] El correo de validación ya se encuentra registrado.`);
        }

        connection.end();
        return { processed: existingLog ? 0 : 1, type: 'FORWARDED_VALIDATION' };
      }

      // 🎯 3. SI SÓLO LLEGÓ EL LINK DEL PASO 1 Y EL CERTIFICADO AÚN NO ESTÁ CONFIRMADO: AUTOMATIZAR MARCA "SI"
      if (step1ConfirmUrl && certRequest.status !== 'APROBADO') {
        const cleanUrl = cleanQuotedPrintable(step1ConfirmUrl)
          .replace(/&amp;/g, '&')
          .replace(/[>"\s]+$/, '');

        console.log(`🔗 [Paso 1 Automatizado] Procesando enlace interno: ${cleanUrl}`);

        let page = existingPage;
        let browser: Browser | null = null;

        if (!page) {
          browser = await puppeteer.launch({
            headless: process.env.NODE_ENV === 'production',
            slowMo: 50,
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
          });
          page = await browser.newPage();
        }

        await page.goto(cleanUrl, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 1500));

        // Marcar "SI"
        await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
          const siOpt = inputs.find((i) => i.value.toUpperCase() === 'SI' || i.type === 'checkbox' || i.type === 'radio');
          if (siOpt) {
            siOpt.checked = true;
            siOpt.dispatchEvent(new Event('change', { bubbles: true }));
            siOpt.dispatchEvent(new Event('click', { bubbles: true }));
          }
        });

        await new Promise((r) => setTimeout(r, 1000));

        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => { }),
          page.evaluate(() => {
            if (typeof (window as any).enviar === 'function') {
              (window as any).enviar();
            } else {
              const btn = document.querySelector('input[value="Enviar"], input[type="submit"], button, a.boton') as HTMLElement;
              if (btn) btn.click();
            }
          }),
        ]);

        console.log('🎉 [Paso 1 Automatizado] Confirmación de enlace completada.');

        if (browser) await browser.close();

        connection.end();
        return { processed: 1, type: 'STEP_1_CONFIRMED' };
      }

      connection.end();
      return { processed: 0 };
    } catch (error: any) {
      console.error('✕ [Email Processor Error]:', error.message || error);
      if (connection) connection.end();
      throw error;
    }
  }
}