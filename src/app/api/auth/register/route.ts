// backend-hyperion/src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, Role, DocType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { email, password, fullName, docNumber, phone } = await request.json();

    if (!email || !password || !fullName || !docNumber) {
      return NextResponse.json({ error: 'Todos los campos marcados con * son obligatorios.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: cleanEmail }, { docNumber }] },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Ya existe un usuario registrado con este email o DNI.' }, { status: 400 });
    }

    // Hashear la contraseña antes de guardar en PostgreSQL
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        fullName,
        docNumber,
        phone,
        docType: DocType.DNI,
        role: Role.USER,
      },
    });

    return NextResponse.json({
      success: true,
      user: { id: newUser.id, email: newUser.email, fullName: newUser.fullName },
    });

  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Error registrando usuario.' }, { status: 500 });
  }
}