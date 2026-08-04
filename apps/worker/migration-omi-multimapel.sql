-- OMI / multi-mapel metadata.
-- Jalankan satu kali pada database PMB yang sudah memakai migration-multi-event.sql.
-- Kolom ini hanya berada di tabel CBT; database sumber peserta tidak disentuh.

ALTER TABLE cbt_exams ADD COLUMN subject_name TEXT;
ALTER TABLE cbt_exams ADD COLUMN sequence_order INTEGER NOT NULL DEFAULT 0;
