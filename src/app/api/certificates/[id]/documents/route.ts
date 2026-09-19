import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, DocumentCategory, RequestStatus } from '@prisma/client';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const category = formData.get('category') as DocumentCategory;

    if (!file || !category) {
      return NextResponse.json({ error: 'Archivo o categoría no provistos.' }, { status: 400 });
    }

    // Guardar archivo físicamente
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    await writeFile(path.join(uploadDir, filename), Buffer.from(await file.arrayBuffer()));
    const fileUrl = `/uploads/${filename}`;

    // Buscar si ya existe un documento de esa categoría para reemplazarlo o crearlo
    const existingDoc = await prisma.requestDocument.findFirst({
      where: { requestId: id, category },
    });

    if (existingDoc) {
      await prisma.requestDocument.update({
        where: { id: existingDoc.id },
        data: {
          fileName: file.name,
          fileUrl,
          fileSizeBytes: file.size,
          uploadedAt: new Date(),
        },
      });
    } else {
      await prisma.requestDocument.create({
        data: {
          requestId: id,
          category,
          fileName: file.name,
          fileUrl,
          fileSizeBytes: file.size,
        },
      });
    }

    // Recalcular Progreso de Documentos (Total máximo 3 para Empresas)
    const allDocs = await prisma.requestDocument.findMany({ where: { requestId: id } });
    const uploadedCount = allDocs.length;
    const newProgress = `${uploadedCount}/3`;

    const updatedRequest = await prisma.certificateRequest.update({
      where: { id },
      data: {
        progress: newProgress,
        status: uploadedCount === 3 ? RequestStatus.EN_REVISION : RequestStatus.BORRADOR,
      },
      include: {
        documents: { include: { verificationResult: true } },
      },
    });

    const response = NextResponse.json({ success: true, data: updatedRequest });
    response.headers.set('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    return response;

  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Error al procesar el archivo.' }, { status: 500 });
  }
}