// backend-hyperion/src/app/api/certificates/[id]/sync-biocamer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '@/lib/auth';
import { registerClientInBiocamer } from '@/service/biocamer.service';

const prisma = new PrismaClient();
const origin = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

const makeCorsResponse = (data: any, status = 200) => {
  const res = NextResponse.json(data, { status });
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // 👈 1. Declarar params como Promise
) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return makeCorsResponse({ error: 'Sesión expirada o inválida.' }, 401);
    }

    // 👈 2. Resolver la promesa de params obligatoria en Next.js
    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!id || id === 'undefined') {
      return makeCorsResponse({ error: 'ID de certificado no válido.' }, 400);
    }

    // 3. Buscar la solicitud en PostgreSQL
    const certRequest = await prisma.certificateRequest.findUnique({
      where: { id },
    });

    if (!certRequest) {
      return makeCorsResponse({ error: 'Certificado no encontrado en la base de datos.' }, 404);
    }

    // 4. Ejecutar la automatización de Puppeteer
    console.log(`[BioCamer Sync Directo] Registrando DNI ${certRequest.applicantDocNum}...`);
    
    await registerClientInBiocamer({
      docType: 'DNI',
      docNumber: certRequest.applicantDocNum,
    });

    // 5. Actualizar estado en Prisma
    const updatedCert = await prisma.certificateRequest.update({
      where: { id },
      data: {
        identityStatus: 'REGISTERED',
        biocamerUrl: 'https://biocamer.com/hyperion',
      },
    });

    return makeCorsResponse({
      success: true,
      message: 'Cliente registrado exitosamente en BioCamer.',
      redirectUrl: 'https://biocamer.com/hyperion',
      data: updatedCert,
    });

  } catch (error: any) {
    console.error('Error al registrar cliente en BioCamer:', error);
    return makeCorsResponse(
      { error: error?.message || 'Error del servidor al conectar con BioCamer.' },
      500
    );
  }
}