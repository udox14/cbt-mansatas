-- ============================================================
-- Phase 6: Semester Foundation Migration
--
-- Pure D1/SQLite additive migration:
-- 1. Adds nullable target_grade column to cbt_exams
-- 2. Creates cbt_semester_participants
-- 3. Creates cbt_semester_exam_classes (multi-class academic audience)
-- 4. Creates cbt_semester_slots
-- 5. Creates cbt_semester_schedules
-- 6. Creates indexes and deterministic DB integrity triggers
-- ============================================================

-- 1. Add target_grade to cbt_exams
ALTER TABLE cbt_exams ADD COLUMN target_grade TEXT;

-- 2. Multi-Grade Participant Snapshot
CREATE TABLE IF NOT EXISTS cbt_semester_participants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  nisn TEXT,
  nis_lokal TEXT,
  nama_lengkap TEXT NOT NULL,
  gender TEXT,
  class_id TEXT,
  class_name TEXT,
  grade TEXT NOT NULL,
  room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
  nomor_peserta TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_participants_event ON cbt_semester_participants(event_id, grade);
CREATE INDEX IF NOT EXISTS idx_semester_participants_student ON cbt_semester_participants(student_id);
CREATE INDEX IF NOT EXISTS idx_semester_participants_room ON cbt_semester_participants(event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_semester_participants_class ON cbt_semester_participants(event_id, class_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_semester_participants_nomor
ON cbt_semester_participants(event_id, nomor_peserta)
WHERE nomor_peserta IS NOT NULL AND trim(nomor_peserta) != '';

-- 3. Multi-Class Academic Audience Mapping
CREATE TABLE IF NOT EXISTS cbt_semester_exam_classes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_exam_classes_event ON cbt_semester_exam_classes(event_id, grade);
CREATE INDEX IF NOT EXISTS idx_semester_exam_classes_exam ON cbt_semester_exam_classes(exam_id);
CREATE INDEX IF NOT EXISTS idx_semester_exam_classes_class ON cbt_semester_exam_classes(event_id, class_id);

-- 4. Discrete Time Windows (Slots)
CREATE TABLE IF NOT EXISTS cbt_semester_slots (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  slot_label TEXT NOT NULL,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  CHECK (end_time > start_time),
  UNIQUE(event_id, slot_date, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_semester_slots_event ON cbt_semester_slots(event_id, slot_date, sequence_order);

-- 5. Exam-to-Slot Binding (Schedules)
CREATE TABLE IF NOT EXISTS cbt_semester_schedules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_schedules_event ON cbt_semester_schedules(event_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_semester_schedules_exam ON cbt_semester_schedules(exam_id);

-- 6. DB Integrity Triggers

-- 6.1 Semester Exam Event & Grade Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_exams_semester_integrity_insert
BEFORE INSERT ON cbt_exams
WHEN (NEW.mode = 'semester' OR EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'))
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      AND (NEW.mode IS NULL OR NEW.mode != 'semester')
      THEN RAISE(ABORT, 'Exams belonging to a semester event must have mode = ''semester''')
    WHEN NEW.mode = 'semester' AND (NEW.event_id IS NULL OR trim(NEW.event_id) = '')
      THEN RAISE(ABORT, 'Semester exams must have a non-null non-blank event_id')
    WHEN NEW.mode = 'semester' AND NOT EXISTS (
      SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'
    )
      THEN RAISE(ABORT, 'Semester exams must reference an existing event with mode = ''semester''')
    WHEN NEW.mode = 'semester' AND (NEW.target_grade IS NULL OR trim(NEW.target_grade) = '' OR NEW.target_grade NOT IN ('10', '11', '12'))
      THEN RAISE(ABORT, 'Semester exams must have target_grade in (''10'', ''11'', ''12'')')
    WHEN NEW.mode = 'semester' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
      THEN RAISE(ABORT, 'Semester exams must have a non-null verified subject_id')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_exams_semester_integrity_update
BEFORE UPDATE OF target_grade, subject_id, mode, event_id ON cbt_exams
WHEN (OLD.mode = 'semester' OR NEW.mode = 'semester' OR EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'))
BEGIN
  SELECT CASE
    WHEN OLD.mode = 'semester' AND (NEW.mode IS NULL OR NEW.mode != 'semester')
      THEN RAISE(ABORT, 'Cannot independently mutate mode of a Semester exam away from semester')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      AND (NEW.mode IS NULL OR NEW.mode != 'semester')
      THEN RAISE(ABORT, 'Exams belonging to a semester event must have mode = ''semester''')
    WHEN NEW.mode = 'semester' AND (NEW.event_id IS NULL OR trim(NEW.event_id) = '')
      THEN RAISE(ABORT, 'Semester exams must have a non-null non-blank event_id')
    WHEN NEW.mode = 'semester' AND NOT EXISTS (
      SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'
    )
      THEN RAISE(ABORT, 'Semester exams must reference an existing event with mode = ''semester''')
    WHEN NEW.mode = 'semester' AND (NEW.target_grade IS NULL OR trim(NEW.target_grade) = '' OR NEW.target_grade NOT IN ('10', '11', '12'))
      THEN RAISE(ABORT, 'Semester exams must have target_grade in (''10'', ''11'', ''12'')')
    WHEN NEW.mode = 'semester' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
      THEN RAISE(ABORT, 'Semester exams must have a non-null verified subject_id')
  END;
END;

-- 6.2 Exam Academic Audience Trigger
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_exam_classes_insert
BEFORE INSERT ON cbt_semester_exam_classes
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_exam_classes.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_exam_classes can only belong to an event with mode = ''semester''')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'Semester exam class assignment must reference an existing semester exam in the same event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade)
      THEN RAISE(ABORT, 'Semester exam class grade must match exam target_grade')
    WHEN EXISTS (
      SELECT 1
      FROM cbt_semester_exam_classes sec
      JOIN cbt_exams e1 ON e1.id = sec.exam_id
      JOIN cbt_exams e2 ON e2.id = NEW.exam_id
      WHERE sec.event_id = NEW.event_id
        AND sec.class_id = NEW.class_id
        AND sec.exam_id != NEW.exam_id
        AND e1.subject_id = e2.subject_id
    )
      THEN RAISE(ABORT, 'A class cannot be assigned to multiple semester exams for the same subject in the same event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_exam_classes_update
BEFORE UPDATE OF event_id, exam_id, class_id, grade ON cbt_semester_exam_classes
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_exam_classes.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_exam_classes can only belong to an event with mode = ''semester''')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'Semester exam class assignment must reference an existing semester exam in the same event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade)
      THEN RAISE(ABORT, 'Semester exam class grade must match exam target_grade')
    WHEN EXISTS (
      SELECT 1
      FROM cbt_semester_exam_classes sec
      JOIN cbt_exams e1 ON e1.id = sec.exam_id
      JOIN cbt_exams e2 ON e2.id = NEW.exam_id
      WHERE sec.event_id = NEW.event_id
        AND sec.class_id = NEW.class_id
        AND sec.exam_id != NEW.exam_id
        AND e1.subject_id = e2.subject_id
    )
      THEN RAISE(ABORT, 'A class cannot be assigned to multiple semester exams for the same subject in the same event')
  END;
END;

-- 6.3 Schedule Cross-Event Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_integrity_insert
BEFORE INSERT ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_schedules can only belong to an event with mode = ''semester''')
    WHEN NEW.exam_id IS NULL OR trim(NEW.exam_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id must belong to schedule.event_id with mode = ''semester''')
    WHEN NEW.slot_id IS NULL OR trim(NEW.slot_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id must belong to schedule.event_id')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_integrity_update
BEFORE UPDATE OF event_id, exam_id, slot_id ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_schedules can only belong to an event with mode = ''semester''')
    WHEN NEW.exam_id IS NULL OR trim(NEW.exam_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id must belong to schedule.event_id with mode = ''semester''')
    WHEN NEW.slot_id IS NULL OR trim(NEW.slot_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id must belong to schedule.event_id')
  END;
END;

-- 6.4 Participant Room Scope
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_integrity_insert
BEFORE INSERT ON cbt_semester_participants
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_participants.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_participants can only be attached to an event with mode = ''semester''')
    WHEN NEW.grade IS NULL OR trim(NEW.grade) = '' OR NEW.grade NOT IN ('10', '11', '12')
      THEN RAISE(ABORT, 'cbt_semester_participants.grade must be one of (''10'', ''11'', ''12'')')
    WHEN NEW.room_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
    ) THEN RAISE(ABORT, 'Semester participant room must be global or belong to the same event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_integrity_update
BEFORE UPDATE OF event_id, grade, room_id ON cbt_semester_participants
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_participants.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_participants can only be attached to an event with mode = ''semester''')
    WHEN NEW.grade IS NULL OR trim(NEW.grade) = '' OR NEW.grade NOT IN ('10', '11', '12')
      THEN RAISE(ABORT, 'cbt_semester_participants.grade must be one of (''10'', ''11'', ''12'')')
    WHEN NEW.room_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
    ) THEN RAISE(ABORT, 'Semester participant room must be global or belong to the same event')
  END;
END;

-- 6.5 Slots Mode Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_slots_integrity_insert
BEFORE INSERT ON cbt_semester_slots
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_slots.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_slots can only be attached to an event with mode = ''semester''')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_slots_integrity_update
BEFORE UPDATE OF event_id ON cbt_semester_slots
BEGIN
  SELECT CASE
    WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
      THEN RAISE(ABORT, 'cbt_semester_slots.event_id cannot be null or blank')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_slots can only be attached to an event with mode = ''semester''')
  END;
END;

-- 6.6 Runtime Roster Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_exam_roster_semester_insert
BEFORE INSERT ON cbt_exam_roster
WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Semester roster event_id must match exam event_id')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_semester_participants
      WHERE event_id = NEW.event_id AND student_id = NEW.source_id
    )
      THEN RAISE(ABORT, 'Semester roster participant must exist in cbt_semester_participants for this event')
    WHEN NOT EXISTS (
      SELECT 1
      FROM cbt_semester_participants sp
      JOIN cbt_semester_exam_classes sec ON sec.exam_id = NEW.exam_id AND sec.class_id = sp.class_id
      WHERE sp.event_id = NEW.event_id AND sp.student_id = NEW.source_id
    )
      THEN RAISE(ABORT, 'Participant class is not in the academic audience for this semester exam')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade
    )
      THEN RAISE(ABORT, 'Semester roster grade must match exam target_grade')
    WHEN NEW.room_id IS NULL OR trim(NEW.room_id) = ''
      THEN RAISE(ABORT, 'Semester roster room_id cannot be null')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_rooms
      WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
    )
      THEN RAISE(ABORT, 'Semester roster room must be global or belong to this event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_exam_roster_semester_update
BEFORE UPDATE OF exam_id, event_id, source_id, grade, room_id ON cbt_exam_roster
WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
  OR EXISTS (SELECT 1 FROM cbt_exams WHERE id = OLD.exam_id AND mode = 'semester')
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = OLD.exam_id AND mode = 'semester')
      AND NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
      THEN RAISE(ABORT, 'Cannot mutate semester roster entry to non-semester exam')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Semester roster event_id must match exam event_id')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_semester_participants
      WHERE event_id = NEW.event_id AND student_id = NEW.source_id
    )
      THEN RAISE(ABORT, 'Semester roster participant must exist in cbt_semester_participants for this event')
    WHEN NOT EXISTS (
      SELECT 1
      FROM cbt_semester_participants sp
      JOIN cbt_semester_exam_classes sec ON sec.exam_id = NEW.exam_id AND sec.class_id = sp.class_id
      WHERE sp.event_id = NEW.event_id AND sp.student_id = NEW.source_id
    )
      THEN RAISE(ABORT, 'Participant class is not in the academic audience for this semester exam')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade
    )
      THEN RAISE(ABORT, 'Semester roster grade must match exam target_grade')
    WHEN NEW.room_id IS NULL OR trim(NEW.room_id) = ''
      THEN RAISE(ABORT, 'Semester roster room_id cannot be null')
    WHEN NOT EXISTS (
      SELECT 1 FROM cbt_rooms
      WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
    )
      THEN RAISE(ABORT, 'Semester roster room must be global or belong to this event')
  END;
END;
