# PRD — CBT MANSATAS Multi-Mode Examination Platform

**Repository:** `udox14/cbt-mansatas`  
**Baseline audited:** `main` @ `2ab45cfbebd151f77f8bc5d0705612b4a6434b86`  
**Product:** CBT MAN 1 Tasikmalaya  
**Status:** Product & architecture specification for major refactor  
**Primary principle:** **Multiple Exam Domains, One Shared Examination Engine**

---

## 1. Executive Summary

CBT MANSATAS saat ini berawal sebagai CBT PMB dan sudah berkembang memiliki fondasi multi-event, roster snapshot, sumber peserta dari `mansatas-db`, multi-mapel, monitoring, token, anti-cheat, heartbeat, hasil, analitik soal, import Word/Excel, serta peran admin/proktor/peserta.

Perubahan berikutnya bukan membuat aplikasi CBT baru dari nol. Perubahan ini mengubah CBT MANSATAS menjadi **platform ujian sekolah multi-mode** dengan domain operasional yang terpisah namun menggunakan satu engine ujian bersama.

Mode/domain yang sudah didefinisikan dalam requirement:

1. **PMB** — tes penerimaan murid baru.
2. **Kegiatan** — seleksi OSN, OMI, lomba, dan tes kegiatan lain.
3. **TKA** — latihan, try out, simulasi, dan tes TKA.
4. **Semester** — asesmen akhir semester / akhir tahun dengan nama event yang configurable.
5. **Ulangan Harian** — workspace ujian milik guru.

> Requirement awal menyebut “6 mode”, tetapi hanya lima domain di atas yang didefinisikan. Implementasi **tidak boleh mengarang mode keenam**. Arsitektur wajib extensible sehingga domain keenam dapat ditambahkan kelak tanpa merombak shared engine.

Setiap mode harus mempunyai route, navigation context, konfigurasi, lifecycle, hak akses, event, roster, jadwal, bank soal, monitoring, token, laporan, dan data operasional yang jelas. Pemisahan ini **bukan sekadar filter UI**.

---

# 2. Current-State Audit

## 2.0 Cross-repository source of truth

Untuk integrasi data sekolah, baca juga `MANSATAS-INTEGRATION.md`. Dokumen tersebut diaudit terhadap `udox14/mansatas-app` dan menjadi kontrak source siswa, staff, mapel, TKA, auth, dan pola RPPM Generator.

## 2.1 Stack saat ini

### Frontend
- Next.js 14.2
- React 18
- Tailwind CSS 3
- Static export / Cloudflare Pages
- Plus Jakarta Sans
- KaTeX
- DOMPurify
- `docx`, `mammoth`, `xlsx`
- Lucide React

### Backend
- Hono
- Cloudflare Workers
- TypeScript

### Storage
- D1 binding `DB` ke database `pmb-man1-tasik`
- D1 binding `MANSATAS_DB` ke `mansatas-db`
- R2 `cbt-media`
- KV `RATE_LIMIT`

### Existing participant sources
- `pmb`
- `mansatas`
- `cbt_user`

---

## 2.2 Existing capabilities to preserve and reuse

Fitur berikut sudah terdapat di codebase dan harus diperlakukan sebagai **existing capability**, bukan dibangun ulang tanpa alasan:

### Shared CBT mechanics
- login multi-source;
- JWT authentication;
- login rate limiting;
- exam listing;
- token validation;
- session creation;
- randomized question order;
- randomized option order;
- answer saving;
- heartbeat;
- anti-cheat violation logging;
- session locking;
- fullscreen enforcement;
- submit;
- force-submit oleh proktor;
- reset/unlock session;
- monitoring session;
- hasil ujian;
- recompute missing results;
- item/question analytics;
- media upload ke R2;
- score visibility;
- duration/timer;
- passing score;
- rules text;
- completion message.

### Content authoring
- input soal;
- bulk question endpoint;
- Rich Editor;
- Word import;
- Excel import;
- image/audio media;
- Arabic/RTL rendering;
- mathematical content via KaTeX.

### Administration
- rooms;
- proctors;
- user management;
- token generation;
- token custom code;
- participant assignment;
- result export;
- attendance Word generation;
- settings.

### Multi-event groundwork
Sudah ada:
- `cbt_events`;
- `event_id` pada exam;
- `cbt_exam_roster`;
- source participants;
- roster snapshot;
- Mansatas participant adapter;
- `subject_name`;
- `sequence_order`;
- OMI/multi-mapel groundwork.

**Kesimpulan:** refactor harus mengangkat fitur-fitur ini menjadi **shared platform services**, bukan menggandakannya per mode.

---

## 2.3 Existing technical debt relevant to this project

Beberapa file saat ini terlalu besar dan mencampur banyak tanggung jawab:

- `apps/web/src/app/admin/page.tsx` sekitar 4.500 baris.
- `apps/web/src/components/exam/ExamRoom.tsx` sekitar 1.100 baris.
- `apps/worker/src/routes/admin.ts` sekitar 1.500 baris.

Refactor multi-mode tidak boleh memperbesar pola monolitik ini.

Strategi wajib:
- **strangler / incremental refactor**;
- extract domain services, route modules, components, dan hooks sedikit demi sedikit;
- jangan rewrite PMB sekaligus;
- jangan memindahkan semua kode hanya demi “arsitektur bersih” tanpa kebutuhan produk.

---

# 3. Product Goals

## 3.1 Goals

Platform harus:

1. Menangani berbagai jenis ujian sekolah melalui domain terpisah.
2. Memakai satu examination engine yang stabil.
3. Membuat PMB tetap berjalan tanpa regression.
4. Menggunakan `mansatas-db` sebagai source of truth untuk siswa aktif dan akun staf/guru.
5. Menyediakan RBAC yang lebih granular daripada `admin/proctor/student`.
6. Membuat pengelolaan ujian semester dapat disiapkan penuh sebelum hari-H.
7. Membuat guru dapat membuat dan mengelola ujian mereka sendiri sesuai hak akses.
8. Menyediakan AI Question Generator sebagai jalur input soal tambahan.
9. Mempertahankan reliability pada ujian dengan ratusan peserta simultan.
10. Membuat arsitektur cukup modular untuk domain ujian baru di masa depan.

---

## 3.2 Non-goals

Pada refactor ini jangan sekaligus:

- mengganti seluruh stack frontend/backend;
- migrate Next.js 14 ke framework lain;
- mengganti Hono;
- memindahkan semua tabel CBT ke database baru hanya karena refactor;
- rewrite total ExamRoom;
- membuat sistem LMS;
- membuat sistem nilai rapor;
- membuat sistem pembayaran;
- mengubah source data Mansatas dari CBT;
- menambahkan mode keenam yang belum didefinisikan;
- membuat AI menentukan kunci jawaban final tanpa review manusia.

---

# 4. Core Architectural Principle

## 4.1 Shared Engine vs Domain

Gunakan model:

```text
CBT MANSATAS
│
├── Platform Shell
│   ├── Authentication
│   ├── RBAC / Permissions
│   ├── Mode Launcher
│   ├── Shared Settings
│   └── Audit
│
├── Shared Examination Engine
│   ├── Exam Runtime
│   ├── Question Delivery
│   ├── Randomization
│   ├── Autosave
│   ├── Heartbeat
│   ├── Anti-cheat
│   ├── Timer
│   ├── Token
│   ├── Session
│   ├── Scoring
│   ├── Monitoring
│   ├── Analytics
│   ├── Result
│   └── Print / Export
│
├── PMB Domain
├── Kegiatan Domain
├── TKA Domain
├── Semester Domain
└── Ulangan Domain
```

### Shared engine bertanggung jawab terhadap:
“Bagaimana sebuah ujian dijalankan.”

### Domain bertanggung jawab terhadap:
“Siapa peserta, siapa pengelola, bagaimana ujian dibuat, dijadwalkan, dikelompokkan, dan dioperasikan dalam konteks mode tersebut.”

---

# 5. Routing

Target route frontend:

```text
/login

/app
  /select-mode

/pmb
  /dashboard
  /events
  /exams
  /participants
  /rooms
  /monitoring
  /reports
  /settings

/kegiatan
  /dashboard
  /events
  /:eventId
    /subjects
    /participants
    /schedule
    /monitoring
    /results

/tka
  /dashboard
  /events
  /:eventId
    /subjects
    /participants
    /schedule
    /monitoring
    /results

/semester
  /dashboard
  /events
  /:eventId
    /subjects
    /participants
    /rooms
    /seating
    /schedule
    /invigilators
    /readiness
    /monitoring
    /results
    /reports

/ulangan
  /dashboard
  /exams
  /question-banks
  /results

/exam/:sessionId
```

Route final boleh disesuaikan dengan keterbatasan static export, tetapi **context domain harus berada di URL**, bukan hanya `localStorage` atau filter state.

Backend target konseptual:

```text
/api/auth/*
/api/platform/*
/api/pmb/*
/api/kegiatan/*
/api/tka/*
/api/semester/*
/api/ulangan/*
/api/exam-engine/*
```

Existing endpoint tidak perlu langsung dipindahkan semua. Sediakan compatibility layer selama migrasi.

---

# 6. Domain Model

## 6.1 Mode

Gunakan identifier stabil:

```text
pmb
kegiatan
tka
semester
ulangan
```

Jangan gunakan display label sebagai primary identifier.

---

## 6.2 Event

`Event` adalah container operasional tingkat atas.

Minimal field konseptual:

```text
id
mode
code
name
academic_year
term
participant_source
status
starts_at
ends_at
created_by
created_at
updated_at
```

Lifecycle:

```text
draft
configuration
ready
active
completed
archived
```

PMB existing dapat sementara dipetakan ke lifecycle ini melalui compatibility rules.

---

## 6.3 Subject / Exam Definition

Pisahkan konsep **mata pelajaran/domain ujian** dari **attempt/session siswa**.

Minimal:

```text
exam_id
event_id
mode
subject_id nullable
subject_name
version_label nullable
owner_user_id nullable
duration_minutes
rules
randomization settings
security settings
scoring settings
schedule binding
status
```

---

## 6.4 Roster Snapshot

Prinsip existing `cbt_exam_roster` dipertahankan:

- sumber peserta tetap berasal dari sistem asal;
- roster ujian menyimpan snapshot;
- perubahan nama/kelas siswa setelah ujian tidak mengubah histori.

Snapshot minimal:
- source;
- source_id;
- NISN;
- nama;
- kelas;
- tingkat;
- jenis kelamin;
- metadata relevan;
- event;
- exam;
- room;
- schedule slot.

---

# 7. Mode Specification

# 7.1 PMB

## Purpose
Tes masuk calon murid.

## Source
Data PMB existing.

## Rules
- Pertahankan workflow yang sudah stabil.
- Event PMB existing tetap dikenali.
- Login peserta PMB tetap kompatibel.
- Rule jalur PMB existing tidak boleh rusak.
- Refactor harus memiliki regression checklist khusus PMB.

## Priority
**Compatibility first.**

---

# 7.2 Kegiatan

## Purpose
Seleksi lomba/kegiatan seperti:
- OSN;
- OMI;
- delegasi lomba;
- seleksi internal;
- tes kegiatan lain.

## Workflow

```text
Create Event
→ Create Subjects/Exams
→ Build Questions
→ Assign Participants per Subject
→ Configure Schedule / Token
→ Ready Check
→ Run
→ Monitor
→ Result / Analytics / Print
```

## Participant rules
- source utama: siswa aktif `mansatas-db`;
- satu siswa dapat diassign ke beberapa mapel;
- assignment per mapel harus eksplisit;
- roster snapshot dibuat per exam/mapel.

## Admin capabilities
- create/edit/archive event;
- create mapel;
- create multiple exam versions;
- bulk assign participant;
- filter siswa by kelas/tingkat/gender;
- monitoring;
- analytics;
- export.

---

# 7.3 TKA

## Purpose
- latihan;
- try out;
- simulasi;
- TKA internal.

## Participant source
`mansatas-db` melalui **TKA adapter**.

Schema source telah diverifikasi:
- siswa aktif dari `siswa`;
- kelas tingkat 12 dari `kelas`;
- historical fallback melalui `riwayat_kelas`;
- tahun ajaran dari `tahun_ajaran`;
- dua mapel pilihan dari `tka_mapel_pilihan`;
- unique source key pilihan adalah `(siswa_id, tahun_ajaran_id)`.

Jangan hardcode query TKA tersebar di route. Buat adapter seperti existing `participants.ts`.

TKA CBT harus selalu menyimpan source `tahun_ajaran_id` dan membuat snapshot sebelum execution.

## Automatic subject assignment

Setiap peserta mendapatkan:

### Wajib
1. Matematika
2. Bahasa Indonesia
3. Bahasa Inggris

### Pilihan
4. Pilihan 1 dari Modul TKA
5. Pilihan 2 dari Modul TKA

Assignment dihasilkan otomatis dari source data dan disnapshot ke event.

## Teacher behavior
Guru yang memiliki permission TKA dapat:
- membuat bank soal mapelnya;
- membuat banyak versi/paket;
- membuat latihan/try out sesuai scope;
- melihat hasil pada mapelnya;
- melihat item analysis mapelnya.

Admin dapat melihat seluruh data.

## Ownership
Setiap exam harus mempunyai:
- `owner_user_id`;
- optional `subject_id`;
- access scope.

Guru tidak boleh mengedit exam guru lain kecuali memiliki permission khusus.

---

# 7.4 Semester

Nama UI event **configurable**. Jangan hardcode istilah kementerian.

Contoh:
- Asesmen Sumatif Akhir Semester;
- Asesmen Akhir Semester;
- Penilaian Akhir Tahun;
- Asesmen Sumatif Akhir Tahun;
- nama lokal lainnya.

System domain tetap `semester`.

---

## 7.4.1 Event Setup Wizard

Recommended flow:

```text
1. Identitas Event
2. Peserta
3. Mata Pelajaran
4. Ruangan
5. Seating
6. Jadwal
7. Pengawas
8. Soal & Readiness
9. Publish / Ready
```

Wizard bukan kewajiban visual tunggal, tetapi dependency antar-konfigurasi harus jelas.

---

## 7.4.2 Participant Population

Default:
- seluruh siswa aktif yang berada dalam scope event.

Filter:
- tingkat;
- kelas;
- jenis kelamin;
- status.

Roster snapshot dibuat saat event dikunci/masuk `ready`.

---

## 7.4.3 Room Management

Room model minimal:

```text
room_id
event_id
name
capacity
desk_count optional
seats_per_desk default 2
gender_scope
sequence
is_active
```

Room master global boleh direuse, tetapi event harus menyimpan assignment/capacity yang berlaku saat event.

---

## 7.4.4 Gender Allocation

Aturan:
- peserta laki-laki dan perempuan dipisahkan;
- alokasi ruangan laki-laki dikerjakan terlebih dahulu;
- setelah pool laki-laki habis, lanjut perempuan;
- tidak boleh mencampur gender di ruangan jika policy event menyatakan segregated.

Gender normalization harus eksplisit dan tidak mengandalkan satu ejaan saja.

---

## 7.4.5 Seating Algorithm

Primary constraint:

> Siswa yang duduk pada meja yang sama harus berasal dari tingkat berbeda apabila secara matematis memungkinkan.

Hard constraints:
- peserta hanya satu seat;
- seat tidak melebihi capacity;
- gender sesuai room;
- tidak duplicate;
- tidak ada seat assignment pada room nonaktif.

Preferred constraints:
- pasangan meja beda tingkat;
- distribusi kelas tersebar;
- hindari terlalu banyak satu kelas berdekatan jika layout tersedia.

Algorithm harus:
- deterministic dengan seed/event version;
- menghasilkan validation report;
- dapat regenerate;
- mendukung manual override;
- tidak menghancurkan override manual saat regenerate kecuali admin memilih reset.

Jika constraint tidak mungkin dipenuhi, sistem:
- tetap menghasilkan seating terbaik;
- menandai violations;
- meminta admin review sebelum `ready`.

---

## 7.4.6 Schedule

Jangan hardcode 3 sesi atau Jumat 2 sesi.

Default template boleh:
- hari biasa: 3;
- Jumat: 2.

Tetapi admin bebas membuat slot.

Model:

```text
schedule_day
schedule_slot
  id
  event_id
  date
  sequence
  starts_at
  ends_at
  label
```

Assignment:
```text
exam_schedule
  exam_id
  slot_id
  grade/scope
```

Validation:
- exam tidak overlap;
- peserta tidak mendapat dua ujian pada slot sama;
- durasi sesuai slot;
- room capacity cukup;
- subject availability lengkap.

---

## 7.4.7 Invigilator / Pengawas

Sumber pengawas:
- guru/staf dari `mansatas-db`.

Model:

```text
invigilator_assignment
  event_id
  slot_id
  room_id
  staff_source_id
  status
  created_by
```

Rules:
- seorang pengawas dapat bertugas berkali-kali dalam event;
- tidak boleh dua ruangan pada slot sama;
- sistem mendukung manual assignment;
- sistem mendukung auto assignment;
- sistem menghitung workload;
- auto assignment mengusahakan pemerataan;
- admin dapat lock assignment tertentu;
- regenerate tidak mengubah assignment yang locked.

---

## 7.4.8 Contextual Proctor

Pengawas yang ditugaskan pada:

```text
event + room + schedule_slot
```

otomatis memperoleh kemampuan proktor untuk konteks tersebut.

Permission hanya berlaku untuk:
- event itu;
- room itu;
- slot itu;
- window waktu yang diizinkan.

Hak proktor dapat mencakup:
- melihat peserta room;
- melihat heartbeat/status;
- melihat pelanggaran;
- unlock;
- reset sesuai permission;
- force-submit sesuai permission;
- token actions sesuai permission.

Jangan mengubah setiap pengawas menjadi global `proctor`.

---

## 7.4.9 Readiness Check

Event tidak boleh masuk `ready` jika terdapat blocker.

Minimum check:
- peserta tersedia;
- roster snapshot selesai;
- room cukup;
- seating valid;
- semua required subject tersedia;
- soal tersedia;
- schedule lengkap;
- exam duration compatible;
- pengawas tersedia;
- tidak ada bentrok pengawas;
- tidak ada bentrok peserta;
- token/security config valid;
- semua exam publishable.

Result:
```text
BLOCKER
WARNING
INFO
```

Admin harus melihat daftar item dan link langsung menuju konfigurasi bermasalah.

---

## 7.4.10 Zero-Touch Day-H Operation

Target:
setelah event `ready`/`active`, admin tidak perlu memindahkan assignment secara manual.

Sistem menentukan dari server time:
- ujian yang sedang aktif;
- peserta eligible;
- room;
- proktor;
- token;
- schedule window.

Manual override tetap tersedia untuk emergency, dengan audit log.

---

# 7.5 Ulangan Harian

## Purpose
Workspace ujian mandiri guru.

## Access
Semua guru yang diberi permission `ulangan`.

## Ownership

Guru hanya dapat secara default:
- melihat ujian miliknya;
- membuat ujian miliknya;
- edit/delete draft miliknya;
- run ujian miliknya;
- melihat hasil miliknya.

Admin memiliki oversight global.

Optional permission dapat memberi kolaborasi.

## Student targeting
Guru dapat memilih:
- satu kelas;
- beberapa kelas;
- siswa tertentu.

Source siswa:
- siswa aktif `mansatas-db`.

## Workflow

```text
Create Exam
→ Choose Classes/Students
→ Add Questions
→ Configure
→ Schedule / Open
→ Run
→ Monitor
→ Result
```

---

# 8. Authentication & Identity

## 8.1 Staff Identity

Akun admin dan guru bersumber dari `mansatas-db`.

Kontrak aktual Mansatas terdapat di `MANSATAS-INTEGRATION.md`.

Source identity:
- tabel `"user"` menggunakan `user.id` sebagai stable external identity;
- primary/display role berada di `user.role`;
- multi-role berada di `user_roles`;
- password hash **bukan** berada di tabel `user`;
- credential password berada di `account.password` untuk `providerId='credential'`.

Current endpoint CBT `/gtk-users` yang mencoba membaca `u.password` / `u.password_hash` dari tabel `user` **tidak sesuai dengan Mansatas App aktual** dan harus direfactor.

Target akhir bukan copy user menjadi local `proctor/admin`.

Gunakan model:
- Mansatas identity reference;
- local CBT access profile;
- local CBT role/permission grants.

Contoh konseptual:

```text
cbt_staff_profiles
  id
  mansatas_user_id
  email
  display_name
  status
  synced_at
```

Credential verification yang direkomendasikan:
1. preferred: private internal/service-binding auth contract ke Mansatas App;
2. transitional fallback: read-only auth adapter yang memverifikasi `account.password` menggunakan kontrak PBKDF2 Mansatas tanpa menyimpan ulang hash.

DILARANG membuat password default massal sebagai desain produksi.

CBT role tidak otomatis sama dengan Mansatas role. Admin CBT memilih mode dan permission user secara lokal.

---

# 9. Roles & Permissions

Role bukan pengganti permission.

Base roles:
- `admin`
- `teacher`
- `proctor`
- `student`

Role dapat memiliki permission grant.

Contoh permission:

```text
platform.manage
users.manage
permissions.manage

pmb.access
pmb.manage

kegiatan.access
kegiatan.manage
kegiatan.exam.manage

tka.access
tka.manage
tka.exam.create
tka.exam.manage_own
tka.results.view_own

semester.access
semester.manage
semester.rooms.manage
semester.seating.manage
semester.schedule.manage
semester.invigilators.manage

ulangan.access
ulangan.exam.create
ulangan.exam.manage_own
ulangan.results.view_own

questions.generate_ai
questions.import
questions.manage

monitor.view
session.unlock
session.reset
session.force_submit
token.view
token.manage

reports.view
reports.export
```

## Mode Access
Admin dapat menentukan mode yang bisa diakses guru.

UI mode launcher hanya menampilkan mode yang diizinkan.

**Backend tetap wajib enforce permission.**
Hide menu bukan authorization.

---

# 10. Permission Scope

Permission dapat memiliki scope:

```text
global
mode
event
subject
exam
room_slot
own
```

Contoh:
- teacher: `ulangan.exam.manage_own`;
- teacher Biologi TKA: `tka.exam.manage` untuk subject Biologi;
- pengawas: proctor actions hanya pada `event+room+slot`.

---

# 11. Source of Truth & Integration

## 11.1 `mansatas-db`

Read-only dari CBT untuk data master.

Sumber:
- staff/guru;
- siswa;
- kelas;
- tingkat;
- gender;
- mata pelajaran bila tersedia;
- modul TKA;
- pilihan mapel TKA.

Tidak boleh melakukan:
- INSERT;
- UPDATE;
- DELETE

ke data master Mansatas dari CBT kecuali ada requirement baru yang eksplisit.

---

## 11.2 Adapter pattern

Pertahankan pola existing `services/participants.ts`.

Buat adapter:
- `student-directory`;
- `staff-directory`;
- `tka-directory`;
- optional `subject-directory`.

Business route tidak boleh mengandung query raw ke schema eksternal yang tersebar.

---

# 12. Database Evolution

## 12.1 Principles

- additive-first migrations;
- backwards compatible;
- backup before destructive D1 rebuild;
- no silent data loss;
- migration idempotence bila memungkinkan;
- history preserved.

---

## 12.2 Proposed CBT-owned entities

Nama final dapat berubah setelah design review.

```text
cbt_modes
cbt_events
cbt_event_settings

cbt_staff_profiles
cbt_role_assignments
cbt_permission_grants

cbt_subjects
cbt_question_banks
cbt_question_bank_items

cbt_exams
cbt_exam_versions
cbt_exam_roster
cbt_exam_assignments

cbt_schedule_slots
cbt_exam_schedules

cbt_event_rooms
cbt_seats
cbt_seat_assignments

cbt_invigilator_assignments

cbt_exam_tokens
cbt_exam_sessions
cbt_student_answers
cbt_exam_results
cbt_cheat_logs

cbt_ai_generation_runs
cbt_ai_generated_items

cbt_audit_logs
```

Tidak semua harus dibuat sekaligus.

---

# 13. Shared Examination Engine Contract

Engine harus menerima context yang cukup, tetapi tidak mengetahui detail bisnis semua mode.

Conceptual:

```ts
ExamContext {
  mode
  eventId
  examId
  participant
  room
  schedule
  securityPolicy
  tokenPolicy
}
```

Engine tidak boleh mempunyai rangkaian:

```ts
if (mode === 'pmb') ...
else if (mode === 'tka') ...
else if ...
```

untuk setiap behavior.

Mode-specific policy diberikan melalui:
- configuration;
- domain service;
- strategy/policy adapter.

---

# 14. Token System

Semua mode dapat memakai token.

Token scope minimal:
- exam;
- room optional;
- slot optional.

Policy:
- token dapat disabled;
- generate;
- manual code;
- expiry;
- activate/deactivate;
- proctor visibility berdasarkan scope.

Existing token implementation harus direuse/migrated.

---

# 15. Monitoring

Unified monitoring engine.

Status peserta:
- belum mulai;
- aktif;
- stale heartbeat;
- paused/locked;
- submitted;
- force-submitted;
- connection issue.

Monitoring dapat difilter:
- mode;
- event;
- exam;
- room;
- slot;
- subject.

Mode-specific dashboard boleh berbeda, data session engine tetap shared.

---

# 16. Anti-Cheat

Pertahankan:
- warning count;
- violation log;
- fullscreen rule;
- lock action;
- proctor unlock;
- audit.

Jangan menurunkan security behavior existing selama refactor.

Anti-cheat policy configurable per exam/event.

---

# 17. Heartbeat & Recovery

Heartbeat adalah bagian shared engine.

Requirements:
- server timestamps;
- stale state detectable;
- reconnect tidak membuat duplicate session;
- answer save idempotent;
- submit idempotent;
- session recovery mempertahankan question/option mapping;
- tidak reset timer dari client refresh.

---

# 18. Question Bank

Current model menempelkan question langsung ke exam.

Target jangka refactor:
- dukung bank soal reusable;
- exam dapat mengambil snapshot item dari bank;
- perubahan bank setelah exam published tidak boleh mengubah attempt existing.

Untuk migration awal, direct questions boleh tetap bekerja melalui compatibility layer.

---

# 19. AI Question Generator

## 19.1 Purpose
Alternatif:
- manual;
- Word;
- Excel;
- AI.

## 19.2 UX flow

```text
Input Parameters
→ Generate
→ Structured Draft
→ Validate
→ Preview
→ Human Edit
→ Select Items
→ Save to Question Bank / Exam
```

AI output **tidak pernah langsung published**.

---

## 19.3 Input & Question Blueprint

Generator fase awal tetap berfokus pada **pilihan ganda**. User tidak memilih tipe jawaban lain, tetapi dapat menentukan **karakter dan komposisi paket soal** secara detail agar hasil AI tidak monoton, generik, atau sekadar parafrasa berulang.

### A. Basic Parameters
- mode/context;
- subject;
- grade;
- material/topic;
- learning objective;
- number of questions;
- language;
- number of options, default 5;
- include explanation;
- special instructions;
- optional source text/material supplied by teacher.

### B. Difficulty Profile

Preset:
```text
Dominan Mudah
Balance
Dominan Sulit
Custom
```

Default:
```text
Dominan Mudah : 50% mudah / 35% sedang / 15% sulit
Balance       : 30% mudah / 40% sedang / 30% sulit
Dominan Sulit : 15% mudah / 35% sedang / 50% sulit
```

`Custom` membolehkan persentase sendiri.

Validation:
- total harus 100%;
- jumlah aktual dibulatkan deterministik;
- total akhir tetap sama dengan jumlah soal yang diminta.

Kesulitan tidak boleh dimaknai hanya dari panjang kalimat:
- mudah = recall/pemahaman langsung;
- sedang = aplikasi/interpretasi;
- sulit = analisis, multi-step reasoning, integrasi konsep, atau distractor lebih plausible.

### C. Cognitive / Thinking Profile

Preset:
```text
Pemahaman Konsep
Aplikasi
Analisis / HOTS
Campuran
Custom
```

Contoh `Campuran`:
- 30% pemahaman konsep;
- 40% aplikasi;
- 30% analisis.

### D. Question Style Mix

Walau semuanya pilihan ganda, bentuk stem dapat dicampur:
- pertanyaan langsung;
- studi kasus singkat;
- skenario kehidupan nyata;
- interpretasi tabel/data;
- interpretasi grafik;
- stimulus bacaan pendek;
- sebab-akibat;
- urutan/prosedur;
- perbandingan konsep;
- identifikasi kesalahan;
- memilih simpulan paling tepat;
- contextual/application problem.

Tidak semua style harus dipakai. Prompt memilih yang relevan untuk mapel/topik.

### E. Contextualization Level

Preset:
```text
Minimal konteks
Kontekstual secukupnya
Dominan kontekstual
```

Konteks harus membantu reasoning, bukan sekadar memperpanjang soal.

### F. Stimulus Configuration

Pilihan:
```text
Tanpa stimulus panjang
Stimulus singkat
Beberapa soal berbagi satu stimulus
Stimulus individual
Campuran
```

Stimulus dapat berupa:
- teks;
- tabel;
- data;
- deskripsi grafik;
- dialog;
- ilustrasi deskriptif.

Untuk V1 external-chatbot, bila perlu gambar nyata, AI cukup memberi `image_prompt`/deskripsi aset, bukan mengarang URL.

### G. Distractor Quality

Preset:
```text
Standar
Ketat
```

Distractor harus:
- plausible;
- merepresentasikan miskonsepsi masuk akal;
- relatif seimbang panjangnya;
- tidak memberi clue gramatikal;
- tidak absurd sebagai filler;
- tidak menjadikan jawaban benar selalu paling panjang;
- tidak terlalu sering memakai “semua benar/semua salah”.

`Ketat` diprioritaskan untuk seleksi/TKA.

### H. Answer-Key Distribution

Dalam satu batch:
- posisi kunci A/B/C/D/E relatif seimbang;
- hindari pola jelas;
- jangan random murni tanpa validasi;
- pipeline boleh post-process distribusi.

Target praktis: selisih frekuensi antarpilihan sebisa mungkin <= 1 pada batch yang cukup besar.

### I. Anti-Monotony / Diversity

Preset:
```text
Normal
Tinggi
```

Pada `Tinggi`, prompt wajib:
- menghindari pembuka stem yang sama;
- menghindari struktur opsi identik berulang;
- menyebarkan soal ke beberapa subkonsep;
- memvariasikan bentuk reasoning;
- tidak mengulang fakta yang sama dengan parafrasa tipis;
- tidak membuat semua soal definisi;
- tidak membuat semua soal kasus panjang;
- tidak membuat HOTS artifisial.

Pipeline menandai duplicate/near-duplicate untuk review.

### J. Topic Coverage

Jika topik memiliki submateri, user dapat:
- memasukkan daftar subtopik;
- menentukan bobot;
- memilih `Sebar Merata`;
- memilih `Fokus`.

Contoh:
```text
Nahwu:
- Mubtada-Khabar 30%
- Na'at-Man'ut 30%
- Idhafah 40%
```

AI harus membuat blueprint count sebelum menghasilkan soal.

### K. Negative / Exception Questions

User dapat mengatur batas soal model:
- “kecuali”;
- “yang bukan”;
- “tidak tepat”.

Default maksimal 10–15% dari batch.

### L. Numerical / Calculation Mix

Untuk mapel numerik:
```text
Konseptual dominan
Seimbang
Perhitungan dominan
```

Generator membedakan hitung langsung, interpretasi, multi-step calculation, dan reasoning konseptual.

### M. Blueprint Preview

Sebelum prompt disalin/generation, tampilkan preview:

```text
40 soal Pilihan Ganda

Kesulitan
12 Mudah / 16 Sedang / 12 Sulit

Karakter
12 Konsep / 16 Aplikasi / 12 Analisis

Gaya
8 Pertanyaan langsung
8 Studi kasus
6 Interpretasi data
6 Stimulus bacaan
6 Identifikasi kesalahan
6 Campuran lain

Distraktor: Ketat
Variasi: Tinggi
Negasi: maks. 4 soal
```

User dapat mengubah blueprint sebelum generate.

### N. Generated Item Metadata

Setiap item minimal menyimpan:
```text
difficulty
cognitive_level
style
subtopic
stimulus_type
distractor_profile
generation_batch_id
```

Metadata berguna untuk review, filter, regenerate subset, analytics, dan verifikasi distribusi.

---

## 19.4 Integration architecture

RPPM Generator Mansatas aktual memakai pola:

```text
Build Prompt
→ Copy ke chatbot AI eksternal
→ Paste JSON AI
→ Parse / Normalize / Validate
→ Edit
→ Save
```

CBT Question Generator V1 harus mengikuti mental model yang sama.

V1 **tidak membutuhkan API provider langsung**.

Flow:

```text
Question Parameters
→ Build Prompt
→ Copy Prompt
→ External Chatbot
→ Paste Structured JSON
→ Validation
→ Preview/Edit
→ Save
```

Dengan demikian hasil AI dapat berubah menjadi soal secara otomatis setelah structured JSON dimasukkan, tanpa Word/Excel.

### Optional V2: direct provider

Direct AI API dapat ditambahkan kemudian melalui adapter:

```ts
AiQuestionProvider {
  generate(request): Promise<GeneratedQuestionSet>
}
```

V1 dan V2 wajib menghasilkan schema draft yang sama.

Provider key/model tidak hardcoded ke UI dan secret hanya server-side.

---

## 19.5 Structured schema

Contoh:

```json
{
  "questions": [
    {
      "type": "multiple_choice",
      "stem": "...",
      "options": [
        {"label":"A","text":"..."},
        {"label":"B","text":"..."}
      ],
      "correct_option": "B",
      "explanation": "...",
      "difficulty": "medium",
      "tags": ["..."]
    }
  ]
}
```

Server melakukan schema validation.

Validator batch juga memeriksa:
- jumlah soal sesuai blueprint;
- distribusi difficulty;
- distribusi cognitive profile;
- answer-key distribution;
- subtopic coverage;
- duplicate / near-duplicate stem;
- duplicate option set;
- excessive negative-question pattern;
- missing explanation bila diminta;
- option count konsisten.

Jika hasil AI menyimpang dari blueprint, UI menandai discrepancy dan mengizinkan regenerate per item/subset tanpa harus mengulang seluruh batch.

Invalid item tidak disimpan diam-diam.

---

## 19.6 AI safety/product rules

- teacher/admin selalu reviewer final;
- tampilkan warning bahwa hasil AI dapat salah;
- jangan menganggap AI-generated answer key pasti benar;
- log provider/model/generation timestamp;
- jangan mengirim data siswa ke provider;
- jangan memasukkan secret dalam prompt;
- regenerate hanya draft, tidak overwrite published exam.

---

# 20. Import Word / Excel

Existing import harus dipertahankan.

Semua jalur authoring berujung pada normalization pipeline yang sama:

```text
Manual
Word
Excel
AI
   ↓
Question Draft Schema
   ↓
Validation
   ↓
Question Bank / Exam
```

Tujuan: mencegah empat implementasi format soal yang berbeda.

---

# 21. Analytics

Semua mode memakai shared item analysis.

Minimum metrics:
- answered;
- unanswered;
- correct rate;
- distractor distribution;
- number of sessions;
- score distribution.

Advanced metrics dapat ditambahkan kemudian:
- difficulty index;
- discrimination index;
- point-biserial.

Jangan menampilkan advanced statistic sebelum formula dan sample validity jelas.

---

# 22. Reports & Printing

Semua mode minimal mendukung:
- attendance;
- participant list;
- results;
- exam summary;
- item analysis;
- session/incident log jika dibutuhkan.

Semester tambahan:
- room list;
- seating list;
- invigilator schedule;
- room attendance per slot;
- proctor sheet.

Existing DOCX generation direuse sebagai basis.

---

# 23. Audit Log

Operasi kritis harus diaudit:

- create/update/delete event;
- permission change;
- exam publish/status;
- roster changes;
- seating regenerate/manual override;
- schedule changes;
- invigilator changes;
- token changes;
- session reset/unlock;
- force-submit;
- result recompute/delete;
- AI generation save;
- emergency override.

Minimal:
```text
actor
action
target_type
target_id
context
before_json optional
after_json optional
created_at
```

---

# 24. UI Product Architecture

Setelah login:

```text
Login
→ Resolve Identity & Permissions
→ Mode Launcher
→ Mode-specific route
```

Jika user hanya mempunyai satu mode:
- boleh langsung diarahkan ke mode tersebut.

Global shell boleh shared.
Menu di dalam shell mengikuti domain dan permission.

Jangan menampilkan semua menu lalu disable puluhan item.

---

# 25. Performance

Target tetap mendukung ratusan peserta bersamaan.

Rules:
- hindari N+1 query pada monitoring/roster;
- paginate admin lists;
- batch D1 writes;
- query indexes untuk hot paths;
- jangan query `mansatas-db` untuk setiap heartbeat;
- roster/session runtime memakai snapshot CBT;
- large exports tidak dipanggil pada polling;
- frontend monitoring polling harus bounded;
- tidak polling seluruh sekolah bila hanya room tertentu yang dibutuhkan.

Existing load simulation script harus tetap dapat digunakan dan diperluas.

---

# 26. Security

Must:
- JWT secret hanya secret binding;
- no auth trust from frontend;
- backend permission enforcement;
- rate limit login/token-sensitive route;
- validate ID/context ownership;
- prevent cross-mode data access;
- sanitize rich text;
- validate uploaded media;
- avoid exposing answer keys to student API;
- server-authoritative timer/status;
- no client-side-only proctor authorization.

---

# 27. Data Isolation

Mode isolation harus berada di service/query layer.

Bad:
```text
fetch all exams → filter di React
```

Good:
```text
authorized query by mode/event/owner
```

Setiap critical entity wajib mempunyai context jelas:
- mode;
- event;
- owner/scope bila relevan.

---

# 28. Migration Strategy

## Phase 0 — Baseline & safety
- backup DB;
- document existing routes;
- regression checklist PMB;
- verify load simulation;
- add architecture docs.

## Phase 1 — Platform foundation
- Mode definition;
- staff profile;
- permission model;
- mode launcher;
- route shell;
- compatibility authorization.

## Phase 2 — Decompose existing admin
- extract shared exam admin services;
- extract question services;
- extract token/monitoring/results;
- split giant frontend admin page;
- preserve visible behavior.

## Phase 3 — Kegiatan
- map existing multi-event + subject_name into Kegiatan domain;
- participant per subject;
- clean event-scoped UI.

## Phase 4 — Ulangan
- teacher ownership;
- own exam;
- class/student targeting;
- permission enforcement.

## Phase 5 — TKA
- TKA adapter;
- automatic 3+2 subject assignment;
- subject ownership;
- multiple exam versions.

## Phase 6 — Semester foundation
- event rooms;
- slots;
- roster;
- seating;
- schedules.

## Phase 7 — Semester automation
- auto seating;
- invigilator assignment;
- contextual proctor;
- readiness engine;
- zero-touch schedule behavior.

## Phase 8 — AI Question Generator
- provider adapter;
- structured validation;
- preview/edit/save;
- generation logs.

## Phase 9 — Consolidation
- reports;
- audit;
- load tests;
- cleanup compatibility endpoints;
- documentation.

Do not combine all phases into one huge branch/commit.

---

# 29. Acceptance Criteria

## Platform
- Login resolves role and permissions.
- User sees only allowed modes.
- Direct unauthorized URL returns forbidden.
- Mode data does not leak across route/domain.

## PMB
- Existing PMB login works.
- Existing exam flow works.
- Existing token/session/anti-cheat/result flow works.

## Kegiatan
- Event can contain multiple subjects.
- Student can be assigned to multiple subjects.
- Result and analytics are subject/event scoped.

## TKA
- Participant data comes from TKA source adapter.
- 3 mandatory + 2 selected subjects generated correctly.
- Teacher can manage permitted subject exams only.
- Multiple versions supported.

## Semester
- Separate male/female room allocation.
- Seating attempts cross-grade desk pairing.
- Impossible constraints produce warnings.
- 2/3/custom slots supported.
- Invigilator collision is blocked.
- Auto assignment can be regenerated with locked overrides.
- Invigilator gains contextual proctor rights.
- Readiness blockers prevent accidental activation.
- Active event follows schedule without routine admin intervention.

## Ulangan
- Teacher sees own exams.
- Teacher can target classes/students.
- Other teachers cannot edit without permission.

## AI
- AI output requires review.
- Generator V1 tetap pilihan ganda.
- User dapat memilih profil kesulitan: dominan mudah, balance, dominan sulit, atau custom.
- User dapat mengatur cognitive profile, style mix, contextualization, stimulus, distractor quality, topic coverage, dan diversity.
- Blueprint preview menunjukkan jumlah aktual per kategori sebelum generation.
- Generated item memiliki metadata blueprint.
- Invalid schema is rejected.
- Batch discrepancy terhadap blueprint ditandai.
- Near-duplicate ditandai untuk review.
- Answer-key distribution diperiksa.
- Regenerate dapat dilakukan per item/subset.
- Saved questions use normal question pipeline.
- No student PII sent to provider.

---

# 30. Definition of Done per Implementation Phase

Each phase must provide:

1. code changes;
2. migration if needed;
3. migration rollback/recovery notes;
4. API contract changes;
5. UI changes;
6. authorization test matrix;
7. PMB regression result;
8. build/typecheck result;
9. manual walkthrough;
10. known limitations.

---

# 31. Open Product Decisions

These must be resolved before the relevant phase, not guessed by the coding agent:

1. Nama/definisi mode keenam, jika memang ada.
2. Apakah guru boleh share question bank lintas guru.
3. Apakah question bank lintas mode boleh share.
4. Kebijakan essay scoring.
5. Exact availability window sebelum/sesudah slot untuk contextual proctor.
6. Apakah direct AI provider V2 perlu dibuat setelah workflow external-chatbot V1.
7. Provider/budget/rate-limit AI jika direct integration V2 dibuat.
8. Seating layout detail jika denah fisik meja ingin divisualisasikan.

Arsitektur harus tetap memungkinkan keputusan ini tanpa rewrite besar.
