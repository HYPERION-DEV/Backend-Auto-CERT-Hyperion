import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { sendToCamerfirma } from '@/service/camerfirma.service';

const prisma = new PrismaClient();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const certRequest = await prisma.certificateRequest.findUnique({
      where: { id },
      include: { documents: true },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 });
    }

    // 1. Extraer el registro del documento PDF
    const dniDocument = certRequest.documents?.find(
      (doc: any) => doc.category === 'DNI_FRONT_BACK'
    ) || certRequest.documents?.[0];

    let absoluteFilePath: string | undefined = undefined;

    if (dniDocument && dniDocument.fileUrl) {
      const fileName = path.basename(dniDocument.fileUrl);
      const localPath = path.join(process.cwd(), 'uploads', fileName);

      if (fs.existsSync(localPath)) {
        absoluteFilePath = localPath;
        console.log(`✓ [PDF Local Encontrado]: ${absoluteFilePath}`);
      } else if (dniDocument.fileUrl.startsWith('http')) {
        // Si la URL es remota, se descarga directamente en el servidor Node.js
        console.log(`[PDF Remoto] Descargando desde servidor a disco: ${dniDocument.fileUrl}`);
        const tempPath = path.join(process.cwd(), 'uploads', `temp_${certRequest.applicantDocNum}.pdf`);
        const writer = fs.createWriteStream(tempPath);

        const response = await axios({
          url: dniDocument.fileUrl,
          method: 'GET',
          responseType: 'stream',
        });

        response.data.pipe(writer);

        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => resolve());
          writer.on('error', (err) => reject(err));
        });

        absoluteFilePath = tempPath;
        console.log(`✓ [PDF Temporal Creado]: ${absoluteFilePath}`);
      }
    }

    // 2. Invocar Puppeteer pasando la ruta física absoluta del archivo
    await sendToCamerfirma(certRequest, absoluteFilePath);

    return NextResponse.json({
      success: true,
      message: 'Formulario de Camerfirma autocompletado y PDF adjuntado exitosamente.',
    });

  } catch (error: any) {
    console.error('✕ [Autofill API Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error en autocompletado' },
      { status: 500 }
    );
  }
}