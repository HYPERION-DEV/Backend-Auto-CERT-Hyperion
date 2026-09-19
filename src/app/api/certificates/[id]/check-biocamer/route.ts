import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '@/lib/auth';
import { checkClientValidationStatus } from '@/service/biocamer.service';

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return makeCorsResponse({ error: 'Sesión no válida' }, 401);
    }

    const { id } = await params;
    const certRequest = await prisma.certificateRequest.findUnique({ where: { id } });

    if (!certRequest) {
      return makeCorsResponse({ error: 'Certificado no encontrado' }, 404);
    }

    // 1. Escrapear estado real en BioCamer navegando al detalle del cliente
    const remoteStatus = await checkClientValidationStatus(certRequest.applicantDocNum);

    // 2. Actualizar PostgreSQL estrictamente según lo encontrado
    const updated = await prisma.certificateRequest.update({
      where: { id },
      data: {
        identityStatus: remoteStatus,
        identityVerified: remoteStatus === 'APPROVED',
      },
    });

    return makeCorsResponse({
      success: true,
      message: remoteStatus === 'APPROVED' 
        ? '¡Identidad aprobada en BioCamer!' 
        : 'El cliente aún no completa la validación biométrica.',
      data: updated,
    });

  } catch (error: any) {
    return makeCorsResponse({ error: error.message || 'Error al verificar estado' }, 500);
  }
}