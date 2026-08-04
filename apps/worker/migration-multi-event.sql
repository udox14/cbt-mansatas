-- ============================================================
-- Multi-kegiatan + roster snapshot migration
-- Jalankan setelah schema.sql pada database PMB yang sudah berisi CBT.
-- Migration ini tidak mengubah tabel sumber PMB atau database sekolah.
-- ============================================================

CREATE TABLE IF NOT EXISTS cbt_events (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'other',
  participant_source TEXT NOT NULL CHECK (participant_source IN ('pmb', 'mansatas', 'cbt_user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO cbt_events (id, code, name, activity_type, participant_source, status)
VALUES ('event-pmb', 'PMB', 'Penerimaan Murid Baru', 'pmb', 'pmb', 'active');

ALTER TABLE cbt_exams ADD COLUMN event_id TEXT REFERENCES cbt_events(id);
UPDATE cbt_exams SET event_id = 'event-pmb' WHERE event_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cbt_exams_event ON cbt_exams(event_id);

CREATE TABLE IF NOT EXISTS cbt_exam_roster (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES cbt_events(id),
  source_key TEXT NOT NULL CHECK (source_key IN ('pmb', 'mansatas', 'cbt_user')),
  source_id TEXT NOT NULL,
  username TEXT NOT NULL,
  nisn TEXT,
  full_name TEXT NOT NULL,
  class_name TEXT,
  grade TEXT,
  gender TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  room_id TEXT REFERENCES cbt_rooms(id),
  tanggal_tes TEXT NOT NULL DEFAULT '',
  sesi_tes TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, source_key, source_id)
);
CREATE INDEX IF NOT EXISTS idx_cbt_roster_exam ON cbt_exam_roster(exam_id, room_id);
CREATE INDEX IF NOT EXISTS idx_cbt_roster_source ON cbt_exam_roster(source_key, source_id);

-- Existing databases have a CHECK constraint that only allows pendaftar and
-- cbt_user. Rebuild just this CBT-owned table so mansatas sessions can be
-- stored while preserving all session IDs and timestamps.
--
-- IMPORTANT: D1 executes imported statements separately. Therefore a
-- PRAGMA foreign_keys=OFF cannot be relied on across the DROP TABLE below.
-- Dropping the parent with foreign keys enabled cascades into answers,
-- results, and cheat logs. Make constraint-free copies first, then restore
-- those rows after the new parent table exists. The backups are intentionally
-- left in place until post-migration verification completes.
DROP TABLE IF EXISTS cbt_migration_student_answers_backup;
DROP TABLE IF EXISTS cbt_migration_exam_results_backup;
DROP TABLE IF EXISTS cbt_migration_cheat_logs_backup;
CREATE TABLE cbt_migration_student_answers_backup AS SELECT * FROM cbt_student_answers;
CREATE TABLE cbt_migration_exam_results_backup AS SELECT * FROM cbt_exam_results;
CREATE TABLE cbt_migration_cheat_logs_backup AS SELECT * FROM cbt_cheat_logs;

DROP INDEX IF EXISTS idx_cbt_sessions_exam;
DROP INDEX IF EXISTS idx_cbt_sessions_room;
DROP TABLE IF EXISTS cbt_exam_sessions_new;
CREATE TABLE cbt_exam_sessions_new (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'pendaftar' CHECK (user_type IN ('pendaftar', 'mansatas', 'cbt_user')),
  room_id TEXT NOT NULL,
  device_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'submitted', 'force_submitted')),
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
INSERT INTO cbt_exam_sessions_new
  (id, exam_id, user_id, user_type, room_id, device_id, status, cheat_warnings,
   question_map, option_map, started_at, finished_at, last_heartbeat,
   is_time_locked, locked_at, ip_address, user_agent)
SELECT id, exam_id, user_id, user_type, room_id, device_id, status, cheat_warnings,
       question_map, option_map, started_at, finished_at, last_heartbeat,
       is_time_locked, locked_at, ip_address, user_agent
FROM cbt_exam_sessions;
DROP TABLE cbt_exam_sessions;
ALTER TABLE cbt_exam_sessions_new RENAME TO cbt_exam_sessions;
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam ON cbt_exam_sessions(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_room ON cbt_exam_sessions(room_id, status);

-- Restore all child rows. INSERT OR IGNORE makes this safe if a D1 import
-- implementation leaves a child table intact instead of cascading it.
INSERT OR IGNORE INTO cbt_student_answers
  (id, session_id, question_id, selected_option_id, essay_answer, is_doubtful, answered_at)
SELECT id, session_id, question_id, selected_option_id, essay_answer, is_doubtful, answered_at
FROM cbt_migration_student_answers_backup;
INSERT OR IGNORE INTO cbt_exam_results
  (id, session_id, exam_id, user_id, user_type, total_questions, total_correct,
   total_wrong, total_unanswered, score, computed_at)
SELECT id, session_id, exam_id, user_id, user_type, total_questions, total_correct,
       total_wrong, total_unanswered, score, computed_at
FROM cbt_migration_exam_results_backup;
INSERT OR IGNORE INTO cbt_cheat_logs
  (id, session_id, violation_type, happened_at)
SELECT id, session_id, violation_type, happened_at
FROM cbt_migration_cheat_logs_backup;
