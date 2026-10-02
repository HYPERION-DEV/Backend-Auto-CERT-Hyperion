import imaps from 'imap-simple';
import { JSDOM } from 'jsdom';
import { PrismaClient } from '@prisma/client';
import puppeteer, { Browser } from 'puppeteer';

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

      console.log(`📡 [Email Processor] Obteniendo enlace para ${targetRecipient}...`);
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');

      const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: true };
      const messages = await connection.search(['ALL'], fetchOptions);

      if (messages.length === 0) {
        connection.end();
        return { processed: 0 };
      }

      let confirmUrl: string | null = null;

      for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        let fullRawContent = '';

        for (const part of item.parts) {
          if (part.body) {
            fullRawContent += typeof part.body === 'string' ? part.body : JSON.stringify(part.body);
          }
        }

        const cleanBody = cleanQuotedPrintable(fullRawContent);

        if (cleanBody.includes(dni) || cleanBody.includes(targetRecipient)) {
          const directMatch = cleanBody.match(/https?:\/\/secure\.camerfirma\.com\/solicitudes_status\/paso_a_solicitud_[^\s"'>]+/gi);
          if (directMatch && directMatch.length > 0) {
            confirmUrl = directMatch[0];
            break;
          }
        }
      }

      if (confirmUrl) {
        confirmUrl = cleanQuotedPrintable(confirmUrl)
          .replace(/&amp;/g, '&')
          .replace(/[>"\s]+$/, '');

        console.log(`🔗 Navegando en la misma sesión: ${confirmUrl}`);

        let page = existingPage;
        let browser: Browser | null = null;

        // Si no se pasó una pestaña activa, abre una pero manteniendo cookies/headers
        if (!page) {
          browser = await puppeteer.launch({
            headless: false,
            slowMo: 50,
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
          });
          page = await browser.newPage();
        }

        await page.goto(confirmUrl, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 1500));

        // Marcar casilla "SI"
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

        // Forzar la ejecución del envío nativo de Camerfirma
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {}),
          page.evaluate(() => {
            if (typeof (window as any).enviar === 'function') {
              (window as any).enviar();
            } else {
              const btn = document.querySelector('input[value="Enviar"], input[type="submit"], button') as HTMLElement;
              if (btn) btn.click();
            }
          }),
        ]);

        console.log('🎉 Confirmación completada en el mismo nivel de la aplicación.');

        if (browser) await browser.close();

        await certModel.updateMany({
          where: { applicantDocNum: dni },
          data: { status: 'EN_REVISION' },
        });

        connection.end();
        return { processed: 1 };
      }

      connection.end();
      return { processed: 0 };
    } catch (error: any) {
      console.error('✕ Error:', error.message || error);
      if (connection) connection.end();
      throw error;
    }
  }
}