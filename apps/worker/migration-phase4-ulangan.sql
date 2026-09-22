-- ============================================================
-- PHASE 4 Migration: Ulangan Harian Domain & Room Nullability
--
-- 1. Adds teaching assignment, subject, and class context to cbt_exams.
-- 2. D1/SQLite-safe table rebuild of cbt_exam_tokens to make room_id nullable.
-- 3. D1/SQLite-safe table rebuild of cbt_exam_sessions to make room_id nullable.
--    Child data preservation pattern (AGENTS.md Rule 8):
--    Copies cbt_student_answers, cbt_exam_results, cbt_cheat_logs to temporary
--    tables prior to rebuilding cbt_exam_sessions to protect against SQLite
--    ON DELETE CASCADE during table drop, then restores all child data.
--
-- Preserves all existing rows, PKs, FKs, indexes, defaults, and constraints.
-- ============================================================

-- 1. Additive columns for cbt_exams
ALTER TABLE cbt_exams ADD COLUMN teaching_assignment_id TEXT;
ALTER TABLE cbt_exams ADD COLUMN subject_id TEXT;
ALTER TABLE cbt_exams ADD COLUMN class_id TEXT;
ALTER TABLE cbt_exams ADD COLUMN class_name TEXT;

CREATE INDEX IF NOT EXISTS idx_cbt_exams_subject_id ON cbt_exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_class_id ON cbt_exams(class_id);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_owner_mode ON cbt_exams(owner_staff_id, mode);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_assignment ON cbt_exams(teaching_assignment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_ulangan_event_unique ON cbt_exams(event_id) WHERE mode = 'ulangan';

-- 2. Safe Rebuild of cbt_exam_tokens to make room_id nullable
DROP INDEX IF EXISTS idx_cbt_tokens_lookup;
DROP TABLE IF EXISTS cbt_exam_tokens_phase4;
CREATE TABLE cbt_exam_tokens_phase4 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  tanggal_tes TEXT NOT NULL DEFAULT '',
  sesi_tes TEXT NOT NULL DEFAULT '',
  token_code TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, room_id, tanggal_tes, sesi_tes)
);

INSERT INTO cbt_exam_tokens_phase4 (
  id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active, expires_at, created_at
)
SELECT id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active, expires_at, created_at
FROM cbt_exam_tokens;

DROP TABLE cbt_exam_tokens;
ALTER TABLE cbt_exam_tokens_phase4 RENAME TO cbt_exam_tokens;
CREATE INDEX IF NOT EXISTS idx_cbt_tokens_lookup ON cbt_exam_tokens(exam_id, room_id, tanggal_tes, sesi_tes, token_code);

-- 3. Safe Rebuild of cbt_exam_sessions to make room_id nullable
-- Backup child data before table drop to guard against ON DELETE CASCADE in SQLite/D1
DROP TABLE IF EXISTS _backup_student_answers;
DROP TABLE IF EXISTS _backup_exam_results;
DROP TABLE IF EXISTS _backup_cheat_logs;

CREATE TABLE _backup_student_answers AS SELECT * FROM cbt_student_answers;
CREATE TABLE _backup_exam_results AS SELECT * FROM cbt_exam_results;
CREATE TABLE _backup_cheat_logs AS SELECT * FROM cbt_cheat_logs;

DROP INDEX IF EXISTS idx_cbt_sessions_exam;
DROP INDEX IF EXISTS idx_cbt_sessions_room;
DROP TABLE IF EXISTS cbt_exam_sessions_phase4;
CREATE TABLE cbt_exam_sessions_phase4 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'pendaftar' CHECK (user_type IN ('pendaftar', 'mansatas', 'cbt_user')),
  room_id TEXT REFERENCES cbt_rooms(id),
  device_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'submitted')),
  cheat_warnings INTEGER DEFAULT 0,
  question_map TEXT,
  option_map TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  last_heartbeat TEXT DEFAULT (datetime('now')),
  is_time_locked INTEGER DEFAULT 0,
  locked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(exam_id, user_id, user_type)
);

INSERT INTO cbt_exam_sessions_phase4 (
  id, exam_id, user_id, user_type, room_id, device_id, status, cheat_warnings,
  question_map, option_map, started_at, finished_at, last_heartbeat,
  is_time_locked, locked_at, ip_address, user_agent
)
SELECT id, exam_id, user_id, user_type, room_id, device_id, status, cheat_warnings,
       question_map, option_map, started_at, finished_at, last_heartbeat,
       is_time_locked, locked_at, ip_address, user_agent
FROM cbt_exam_sessions;

DROP TABLE cbt_exam_sessions;
ALTER TABLE cbt_exam_sessions_phase4 RENAME TO cbt_exam_sessions;
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam ON cbt_exam_sessions(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_room ON cbt_exam_sessions(room_id, status);

-- Restore child data
INSERT OR REPLACE INTO cbt_student_answers SELECT * FROM _backup_student_answers;
INSERT OR REPLACE INTO cbt_exam_results SELECT * FROM _backup_exam_results;
INSERT OR REPLACE INTO cbt_cheat_logs SELECT * FROM _backup_cheat_logs;

DROP TABLE _backup_student_answers;
DROP TABLE _backup_exam_results;
DROP TABLE _backup_cheat_logs;
