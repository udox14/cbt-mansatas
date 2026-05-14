# Panduan Push dan Deploy via CMD

Panduan ini untuk alur kerja biasa: perubahan di-push ke GitHub, lalu GitHub Actions otomatis build dan deploy ke Cloudflare.

## 1. Masuk Folder Project

```bat
cd /d C:\DATA\cbt-mansatas
```

## 2. Jalankan Migration D1 Readiness

Jalankan ini sebelum push, karena Worker baru memakai kolom dan tabel readiness.

```bat
npm.cmd run db:readiness
```

Perintah ini menjalankan:

```bat
node scripts\cbt-readiness-migration.mjs --remote
```

Script tersebut akan mengecek schema D1 produksi dulu, lalu hanya menambahkan kolom/tabel yang belum ada.

Jika muncul pesan `CLOUDFLARE_API_TOKEN` diperlukan, set token Cloudflare dulu di CMD yang sama:

```bat
set CLOUDFLARE_API_TOKEN=ISI_TOKEN_CLOUDFLARE_ANDA
npm.cmd run db:readiness
```

Token yang dipakai harus punya akses edit D1 database dan account Cloudflare yang sama dengan deployment.

## 3. Cek Perubahan Git

```bat
git -c safe.directory=C:/DATA/cbt-mansatas status
```

## 4. Stage Semua Perubahan

```bat
git -c safe.directory=C:/DATA/cbt-mansatas add .
```

## 5. Commit

```bat
git -c safe.directory=C:/DATA/cbt-mansatas commit -m "Harden CBT readiness for concurrent exam"
```

## 6. Push

Jika branch utama adalah `main`:

```bat
git -c safe.directory=C:/DATA/cbt-mansatas push origin main
```

Jika branch utama adalah `master`:

```bat
git -c safe.directory=C:/DATA/cbt-mansatas push origin master
```

## 7. Pantau GitHub Actions

Buka repository GitHub, masuk tab **Actions**, lalu pastikan workflow **Deploy to Cloudflare** sukses.

Workflow akan otomatis:

- Deploy Worker jika ada perubahan di `apps/worker/**`
- Build dan deploy Pages jika ada perubahan di `apps/web/**`

## 8. Cek Cepat Setelah Deploy

Cek health API:

```text
https://cbtmansatas.drudox.workers.dev/api/health
```

Lalu lakukan tes cepat:

- Login admin
- Login proktor
- Login satu siswa dummy
- Mulai ujian dummy
- Isi jawaban
- Submit
- Cek hasil dan monitoring proktor

## Catatan Penting

- GitHub Actions saat ini tidak menjalankan migration D1 otomatis.
- Karena itu `npm.cmd run db:readiness` tetap wajib dijalankan manual sebelum push untuk update readiness ini.
- Jangan menjalankan load simulation ke ujian atau peserta asli. Gunakan dummy exam dan dummy users.
