# Panduan Lengkap: Deploy CBT PMB dari Nol sampai Live

## Daftar Isi

1. Prasyarat
2. Setup Akun Cloudflare
3. Setup & Deploy Backend (Worker — numpang di D1 PMB existing)
4. Setup & Deploy Frontend (Next.js + Pages)
5. Hubungkan Domain Custom
6. Konfigurasi Final & Keamanan
7. Persiapan Sebelum Hari-H Ujian
8. Troubleshooting

---

## 1. Prasyarat

Pastikan sudah terinstall di komputer Anda:

**a) Node.js v18+**
```bash
node --version   # minimal v18.x
npm --version    # minimal v9.x
```
Download: https://nodejs.org

**b) Git**
```bash
git --version
```

**c) Wrangler CLI (Cloudflare)**
```bash
npm install -g wrangler
wrangler --version   # minimal v3.x
```

---

## 2. Setup Akun Cloudflare

### 2.1 Login Wrangler
```bash
wrangler login
```
Browser terbuka → klik **Allow** → kembali ke terminal.

Verifikasi:
```bash
wrangler whoami
```

---

## 3. Setup & Deploy Backend

> **PENTING:** CBT numpang di database PMB existing (`pmb-man1-tasik`).
> JANGAN buat database baru. Semua tabel CBT sudah di-prefix `cbt_` agar tidak bentrok.

### 3.1 Extract & Install
```bash
tar -xzf cbt-pmb.tar.gz
cd cbt-pmb
npm run setup
```

### 3.2 Edit `apps/worker/wrangler.toml`
Hanya 2 hal yang perlu diubah:

```toml
[vars]
JWT_SECRET = "GANTI_DENGAN_STRING_ACAK_32_KARAKTER"
CORS_ORIGIN = "https://cbt.man1tasikmalaya.sch.id"
```

Generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Database ID sudah diisi: `b28a3f9e-331d-4bd2-9b85-95b12d6f313f`
> Tidak perlu diubah karena sudah mengarah ke DB PMB Anda.

### 3.3 Buat Bucket R2 (untuk media soal)
```bash
wrangler r2 bucket create cbt-media
```

### 3.4 Tambahkan Tabel CBT ke Database PMB
```bash
npm run db:init
```

Ini akan menambahkan tabel `cbt_rooms`, `cbt_users`, `cbt_exams`, dll **tanpa mengubah tabel PMB yang sudah ada** (admins, pendaftar, prestasi, pengaturan).

Verifikasi:
```bash
npx wrangler d1 execute pmb-man1-tasik --remote --command="SELECT name FROM sqlite_master WHERE name LIKE 'cbt_%' ORDER BY name"
```
Harus muncul 9 tabel yang diawali `cbt_`.

### 3.5 Deploy Worker
```bash
npm run deploy:worker
```

Output:
```
Published cbtmansatas
  https://cbtmansatas.NAMA-ANDA.workers.dev
```
**CATAT URL ini.**

### 3.6 Test Login
```bash
# Test dengan akun admin PMB existing
curl -X POST https://cbtmansatas.NAMA-ANDA.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ADMIN_USERNAME_PMB","password":"PASSWORD_ADMIN_PMB"}'
```
Harus dapat `{"success":true,"data":{"token":"...","user":{"role":"admin"}}}`

---

## 4. Setup & Deploy Frontend

### 4.1 Konfigurasi Environment
```bash
echo "NEXT_PUBLIC_API_URL=https://cbtmansatas.NAMA-ANDA.workers.dev" > apps/web/.env.local
```

### 4.2 Test Lokal (Opsional)
Terminal 1:
```bash
npm run dev:worker
```
Terminal 2:
```bash
npm run dev:web
```
Buka http://localhost:3000

### 4.3 Build & Deploy
```bash
npm run build:web
npm run deploy:web
```

**Atau via GitHub (auto-deploy):**

1. Push ke GitHub:
   ```bash
   git init && git add . && git commit -m "Initial CBT PMB"
   git remote add origin https://github.com/USERNAME/cbt-pmb.git
   git push -u origin main
   ```

2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**

3. Konfigurasi:
   - **Root directory:** `apps/web`
   - **Build command:** `npm install && npm run build`
   - **Build output:** `out`
   - **Environment:** `NEXT_PUBLIC_API_URL` = URL Worker Anda, `NODE_VERSION` = `18`

---

## 5. Hubungkan Domain Custom

### 5.1 Frontend
Dashboard → Workers & Pages → project `cbt-pmb` → **Custom domains** → tambah `cbt.man1tasikmalaya.sch.id`

### 5.2 Backend
Dashboard → Workers → `cbtmansatas` → **Settings** → **Triggers** → **Custom Domains** → tambah `api-cbt.man1tasikmalaya.sch.id`

### 5.3 Update Config
**`apps/worker/wrangler.toml`:**
```toml
CORS_ORIGIN = "https://cbt.man1tasikmalaya.sch.id"
```
Deploy: `npm run deploy:worker`

**`apps/web/.env.local`:**
```
NEXT_PUBLIC_API_URL=https://api-cbt.man1tasikmalaya.sch.id
```
Build & deploy: `npm run build:web && npm run deploy:web`

---

## 6. Konfigurasi Keamanan

### 6.1 SSL
Dashboard → domain → **SSL/TLS** → **Full (strict)**

### 6.2 Rate Limiting (opsional)
Dashboard → **Security** → **WAF**:
- `/api/auth/login` → max 10 req/menit per IP
- `/api/*` → max 100 req/menit per IP

---

## 7. Persiapan Sebelum Hari-H Ujian

### 7.1 Login Admin
Buka situs CBT → Login dengan **username & password admin PMB yang sudah ada**.
Admin PMB otomatis jadi admin CBT!

### 7.2 Buat Ruangan
Admin → tab **Ruangan** → Tambah sesuai lokasi ujian.

### 7.3 Buat Akun Proktor
Admin → tab **Pengguna** → Tambah:
- Role: **Proktor**
- Assign ke ruangan yang diawasi

### 7.4 Pastikan Pendaftar PMB Punya `ruang_tes`
Di sistem PMB Anda, pastikan kolom `ruang_tes` pada tabel `pendaftar` sudah diisi dan **namanya sama persis** dengan nama ruangan di CBT.

Contoh: jika di CBT ada ruangan "Ruang 1", maka `ruang_tes` pendaftar harus bernilai "Ruang 1".

### 7.5 Buat Ujian + Input Soal
Admin → tab **Ujian** → Buat ujian → masukkan soal (manual, import Excel, atau import Word).

### 7.6 Generate Token
Klik ujian → **Token** → **Generate Token** → setiap ruangan dapat PIN 6 digit.

### 7.7 Aktifkan Ujian
Edit ujian → Status: **Aktif** → Simpan.

### 7.8 Alur Siswa di Hari-H
1. Siswa buka situs CBT di HP/laptop
2. Login pakai **NISN** dan **tanggal lahir** (format DDMMYYYY, contoh: `22122002`)
3. Klik ujian → baca tata tertib → input token dari pengawas
4. Kerjakan ujian → otomatis tersimpan berkala
5. Kumpulkan / waktu habis → selesai

### 7.9 Checklist
- [ ] Admin PMB bisa login CBT
- [ ] Ruangan sudah dibuat, nama sama dengan `ruang_tes` di pendaftar
- [ ] Proktor sudah punya akun & di-assign ruangan
- [ ] Soal sudah lengkap & di-review
- [ ] Token sudah di-generate
- [ ] Ujian berstatus **Aktif**
- [ ] Proktor sudah coba login & melihat token
- [ ] Test 1 siswa dummy untuk coba alur dari awal sampai selesai

---

## 8. Troubleshooting

### "Username atau password salah" (pendaftar)
- Username = **NISN**, password = **tanggal lahir** format DDMMYYYY
- Contoh: lahir 22 Desember 2002 → password `22122002`
- Cek format tanggal di DB: `npx wrangler d1 execute pmb-man1-tasik --remote --command="SELECT nisn, tanggal_lahir FROM pendaftar LIMIT 5" --json`

### "Anda belum di-assign ke ruangan"
- Kolom `ruang_tes` di tabel `pendaftar` kosong, ATAU
- Nama `ruang_tes` tidak cocok dengan nama di `cbt_rooms`
- Solusi: samakan nama ruangan di kedua tempat

### "Token tidak valid"
- Pastikan token untuk ruangan yang benar
- Cek apakah ujian masih berstatus **Aktif**

### "Sesi terkunci di perangkat lain"
- Proktor klik **Reset** di dashboard monitoring

### Tabel CBT vs PMB
CBT hanya baca tabel `admins` dan `pendaftar`. Tidak pernah menulis ke tabel PMB.
Semua data CBT tersimpan di tabel `cbt_*` — aman tidak bentrok.

---

## Arsitektur

```
┌────────────────────────────────────────────────────────────┐
│  Database D1: pmb-man1-tasik                               │
│                                                            │
│  ┌──────────────────────┐  ┌────────────────────────────┐  │
│  │  TABEL PMB (existing) │  │  TABEL CBT (baru, cbt_*)  │  │
│  │  • admins             │  │  • cbt_rooms               │  │
│  │  • pendaftar  ◄───JOIN──│  • cbt_exams                │  │
│  │  • prestasi           │  │  • cbt_questions           │  │
│  │  • pengaturan         │  │  • cbt_exam_sessions       │  │
│  │                       │  │  • cbt_student_answers     │  │
│  │                       │  │  • cbt_exam_results        │  │
│  │                       │  │  • cbt_users (proktor dll) │  │
│  │                       │  │  • cbt_exam_tokens         │  │
│  │                       │  │  • cbt_question_options    │  │
│  └──────────────────────┘  └────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

Login: cek `admins` → `cbt_users` → `pendaftar` (by NISN)

---

## Biaya

| Komponen | Free Plan | Catatan |
|----------|-----------|---------|
| Workers | 100K req/hari | Cukup untuk 800 siswa |
| D1 | 5M read/hari | Sudah ada, numpang |
| R2 | 10GB storage | Gambar/audio soal |
| Pages | Unlimited | Unlimited bandwidth |
| **Total** | **Rp 0/bulan** | |
