-- ============================================================
-- Migration: Normalize legacy submission status
-- ============================================================
-- Jalankan di Cloudflare D1 Dashboard / wrangler d1 execute.
-- Tujuan: semua sesi selesai memakai satu status final saja: submitted.

UPDATE cbt_exam_sessions
SET status = 'submitted'
WHERE status = 'force_' || 'submitted';
