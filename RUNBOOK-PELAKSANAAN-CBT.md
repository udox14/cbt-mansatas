# Runbook Pelaksanaan CBT

Dokumen ini dipakai saat simulasi dan hari-H CBT MAN 1 Tasikmalaya. Bagikan bagian yang sesuai ke admin/panitia, proktor, dan peserta.

## Aturan Umum

- Gunakan satu kanal komunikasi resmi untuk hari-H, misalnya grup panitia/proktor.
- Jangan regenerate token setelah peserta mulai ujian.
- Jangan menghapus ujian, sesi, jawaban, token, atau hasil sampai rekap selesai.
- Jika peserta mengalami kendala, utamakan menjaga halaman ujian tetap terbuka.
- Semua keputusan membuka kunci, reset perangkat, atau memperbolehkan lanjut ujian harus melalui proktor/panitia.

## Sosialisasi Anti-Cheat

Anti-cheat sebaiknya diberitahukan kepada peserta sebelum ujian dimulai. Tujuannya agar peserta memahami aturan, tidak kaget saat muncul peringatan, dan langsung melapor jika ada kendala teknis.

### Yang Perlu Disampaikan

- Peserta wajib tetap berada di halaman ujian selama ujian berlangsung.
- Peserta tidak boleh berpindah tab, minimize browser, membuka aplikasi lain, split screen, atau keluar fullscreen jika diminta fullscreen.
- Sistem dapat mencatat aktivitas yang dianggap pelanggaran.
- Pelanggaran dapat memunculkan peringatan, mengunci sesi, atau ditindaklanjuti sesuai keputusan panitia/proktor.
- Jika ada kendala teknis, peserta harus segera mengangkat tangan dan melapor ke proktor.
- Peserta tidak boleh menutup halaman ujian tanpa instruksi proktor.

### Yang Tidak Perlu Disampaikan Detail

- Batas angka pelanggaran yang terlalu rinci.
- Detail teknis cara deteksi sistem.
- Detail cooldown, endpoint, log, atau cara kerja internal aplikasi.
- Cara reset/unlock sesi.

### Teks Untuk Dibacakan Proktor

> Selama ujian berlangsung, peserta wajib tetap berada di halaman ujian. Sistem akan mendeteksi aktivitas seperti berpindah tab, keluar dari mode layar penuh, membuka aplikasi lain, atau meninggalkan halaman ujian. Setiap pelanggaran akan tercatat dan dapat menimbulkan peringatan, penguncian sesi, atau tindakan sesuai keputusan panitia/proktor. Jika terjadi kendala teknis, segera angkat tangan dan lapor kepada proktor, jangan menutup halaman ujian tanpa instruksi.

## Runbook Admin/Panitia

### H-1

1. Pastikan GitHub Actions deploy terakhir sukses.
2. Buka halaman CBT dan login sebagai admin.
3. Cek menu **Ruangan**:
   - semua ruangan ujian sudah ada;
   - nama ruangan sama persis dengan `ruang_tes` peserta;
   - setiap ruangan punya proktor.
4. Cek menu **Pengguna**:
   - akun proktor aktif;
   - proktor sudah di-assign ke ruangan yang benar.
5. Cek menu **Pendaftar/Peserta**:
   - tidak ada peserta non-Prestasi yang belum punya ruangan;
   - jadwal dan sesi peserta sudah benar.
6. Cek menu **Ujian**:
   - judul, durasi, tata tertib, dan pesan selesai sudah benar;
   - soal dan opsi sudah lengkap;
   - kunci jawaban sudah benar;
   - randomisasi dan anti-cheat sesuai kebijakan panitia;
   - status ujian masih **draft** sampai proktor siap.
7. Generate token untuk setiap ruangan.
8. Lakukan tes alur lengkap dengan 1-3 akun dummy:
   - login peserta;
   - input token;
   - jawab beberapa soal;
   - submit;
   - cek hasil;
   - proktor coba reset/unlock pada sesi dummy.

### 30 Menit Sebelum Ujian

1. Login admin dan pastikan dashboard bisa dibuka.
2. Pastikan semua proktor sudah login dan melihat token ruangan masing-masing.
3. Pastikan jaringan ruangan siap.
4. Aktifkan ujian hanya setelah proktor siap:
   - buka ujian;
   - ubah status menjadi **active**;
   - simpan.
5. Minta proktor membacakan token ke peserta setelah peserta berhasil login.

### Saat Ujian Berjalan

1. Jangan mengubah durasi, soal, opsi, randomisasi, atau token.
2. Pantau laporan dari proktor:
   - peserta tidak bisa login;
   - token tidak valid;
   - sesi terkunci;
   - peserta offline;
   - gagal submit.
3. Jika banyak peserta di banyak ruangan bermasalah bersamaan:
   - cek Cloudflare Pages/Worker status;
   - cek koneksi sekolah;
   - jangan langsung refresh massal atau regenerate token;
   - instruksikan proktor menjaga peserta tetap di halaman ujian.

### Setelah Ujian

1. Tunggu 2-3 menit setelah waktu selesai untuk memberi kesempatan submit terakhir masuk.
2. Cek rekap sesi:
   - jumlah peserta aktif;
   - jumlah submitted;
   - jumlah force submitted;
   - jumlah locked/offline.
3. Export hasil dari dashboard admin.
4. Simpan backup hasil sebelum melakukan perubahan lain.
5. Ubah status ujian menjadi **finished** setelah rekap dinyatakan lengkap.

## Runbook Proktor

### Sebelum Peserta Masuk

1. Login sebagai proktor.
2. Pastikan nama proktor dan ruangan yang tampil sudah benar.
3. Pastikan token aktif muncul untuk ujian di ruangan tersebut.
4. Jangan menampilkan token terlalu awal sebelum instruksi panitia.
5. Siapkan daftar peserta ruangan untuk mencocokkan peserta yang hadir.

### Saat Peserta Login

1. Arahkan peserta membuka situs CBT.
2. Peserta login memakai:
   - username: NISN;
   - password: tanggal lahir format `DDMMYYYY`.
3. Jika peserta gagal login:
   - cek NISN;
   - cek tanggal lahir;
   - laporkan ke admin jika tetap gagal.
4. Setelah peserta berhasil login dan ujian tersedia, bacakan token ruangan.
5. Pastikan peserta masuk ke halaman soal dan timer berjalan.
6. Bacakan sosialisasi anti-cheat sebelum peserta mulai mengerjakan.

### Saat Ujian Berjalan

1. Pantau tabel monitoring peserta.
2. Status penting:
   - **Online**: peserta aktif dan heartbeat masuk.
   - **Offline**: heartbeat tidak masuk sekitar 30 detik.
   - **Dikunci**: sesi terkunci karena waktu/anti-cheat.
   - **Selesai**: peserta sudah submit atau force submit.
3. Jika peserta **offline**:
   - cek perangkat dan koneksi peserta;
   - minta peserta jangan panik;
   - jika halaman tertutup, minta login ulang dan lanjutkan sesi.
4. Jika muncul **sesi terkunci di perangkat lain**:
   - pastikan peserta memang memakai perangkat yang benar;
   - klik **Reset** pada sesi peserta;
   - minta peserta login/input token lagi.
5. Jika peserta terkunci karena anti-cheat:
   - tanyakan kronologi;
   - cek log pelanggaran;
   - jika panitia/proktor mengizinkan lanjut, klik **Buka Kunci**;
   - jika tidak diizinkan, biarkan terkunci dan laporkan.
6. Jika peserta gagal submit:
   - jangan tutup halaman;
   - tunggu koneksi stabil;
   - minta peserta klik kirim ulang;
   - laporkan ke admin jika masih gagal.

### Larangan Untuk Proktor

- Jangan membagikan token ke luar ruangan.
- Jangan klik reset/unlock tanpa alasan jelas.
- Jangan menyuruh peserta refresh massal.
- Jangan menutup halaman peserta saat jawaban belum berhasil submit.
- Jangan mengubah perangkat peserta tanpa reset sesi dari dashboard proktor.

### Setelah Ujian

1. Pastikan semua peserta di ruangan berstatus **Selesai** atau sudah dilaporkan sebagai kasus khusus.
2. Catat peserta yang:
   - gagal login;
   - ganti perangkat;
   - terkunci anti-cheat;
   - gagal submit;
   - force submitted.
3. Laporkan rekap ruangan ke admin/panitia.

## Panduan Peserta

### Sebelum Mulai

1. Pastikan perangkat menyala dan baterai cukup.
2. Pastikan koneksi internet aktif.
3. Siapkan NISN dan tanggal lahir.
4. Jangan membuka aplikasi lain selama ujian.
5. Tunggu instruksi proktor untuk token.

### Login

1. Buka situs CBT.
2. Isi username dengan NISN.
3. Isi password dengan tanggal lahir format `DDMMYYYY`.
   - Contoh lahir 22 Desember 2002: `22122002`.
4. Pilih ujian yang tersedia.
5. Baca tata tertib.
6. Masukkan token dari proktor.

### Saat Mengerjakan

1. Jawaban otomatis tersimpan berkala.
2. Tetap kerjakan sampai selesai walaupun ada jeda koneksi singkat.
3. Gunakan tombol navigasi soal untuk berpindah soal.
4. Gunakan tanda **Ragu** jika ingin menandai soal.
5. Jangan pindah tab, minimize browser, split screen, atau keluar fullscreen jika diwajibkan.
6. Jika muncul peringatan pelanggaran, segera kembali fokus ke halaman ujian.
7. Jika halaman error atau koneksi putus:
   - jangan panik;
   - panggil proktor;
   - jangan menutup halaman kecuali diminta proktor.

### Submit

1. Klik **Kirim** setelah yakin selesai.
2. Jika submit gagal, jangan tutup halaman.
3. Tunggu koneksi stabil, lalu klik kirim ulang.
4. Ujian selesai hanya jika halaman menampilkan pesan selesai.

## Troubleshooting Cepat

| Masalah | Yang Dilakukan Peserta | Yang Dilakukan Proktor/Admin |
| --- | --- | --- |
| Login gagal | Cek NISN dan tanggal lahir | Cek data peserta dan format tanggal lahir |
| Ujian tidak muncul | Panggil proktor | Cek status ujian, jadwal, jalur, assignment |
| Token tidak valid | Pastikan token diketik benar | Cek token ruangan dan status ujian |
| Belum di-assign ruangan | Panggil proktor | Cek `ruang_tes` peserta dan mapping ruangan |
| Sesi terkunci perangkat lain | Jangan coba perangkat lain terus-menerus | Klik **Reset** jika perangkat benar |
| Terkunci anti-cheat | Panggil proktor | Cek log, lalu putuskan **Buka Kunci** atau tidak |
| Offline di dashboard | Tetap di halaman jika masih bisa | Cek koneksi/perangkat, tunggu 30 detik |
| Submit gagal | Jangan tutup halaman, coba ulang | Pastikan koneksi stabil, laporkan jika berulang |
| Waktu habis | Ikuti instruksi proktor | Cek status submit/lock di monitoring |

## Checklist Cetak Untuk Proktor

- [ ] Login proktor berhasil.
- [ ] Ruangan proktor benar.
- [ ] Token aktif terlihat.
- [ ] Peserta hadir dicocokkan dengan daftar.
- [ ] Semua peserta berhasil login.
- [ ] Semua peserta berhasil masuk halaman soal.
- [ ] Monitoring dibuka selama ujian.
- [ ] Kasus reset/unlock dicatat.
- [ ] Semua peserta selesai atau kasus khusus dilaporkan.

## Checklist Cetak Untuk Admin

- [ ] Deploy GitHub Actions sukses.
- [ ] Migration readiness sudah jalan.
- [ ] Health API normal.
- [ ] Admin bisa login.
- [ ] Proktor bisa login.
- [ ] Ruangan dan proktor benar.
- [ ] Peserta punya ruangan dan jadwal.
- [ ] Soal dan kunci jawaban final.
- [ ] Token sudah digenerate.
- [ ] Ujian diaktifkan setelah proktor siap.
- [ ] Hasil diexport setelah ujian selesai.
