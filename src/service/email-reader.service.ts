import imaps, { ImapSimple } from 'imap-simple';
import { simpleParser } from 'mailparser';

const config: imaps.ImapSimpleOptions = {
  imap: {
    user: process.env.GMAIL_USER || '',
    password: process.env.GMAIL_APP_PASSWORD || '',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    authTimeout: 5000,
  },
};

export async function obtenerLinkCamerfirma(timeoutMs = 60000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    let connection: ImapSimple | null = null;
    try {
      connection = await imaps.connect(config);
      await connection.openBox('INBOX');

      const searchCriteria = ['UNSEEN'];
      const fetchOptions = { bodies: [''], markSeen: true };
      const messages = await connection.search(searchCriteria, fetchOptions);

      for (const item of messages) {
        const allParts = item.parts.find((part: any) => part.which === '');
        if (allParts) {
          const parsed = await simpleParser(allParts.body);
          const htmlContent = parsed.html || parsed.textAsHtml || parsed.text || '';

          // Regex para detectar la URL de verificación de Camerfirma
          const match = htmlContent.match(/href="(https:\/\/[^"]*camerfirma[^"]*)"/i);
          if (match) {
            connection.end();
            return match[1];
          }
        }
      }
      connection.end();
    } catch (error) {
      if (connection) {
        connection.end();
      }
    }

    // Esperar 3 segundos antes de volver a consultar la bandeja
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error('Tiempo de espera agotado: No se recibió el correo de Camerfirma.');
}