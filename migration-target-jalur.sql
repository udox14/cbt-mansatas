-- Jalankan di D1 Console atau via wrangler CLI
-- Menambahkan kolom target_jalur ke tabel cbt_exams
ALTER TABLE cbt_exams ADD COLUMN target_jalur TEXT DEFAULT NULL;
