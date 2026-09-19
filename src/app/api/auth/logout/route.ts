// backend-hyperion/src/app/api/auth/logout/route.ts

import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: 'Sesión cerrada correctamente.',
  });

  // Sobreescribir la cookie borrándola con maxAge: 0 y fecha de expiración en el pasado
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0, // Destrucción inmediata en el navegador
    expires: new Date(0),
    path: '/',
  });

  return response;
}