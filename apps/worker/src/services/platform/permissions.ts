// ============================================================
// Staff Profiles & RBAC Service
//
// Handles local CBT staff profile synchronization, base role assignments,
// and granular permission evaluation with normalized non-null scopes.
// ============================================================

import type { StaffProfile, RoleAssignment, PermissionGrant, ScopeType } from '../../types.ts';
import type { MansatasStaffIdentity } from './auth-mansatas.ts';
import { newId, now } from '../../utils/helpers.ts';

export const ALL_MODES = ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'] as const;
export type ExamMode = (typeof ALL_MODES)[number];

export interface ResolvedStaffAuth {
  profile: StaffProfile;
  roles: string[];
  permissions: PermissionGrant[];
  allowedModes: string[];
}

/**
 * Synchronizes an authenticated Mansatas staff member into CBT's local profile and RBAC store.
 * Applies least-privilege defaults for newly provisioned staff.
 */
export async function syncStaffProfile(
  db: D1Database,
  staff: MansatasStaffIdentity
): Promise<ResolvedStaffAuth> {
  const normalizedEmail = staff.email.trim().toLowerCase();

  // 1. Check existing local staff profile by mansatas_user_id or canonical email
  let profile = await db
    .prepare(
      `SELECT id, mansatas_user_id, email, nama_lengkap, nip, is_active, synced_at
       FROM cbt_staff_profiles
       WHERE mansatas_user_id = ? OR LOWER(email) = ?
       LIMIT 1`
    )
    .bind(staff.id, normalizedEmail)
    .first<StaffProfile>();

  if (!profile) {
    // First-time provisioning: create local CBT staff profile
    const profileId = newId();
    await db
      .prepare(
        `INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap, nip, is_active, synced_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .bind(profileId, staff.id, normalizedEmail, staff.nama_lengkap, staff.nip, now())
      .run();

    // Least privilege default: assign base role 'teacher'
    await db
      .prepare(
        `INSERT OR IGNORE INTO cbt_role_assignments (id, staff_id, role, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(newId(), profileId, 'teacher', now())
      .run();

    // Default permissions for teacher: access and create own ulangan exams
    await db
      .prepare(
        `INSERT OR IGNORE INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), profileId, 'ulangan.access', 'mode', 'ulangan', now())
      .run();

    await db
      .prepare(
        `INSERT OR IGNORE INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), profileId, 'ulangan.exam.create', 'own', profileId, now())
      .run();

    await db
      .prepare(
        `INSERT OR IGNORE INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), profileId, 'ulangan.exam.manage_own', 'own', profileId, now())
      .run();

    profile = {
      id: profileId,
      mansatas_user_id: staff.id,
      email: normalizedEmail,
      nama_lengkap: staff.nama_lengkap,
      nip: staff.nip,
      is_active: 1,
      synced_at: now(),
    };
  } else {
    // Existing profile: update synced fields and touch synced_at
    await db
      .prepare(
        `UPDATE cbt_staff_profiles
         SET email = ?, nama_lengkap = ?, nip = ?, synced_at = ?
         WHERE id = ?`
      )
      .bind(normalizedEmail, staff.nama_lengkap, staff.nip, now(), profile.id)
      .run();

    profile.email = normalizedEmail;
    profile.nama_lengkap = staff.nama_lengkap;
    profile.nip = staff.nip;
    profile.synced_at = now();
  }

  // 2. Fetch role assignments
  const { results: roleRows } = await db
    .prepare(`SELECT role FROM cbt_role_assignments WHERE staff_id = ?`)
    .bind(profile.id)
    .all<{ role: string }>();

  const roles = roleRows.map((r) => r.role);
  if (roles.length === 0) {
    roles.push('teacher');
  }

  // 3. Fetch permission grants
  const { results: permRows } = await db
    .prepare(
      `SELECT id, staff_id, permission, scope_type, scope_value, created_at
       FROM cbt_permission_grants
       WHERE staff_id = ?`
    )
    .bind(profile.id)
    .all<PermissionGrant>();

  const permissions = permRows || [];

  // 4. Resolve allowed modes
  const allowedModes = resolveAllowedModes(roles, permissions);

  return {
    profile,
    roles,
    permissions,
    allowedModes,
  };
}

/**
 * Resolves which exam modes a staff member has permission to enter.
 */
export function resolveAllowedModes(roles: string[], permissions: PermissionGrant[]): string[] {
  if (roles.includes('admin')) {
    return [...ALL_MODES];
  }

  const modes = new Set<string>();

  for (const grant of permissions) {
    if (grant.permission === 'platform.manage' || grant.scope_value === '*') {
      return [...ALL_MODES];
    }

    if (grant.permission.startsWith('pmb.') || grant.scope_value === 'pmb') {
      modes.add('pmb');
    }
    if (grant.permission.startsWith('kegiatan.') || grant.scope_value === 'kegiatan') {
      modes.add('kegiatan');
    }
    if (grant.permission.startsWith('tka.') || grant.scope_value === 'tka') {
      modes.add('tka');
    }
    if (grant.permission.startsWith('semester.') || grant.scope_value === 'semester') {
      modes.add('semester');
    }
    if (grant.permission.startsWith('ulangan.') || grant.scope_value === 'ulangan') {
      modes.add('ulangan');
    }
  }

  // Default fallback: teachers always have access to their own ulangan
  if (roles.includes('teacher') && modes.size === 0) {
    modes.add('ulangan');
  }

  return Array.from(modes);
}

/**
 * Evaluates whether a staff member has a given permission, respecting scopes.
 */
export function hasPermission(
  permissions: PermissionGrant[],
  requiredPermission: string,
  scope?: { type: ScopeType; value: string },
  roles?: string[]
): boolean {
  if (roles?.includes('admin')) {
    return true;
  }

  for (const grant of permissions) {
    // Platform superuser permission
    if (grant.permission === 'platform.manage') {
      return true;
    }

    if (grant.permission === requiredPermission || grant.permission === '*') {
      if (!scope) {
        return true;
      }
      // Global scope grant covers all scopes
      if (grant.scope_type === 'global' || grant.scope_value === '*') {
        return true;
      }
      // Exact scope match
      if (grant.scope_type === scope.type && grant.scope_value === scope.value) {
        return true;
      }
    }
  }

  return false;
}
