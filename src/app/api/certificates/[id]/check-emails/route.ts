import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { EmailProcessorService } from '@/service/email-processor.service';

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

    // 1. Ejecuta el procesamiento de correos y auto-clic HTTP
    const result = await EmailProcessorService.processIncomingEmailsForDni(
      certRequest.applicantDocNum
    );

    // 2. Re-consultar el expediente actualizado en PostgreSQL para enviar el nuevo estado al Frontend
    const updatedCertRequest = await certModel.findUnique({
      where: { id: certId },
      include: { emailLogs: true },
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