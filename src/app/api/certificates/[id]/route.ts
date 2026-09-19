// backend-hyperion/src/app/api/certificates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '@/lib/auth';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const origin = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

  const makeCorsResponse = (data: any, status = 200) => {
    const res = NextResponse.json(data, { status });
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    return res;
  };

  try {
    const user = getAuthUser(request);

    // Si la función no retorna usuario, lanzar 401
    if (!user) {
      return makeCorsResponse(
        { error: 'Sesión expirada o invalida. Por favor, vuelva a iniciar sesión.' },
        401
      );
    }

    const { id } = await context.params;

    const certRequest = await prisma.certificateRequest.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        documents: {
          include: { verificationResult: true },
        },
      },
    });

    if (!certRequest) {
      return makeCorsResponse({ error: 'Solicitud no encontrada.' }, 404);
    }

    return makeCorsResponse({ success: true, data: certRequest });

  } catch (error: any) {
    return makeCorsResponse({ error: error?.message || 'Error del servidor.' }, 500);
  }
}