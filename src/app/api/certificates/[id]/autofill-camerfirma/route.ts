import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, DocumentCategory } from '@prisma/client';
import { sendToCamerfirma } from '@/service/camerfirma.service';

const prisma = new PrismaClient() as any;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const requestId = resolvedParams.id;

    if (!requestId) {
      return NextResponse.json({ error: 'ID de solicitud no proporcionado.' }, { status: 400 });
    }

    const certModel = prisma.certificateRequest || prisma.CertificateRequest;

    // 1. Obtener la solicitud incluyendo los documentos cargados
    const certRequest = await certModel.findUnique({
      where: { id: requestId },
      include: {
        documents: true,
      },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 });
    }

    // 2. Extraer la URL del PDF del DNI para que Puppeteer lo suba automáticamente
    const dniDoc = certRequest.documents?.find((d: any) => d.category === DocumentCategory.DNI_FRONT_BACK);
    const fileUrl = dniDoc?.fileUrl;

    // 3. 🎯 EJECUTAR PUPPETEER (Abre la ventana visible de Chrome y rellena Camerfirma)
    await sendToCamerfirma(certRequest, fileUrl);

    // 4. Actualizar estado/auditoría
    const updatedCert = await certModel.update({
      where: { id: requestId },
      data: {
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: '✓ Formulario autocompletado y documento cargado exitosamente en Camerfirma.',
      data: updatedCert,
    });

  } catch (error: any) {
    console.error('Error en autofill-camerfirma:', error);
    return NextResponse.json({ error: error?.message || 'Error al ejecutar Puppeteer en el servidor.' }, { status: 500 });
  }
}