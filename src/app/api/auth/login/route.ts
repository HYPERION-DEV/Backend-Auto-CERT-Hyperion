import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const prisma = new PrismaClient();
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'clave_secreta_para_firma_jwt_2026'
);

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Debe ingresar correo y contraseña.' },
        { status: 400 }
      );
    }

    // 1. Buscar usuario en PostgreSQL
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: 'Credenciales inválidas.' },
        { status: 401 }
      );
    }

    // 2. Validar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN_FAILED',
          ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
          userAgent: request.headers.get('user-agent'),
        },
      });

      return NextResponse.json(
        { error: 'Credenciales inválidas.' },
        { status: 401 }
      );
    }

    // ⏱️ DURACIÓN DE LA SESIÓN EN SEGUNDOS (Pruebas: 10s | Producción: 1800s = 30min)
    const DURATION_SECONDS = 36000; // 10 horas para pruebas, ajustar según necesidades
    const expiresAt = Date.now() + DURATION_SECONDS * 1000;

    // 3. Generar token JWT con jose
    const token = await new SignJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${DURATION_SECONDS}h`)
      .sign(JWT_SECRET);

    // 4. Registrar auditoría
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
        userAgent: request.headers.get('user-agent'),
      },
    });

    const response = NextResponse.json({
      success: true,
      expiresAt, // <-- Timestamp Unix en ms para el cliente
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });

    // 5. Cookie HTTP-ONLY principal (Inaccesible por JS por seguridad)
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DURATION_SECONDS,
      path: '/',
    });

    // 6. Cookie LEGIBLE POR JS (Sincroniza el temporizador del cliente)
    response.cookies.set('session_exp', expiresAt.toString(), {
      httpOnly: false, // Permitir lectura con document.cookie en el frontend
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DURATION_SECONDS,
      path: '/',
    });

    return response;
  } catch (error: any) {
    console.error('Error en Login Route:', error);
    return NextResponse.json(
      { error: 'Error interno en el servidor de autenticación.' },
      { status: 500 }
    );
  }
}