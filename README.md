# CBT PMB — Sistem Ujian Penerimaan Murid Baru

Aplikasi Computer Based Test untuk seleksi PMB MAN 1 Tasikmalaya.
Numpang di database PMB existing. 300-800 siswa bersamaan. Gratis.

## Struktur

```
cbt-pmb/
├── apps/
│   ├── worker/        ← Backend API (Hono + D1 + R2)
│   │   ├── src/
│   │   ├── schema.sql ← Tabel cbt_* (tidak ganggu tabel PMB)
│   │   └── wrangler.toml ← ⚠️ Edit JWT_SECRET & CORS_ORIGIN
│   └── web/           ← Frontend (Next.js Static Export)
│       ├── src/
│       └── .env.local ← ⚠️ Buat file ini
├── PANDUAN-DEPLOY.md  ← Panduan lengkap
└── package.json       ← Script shortcut
```

## Quick Start

```bash
npm run setup                                          # Install deps
# Edit apps/worker/wrangler.toml → JWT_SECRET & CORS
wrangler r2 bucket create cbt-media                    # Buat R2
npm run db:init                                        # Tambah tabel cbt_*
npm run deploy:worker                                  # Deploy backend
echo "NEXT_PUBLIC_API_URL=https://..." > apps/web/.env.local
npm run build:web && npm run deploy:web                # Deploy frontend
```

## Login

| Siapa | Username | Password | Sumber |
|-------|----------|----------|--------|
| Admin PMB | username admin PMB | password admin PMB | tabel `admins` |
| Proktor | dibuat di CBT | dibuat di CBT | tabel `cbt_users` |
| Pendaftar PMB | NISN | tanggal lahir (DDMMYYYY) | tabel `pendaftar` |
| Peserta non-PMB | dibuat di CBT | dibuat di CBT | tabel `cbt_users` |

Panduan detail → [PANDUAN-DEPLOY.md](./PANDUAN-DEPLOY.md)
