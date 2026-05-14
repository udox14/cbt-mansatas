-- ============================================================
-- CBT READINESS MIGRATION (Hari-H)
-- ============================================================
-- Untuk production yang sudah pernah deploy, cara paling aman adalah:
--   npm run db:readiness
--
-- Script tersebut idempotent: ia cek PRAGMA table_info(cbt_exams) dulu,
-- lalu hanya menjalankan ALTER TABLE untuk kolom yang belum ada.
--
-- Kalau harus manual via D1 Dashboard:
-- 1. Jalankan PRAGMA table_info(cbt_exams);
-- 2. Jalankan ALTER TABLE di bawah hanya untuk kolom yang belum ada.
-- 3. Jalankan semua CREATE TABLE/INDEX IF NOT EXISTS di bagian bawah.
-- ============================================================

-- Jalankan hanya jika kolom belum ada:
-- ALTER TABLE cbt_exams ADD COLUMN target_jalur TEXT DEFAULT NULL;
-- ALTER TABLE cbt_exams ADD COLUMN cheat_limit INTEGER DEFAULT 3;
-- ALTER TABLE cbt_exams ADD COLUMN cheat_action TEXT DEFAULT 'lock';
-- ALTER TABLE cbt_exams ADD COLUMN enforce_fullscreen INTEGER DEFAULT 0;

-- Tabel settings
CREATE TABLE IF NOT EXISTS cbt_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tabel exam assignments
CREATE TABLE IF NOT EXISTS cbt_exam_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'pendaftar',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, user_id, user_type)
);

CREATE INDEX IF NOT EXISTS idx_cbt_assignments_exam ON cbt_exam_assignments(exam_id);
CREATE INDEX IF NOT EXISTS idx_cbt_assignments_user ON cbt_exam_assignments(user_id, user_type);

-- Tabel log anti-cheat
CREATE TABLE IF NOT EXISTS cbt_cheat_logs (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL,
  happened_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cheat_logs_session ON cbt_cheat_logs(session_id);
