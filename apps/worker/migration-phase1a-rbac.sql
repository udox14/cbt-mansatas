-- ============================================================
-- Phase 1A: Secure Staff Identity & RBAC Foundation Migration
--
-- Pure additive migration.
-- Preserves existing tables: admins, pendaftar, cbt_users, etc.
-- Does NOT touch cbt_events, cbt_exams, or cbt_rooms.
-- ============================================================

-- 1. Profil Staf Lokal CBT (Mirror referensi user Mansatas)
CREATE TABLE IF NOT EXISTS cbt_staff_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  mansatas_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  nama_lengkap TEXT NOT NULL,
  nip TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_email ON cbt_staff_profiles(email);
CREATE INDEX IF NOT EXISTS idx_staff_mansatas_id ON cbt_staff_profiles(mansatas_user_id);

-- 2. Penugasan Base Role Staf CBT (admin, teacher, proctor)
CREATE TABLE IF NOT EXISTS cbt_role_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'proctor')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(staff_id, role)
);
CREATE INDEX IF NOT EXISTS idx_role_staff ON cbt_role_assignments(staff_id);

-- 3. Hak Akses & Scope Granular (Normalized non-null scope: '*' untuk global)
CREATE TABLE IF NOT EXISTS cbt_permission_grants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'mode', 'event', 'subject', 'own', 'room_slot')),
  scope_value TEXT NOT NULL DEFAULT '*',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(staff_id, permission, scope_type, scope_value)
);
CREATE INDEX IF NOT EXISTS idx_perm_staff ON cbt_permission_grants(staff_id);
