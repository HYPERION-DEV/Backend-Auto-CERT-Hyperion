// backend-hyperion/src/middleware.ts

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'clave_secreta_para_firma_jwt_2026'
);

export async function middleware(request: NextRequest) {
  const requestOrigin = request.headers.get('origin');
  const { pathname } = request.nextUrl;

  // Permitir tanto tu frontend como el sitio de Camerfirma
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000',
    'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040'
  ];

  const isAllowed = requestOrigin && allowedOrigins.includes(requestOrigin);

  // Helper de cabeceras CORS
  const setCorsHeaders = (res: NextResponse) => {
    if (isAllowed || !requestOrigin) {
      res.headers.set('Access-Control-Allow-Origin', requestOrigin || '*');
      res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return res;
  };

  // 1. Manejo de Preflight OPTIONS
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 200 });
    response.headers.set('Access-Control-Allow-Origin', requestOrigin || '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    return response;
  }

  // 2. Definir Rutas Públicas (Incluyendo el inyector)
  const isPublicApi = 
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/register') ||
    pathname.startsWith('/api/cliente/'); // <--- AGREGADO

  if (isPublicApi) {
    return setCorsHeaders(NextResponse.next());
  }

  // 3. Validación de JWT para rutas privadas
  if (pathname.startsWith('/api/')) {
    const token = request.cookies.get('auth_token')?.value || request.cookies.get('token')?.value;

    if (!token) {
      return setCorsHeaders(
        NextResponse.json({ error: 'No se encontró una sesión activa.' }, { status: 401 })
      );
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const requestHeaders = new Headers(request.headers);
      if (payload.sub) requestHeaders.set('x-user-id', String(payload.sub));
      if (payload.role) requestHeaders.set('x-user-role', String(payload.role));

      return setCorsHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
    } catch (err) {
      const expiredResponse = NextResponse.json({ error: 'Tu sesión ha expirado.' }, { status: 401 });
      expiredResponse.cookies.set('auth_token', '', { httpOnly: true, maxAge: 0, path: '/' });
      return setCorsHeaders(expiredResponse);
    }
  }

  return setCorsHeaders(NextResponse.next());
}

export const config = {
  matcher: '/api/:path*',
};