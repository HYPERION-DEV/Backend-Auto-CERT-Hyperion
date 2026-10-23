import { google } from 'googleapis';

/**
 * Limpia y decodifica el cuerpo Quoted-Printable sin destruir los signos `=`
 */
function cleanQuotedPrintable(rawBody: string): string {
  if (!rawBody) return '';
  return rawBody
    .replace(/=\r?\n/g, '') // Eliminar saltos de línea suaves de MIME
    .replace(/=3D/gi, '=')   // Decodificar el signo '='
    .replace(/=26/gi, '&')   // Decodificar '&'
    .replace(/&amp;/g, '&'); // Normalizar entidades HTML
}

/**
 * Extrae limpiamente el cuerpo HTML de la estructura multipart de Gmail API
 */
function extractBodyFromPayload(payload: any): string {
  if (!payload) return '';

  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        const subBody = extractBodyFromPayload(part);
        if (subBody) return subBody;
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
  }

  return '';
}

export class EmailReaderService {
  private static getGmailClient() {
    const auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    return google.gmail({ version: 'v1', auth });
  }

  /**
   * FASE 1: Extrae la URL de auto-confirmación (paso_a_solicitud_1.php)
   */
  /**
   * FASE 1: Extrae el enlace de auto-confirmación (paso_a_solicitud_1.php)
   */
  static async extractConfirmationUrl(
    dni: string,
    fullName?: string
  ): Promise<{ confirmUrl: string | null; cleanHtml: string }> {
    try {
      const gmail = this.getGmailClient();
      const targetAlias = `${dni}@lectordnie.com`.toLowerCase();

      // 🎯 Consulta exacta idéntica al buscador de Gmail: busca por el alias directo o el DNI
      const query = `"${targetAlias}" OR "${dni}"`;
      console.log(`🔎 [EmailReaderService] Buscando correos con query: ${query}`);

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 20,
      });

      const messages = listRes.data.messages;
      if (!messages || messages.length === 0) {
        console.log(`⚠️ [EmailReaderService] No se encontraron mensajes para ${targetAlias}`);
        return { confirmUrl: null, cleanHtml: '' };
      }

      for (const msgRef of messages) {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id!,
          format: 'full',
        });

        const rawText = extractBodyFromPayload(msgRes.data.payload);
        const cleanText = cleanQuotedPrintable(rawText);

        // Buscar enlaces a paso_a_solicitud_1.php
        const match =
          cleanText.match(/https?:\/\/[^\s"'>]*paso_a_solicitud_1\.php[^\s"'>]*/gi) ||
          cleanText.match(/href=["']([^"']*paso_a_solicitud_1[^"']*)["']/i);

        if (match) {
          const rawUrl = Array.isArray(match) ? match[0] || match[1] : match;
          const confirmUrl = rawUrl.replace(/&amp;/g, '&').replace(/^href=["']/, '').replace(/[>"\s]+$/, '').trim();

          console.log(`🎯 [EmailReaderService] URL de Confirmación (Fase 1) detectada para DNI ${dni}:\n   ${confirmUrl}`);
          return { confirmUrl, cleanHtml: cleanText };
        }
      }

      return { confirmUrl: null, cleanHtml: '' };
    } catch (error: any) {
      console.error('💥 [EmailReaderService Error Fase 1]:', error.message);
      return { confirmUrl: null, cleanHtml: '' };
    }
  }

  /**
   * FASE 2: Extrae el enlace de la página oficial de descarga (Confirmación de Validación)
   */
  static async extractDownloadUrl(dni: string): Promise<{ downloadUrl: string | null; emailSubject: string }> {
    try {
      const gmail = this.getGmailClient();
      const targetAlias = `${dni}@lectordnie.com`.toLowerCase();

      // 🎯 Busca en los correos del expediente que contengan "descarga" o "Validación"
      const query = `("${targetAlias}" OR "${dni}") (descarga OR validación OR validacion)`;
      console.log(`🔎 [EmailReaderService] Buscando enlace de descarga con query: ${query}`);

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 20,
      });

      const messages = listRes.data.messages;
      if (!messages || messages.length === 0) {
        return { downloadUrl: null, emailSubject: '' };
      }

      for (const msgRef of messages) {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id!,
          format: 'full',
        });

        const headers = msgRes.data.payload?.headers || [];
        const headerSubject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';

        const rawText = extractBodyFromPayload(msgRes.data.payload);
        const cleanText = cleanQuotedPrintable(rawText);

        // 🎯 Extrae el enlace a la página de descarga oficial de Camerfirma
        const match =
          cleanText.match(/href=["']([^"']*descarga[^"']*)["']/i) ||
          cleanText.match(/https?:\/\/[^\s"'>]*camerfirma[^\s"'>]*descarga[^\s"'>]*/gi) ||
          cleanText.match(/https?:\/\/status\.camerfirma\.com\/[^\s"'>]+/gi);

        if (match) {
          const rawUrl = Array.isArray(match) ? match[1] || match[0] : match;
          const downloadUrl = rawUrl.replace(/&amp;/g, '&').replace(/^href=["']/, '').replace(/[>"\s]+$/, '').trim();

          console.log(`🎯 [EmailReaderService] Enlace Oficial de Descarga (Fase 2) interceptado para DNI ${dni}:\n   ${downloadUrl}`);

          return {
            downloadUrl,
            emailSubject: headerSubject || 'Confirmación de Validación de Solicitud de Certificado Digital',
          };
        }
      }

      return { downloadUrl: null, emailSubject: '' };
    } catch (error: any) {
      console.error(`💥 [EmailReaderService Error Fase 2 DNI ${dni}]:`, error.message);
      return { downloadUrl: null, emailSubject: '' };
    }
  }
}