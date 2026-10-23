import imaps from 'imap-simple';
import { PrismaClient } from '@prisma/client';
import puppeteer, { Browser } from 'puppeteer';
import { sendDownloadCodeEmail } from './email.service';

const prisma = new PrismaClient() as any;

function cleanQuotedPrintable(rawBody: string): string {
  if (!rawBody) return '';
  return rawBody
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=26/gi, '&')
    .replace(/&amp;/g, '&');
}

export class EmailProcessorService {
  static async processIncomingEmailsForDni(dni: string, existingPage?: any) {
    const imapConfig = {
      imap: {
        user: process.env.GMAIL_USER || process.env.IMAP_USER || '',
        password: process.env.GMAIL_APP_PASSWORD || process.env.IMAP_PASS || '',
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: Number(process.env.IMAP_PORT) || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 15000,
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

      console.log(`📡 [Email Processor] Filtrando correos de Camerfirma en Gmail para DNI: ${dni}...`);
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');

      // 🎯 OPTIMIZACIÓN: Filtrado directo en servidor por remitente 'camerfirma.com' (< 500ms)
      const searchCriteria = [['HEADER', 'FROM', 'camerfirma.com']];
      const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: true };

      let messages = await connection.search(searchCriteria, fetchOptions);

      // Si no encuentra por FROM, hace búsqueda de respaldo rápida en los últimos 5 correos recibidos
      if (!messages || messages.length === 0) {
        const allSearch = await connection.search(['ALL'], { bodies: ['HEADER'], markSeen: false });
        if (allSearch && allSearch.length > 0) {
          const recentUids = allSearch.slice(-5).map((m: any) => m.attributes.uid);
          messages = await connection.search([['UID', recentUids.join(',')]], fetchOptions);
        }
      }

      if (!messages || messages.length === 0) {
        console.log(`ℹ️ [Email Processor] No se hallaron correos de Camerfirma en el buzón.`);
        connection.end();
        return { processed: 0 };
      }

      let confirmUrl: string | null = null;
      let capturedBodyHtml: string = '';

      // Iterar desde el mensaje más reciente hacia el más antiguo
      for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        let fullRawContent = '';

        for (const part of item.parts) {
          if (part.body) {
            fullRawContent += typeof part.body === 'string' ? part.body : JSON.stringify(part.body);
          }
        }

        const cleanBody = cleanQuotedPrintable(fullRawContent);
        const directMatch = cleanBody.match(/https?:\/\/secure\.camerfirma\.com\/solicitudes_status\/paso_a_solicitud_[^\s"'>]+/gi);

        if (directMatch && directMatch.length > 0) {
          confirmUrl = directMatch[0];
          capturedBodyHtml = cleanBody;
          break; // Tomar el enlace más reciente
        }
      }

      connection.end();

      // =========================================================================
      // NAVEGACIÓN Y AUTO-ACEPTACIÓN CON PUPPETEER
      // =========================================================================
      if (confirmUrl) {
        confirmUrl = cleanQuotedPrintable(confirmUrl)
          .replace(/&amp;/g, '&')
          .replace(/[>"\s]+$/, '');

        console.log(`🔗 [Email Processor] Enlace capturado exitosamente: ${confirmUrl}`);

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

        await page.goto(confirmUrl, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 1000));

        // 1. Marcar casilla "SI"
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

        // 2. Ejecutar enviar()
        console.log('🚀 [Email Processor] Confirmando solicitud en la web de Camerfirma...');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {}),
          page.evaluate(() => {
            if (typeof (window as any).enviar === 'function') {
              (window as any).enviar();
            } else {
              const btn = document.querySelector('input[value="Enviar"], input[type="submit"], button, a.boton') as HTMLElement;
              if (btn) btn.click();
            }
          }),
        ]);

        await new Promise((r) => setTimeout(r, 2000));

        // 3. Extraer Código de Proyecto
        const camerfirmaCode = await page.evaluate(() => {
          const cleanStr = (s: string) => (s || '').trim();

          const projectInput = document.querySelector('input[name*="codpro"], input[name*="codigo"], input[name*="cod_proyecto"]') as HTMLInputElement;
          if (projectInput && projectInput.value) return cleanStr(projectInput.value);

          const fullText = document.body.innerText || '';
          const match = fullText.match(/(?:C[óo]digo(?:\s+de)?\s*(?:Proyecto|Descarga|Acceso))\s*[:\=]?\s*([A-Z0-9]{5,15})/i);
          if (match && match[1]) return cleanStr(match[1]);

          return null;
        });

        console.log(`🔑 [Camerfirma Extractor] Código real obtenido: ${camerfirmaCode || 'NO ENCONTRADO'}`);

        if (browser) await browser.close();

        // 4. Guardar Log en PostgreSQL
        const emailLogModel = prisma.camerfirmaEmailLog || prisma.CamerfirmaEmailLog;
        await emailLogModel.create({
          data: {
            certificateRequestId: certRequest.id,
            fromEmail: 'certificados@camerfirma.com',
            toEmail: `${dni}@lectordnie.com`,
            subject: 'Confirmación de Solicitud de Certificado Digital',
            bodyHtml: capturedBodyHtml || `<p>Enlace procesado: <a href="${confirmUrl}">${confirmUrl}</a></p>`,
            emailSequenceNumber: 1,
            isFinalForwarded: false,
          },
        });

        // 5. Actualizar estado a APROBADO
        await certModel.updateMany({
          where: { applicantDocNum: dni },
          data: { status: 'APROBADO' },
        });

        // 6. Enviar Correo al Usuario
        const personalEmail = certRequest.applicantEmail;
        if (camerfirmaCode && personalEmail) {
          try {
            await sendDownloadCodeEmail({
              to: personalEmail,
              applicantName: `${certRequest.applicantNames || ''} ${certRequest.applicantSurname1 || ''}`.trim(),
              downloadCode: camerfirmaCode,
              certCode: certRequest.code,
              certificateId: certRequest.id,
            });
            console.log(`✉️ [Éxito] Código (${camerfirmaCode}) reenviado a ${personalEmail}`);
          } catch (mailError) {
            console.error(`❌ Error al enviar correo a ${personalEmail}:`, mailError);
          }
        }

        return { processed: 1, camerfirmaCode };
      }

      console.log(`ℹ️ [Email Processor] No se hallaron enlaces pendientes de confirmación en el correo.`);
      return { processed: 0 };
    } catch (error: any) {
      console.error('✕ [Email Processor Error]:', error.message || error);
      if (connection) connection.end();
      throw error;
    }
  }
}