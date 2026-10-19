import nodemailer from 'nodemailer';

const APP_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://cert.hyperion.com.pe';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // Contraseña de aplicación de Google
  },
});

interface SendDownloadCodeParams {
  to: string;
  applicantName: string;
  downloadCode: string;
  certCode: string;
  certificateId: string;
}

interface ForwardCamerfirmaEmailParams {
  to: string;
  subject: string;
  originalHtmlBody: string;
  certificateId: string;
}

export async function sendDownloadCodeEmail({
  to,
  applicantName,
  downloadCode,
  certCode,
  certificateId,
}: SendDownloadCodeParams) {
  const unsubscribeUrl = `${APP_URL}/api/notifications/unsubscribe?email=${encodeURIComponent(to)}&id=${certificateId}`;

  const mailOptions = {
    from: `"Certificados Hyperion" <${process.env.GMAIL_USER}>`,
    to: to,
    subject: `Código de Descarga de Certificado Digital - ${certCode}`,
    
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${process.env.GMAIL_USER}?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Ref-ID': certCode,
      'X-Auto-Response-Suppress': 'OOF, AutoReply',
    },
    
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px;">
        <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <div style="background-color: #00668c; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; tracking-tight: -0.025em;">
              Hyperion Certificados Digitales
            </h1>
          </div>

          <div style="padding: 32px 24px; color: #334155;">
            <p style="font-size: 15px; margin-top: 0; color: #1e293b; font-weight: 600;">
              Estimado(a) ${applicantName},
            </p>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Le informamos que su solicitud de Certificado Digital con código <strong style="color: #0f172a;">${certCode}</strong> ha completado la fase de registro e inyección exitosamente.
            </p>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
              <span style="font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">
                Su Código de Descarga / Acceso
              </span>
              <div style="font-family: 'Courier New', Courier, monospace; font-size: 28px; font-weight: 800; color: #15803d; letter-spacing: 4px;">
                ${downloadCode}
              </div>
            </div>

            <p style="font-size: 13px; line-height: 1.5; color: #64748b;">
              Conserve este código para la descarga, instalación o verificación de su certificado. Si usted no realizó esta solicitud o requiere asistencia, puede contactar a nuestro equipo de soporte.
            </p>
          </div>

          <div style="background-color: #f8fafc; padding: 20px 24px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5;">
            <p style="margin: 0 0 8px 0;">
              Este mensaje fue enviado a <strong>${to}</strong> porque forma parte de la emisión de su Certificado Digital.
            </p>
            <p style="margin: 0;">
              Si no desea recibir más notificaciones o correos automáticos sobre esta cuenta, puede 
              <a href="${unsubscribeUrl}" style="color: #00668c; text-decoration: underline;">
                solicitar la desuscripción aquí
              </a>.
            </p>
          </div>

        </div>
      </body>
      </html>
    `,
  };

  return await transporter.sendMail(mailOptions);
}


/**
 * 🎯 REENVÍO DEL CORREO OFICIAL DE CAMERFIRMA AL CORREO PERSONAL DEL TITULAR (LIMPIO Y DIRECTO)
 */
// En src/service/email.service.ts

export async function forwardCamerfirmaEmailToUser({
  to,
  subject,
  originalHtmlBody,
  certificateId,
}: ForwardCamerfirmaEmailParams) {
  const unsubscribeUrl = `${APP_URL}/api/notifications/unsubscribe?email=${encodeURIComponent(to)}&id=${certificateId}`;

  const mailOptions = {
    from: `"AC Camerfirma" <${process.env.GMAIL_USER}>`,
    to: to,
    subject: subject || 'Confirmación de Validación de Solicitud de Certificado Digital',
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${process.env.GMAIL_USER}?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Ref-ID': certificateId,
    },
    // 🎯 Reenvío del HTML tal cual lo emite Camerfirma
    html: originalHtmlBody,
  };

  return await transporter.sendMail(mailOptions);
}