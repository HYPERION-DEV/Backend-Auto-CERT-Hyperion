import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { EmailProcessorService } from '@/service/email-processor.service';
import { forwardCamerfirmaEmailToUser } from '@/service/email.service'; // 👈 1. Importamos el servicio de correo

const prisma = new PrismaClient() as any;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const certId = resolvedParams.id;

    console.log(`🔍 [check-emails] ID Recibido: ${certId}`);

    const certModel = prisma.certificateRequest || prisma.CertificateRequest;
    const certRequest = await certModel.findUnique({
      where: { id: certId },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Expediente no encontrado' }, { status: 404 });
    }

    console.log(`📩 [check-emails] Procesando DNI: ${certRequest.applicantDocNum}`);

    // 1. Ejecuta el procesamiento de correos IMAP y auto-clic HTTP
    const result: any = await EmailProcessorService.processIncomingEmailsForDni(
      certRequest.applicantDocNum
    );

    // 🎯 2. Reenvío del correo de validación de Camerfirma al correo personal real del cliente
    const personalEmail = certRequest.applicantEmail; // ej: o.martinez@hyperion.com.pe / m.conde@hyperion.com.pe

    if (result && result.validationEmailBody && personalEmail) {
      try {
        await forwardCamerfirmaEmailToUser({
          to: personalEmail, // 👈 Destino: Correo personal real del usuario
          subject: result.validationSubject || 'Confirmación de Validación de Solicitud de Certificado Digital',
          originalHtmlBody: result.validationEmailBody,
          certificateId: certRequest.id,
        });
        console.log(`✉️ [check-emails] Correo de validación reenviado con éxito a: ${personalEmail}`);
      } catch (mailError: any) {
        console.error(`❌ [check-emails] Error al reenviar correo a ${personalEmail}:`, mailError.message || mailError);
      }
    }

    // 3. Re-consultar el expediente actualizado en PostgreSQL para enviar el nuevo estado al Frontend
    const updatedCertRequest = await certModel.findUnique({
      where: { id: certId },
      include: {
        documents: {
          include: {
            verificationResult: true
          }
        },
        emailLogs: true
      },
    });

    return NextResponse.json({
      success: true,
      status: updatedCertRequest?.status || certRequest.status,
      processed: result?.processed || 0,
      certificateRequest: updatedCertRequest,
      result,
    });
  } catch (error: any) {
    console.error('💥 ERROR EN CHECK-EMAILS:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}