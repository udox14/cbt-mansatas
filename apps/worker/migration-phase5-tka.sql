-- ============================================================
-- PHASE 5 Migration: Additive tables and invariants for TKA Domain
-- ============================================================

-- 1. Additive table for event-level participant snapshot and choice tracking
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
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending')),
  validation_notes TEXT,
  room_id TEXT REFERENCES cbt_rooms(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tka_participants_event ON cbt_tka_participants(event_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_tka_participants_student ON cbt_tka_participants(student_id);

-- 2. Partial unique index enforcing at most one exam per subject per TKA event
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject
ON cbt_exams(event_id, subject_id)
WHERE mode = 'tka';
