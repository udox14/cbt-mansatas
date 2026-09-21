# AGENTS.md — CBT MANSATAS

Dokumen ini adalah aturan kerja wajib untuk coding agent yang mengubah repository `cbt-mansatas`.

## 0. Read First

Sebelum mengubah kode:

1. Baca `PRD.md`.
2. Baca `UI-GUIDELINES.md`.
3. Baca `MANSATAS-INTEGRATION.md` untuk task yang menyentuh siswa, staff, auth, mapel, TKA, atau source Mansatas.
4. Audit file yang benar-benar terkait task.
5. Jangan langsung refactor area yang tidak diperlukan.
6. Jelaskan dependency dan risiko sebelum implementasi fase besar.

Jika requirement task bertentangan dengan PRD, **jangan diam-diam memilih salah satu**. Laporkan konflik pada walkthrough.

---

# 1. Product Identity

CBT MANSATAS adalah platform ujian sekolah multi-mode.

Domain yang saat ini terdefinisi:

```text
pmb
kegiatan
tka
semester
ulangan
```

Requirement lama menyebut 6 mode tetapi hanya lima domain terdefinisi.

**DILARANG mengarang mode keenam.**
Jangan hardcode jumlah mode.

---

# 2. Architectural Rule

Gunakan prinsip:

> Multiple Exam Domains + Shared Examination Engine

Shared engine menangani runtime ujian.

Domain menangani:
- peserta;
- event;
- ownership;
- scheduling;
- rooms;
- seating;
- invigilator;
- domain-specific workflow.

DILARANG membuat copy engine untuk tiap mode.

DILARANG membuat giant switch seperti:

```ts
if (mode === 'pmb') ...
else if (mode === 'kegiatan') ...
else if (mode === 'tka') ...
```

berulang di seluruh codebase.

Gunakan:
- services;
- adapters;
- policy functions;
- domain modules;
- configuration.

---

# 3. Repository Baseline

Current architecture:

```text
apps/
  web/
    src/app/
    src/components/
    src/hooks/
    src/lib/

  worker/
    src/
      routes/
      middleware/
      services/
      utils/
    schema.sql
```

Stack:
- Next.js 14
- React 18
- Tailwind 3
- Hono
- Cloudflare Workers
- D1
- R2
- KV

Jangan mengganti stack tanpa explicit requirement.

---

# 4. Protect Existing CBT Engine

Existing working behavior must be preserved:

- login;
- token;
- randomized questions/options;
- session;
- answer persistence;
- heartbeat;
- timer;
- anti-cheat;
- session lock;
- fullscreen rule;
- proctor unlock/reset;
- force submit;
- scoring;
- result;
- analytics;
- upload;
- Word/Excel import;
- attendance/result export.

Jika memindahkan kode existing:
1. preserve behavior first;
2. refactor second;
3. improve behavior only when requirement says so.

---

# 5. PMB Is Regression-Critical

PMB adalah production behavior existing.

Setiap phase yang menyentuh:
- auth;
- exam;
- session;
- participant;
- token;
- result;
- ExamRoom;
- DB schema

wajib mengecek PMB.

Jangan menghapus:
- PMB source;
- existing PMB participant rules;
- PMB compatibility event;
- legacy behavior yang masih diperlukan

tanpa migration plan yang eksplisit.

---

# 6. Database Boundaries

Bindings existing:

```text
DB            → CBT tables currently in pmb-man1-tasik
MANSATAS_DB   → mansatas-db
R2            → cbt-media
RATE_LIMIT    → KV
```

## MANSATAS_DB rule

Secara default CBT **read-only** terhadap master data Mansatas.

DILARANG melakukan:
```sql
INSERT
UPDATE
DELETE
```

ke `MANSATAS_DB` untuk fitur CBT kecuali requirement secara eksplisit mengubah policy ini.

Jangan menebak nama tabel/kolom eksternal.

Gunakan adapter + config/mapping terverifikasi.


## Staff credential warning

Tabel `"user"` MANSATAS tidak memiliki `password` atau `password_hash`.

Credential berada pada tabel `account` dengan `providerId='credential'`.

DILARANG:
- query `user.password`;
- query `user.password_hash`;
- membuat fallback password default massal;
- copy password/hash Mansatas ke `cbt_users`.

Preferred: internal auth contract/service binding.
Fallback: isolated read-only Mansatas auth adapter yang kompatibel dengan PBKDF2 authoritative implementation.


---

# 7. External Source Adapters

Existing `services/participants.ts` adalah pattern yang harus dipertahankan.

Kontrak field/source aktual ada di `MANSATAS-INTEGRATION.md`.

Buat service khusus untuk source eksternal:

```text
services/sources/students
services/sources/staff
services/sources/tka
services/sources/subjects
```

atau struktur setara.

Rules:
- normalize data di satu tempat;
- route/domain menerima normalized model;
- jangan sebarkan raw Mansatas SQL ke banyak route;
- validate identifiers sebelum interpolasi SQL.

---

# 8. Database Migration Rules

Cloudflare D1/SQLite migration harus konservatif.

WAJIB:
- additive-first;
- preserve IDs;
- preserve history;
- backup/recovery notes;
- indexes pada hot query;
- explicit foreign key behavior;
- batch large writes.

DILARANG:
- destructive `DROP` tanpa preservation strategy;
- delete existing PMB/CBT data;
- recreate all tables “biar bersih”;
- migration yang bergantung pada asumsi schema tanpa audit.

Jika tabel harus direbuild karena SQLite constraint:
- copy child data;
- verify;
- rebuild;
- restore;
- document validation.

Pattern migration-multi-event existing dapat dijadikan referensi kehati-hatian.

---

# 9. Auth & RBAC

Jangan gunakan:

```ts
if (user.role === 'admin')
```

sebagai satu-satunya model authorization untuk fitur baru.

Target:
- base role;
- permissions;
- scopes.

Backend adalah authority.

UI hanya presentation.

Setiap endpoint baru harus menjawab:
1. siapa boleh memanggil?
2. permission apa?
3. scope apa?
4. ownership check apa?
5. mode/event context apa?

---

# 10. Teacher Ownership

Untuk Ulangan dan area teacher-owned:

Query wajib scope ke actor.

Bad:

```sql
SELECT * FROM cbt_exams WHERE mode='ulangan'
```

Good concept:

```sql
... WHERE mode='ulangan'
AND owner_user_id = ?
```

kecuali caller mempunyai explicit global permission.

Never rely on hiding rows in frontend.

---

# 10A. TKA Source Rules

TKA source Mansatas:

```text
tahun_ajaran
siswa
kelas
riwayat_kelas
tka_mapel_pilihan
```

Rules:
- kelas 12;
- siswa aktif;
- source pilihan scoped oleh `tahun_ajaran_id`;
- current class boleh fallback ke `riwayat_kelas`;
- `mapel_pilihan1/2` berupa string;
- jangan exact-match string pilihan ke `mata_pelajaran` untuk authorization tanpa mapping;
- snapshot ke CBT sebelum event execution.

Teacher subject scope berasal dari `penugasan_mengajar`, bukan role `guru` saja.

# 11. Contextual Proctor

Pengawas semester bukan otomatis global proctor.

Proctor permission harus dapat dihitung dari:

```text
event
room
slot
staff
time window
```

Jangan overwrite global role guru hanya untuk satu jadwal pengawasan.

---

# 12. Scheduling Time

Server time adalah authority.

Jangan memakai clock browser sebagai authority untuk:
- exam availability;
- end time;
- contextual proctor;
- activation;
- auto submit.

Client timer adalah display dari server-derived deadline.

---

# 13. Exam Session Safety

Critical operations harus idempotent atau collision-safe:

- start session;
- save answer;
- heartbeat;
- submit;
- force submit;
- result compute.

Jangan membuat duplicate attempt karena retry jaringan.

Jangan regenerate:
- question_map;
- option_map

untuk existing session.

---

# 14. Roster Snapshot

Jangan query Mansatas sebagai runtime identity detail setiap heartbeat/request exam.

Gunakan source system untuk:
- browse;
- select;
- sync/prepare.

Gunakan CBT roster snapshot untuk:
- execution;
- history;
- reporting.

---

# 15. AI Generator Rules

AI-generated question is always **draft**.

V1 mengikuti RPPM Generator Mansatas:

```text
build prompt
copy prompt
external chatbot
paste JSON
validate
preview
edit
select
save
```

DILARANG:
- auto publish;
- auto overwrite existing published questions;
- mengirim student PII ke AI;
- percaya JSON tanpa schema validation.

Direct provider API adalah V2 optional. Jika dibuat:
- gunakan provider adapter;
- secret server-side;
- output masuk ke schema draft yang sama dengan V1.

## Question Generation Blueprint Guardrails

Generator fase awal tetap `multiple_choice`.

Jangan membuat prompt generik seperti:
`Buat 40 soal pilihan ganda tentang X`.

Prompt harus membawa blueprint:
- difficulty distribution;
- cognitive profile;
- style mix;
- subtopic coverage;
- contextualization;
- stimulus mix;
- distractor quality;
- answer-key balance;
- diversity level;
- negative-question limit.

WAJIB:
- hitung jumlah per kategori sebelum generate;
- simpan metadata generated item;
- detect duplicate/near-duplicate;
- detect answer-position imbalance;
- jangan regenerate seluruh batch hanya karena beberapa item gagal;
- support regenerate item/subset;
- jangan menyamakan “sulit” dengan “kalimat lebih panjang”;
- jangan membuat HOTS palsu dengan cerita panjang yang tidak relevan;
- jangan membuat distractor absurd sekadar filler;
- jangan membuat pola kunci jawaban mudah ditebak.

---

# 16. Frontend Refactor Rules

Current large files:
- admin page sangat besar;
- ExamRoom besar.

Jangan menambahkan feature besar baru langsung ke file monolitik.

Untuk kode baru gunakan feature/domain structure.

Contoh:

```text
src/features/
  platform/
  pmb/
  kegiatan/
  tka/
  semester/
  ulangan/
  exam-engine/
  question-authoring/
```

Komponen reusable:
```text
src/components/ui/
```

Shared API client:
```text
src/lib/
```

Existing code boleh dipindahkan bertahap.

Jangan melakukan one-shot 4.000-line rewrite.

---

# 17. Backend Refactor Rules

Jangan menambah semua endpoint baru ke `routes/admin.ts`.

Prefer:

```text
routes/platform/*
routes/pmb/*
routes/kegiatan/*
routes/tka/*
routes/semester/*
routes/ulangan/*
routes/exam-engine/*
```

Service layer untuk business logic.

Route handler:
- parse;
- authorize;
- call service;
- format response.

Business rules jangan menumpuk di handler.

---

# 18. File Size Guardrail

Ini bukan rule absolut, tetapi trigger review:

- React page > 500 lines → pertimbangkan split.
- Component > 350 lines → pertimbangkan split.
- Route module > 700 lines → pertimbangkan split.
- Function > 80 lines → pertimbangkan extract.
- File baru > 1.000 lines → harus punya alasan sangat kuat.

Jangan memecah file menjadi serpihan tidak bermakna hanya mengejar angka.

---

# 19. API Contract

Gunakan response convention existing bila masih kompatibel.

Perubahan API:
- typed;
- validated;
- consistent error;
- no accidental answer-key leakage.

Input:
- validate strings;
- validate enum;
- validate numeric range;
- validate ownership/context;
- cap batch size.

Output participant data:
- hanya field yang diperlukan.

---

# 20. Query Rules

Avoid:
- `SELECT *` pada hot path;
- N+1 queries;
- unbounded list;
- loading entire school roster into client tanpa kebutuhan;
- full monitoring query setiap detik.

Use:
- indexes;
- pagination;
- batching;
- scoped polling;
- aggregate SQL.

---

# 21. Polling / Heartbeat

Jangan membuat polling global baru hanya karena UI butuh terasa real-time.

Heartbeat frequency dan monitoring polling:
- bounded;
- pause/slow when tab hidden where safe;
- abort stale request if appropriate;
- no overlapping fetch storms.

---

# 22. UI Rules

Semua UI baru wajib mematuhi `UI-GUIDELINES.md`.

Ringkas:
- pertahankan identitas hijau MAN/Kemenag;
- Plus Jakarta Sans;
- no generic AI gradient dashboard;
- no glassmorphism;
- no random purple;
- no emoji as production navigation icon;
- no excessive cards;
- dense but calm admin UI;
- Lucide icons;
- semantic status colors only.

---

# 23. Do Not Redesign ExamRoom Casually

ExamRoom adalah mission-critical.

Jangan mengubah layout/interaction besar bersamaan dengan backend refactor kecuali task memang UI ExamRoom.

Jika menyentuh:
- answer button;
- navigator;
- timer;
- fullscreen;
- anti-cheat;
- submit;

wajib regression check mobile + desktop.

---

# 24. Question Rendering

Must preserve:
- sanitized HTML;
- Arabic RTL;
- Scheherazade New;
- KaTeX;
- image;
- audio.

Jangan render model/imported HTML mentah tanpa sanitation.

---

# 25. Accessibility

New controls:
- keyboard accessible;
- proper button semantics;
- label form;
- focus visible;
- status not communicated by color alone;
- minimum practical tap target mobile.

Modal:
- should not trap user behind mobile keyboard;
- close behavior deliberate;
- destructive confirmation explicit.

---

# 26. Dependencies

Jangan menambah library untuk hal yang dapat dilakukan sederhana dengan stack existing.

Before adding dependency:
- explain why;
- check bundle/runtime impact;
- Cloudflare compatibility;
- static export compatibility.

---

# 27. Secrets

Never commit:
- JWT secret;
- AI API key;
- private token;
- credential.

Use Worker secrets / env binding.

Never log secret or raw password.

---

# 28. Logging

Production log:
- no answer keys;
- no passwords;
- no JWT;
- no unnecessary PII.

Critical admin action masuk audit log, bukan console saja.

---

# 29. Testing Minimum

Project belum memiliki test suite lengkap. Jangan menjadikan itu alasan untuk tidak melakukan verification.

Per phase minimum:

### Frontend
```bash
npm run build:web
```

### Worker
TypeScript/build/deploy dry checks yang tersedia.

### DB
- migration local/staging where possible;
- verify counts before/after migration.

### Regression
- login admin;
- login PMB student;
- login Mansatas student;
- create/edit exam;
- token;
- start session;
- answer;
- heartbeat;
- anti-cheat;
- submit;
- result;
- analytics;
- proctor action.

### Load-sensitive changes
Run/update:
```bash
npm run load:simulate
```

Jangan claim “aman untuk 800 user” hanya dari build berhasil.

---

# 30. Implementation Discipline

Untuk task besar:

1. Audit.
2. Write mini design / update design.
3. Implement one phase.
4. Build/check.
5. Give walkthrough.
6. List changed files.
7. List migrations.
8. List risks.
9. List manual test steps.

Jangan mengerjakan 8 fase dalam satu lompatan.

---

# 31. Walkthrough Format

Setelah setiap phase, laporkan:

```text
## What changed
## Architecture decision
## Files changed
## Database changes
## API changes
## UI changes
## Verification performed
## PMB regression check
## Known limitations
## Recommended next phase
```

Walkthrough harus faktual berdasarkan code yang benar-benar dibuat.

---

# 32. No Silent Scope Expansion

DILARANG diam-diam:
- upgrade Next;
- switch database;
- switch auth library;
- redesign brand;
- change participant credentials;
- rename all routes;
- delete legacy endpoint;
- change scoring formula.

Jika dibutuhkan, tulis sebagai recommendation terpisah.

---

# 33. Definition of Good Agent Behavior

Agent yang baik pada repo ini:
- reuse sebelum rewrite;
- membuat perubahan kecil yang bisa diverifikasi;
- menjaga production PMB;
- memperkecil coupling;
- menjaga authorization;
- memahami D1 constraints;
- tidak membuat UI generik;
- tidak mengklaim selesai tanpa test;
- tidak menebak schema eksternal;
- meninggalkan codebase lebih mudah dilanjutkan oleh agent berikutnya.

---

# 34. Priority Order When Trade-offs Occur

Jika terjadi trade-off, urutannya:

1. Data integrity
2. Exam correctness
3. Authorization/security
4. PMB backward compatibility
5. Reliability/recovery
6. Maintainability
7. Performance
8. UI polish
9. Developer convenience

UI bagus tidak pernah menjadi alasan mengorbankan correctness ujian.


# 35. Cross-Repository Audit Baseline

MANSATAS integration assumptions in this document were checked against `udox14/mansatas-app` main commit `ba4b92ea607e8f2effc50d4b11164fede599f3c4` (21 Sep 2026). If Mansatas schema/auth changes later, re-audit `MANSATAS-INTEGRATION.md` before modifying integration code.
