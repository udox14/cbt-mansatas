-- ============================================================
-- Sistem CBT - Schema (Prefix cbt_)
-- ============================================================
-- Tabel legacy PMB lama (compatibility-only; bukan source of truth fitur baru):
--   admins, pendaftar, prestasi, pengaturan, _cf_KV
-- Catatan Arsitektur:
--   Authoritative source of truth untuk pendaftar PMB baru dan seluruh master data
--   madrasah adalah mansatas-db via adapter. Tabel legacy dipertahankan sementara.
-- ============================================================

-- CBT Users: Proktor + Peserta non-PMB (admin pakai tabel admins existing)
CREATE TABLE IF NOT EXISTS cbt_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nama_lengkap TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('proctor', 'student')),
  room_id TEXT,
  nisn TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_users_username ON cbt_users(username);
CREATE INDEX IF NOT EXISTS idx_cbt_users_role ON cbt_users(role);

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

-- Multi-Mode Event CBT. Satu kegiatan hanya memakai satu sumber peserta.
CREATE TABLE IF NOT EXISTS cbt_events (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
  activity_type TEXT NOT NULL DEFAULT 'other',
  participant_source TEXT NOT NULL CHECK (participant_source IN ('pmb', 'mansatas', 'cbt_user')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived')),
  academic_year_id TEXT,
  academic_year_name TEXT,
  term TEXT,
  proctor_access_before_minutes INTEGER NOT NULL DEFAULT 30,
  proctor_access_after_minutes INTEGER NOT NULL DEFAULT 45,
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_events_status ON cbt_events(status);
CREATE INDEX IF NOT EXISTS idx_cbt_events_mode ON cbt_events(mode);
INSERT OR IGNORE INTO cbt_events (id, code, name, mode, activity_type, participant_source, status)
VALUES ('event-pmb', 'PMB', 'Penerimaan Murid Baru', 'pmb', 'pmb', 'pmb', 'active');

-- Ruangan Ujian
CREATE TABLE IF NOT EXISTS cbt_rooms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  room_name TEXT NOT NULL,
  capacity INTEGER DEFAULT 40,
  event_id TEXT REFERENCES cbt_events(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Ujian
CREATE TABLE IF NOT EXISTS cbt_exams (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  rules_text TEXT,
  completion_message TEXT DEFAULT 'Ujian telah selesai. Terima kasih.',
  is_score_visible INTEGER DEFAULT 0,
  randomize_questions INTEGER DEFAULT 0,
  randomize_options INTEGER DEFAULT 0,
  active_status TEXT DEFAULT 'draft' CHECK (active_status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived', 'finished')),
  passing_score REAL DEFAULT 0,
  target_jalur TEXT DEFAULT NULL,
  event_id TEXT REFERENCES cbt_events(id),
  subject_name TEXT,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  cheat_limit INTEGER DEFAULT 3,
  cheat_action TEXT DEFAULT 'lock',
  enforce_fullscreen INTEGER DEFAULT 0,
  mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
  owner_staff_id TEXT,
  version_label TEXT DEFAULT 'v1.0',
  is_frozen INTEGER NOT NULL DEFAULT 0,
  teaching_assignment_id TEXT,
  subject_id TEXT,
  class_id TEXT,
  class_name TEXT,
  target_grade TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_status ON cbt_exams(active_status);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_event ON cbt_exams(event_id);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_subject_id ON cbt_exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_class_id ON cbt_exams(class_id);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_owner_mode ON cbt_exams(owner_staff_id, mode);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_assignment ON cbt_exams(teaching_assignment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_ulangan_event_unique ON cbt_exams(event_id) WHERE mode = 'ulangan';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject ON cbt_exams(event_id, subject_id) WHERE mode = 'tka';

-- Snapshot roster: perubahan pada sumber peserta tidak mengubah histori ujian.
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

-- Snapshot peserta TKA pada tingkat event (pilihan mapel 1 & 2 terikat tahun ajaran)
CREATE TABLE IF NOT EXISTS cbt_tka_participants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
CREATE INDEX IF NOT EXISTS idx_tka_participants_event ON cbt_tka_participants(event_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_tka_participants_student ON cbt_tka_participants(student_id);

-- Token per Ruangan per Ujian
CREATE TABLE IF NOT EXISTS cbt_exam_tokens (
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
CREATE INDEX IF NOT EXISTS idx_cbt_tokens_lookup ON cbt_exam_tokens(exam_id, room_id, tanggal_tes, sesi_tes, token_code);

-- Soal
CREATE TABLE IF NOT EXISTS cbt_questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'essay')),
  image_url TEXT,
  audio_url TEXT,
  points REAL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_questions_exam ON cbt_questions(exam_id, question_order);

-- Opsi Jawaban
CREATE TABLE IF NOT EXISTS cbt_question_options (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
  option_label TEXT NOT NULL,
  option_text TEXT NOT NULL,
  image_url TEXT,
  is_correct INTEGER DEFAULT 0,
  option_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cbt_options_question ON cbt_question_options(question_id);

-- Sesi Ujian
-- user_type: 'pendaftar', 'mansatas', atau 'cbt_user'
CREATE TABLE IF NOT EXISTS cbt_exam_sessions (
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
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam ON cbt_exam_sessions(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_room ON cbt_exam_sessions(room_id, status);

-- Jawaban
CREATE TABLE IF NOT EXISTS cbt_student_answers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
  selected_option_id TEXT REFERENCES cbt_question_options(id),
  essay_answer TEXT,
  is_doubtful INTEGER DEFAULT 0,
  answered_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_cbt_answers_session ON cbt_student_answers(session_id);

-- Hasil
CREATE TABLE IF NOT EXISTS cbt_exam_results (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL UNIQUE REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id),
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'pendaftar',
  total_questions INTEGER DEFAULT 0,
  total_correct INTEGER DEFAULT 0,
  total_wrong INTEGER DEFAULT 0,
  total_unanswered INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_results_exam ON cbt_exam_results(exam_id);

-- Pengaturan CBT (landing page, teks publik, konfigurasi ringan)
CREATE TABLE IF NOT EXISTS cbt_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Assignment ujian ke peserta tertentu
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

-- Log pelanggaran anti-cheat
CREATE TABLE IF NOT EXISTS cbt_cheat_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL,
  happened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cheat_logs_session ON cbt_cheat_logs(session_id);

-- Seed ruangan default
INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES ('room-1', 'Ruang 1', 40);

-- Phase 5: TKA Domain Constraints & Triggers
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject
ON cbt_exams(event_id, subject_id)
WHERE mode = 'tka';

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

-- ============================================================
-- Phase 6: Semester Foundation
-- ============================================================

-- Multi-Grade Participant Snapshot
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
  is_room_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_room_locked IN (0, 1)),
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

-- Multi-Class Academic Audience Mapping
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

-- Discrete Time Windows (Slots)
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

-- Exam-to-Slot Binding (Schedules)
CREATE TABLE IF NOT EXISTS cbt_semester_schedules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_schedules_event ON cbt_semester_schedules(event_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_semester_schedules_exam ON cbt_semester_schedules(exam_id);

-- DB Integrity Triggers

-- 1. Semester Exam Event & Grade Integrity
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

-- 2. Exam Academic Audience Trigger
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

-- 3. Schedule Cross-Event Integrity
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

-- 4. Participant Room Scope
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

-- 5. Slots Mode Integrity
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

-- 6. Runtime Roster Integrity
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

-- ============================================================
-- Phase 7: Semester Automation & Seating Distribution
-- ============================================================

-- 1. Concurrency Controls
CREATE TABLE IF NOT EXISTS cbt_semester_generation_controls (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('room_allocation', 'seating', 'timetable', 'invigilators')),
  active_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running')),
  started_at TEXT,
  actor_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_semester_gen_controls ON cbt_semester_generation_controls(event_id, stage);

-- 2. Room Layout Metadata & Provenance
CREATE TABLE IF NOT EXISTS cbt_semester_room_layouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  layout_type TEXT NOT NULL CHECK (layout_type IN ('logical_fallback', 'physical_configured')),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  rows_count INTEGER,
  cols_count INTEGER,
  desk_group_count INTEGER,
  is_irregular INTEGER NOT NULL DEFAULT 0 CHECK (is_irregular IN (0, 1)),
  required_invigilators INTEGER NOT NULL DEFAULT 1 CHECK (required_invigilators IN (1, 2)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_layouts_room ON cbt_semester_room_layouts(event_id, room_id);

-- 3. Physical Seats Definition
CREATE TABLE IF NOT EXISTS cbt_semester_seats (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL CHECK (seat_number > 0),
  seat_label TEXT NOT NULL,
  row_num INTEGER NOT NULL DEFAULT 1 CHECK (row_num > 0),
  col_num INTEGER NOT NULL DEFAULT 1 CHECK (col_num > 0),
  desk_group INTEGER CHECK (desk_group IS NULL OR desk_group > 0),
  sequence_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, room_id, seat_number),
  UNIQUE(event_id, room_id, seat_label),
  UNIQUE(event_id, room_id, row_num, col_num)
);

CREATE INDEX IF NOT EXISTS idx_semester_seats_room ON cbt_semester_seats(event_id, room_id, sequence_order);

-- 4. Participant Seat Assignments
CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES cbt_semester_participants(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL REFERENCES cbt_semester_seats(id) ON DELETE CASCADE,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, participant_id),
  UNIQUE(event_id, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_seat_assign_room ON cbt_semester_seat_assignments(event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_semester_seat_assign_seat ON cbt_semester_seat_assignments(seat_id);

-- 5. Staging Tables for Multi-Row Bounded Scale Generation
CREATE TABLE IF NOT EXISTS cbt_semester_rooms_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, participant_id)
);

CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, participant_id)
);

CREATE TABLE IF NOT EXISTS cbt_semester_invig_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  invigilator_order INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  mansatas_user_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, slot_id, room_id, invigilator_order)
);

-- 6. Invigilator Pool & Blackouts
CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_pool (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  is_eligible INTEGER NOT NULL DEFAULT 1 CHECK (is_eligible IN (0, 1)),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_invig_pool_event ON cbt_semester_invigilator_pool(event_id, is_eligible);

CREATE TABLE IF NOT EXISTS cbt_semester_staff_blackouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  slot_id TEXT REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  blackout_date TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (
    slot_id IS NOT NULL OR (
      blackout_date IS NOT NULL AND
      length(blackout_date) = 10 AND
      blackout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_semester_blackouts_lookup ON cbt_semester_staff_blackouts(event_id, staff_id);

-- 7. Invigilator Assignments
CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE RESTRICT,
  invigilator_order INTEGER NOT NULL DEFAULT 1 CHECK (invigilator_order IN (1, 2)),
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  staff_name TEXT NOT NULL,
  mansatas_user_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, slot_id, staff_id),
  UNIQUE(event_id, slot_id, room_id, invigilator_order)
);

CREATE INDEX IF NOT EXISTS idx_semester_invig_slot ON cbt_semester_invigilator_assignments(event_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_semester_invig_staff ON cbt_semester_invigilator_assignments(staff_id);

-- 8. Immutable Generation Logs
CREATE TABLE IF NOT EXISTS cbt_semester_generation_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('room_allocation', 'seating', 'timetable', 'invigilators')),
  actor_id TEXT NOT NULL,
  seed INTEGER,
  configuration TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'impossible', 'failed')),
  summary TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_semester_gen_logs_event ON cbt_semester_generation_logs(event_id, stage, created_at);

-- ============================================================
-- DB Integrity Triggers (Phase 7)
-- ============================================================

-- 1. Immutable Generation Logs Triggers
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_gen_logs_no_update
BEFORE UPDATE ON cbt_semester_generation_logs
BEGIN
  SELECT RAISE(ABORT, 'cbt_semester_generation_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_gen_logs_no_delete
BEFORE DELETE ON cbt_semester_generation_logs
BEGIN
  SELECT RAISE(ABORT, 'cbt_semester_generation_logs entries cannot be deleted');
END;

-- 2. Phase 6 Lock Columns Freeze Guards
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_freeze_lock_update
BEFORE UPDATE OF is_room_locked ON cbt_semester_participants
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot toggle is_room_locked in a frozen or active semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_freeze_lock_update
BEFORE UPDATE OF is_locked ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot toggle is_locked on schedules in a frozen or active semester event')
  END;
END;

-- 3. Schedule Lock Structural Protection & Delete Guard
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_locked_protect
BEFORE UPDATE ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN OLD.is_locked = 1 AND (OLD.slot_id != NEW.slot_id OR OLD.exam_id != NEW.exam_id OR OLD.event_id != NEW.event_id)
      THEN RAISE(ABORT, 'Transitioning schedule from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_locked_delete
BEFORE DELETE ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked schedule. Unlock first.')
  END;
END;

-- 4. Reverse Room Integrity & Seat Protection
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_room_change_integrity
BEFORE UPDATE OF room_id ON cbt_semester_participants
WHEN NEW.room_id IS NOT OLD.room_id
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_seat_assignments WHERE participant_id = OLD.id AND is_locked = 1
    ) THEN RAISE(ABORT, 'Cannot change room for participant with a locked seat assignment. Unlock seat first.')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_seat_assignments WHERE participant_id = OLD.id
    ) THEN RAISE(ABORT, 'Participant has an active seat assignment. Service must clear unlocked seat before changing room.')
  END;
END;

-- 5. Seats Integrity, Structural Protection & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_integrity_insert
BEFORE INSERT ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seats can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert seats into a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Seat room must be global or belong to this semester event')
    WHEN NEW.seat_number <= 0 OR NEW.row_num <= 0 OR NEW.col_num <= 0
      THEN RAISE(ABORT, 'Seat numbers, rows, and columns must be positive integers')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_integrity_update
BEFORE UPDATE ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify seats in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seats can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Seat room must be global or belong to this semester event')
    WHEN NEW.seat_number <= 0 OR NEW.row_num <= 0 OR NEW.col_num <= 0
      THEN RAISE(ABORT, 'Seat numbers, rows, and columns must be positive integers')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_freeze_delete
BEFORE DELETE ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete seats from a frozen or active semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE seat_id = OLD.id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot delete a seat that has a locked seat assignment')
  END;
END;

-- 6. Seat Assignment Integrity & Locked Protection
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_integrity_insert
BEFORE INSERT ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seat_assignments can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot assign seats in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Assigned participant must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat room must match participant assigned room')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_seats WHERE id = NEW.seat_id AND event_id = NEW.event_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat must exist in the target room and event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_integrity_update
BEFORE UPDATE ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify seat assignments in a frozen or active semester event')
    WHEN OLD.is_locked = 1 AND (OLD.participant_id != NEW.participant_id OR OLD.room_id != NEW.room_id OR OLD.seat_id != NEW.seat_id)
      THEN RAISE(ABORT, 'Transitioning seat assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seat_assignments can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Assigned participant must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat room must match participant assigned room')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_seats WHERE id = NEW.seat_id AND event_id = NEW.event_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat must exist in the target room and event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_freeze_delete
BEFORE DELETE ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete seat assignments from a frozen or active semester event')
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked seat assignment. Unlock first.')
  END;
END;

-- 7. Room Layouts Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_integrity_insert
BEFORE INSERT ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_room_layouts can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert room layouts in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Layout room must be global or belong to this semester event')
    WHEN NEW.layout_type = 'physical_configured' AND NEW.total_seats != (SELECT capacity FROM cbt_rooms WHERE id = NEW.room_id)
      THEN RAISE(ABORT, 'Physical layout seat count must match room capacity')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_integrity_update
BEFORE UPDATE ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify room layouts in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.room_id != NEW.room_id
      THEN RAISE(ABORT, 'Cannot move room layout to another event or room')
    WHEN NEW.layout_type = 'physical_configured' AND NEW.total_seats != (SELECT capacity FROM cbt_rooms WHERE id = NEW.room_id)
      THEN RAISE(ABORT, 'Physical layout seat count must match room capacity')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE room_id = OLD.room_id AND event_id = OLD.event_id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot modify room layout while locked seat assignments exist in this room')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_freeze_delete
BEFORE DELETE ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete room layouts from a frozen or active semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE room_id = OLD.room_id AND event_id = OLD.event_id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot delete room layout while locked seat assignments exist in this room')
  END;
END;

-- 8. Invigilator Pool Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_integrity_insert
BEFORE INSERT ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_pool can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert into invigilator pool in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Staff must be an active cbt_staff_profile')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_integrity_update
BEFORE UPDATE ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify invigilator pool in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.staff_id != NEW.staff_id
      THEN RAISE(ABORT, 'Cannot change event or staff profile reference in invigilator pool')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Staff must be an active cbt_staff_profile')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_freeze_delete
BEFORE DELETE ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete from invigilator pool in a frozen or active semester event')
  END;
END;

-- 9. Staff Blackouts Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_integrity_insert
BEFORE INSERT ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_staff_blackouts can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert staff blackouts in a frozen or active semester event')
    WHEN NEW.slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Blackout slot must belong to the same semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_integrity_update
BEFORE UPDATE ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify staff blackouts in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.staff_id != NEW.staff_id
      THEN RAISE(ABORT, 'Cannot change event or staff reference in staff blackout')
    WHEN NEW.slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Blackout slot must belong to the same semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_freeze_delete
BEFORE DELETE ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete staff blackouts in a frozen or active semester event')
  END;
END;

-- 10. Invigilator Assignments Hard Constraints, Locked Protection & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_integrity_insert
BEFORE INSERT ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_assignments can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot assign invigilators in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Slot must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Room must be global or belong to this semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Assigned staff must be an active cbt_staff_profile')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_invigilator_pool WHERE event_id = NEW.event_id AND staff_id = NEW.staff_id AND is_eligible = 1)
      THEN RAISE(ABORT, 'Staff member is not in the eligible invigilator pool for this event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_staff_blackouts sb
      JOIN cbt_semester_slots sl ON sl.id = NEW.slot_id
      WHERE sb.event_id = NEW.event_id AND sb.staff_id = NEW.staff_id
        AND (sb.slot_id = NEW.slot_id OR sb.blackout_date = sl.slot_date)
    ) THEN RAISE(ABORT, 'Staff member has an active blackout constraint for this slot or date')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_integrity_update
BEFORE UPDATE ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify invigilator assignments in a frozen or active semester event')
    WHEN OLD.is_locked = 1 AND (OLD.staff_id != NEW.staff_id OR OLD.slot_id != NEW.slot_id OR OLD.room_id != NEW.room_id OR OLD.invigilator_order != NEW.invigilator_order)
      THEN RAISE(ABORT, 'Transitioning invigilator assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_assignments can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Slot must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Room must be global or belong to this semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Assigned staff must be an active cbt_staff_profile')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_invigilator_pool WHERE event_id = NEW.event_id AND staff_id = NEW.staff_id AND is_eligible = 1)
      THEN RAISE(ABORT, 'Staff member is not in the eligible invigilator pool for this event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_staff_blackouts sb
      JOIN cbt_semester_slots sl ON sl.id = NEW.slot_id
      WHERE sb.event_id = NEW.event_id AND sb.staff_id = NEW.staff_id
        AND (sb.slot_id = NEW.slot_id OR sb.blackout_date = sl.slot_date)
    ) THEN RAISE(ABORT, 'Staff member has an active blackout constraint for this slot or date')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_freeze_delete
BEFORE DELETE ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete invigilators from a frozen or active semester event')
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked invigilator assignment. Unlock first.')
  END;
END;

-- 11. Room Capacity & Delete Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_rooms_semester_capacity_integrity
BEFORE UPDATE OF capacity ON cbt_rooms
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_room_layouts
      WHERE room_id = OLD.id AND layout_type = 'physical_configured' AND total_seats != NEW.capacity
    ) THEN RAISE(ABORT, 'Room capacity cannot differ from configured physical layout seats. Reconfigure layout first.')
    WHEN EXISTS (
      SELECT 1 FROM (
        SELECT COUNT(*) as cnt FROM cbt_semester_participants WHERE room_id = OLD.id GROUP BY event_id
      ) WHERE cnt > NEW.capacity
    ) THEN RAISE(ABORT, 'Room capacity cannot be reduced below the number of assigned participants.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_rooms_semester_freeze_delete
BEFORE DELETE ON cbt_rooms
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_participants p
      JOIN cbt_events e ON e.id = p.event_id
      WHERE p.room_id = OLD.id AND e.status IN ('ready', 'active', 'completed', 'archived')
    ) THEN RAISE(ABORT, 'Cannot delete a room used by a frozen or active semester event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_invigilator_assignments a
      JOIN cbt_events e ON e.id = a.event_id
      WHERE a.room_id = OLD.id AND e.status IN ('ready', 'active', 'completed', 'archived')
    ) THEN RAISE(ABORT, 'Cannot delete a room with invigilator assignments in a frozen or active semester event')
  END;
END;

-- ============================================================
-- Phase 8: AI Question Generator V1 Migration
-- ============================================================

-- 1. AI Generation Runs (Authoring provenance & operational metadata)
CREATE TABLE IF NOT EXISTS cbt_ai_generation_runs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES cbt_events(id) ON DELETE CASCADE,
  actor_staff_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  difficulty_mode TEXT NOT NULL CHECK (difficulty_mode IN ('easy', 'balanced', 'hard')),
  variation_level TEXT NOT NULL CHECK (variation_level IN ('standard', 'varied', 'high_variation')),
  topic TEXT NOT NULL,
  additional_instruction TEXT,
  reference_text TEXT,
  requested_count INTEGER NOT NULL CHECK (requested_count > 0 AND requested_count <= 50),
  generated_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  error_code TEXT,
  error_message TEXT,
  idempotency_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_exam ON cbt_ai_generation_runs(exam_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_actor ON cbt_ai_generation_runs(actor_staff_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_runs_idempotency ON cbt_ai_generation_runs(idempotency_token) WHERE idempotency_token IS NOT NULL;

-- 2. AI Question Drafts (Authoring review stage before canonical question creation)
CREATE TABLE IF NOT EXISTS cbt_ai_question_drafts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  run_id TEXT NOT NULL REFERENCES cbt_ai_generation_runs(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
  explanation TEXT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'balanced', 'hard')),
  content_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'duplicate')),
  validation_errors_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  canonical_question_id TEXT REFERENCES cbt_questions(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_drafts_run ON cbt_ai_question_drafts(run_id, question_order);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_exam_status ON cbt_ai_question_drafts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_hash ON cbt_ai_question_drafts(exam_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_drafts_canonical_qid ON cbt_ai_question_drafts(canonical_question_id) WHERE canonical_question_id IS NOT NULL;

-- 3. Integrity Triggers
CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_exam_id_check
BEFORE INSERT ON cbt_ai_question_drafts
BEGIN
  SELECT CASE
    WHEN NEW.exam_id != (SELECT exam_id FROM cbt_ai_generation_runs WHERE id = NEW.run_id)
      THEN RAISE(ABORT, 'Draft exam_id must match run exam_id')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_acceptance_protect
BEFORE UPDATE OF status ON cbt_ai_question_drafts
WHEN NEW.status = 'accepted'
BEGIN
  SELECT CASE
    WHEN OLD.status = 'accepted'
      THEN RAISE(ABORT, 'Draft has already been accepted and cannot be accepted again')
    WHEN NEW.canonical_question_id IS NULL
      THEN RAISE(ABORT, 'Cannot mark draft accepted without a canonical_question_id')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_questions WHERE id = NEW.canonical_question_id AND exam_id = NEW.exam_id)
      THEN RAISE(ABORT, 'canonical_question_id does not exist in target exam questions')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_freeze_protect
BEFORE UPDATE OF status ON cbt_ai_question_drafts
WHEN NEW.status = 'accepted'
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_exams e
      LEFT JOIN cbt_events ev ON ev.id = e.event_id
      WHERE e.id = NEW.exam_id AND (
        e.is_frozen = 1 OR
        e.active_status IN ('ready', 'active', 'completed', 'archived', 'finished') OR
        ev.status IN ('ready', 'active', 'completed', 'archived')
      )
    )
      THEN RAISE(ABORT, 'Cannot accept draft into a frozen or ready+ exam')
  END;
END;

