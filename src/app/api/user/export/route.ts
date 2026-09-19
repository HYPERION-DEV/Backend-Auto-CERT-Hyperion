// backend-hyperion/src/app/api/user/export/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    // 1. Consultar todas las solicitudes ordenadas de más reciente a más antigua
    const requests = await prisma.certificateRequest.findMany({
      select: {
        applicantDocNum: true,
        applicantNames: true,
        applicantSurname1: true,
        applicantSurname2: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const registeredUsersDatabase: Record<string, {
      dni: string;
      first_names: string;
      last_names: string;
      full_name: string;
    }> = {};

    // Palabras clave de rechazo que debemos ignorar completamente
    const invalidKeywords = ['CRUCE_FALLIDO', 'DOCUMENTO NO COINCIDE', 'PENDIENTE', 'RECHAZADO', 'FALLIDO'];

    requests.forEach((req) => {
      const dni = (req.applicantDocNum || '').trim();

      // 🛑 FILTRO 1: El DNI en Perú de persona natural debe tener exactamente 8 dígitos
      if (!dni || dni.length !== 8) return;

      const firstNames = (req.applicantNames || '').trim().toUpperCase();
      const surname1 = (req.applicantSurname1 || '').trim().toUpperCase();
      const surname2 = (req.applicantSurname2 || '').trim().toUpperCase();

      // Limpiamos los apellidos de textos concatenados raros (ej: feches o "Pool/...")
      const cleanSurname2 = surname2.split(/[\/\d]/)[0].trim();
      const lastNames = `${surname1} ${cleanSurname2}`.trim();

      // 🛑 FILTRO 2: Ignorar si contiene textos de error o rechazo
      const isInvalid = invalidKeywords.some(
        (kw) => firstNames.includes(kw) || surname1.includes(kw) || surname2.includes(kw)
      );

      if (isInvalid) return;

      // 🛑 FILTRO 3: Si ya existe este DNI registrado con un nombre válido, no lo sobrescribimos
      if (!registeredUsersDatabase[dni] && firstNames && lastNames) {
        const fullName = `${firstNames} ${lastNames}`.trim();

        registeredUsersDatabase[dni] = {
          dni,
          first_names: firstNames,
          last_names: lastNames,
          full_name: fullName,
        };
      }
    });

    return NextResponse.json(registeredUsersDatabase, { status: 200 });

  } catch (error: any) {
    console.error('Error en /api/user/export:', error);
    return NextResponse.json(
      { error: 'Error interno obteniendo la base de datos de usuarios.' },
      { status: 500 }
    );
  }
}