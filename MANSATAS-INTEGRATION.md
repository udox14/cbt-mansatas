# MANSATAS-INTEGRATION.md — Contract between `cbt-mansatas` and `mansatas-app`

**MANSATAS repository audited:** `udox14/mansatas-app`  
**Baseline:** `main` @ `ba4b92ea607e8f2effc50d4b11164fede599f3c4` (21 Sep 2026)  
**CBT repository:** `udox14/cbt-mansatas`

Dokumen ini adalah kontrak integrasi. Coding agent CBT wajib membacanya sebelum menyentuh integrasi siswa, guru, mapel, TKA, atau autentikasi.

---

# 1. Database Binding

MANSATAS App memakai D1:

```text
database_name = mansatas-db
database_id   = 76b7b346-3f3f-4c1e-a347-2d51497bad97
```

CBT saat ini sudah memiliki binding read-only:

```text
MANSATAS_DB
```

ke database yang sama.

CBT tidak boleh menulis data master sekolah ke database ini.

---

# 2. Student Directory Contract

Source siswa:

```sql
siswa
```

Field yang relevan:

```text
id
nisn
nis_lokal
nama_lengkap
jenis_kelamin   -- 'L' | 'P'
kelas_id
status           -- active value: 'aktif'
foto_url
```

Source kelas:

```sql
kelas
```

Field:

```text
id
tingkat
nomor_kelas
kelompok
kapasitas
wali_kelas_id
```

Relasi:

```text
siswa.kelas_id → kelas.id
```

Current CBT participant mapping untuk siswa/kelas sesuai dengan schema aktual Mansatas.

Class display boleh dinormalisasi dari:

```text
tingkat + kelompok + nomor_kelas
```

tetapi ID kelas tetap `kelas.id`.

---

# 2A. PMB Applicant Directory Contract (Authoritative Source of Truth)

**Koreksi Arsitektur Fundamental:**
Data pendaftar PMB dan sumber data PMB untuk pengembangan baru **diperoleh dari `mansatas-db`**.

Tabel PMB lama pada database PMB lokal (`pendaftar`, `admins`, `prestasi`, dll.) berstatus **LEGACY / COMPATIBILITY ONLY**.
DILARANG memperlakukan tabel legacy PMB sebagai source of truth untuk fitur PMB baru.

## Canonical Architecture

```text
PMB Domain
    ↓
Participant / applicant source
    ↓
mansatas-db
    ↓
snapshot into CBT roster when needed (cbt_exam_roster)
    ↓
shared CBT examination engine
```

- `event-pmb` tetap menjadi event context kanonikal untuk PMB di CBT.
- Keberadaan `event-pmb` **TIDAK** berarti data peserta harus ditarik dari database PMB legacy.
- Seluruh fungsi peserta PMB baru wajib melalui adapter terisolasi: `services/sources/pmb.ts` (atau setara).
- Adapter menormalisasi data dari `mansatas-db` ke format partisipan standar yang digunakan oleh CBT shared engine.
- Roster peserta disnapshot ke tabel CBT (`cbt_exam_roster`) agar mutasi data pada Mansatas tidak mengubah riwayat ujian historis.

## Legacy PMB Database Rules
1. Tabel legacy PMB lama dipertahankan sementara hanya demi backward compatibility.
2. Dilarang membuat fitur baru yang bergantung pada tabel legacy PMB.
3. Dilarang menambah skema baru yang kopling ke tabel legacy PMB.
4. Dilarang menggunakan database PMB legacy sebagai sumber partisipan utama untuk pengembangan baru.
5. Perilaku kompatibilitas lama tetap berjalan sampai migrasi/penghapusan dijadwalkan secara eksplisit.
6. Dilarang melakukan pembersihan destruktif terhadap tabel legacy PMB pada fase ini.

---

# 3. Historical Class Fallback

MANSATAS mempunyai:

```sql
riwayat_kelas
```

Pada data tahun ajaran tertentu, modul TKA Mansatas menggunakan fallback ke `riwayat_kelas` bila `siswa.kelas_id` current tidak cukup.

CBT TKA adapter harus memahami pola ini.

Jangan berasumsi current `kelas_id` selalu merepresentasikan kelas siswa pada event TKA historis.

---

# 4. Academic Year Contract

Gunakan:

```sql
tahun_ajaran
```

Relevant:

```text
id
nama
semester
is_active
```

TKA source adalah **year-scoped**.

Jangan membaca pilihan TKA tanpa `tahun_ajaran_id`.

Untuk membuat snapshot event CBT, simpan source academic year ID pada metadata/event integration context.

---

# 5. Staff Identity Contract

Staff internal disimpan pada:

```sql
"user"
```

Relevant fields:

```text
id
name
email
role
nama_lengkap
nip
avatar_url
banned
banReason
banExpires
```

`user.role` adalah primary/display role, bukan keseluruhan role user.

Multi-role disimpan di:

```sql
user_roles
```

Current model:

```text
user_id
role
PRIMARY KEY(user_id, role)
```

CBT tidak boleh berasumsi satu staff hanya punya satu role.

---

# 6. Credential Contract

**PENTING:** password hash TIDAK berada di tabel `user`.

Credential password berada di:

```sql
account
```

Relevant:

```text
userId
providerId
password
```

Untuk password login:

```text
providerId = 'credential'
```

MANSATAS auth aktual menggunakan custom lightweight auth dengan:

```text
PBKDF2
iterations: 100000
hash: SHA-256
salt: per password
stored format:
pbkdf2:100000:<salt-base64>:<hash-base64>
```

Source implementation:
`utils/auth/index.ts`.

## Current CBT incompatibility

Current endpoint CBT `/api/admin/gtk-users` membaca tabel `user` dan mencoba menggunakan:

```text
u.password
u.password_hash
```

Kolom tersebut tidak ada pada model akun Mansatas aktual.

Endpoint import kemudian fallback ke password default.

**Ini tidak boleh menjadi desain final.**

---

# 7. Recommended Staff Authentication Architecture

Pisahkan dua hal:

## Identity / provisioning

CBT membaca:

```text
"user"
user_roles
```

untuk:
- memilih user;
- nama;
- email;
- status;
- referensi stable `user.id`.

CBT membuat local access profile yang mereferensikan Mansatas user ID.

## Credential verification

Preferred design:

```text
CBT
  ↓ private internal auth contract
MANSATAS App
  ↓
user + account
```

Implementasi terbaik bila praktis:
- private Cloudflare service binding/internal endpoint;
- CBT mengirim email+password;
- Mansatas memverifikasi memakai implementasi auth authoritative;
- Mansatas mengembalikan identity minimal;
- tidak ada password/hash yang dicopy ke CBT.

Fallback yang diperbolehkan bila service binding belum dibuat:
- read-only query `user + account`;
- CBT verifier harus kompatibel dengan PBKDF2 Mansatas;
- implementation terisolasi dalam `MansatasStaffAuthAdapter`;
- contract test wajib;
- jangan persist hash ke CBT.

**Dilarang membuat default password massal seperti `mansatas2026` sebagai desain produksi.**

---

# 8. CBT Roles Are Not the Same as MANSATAS Roles

MANSATAS memiliki banyak role:

```text
super_admin
admin_tu
kepsek
wakamad
guru
guru_bk
guru_piket
guru_tahfidz
wali_kelas
resepsionis
guru_ppl
satpam
pramubakti
operator
bendahara_komite
...
```

MANSATAS juga memiliki:
- `role_features`;
- `role_feature_permissions`;
- `user_feature_overrides`.

CBT tidak perlu menyalin permission matrix tersebut.

CBT access adalah domain sendiri.

Gunakan:
- Mansatas user ID sebagai identity source;
- CBT-local role/permission grants untuk mode CBT.

Contoh:

```text
Mansatas user:
  id = abc
  roles = guru + wali_kelas

CBT:
  role = teacher
  modes = tka + ulangan
  subject scope = Bahasa Arab
```

Jangan otomatis memberi CBT admin hanya karena user memiliki role tertentu di Mansatas kecuali bootstrap policy eksplisit.

---

# 9. Teacher / Subject Assignment Contract

Master mapel:

```sql
mata_pelajaran
```

Fields:

```text
id
nama_mapel
kode_mapel
kelompok
tingkat
kategori
```

Penugasan guru:

```sql
penugasan_mengajar
```

Fields:

```text
id
guru_id          → user.id
mapel_id         → mata_pelajaran.id
kelas_id         → kelas.id
tahun_ajaran_id  → tahun_ajaran.id
```

Untuk menentukan mapel yang secara akademik diampu guru:
- gunakan `penugasan_mengajar`;
- scope ke tahun ajaran relevan;
- jangan menggunakan `user.role='guru'` saja.

RPPM Generator sudah menggunakan pola ini untuk membatasi mapel guru.

---

# 10. TKA Contract

TKA Mansatas saat ini fokus pada pendataan pilihan mapel siswa kelas 12.

Table:

```sql
tka_mapel_pilihan
```

Schema:

```text
id
siswa_id
tahun_ajaran_id
mapel_pilihan1
mapel_pilihan2
updated_at

UNIQUE(siswa_id, tahun_ajaran_id)
```

Jadi pilihan mapel:
- year-scoped;
- disimpan sebagai **string**, bukan FK `mata_pelajaran`.

## TKA participant rule

Mansatas module:
- hanya siswa aktif;
- kelas tingkat 12;
- current class via `siswa.kelas_id`;
- fallback `riwayat_kelas` untuk tahun ajaran terkait.

CBT harus mengikuti semantics ini.

---

# 11. TKA Subject Options

Current option registry Mansatas:

```text
Matematika Tingkat Lanjut
Bahasa Indonesia Tingkat Lanjut
Bahasa Inggris Tingkat Lanjut
Fisika
Kimia
Biologi
Pendidikan Pancasila dan Kewarganegaraan
Ekonomi
Geografi
Sosiologi
Sejarah
Antropologi
Bahasa Prancis
Bahasa Jerman
Bahasa Jepang
Bahasa Mandarin
Bahasa Korea
Bahasa Arab
Projek Kreatif dan Kewirausahaan
```

Mandatory CBT TKA subjects tetap berasal dari product requirement:

```text
Matematika
Bahasa Indonesia
Bahasa Inggris
```

Kemudian tambah dua string dari:
```text
mapel_pilihan1
mapel_pilihan2
```

---

# 12. TKA Subject Mapping Warning

Karena pilihan TKA berupa string sementara teacher assignment memakai FK `mata_pelajaran.id`, CBT **tidak boleh berasumsi exact string selalu sama**.

Buat subject normalization / alias mapping.

Contoh concept:

```text
CBT subject
  id
  canonical_name
  mansatas_mapel_id nullable
  tka_source_name nullable
  aliases[]
```

Admin harus dapat memperbaiki mapping bila nama berbeda.

Jangan menggunakan fuzzy matching otomatis untuk authorization tanpa review.

---

# 13. TKA Snapshot

Saat event TKA dibuat/prepared:

1. resolve active/source `tahun_ajaran_id`;
2. ambil siswa aktif tingkat 12;
3. ambil `mapel_pilihan1/2`;
4. validasi pilihan lengkap;
5. bentuk 5 subject assignments;
6. snapshot ke CBT.

Setelah snapshot, runtime ujian tidak perlu query TKA Mansatas terus-menerus.

Jika pilihan TKA berubah setelah snapshot:
- tampilkan source drift;
- jangan diam-diam mutate event aktif;
- admin dapat explicit resync sebelum event locked/ready.

---

# 14. Parent TKA Approval

MANSATAS memiliki `parent_tka_approvals` dan notification flow.

Untuk CBT exam assignment:
- approval dapat dibaca sebagai metadata bila dibutuhkan;
- tidak menjadi dependency runtime default kecuali product requirement mengatakan hanya pilihan yang disetujui orang tua yang boleh disnapshot.

Jangan mengubah approval dari CBT.

---

# 15. RPPM Generator Actual Pattern

RPPM Generator MANSATAS **tidak memanggil provider AI langsung**.

Current wizard:

```text
Template
→ Spesifikasi
→ Prompt
→ Copy ke AI eksternal
→ Paste JSON dari AI
→ Parse + Normalize + Validate
→ Edit
→ Save / Output
```

Key behavior:
- app membangun prompt;
- user copy prompt ke chatbot AI;
- AI diminta mengembalikan structured JSON;
- user paste JSON;
- app parse dan validate;
- hasil diperiksa sebelum disimpan.

Ini adalah pattern yang dimaksud sebagai benchmark untuk CBT Question Generator.

---

# 16. Recommended CBT AI Question Generator V1

Agar paling konsisten dengan RPPM:

```text
Parameter Soal
→ Build Prompt
→ Copy Prompt
→ User pakai chatbot eksternal
→ Paste Structured JSON
→ Schema Validation
→ Preview
→ Edit
→ Select
→ Save to Question Bank / Exam
```

Keuntungan:
- tidak butuh API key provider;
- tidak vendor-lock;
- sama dengan mental model RPPM;
- biaya API aplikasi nol;
- output tetap bisa “otomatis menjadi soal” setelah JSON di-paste;
- aman karena human review tetap ada.

---

# 17. Optional AI V2

Direct provider integration boleh menjadi fitur berikutnya:

```text
Generate langsung dari aplikasi
```

Jika dibuat:
- gunakan provider adapter;
- secret server-side;
- tetap menghasilkan format JSON yang sama dengan V1;
- tetap melalui validation + preview;
- V1 tidak dibuang.

Jadi pipeline tunggal:

```text
External Chatbot Paste ─┐
Direct AI Provider ─────┼→ Structured Question Draft → Validation → Review → Save
Word Import ────────────┤
Excel Import ───────────┘
```

---

# 18. Integration Rules Summary

Coding agent CBT wajib:

1. Treat `mansatas-db` read-only.
2. Referensi siswa dengan `siswa.id`.
3. Referensi staff dengan `user.id`.
4. Jangan baca password dari `user`.
5. Jangan copy raw/password hash ke CBT.
6. Gunakan multi-role awareness.
7. Gunakan `penugasan_mengajar` untuk scope mapel guru.
8. TKA harus year-scoped.
9. TKA harus support `riwayat_kelas` fallback.
10. Jangan exact-match string TKA ke mapel untuk authorization tanpa mapping.
11. Snapshot source data sebelum execution.
12. Ikuti RPPM pattern untuk AI Generator V1.
13. PMB Source of Truth: Data peserta PMB baru bersumber dari `mansatas-db` via `services/sources/pmb.ts`. Tabel PMB lama adalah legacy compatibility only. Dilarang menambah ketergantungan baru ke skema legacy PMB.
