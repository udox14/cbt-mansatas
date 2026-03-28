// ============================================================
// Auth Middleware: JWT + RBAC
// ============================================================

import { createMiddleware } from 'hono/factory';
import type { Env, JWTPayload, Role } from '../types';
import { verifyJWT } from '../utils/jwt';

declare module 'hono' {
  interface ContextVariableMap { user: JWTPayload; }
}

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return c.json({ success: false, error: 'Token tidak ditemukan' }, 401);

  const payload = await verifyJWT(header.slice(7), c.env.JWT_SECRET);
  if (!payload) return c.json({ success: false, error: 'Token tidak valid atau sudah kedaluwarsa' }, 401);

  c.set('user', payload);
  await next();
});

export function requireRole(...roles: Role[]) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) return c.json({ success: false, error: 'Akses ditolak' }, 403);
    await next();
  });
}
