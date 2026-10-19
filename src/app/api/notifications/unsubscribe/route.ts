import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const certificateId = searchParams.get('id');

  if (email && certificateId) {
    try {
      // Registrar en el certificado que el usuario solicitó detener notificaciones
      await prisma.certificateRequest.updateMany({
        where: { applicantEmail: email },
        data: { useTempEmail: false },
      });
    } catch (e) {
      console.error('Error al registrar desuscripción:', e);
    }
  }

  return new NextResponse(
    `<html>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #00668c;">Suscripción Cancelada</h2>
        <p>El correo <strong>${email || ''}</strong> ha sido removido de nuestras listas de notificación automática.</p>
        <p style="font-size: 12px; color: #888;">Ya no recibirá más mensajes por este medio.</p>
      </body>
    </html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}