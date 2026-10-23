import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { EmailReaderService } from '@/service/email-reader.service';
import { CamerfirmaConfirmationService } from '@/service/camerfirma-confirmation.service';
import { sendDownloadCodeEmail } from '@/service/email.service';
import { encryptCode } from '@/lib/crypto';

const prisma = new PrismaClient() as any;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const certId = resolvedParams.id;

    const certModel = prisma.certificateRequest || prisma.CertificateRequest;
    const certRequest = await certModel.findUnique({
      where: { id: certId },
      include: {
        documents: { include: { verificationResult: true } },
        emailLogs: true,
      },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Expediente no encontrado' }, { status: 404 });
    }

    const applicantFullName = `${certRequest.applicantNames || ''} ${certRequest.applicantSurname1 || ''} ${certRequest.applicantSurname2 || ''}`.trim();

    // 🎯 RESTRICCIÓN FASE 2A: Si ya fue verificado previamente con código encriptado en BD
    const hasDownloadCode = Boolean(certRequest.downloadCode);

    if (hasDownloadCode && certRequest.isConfirmed) {
      console.log(`⚡ [check-emails] Expediente previamente verificado con código cifrado. Buscando correo de validación final para DNI: ${certRequest.applicantDocNum}...`);
      
      const { downloadUrl } = await EmailReaderService.extractDownloadUrl(certRequest.applicantDocNum);

      if (downloadUrl) {
        return NextResponse.json({
          success: true,
          alreadyConfirmed: true,
          phase: 2,
          downloadUrl,
          message: 'Página de descarga obtenida con éxito.',
          certificateRequest: certRequest,
        });
      }

      return NextResponse.json({
        success: true,
        alreadyConfirmed: true,
        phase: 1,
        downloadUrl: null,
        message: 'Solicitud autoconfirmada previamente. A la espera de la emisión de la página de descarga por Camerfirma.',
        certificateRequest: certRequest,
      });
    }

    // 🎯 RESTRICCIÓN FASE 2B: Detección anticipada directa desde el buzón de Gmail
    // (Si el correo "Confirmación de Validación..." ya llegó antes de consultar la Fase 1)
    console.log(`🔎 [check-emails] Comprobando si el correo de validación final ya está disponible en la bandeja para DNI: ${certRequest.applicantDocNum}...`);
    const { downloadUrl: directDownloadUrl } = await EmailReaderService.extractDownloadUrl(certRequest.applicantDocNum);

    if (directDownloadUrl) {
      console.log(`🎯 [check-emails] ¡Página de descarga oficial detectada directamente desde la bandeja!`);

      await certModel.update({
        where: { id: certRequest.id },
        data: { status: 'APROBADO', isConfirmed: true },
      });

      const updatedCertRequest = await certModel.findUnique({
        where: { id: certId },
        include: { documents: { include: { verificationResult: true } }, emailLogs: true },
      });

      return NextResponse.json({
        success: true,
        status: 'APROBADO',
        alreadyConfirmed: true,
        phase: 2,
        downloadUrl: directDownloadUrl,
        message: '¡Certificado validado por Camerfirma! Se ha obtenido la página de descarga oficial.',
        certificateRequest: updatedCertRequest,
      });
    }

    // 🎯 FASE 1: BÚSQUEDA DE CORREO "Confirmación Solicitud" Y AUTOCONFIRMACIÓN CON PLAYWRIGHT
    console.log(`🔎 [check-emails] Buscando correo de confirmación de solicitud (paso_a_solicitud_1) para DNI: ${certRequest.applicantDocNum}...`);
    const { confirmUrl } = await EmailReaderService.extractConfirmationUrl(
      certRequest.applicantDocNum,
      applicantFullName
    );

    if (!confirmUrl) {
      return NextResponse.json({
        success: false,
        message: 'Aún no se ha recibido el correo de confirmación de Camerfirma en la bandeja.',
      });
    }

    console.log(`🔗 [check-emails] URL de solicitud interceptada: ${confirmUrl}`);
    console.log('🤖 [check-emails] Iniciando Playwright (Marcando "SI", haciendo submit y esperando código)...');

    const confirmationResult = await CamerfirmaConfirmationService.confirmAndExtractCode(confirmUrl);

    // 🎯 SI PLAYWRIGHT LOGRÓ CAPTURAR EL CÓDIGO DE DESCARGA:
    if (confirmationResult.downloadCode) {
      console.log(`✅ [check-emails] Código capturado en pantalla: ${confirmationResult.downloadCode}`);

      // 🔐 Cifrar el código mediante AES-256-GCM antes de persistir en PostgreSQL
      const encryptedCode = encryptCode(confirmationResult.downloadCode);

      // 💾 Actualizar base de datos
      await certModel.update({
        where: { id: certRequest.id },
        data: {
          status: 'APROBADO',
          isConfirmed: true,
          downloadCode: encryptedCode,
        },
      });

      // 📧 Reenviar la notificación al correo personal del titular
      if (certRequest.applicantEmail) {
        console.log(`📧 [check-emails] Reenviando código en texto plano al correo personal: ${certRequest.applicantEmail}`);
        await sendDownloadCodeEmail({
          to: certRequest.applicantEmail,
          applicantName: applicantFullName,
          downloadCode: confirmationResult.downloadCode,
          certCode: certRequest.code,
          certificateId: certRequest.id,
        });
      }

      // Intentar obtener de inmediato la URL final de descarga si el correo de validación ya estuviera disponible
      const { downloadUrl } = await EmailReaderService.extractDownloadUrl(certRequest.applicantDocNum);

      const updatedCertRequest = await certModel.findUnique({
        where: { id: certId },
        include: { documents: { include: { verificationResult: true } }, emailLogs: true },
      });

      return NextResponse.json({
        success: true,
        status: 'APROBADO',
        alreadyConfirmed: false,
        phase: downloadUrl ? 2 : 1,
        downloadCode: confirmationResult.downloadCode,
        downloadUrl: downloadUrl || null,
        message: 'Solicitud autoconfirmada en Camerfirma, código encriptado en BD y correo enviado al cliente.',
        certificateRequest: updatedCertRequest,
      });
    }

    // 🎯 SI LA PÁGINA YA ESTABA CONFIRMADA ANTERIORMENTE EN LA WEB DE CAMERFIRMA:
    console.log('ℹ️ [check-emails] La plataforma web de Camerfirma indica que la solicitud ya fue procesada.');

    await certModel.update({
      where: { id: certRequest.id },
      data: { status: 'APROBADO', isConfirmed: true },
    });

    const { downloadUrl } = await EmailReaderService.extractDownloadUrl(certRequest.applicantDocNum);

    const updatedCertRequest = await certModel.findUnique({
      where: { id: certId },
      include: { documents: { include: { verificationResult: true } }, emailLogs: true },
    });

    return NextResponse.json({
      success: true,
      status: 'APROBADO',
      alreadyConfirmed: true,
      phase: downloadUrl ? 2 : 1,
      downloadUrl: downloadUrl || null,
      message: 'La solicitud figura como confirmada previamente en la plataforma.',
      certificateRequest: updatedCertRequest,
    });

  } catch (error: any) {
    console.error('💥 [check-emails Error]:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}