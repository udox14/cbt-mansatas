# Runbook Hari-H CBT MAN 1 Tasikmalaya

Dokumen ini dipakai panitia/proktor saat simulasi dan pelaksanaan ujian serentak.

## H-2 sampai H-1

1. Jalankan build dan dry-run:
   ```powershell
   cd C:\DATA\cbt-mansatas\apps\web
   npm.cmd run build

   cd C:\DATA\cbt-mansatas\apps\worker
   npm.cmd run deploy -- --dry-run
   ```
2. Pastikan migration readiness sudah aman:
   ```powershell
   cd C:\DATA\cbt-mansatas
   npm.cmd run db:readiness
   ```
3. Verifikasi manual di D1 Dashboard:
   ```sql
   SELECT name FROM sqlite_master
   WHERE type='table' AND name LIKE 'cbt_%'
   ORDER BY name;

   PRAGMA table_info(cbt_exams);

   SELECT COUNT(*) AS missing_room
   FROM pendaftar
   WHERE (ruang_tes IS NULL OR ruang_tes = '')
     AND UPPER(jalur) NOT LIKE '%PRESTASI%';

   SELECT ruang_tes, COUNT(*) AS peserta
   FROM pendaftar
   WHERE UPPER(jalur) NOT LIKE '%PRESTASI%'
   GROUP BY ruang_tes
   ORDER BY ruang_tes;

   SELECT e.title, e.active_status, COUNT(q.id) AS soal
   FROM cbt_exams e
   LEFT JOIN cbt_questions q ON q.exam_id = e.id
   GROUP BY e.id;

   SELECT e.title, r.room_name, t.token_code, t.is_active
   FROM cbt_exam_tokens t
   JOIN cbt_exams e ON e.id = t.exam_id
   JOIN cbt_rooms r ON r.id = t.room_id
   ORDER BY e.title, r.room_name;
   ```
4. Pastikan semua ruangan, proktor, jadwal, soal, dan token sudah final.
5. Jalankan simulasi dengan dummy users/exam:
   ```powershell
   cd C:\DATA\cbt-mansatas
   npm.cmd run load:simulate -- --users .\dummy-users.csv --token 123456 --concurrency 20 --confirm-write
   ```

## Saat Ujian

1. Admin hanya mengubah status ujian ke `active` setelah proktor siap.
2. Proktor membuka halaman proktor dan memastikan token aktif sesuai ruangan.
3. Peserta login memakai NISN dan tanggal lahir, lalu memasukkan token dari proktor.
4. Jika peserta pindah perangkat atau muncul "sesi terkunci di perangkat lain", proktor klik **Reset** pada sesi peserta.
5. Jika peserta terkunci karena anti-cheat dan pengawas mengizinkan lanjut, proktor klik **Buka Kunci**.
6. Jika peserta gagal submit karena koneksi, minta peserta jangan menutup halaman, tunggu jaringan stabil, lalu klik kirim lagi.
7. Jika proktor melihat peserta offline, tunggu 30 detik lalu cek perangkat peserta. Offline bisa berarti tab tertutup, jaringan mati, atau heartbeat gagal.

## Setelah Ujian

1. Tunggu 2-3 menit setelah waktu selesai agar submit terakhir masuk.
2. Cek jumlah sesi dan hasil:
   ```sql
   SELECT status, COUNT(*) AS total
   FROM cbt_exam_sessions
   GROUP BY status;

   SELECT COUNT(*) AS total_results
   FROM cbt_exam_results;
   ```
3. Export hasil dari dashboard admin.
4. Jangan hapus token, sesi, jawaban, atau hasil sampai seluruh rekap selesai diverifikasi.

## Kontingensi Cepat

- **Token tidak valid**: pastikan peserta berada di ruangan yang benar dan token milik ruangan itu.
- **Belum di-assign ruangan**: cek `pendaftar.ruang_tes` dan pastikan namanya sama dengan `cbt_rooms.room_name`.
- **Submit gagal**: minta peserta coba lagi; aplikasi tidak menghapus jawaban lokal sebelum submit berhasil.
- **Banyak peserta gagal bersamaan**: cek Cloudflare Workers metrics, D1 row metrics, dan status Cloudflare. Jangan regenerate token saat peserta sudah mulai.
