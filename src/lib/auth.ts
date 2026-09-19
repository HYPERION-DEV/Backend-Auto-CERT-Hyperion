// backend-hyperion/src/lib/auth.ts
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

export function getAuthUser(request: NextRequest): AuthUser | null {
  try {
    const token = request.cookies.get('auth_token')?.value || request.cookies.get('token')?.value;

    if (!token) return null;

    const secret = process.env.JWT_SECRET || 'super-secret-key-hyperion';
    
    // Si el token pasó de los 30 minutos, jwt.verify lanzará un TokenExpiredError y saltará al catch
    return jwt.verify(token, secret) as AuthUser;
  } catch (error) {
    // Retorna null si el token fue manipulado, expiró o no es válido
    return null;
  }
}