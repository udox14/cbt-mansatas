-- ============================================================
-- Migration: Anti-Cheat Configuration + Logs
-- Jalankan di Cloudflare D1 Dashboard
-- ============================================================

-- Kolom konfigurasi per-ujian
ALTER TABLE cbt_exams ADD COLUMN cheat_limit INTEGER DEFAULT 3;
ALTER TABLE cbt_exams ADD COLUMN cheat_action TEXT DEFAULT 'lock';
ALTER TABLE cbt_exams ADD COLUMN enforce_fullscreen INTEGER DEFAULT 0;

-- Tabel log pelanggaran (dengan timestamp)
CREATE TABLE IF NOT EXISTS cbt_cheat_logs (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL,   -- 'tab_switch' | 'fullscreen_exit'
  happened_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cheat_logs_session ON cbt_cheat_logs(session_id);
