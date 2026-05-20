-- ============================================================
-- Migration: Normalize CBT session timestamps to ISO-like UTC
-- ============================================================
-- Jalankan di Cloudflare D1 Dashboard / wrangler d1 execute.
-- Tujuan: timestamp lama dari DEFAULT datetime('now') tidak dibaca ambigu oleh browser.

UPDATE cbt_exam_sessions
SET started_at = replace(started_at, ' ', 'T') || 'Z'
WHERE started_at IS NOT NULL
  AND started_at NOT LIKE '%T%';

UPDATE cbt_exam_sessions
SET last_heartbeat = replace(last_heartbeat, ' ', 'T') || 'Z'
WHERE last_heartbeat IS NOT NULL
  AND last_heartbeat NOT LIKE '%T%';

UPDATE cbt_exam_sessions
SET finished_at = replace(finished_at, ' ', 'T') || 'Z'
WHERE finished_at IS NOT NULL
  AND finished_at NOT LIKE '%T%';
