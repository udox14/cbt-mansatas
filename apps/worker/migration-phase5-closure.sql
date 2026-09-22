-- ============================================================
-- PHASE 5 Closure Migration: Validation Status CHECK & Indexes
--
-- D1/SQLite-safe table rebuild for cbt_tka_participants:
-- 1. Preserves all rows, PKs, FKs, indexes, unique constraints.
-- 2. Strictly enforces validation_status CHECK constraint:
--    CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending'))
-- 3. Preserves room_id FK semantics:
--    room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL
-- 4. Creates DB triggers preventing NULL or empty subject_id for mode = 'tka' on cbt_exams.
-- ============================================================

-- Ensure base table exists so SELECT won't fail if executing on fresh database
CREATE TABLE IF NOT EXISTS cbt_tka_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  nisn TEXT,
  nama_lengkap TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT,
  gender TEXT,
  mapel_pilihan1_raw TEXT,
  mapel_pilihan2_raw TEXT,
  mapel_pilihan1_subject_id TEXT,
  mapel_pilihan2_subject_id TEXT,
  validation_status TEXT NOT NULL,
  validation_notes TEXT,
  room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

-- Rebuild table with strict CHECK constraint
CREATE TABLE IF NOT EXISTS cbt_tka_participants_rebuild (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  nisn TEXT,
  nama_lengkap TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT,
  gender TEXT,
  mapel_pilihan1_raw TEXT,
  mapel_pilihan2_raw TEXT,
  mapel_pilihan1_subject_id TEXT,
  mapel_pilihan2_subject_id TEXT,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending')),
  validation_notes TEXT,
  room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

-- Copy all existing participant records and assignments
INSERT OR REPLACE INTO cbt_tka_participants_rebuild (
  id, event_id, student_id, nisn, nama_lengkap, class_id, class_name, gender,
  mapel_pilihan1_raw, mapel_pilihan2_raw, mapel_pilihan1_subject_id, mapel_pilihan2_subject_id,
  validation_status, validation_notes, room_id, created_at, updated_at
)
SELECT
  id, event_id, student_id, nisn, nama_lengkap, class_id, class_name, gender,
  mapel_pilihan1_raw, mapel_pilihan2_raw, mapel_pilihan1_subject_id, mapel_pilihan2_subject_id,
  validation_status, validation_notes, room_id, created_at, updated_at
FROM cbt_tka_participants;

DROP TABLE cbt_tka_participants;

ALTER TABLE cbt_tka_participants_rebuild RENAME TO cbt_tka_participants;

CREATE INDEX IF NOT EXISTS idx_tka_participants_event ON cbt_tka_participants(event_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_tka_participants_student ON cbt_tka_participants(student_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject
ON cbt_exams(event_id, subject_id)
WHERE mode = 'tka';

-- Triggers to enforce non-NULL verified subject_id for mode = 'tka' in cbt_exams
CREATE TRIGGER IF NOT EXISTS trg_cbt_exams_tka_subject_insert
BEFORE INSERT ON cbt_exams
WHEN NEW.mode = 'tka' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
BEGIN
  SELECT RAISE(ABORT, 'TKA exams must have a non-null verified subject_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_exams_tka_subject_update
BEFORE UPDATE OF subject_id, mode ON cbt_exams
WHEN NEW.mode = 'tka' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
BEGIN
  SELECT RAISE(ABORT, 'TKA exams must have a non-null verified subject_id');
END;
