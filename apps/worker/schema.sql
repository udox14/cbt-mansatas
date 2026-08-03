-- ============================================================
-- Sistem CBT - Schema (Numpang di Database PMB Existing)
-- Semua tabel di-prefix "cbt_" agar tidak bentrok
-- ============================================================
-- Tabel existing yang TIDAK disentuh:
--   admins, pendaftar, prestasi, pengaturan, _cf_KV

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

-- Kegiatan CBT. Satu kegiatan hanya memakai satu sumber peserta.
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
CREATE INDEX IF NOT EXISTS idx_cbt_events_status ON cbt_events(status);
INSERT OR IGNORE INTO cbt_events (id, code, name, activity_type, participant_source, status)
VALUES ('event-pmb', 'PMB', 'Penerimaan Murid Baru', 'pmb', 'pmb', 'active');

-- Ruangan Ujian
CREATE TABLE IF NOT EXISTS cbt_rooms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  room_name TEXT NOT NULL,
  capacity INTEGER DEFAULT 40,
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
  active_status TEXT DEFAULT 'draft' CHECK (active_status IN ('draft', 'active', 'finished')),
  passing_score REAL DEFAULT 0,
  target_jalur TEXT DEFAULT NULL,
  event_id TEXT REFERENCES cbt_events(id),
  cheat_limit INTEGER DEFAULT 3,
  cheat_action TEXT DEFAULT 'lock',
  enforce_fullscreen INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_status ON cbt_exams(active_status);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_event ON cbt_exams(event_id);

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

-- Token per Ruangan per Ujian
CREATE TABLE IF NOT EXISTS cbt_exam_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
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
  room_id TEXT NOT NULL,
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
