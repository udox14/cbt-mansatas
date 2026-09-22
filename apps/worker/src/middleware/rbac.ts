// ============================================================
// RBAC Middleware — Granular Permission & Scope Checker
// ============================================================

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Env, ScopeType, PermissionGrant } from '../types.ts';
import { hasPermission } from '../services/platform/permissions.ts';

export type ScopeResolver = (c: Context<{ Bindings: Env }>) => { type: ScopeType; value: string } | Promise<{ type: ScopeType; value: string }>;

/**
 * Middleware that enforces a specific permission on a route.
 * Admins (legacy admins and role 'admin') always pass.
 */
export function requirePermission(permission: string | string[], scopeResolver?: ScopeResolver) {
  const perms = Array.isArray(permission) ? permission : [permission];
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Autentikasi diperlukan' }, 401);
    }

    // Global admins bypass granular checks
    if (user.role === 'admin' || user.source === 'admins') {
      await next();
      return;
    }

    // Resolve scope if needed
    let scope: { type: ScopeType; value: string } | undefined;
    if (scopeResolver) {
      scope = await scopeResolver(c);
    }

    // 1. Quick check from token claims if present
    if (user.permissions && Array.isArray(user.permissions)) {
      const userPerms = user.permissions;
      // If user has platform superuser permission
      if (userPerms.includes('platform.manage') || userPerms.includes('*')) {
        await next();
        return;
      }

      // If no specific scope required and user has any of the permissions in token
      if (!scope && perms.some((p) => userPerms.includes(p))) {
        await next();
        return;
      }
    }

    // 2. Authoritative check from database if staff_id is present
    const staffId = user.staff_id || user.sub;
    if (staffId && c.env.DB) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, staff_id, permission, scope_type, scope_value, created_at
         FROM cbt_permission_grants
         WHERE staff_id = ?`
      )
        .bind(staffId)
        .all<PermissionGrant>();

      const grants = results || [];
      const roles = user.roles || [user.role];
      const allowed = perms.some((p) => hasPermission(grants, p, scope, roles));
      if (allowed) {
        await next();
        return;
      }
    }

    return c.json({ success: false, error: 'Akses ditolak: izin tidak mencukupi' }, 403);
  });
}
