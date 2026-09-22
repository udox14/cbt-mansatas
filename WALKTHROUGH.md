# WALKTHROUGH — Phase 5 Final Academic-Integrity Verification: TKA Subject Registry Membership

Dokumen ini mendokumentasikan hasil verifikasi dan penguatan invarian integritas akademik pada Domain **Tes Kemampuan Akademik (TKA)**: **TKA Subject Registry Membership**, sesuai panduan arsitektur `AGENTS.md`, `PRD.md`, dan `MANSATAS-INTEGRATION.md`.

---

## What changed

### 1. Invarian Keanggotaan Registry Subjek TKA Terpusat (`assertAllowedTkaSubjectId`)
Sebelumnya, pembuatan dan pembaruan ujian TKA memverifikasi bahwa `subject_id` bukan NULL, bukan ID sintetis (`tka-*`), dan ada pada tabel `mata_pelajaran` Mansatas. Namun, belum ada validasi bahwa mapel tersebut **benar-benar terdaftar sebagai subjek resmi TKA pada registry kanonikal sekolah**.

Kami menambahkan fungsi terpusat:
- [`resolveSubjectRowToCanonical`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/canonical-subjects.ts): Memetakan baris `mata_pelajaran` Mansatas (`nama_mapel`, `kode_mapel`) secara deterministik ke salah satu dari 22 `ALL_CANONICAL_TKA_SUBJECTS` (3 wajib + 19 pilihan terverifikasi) melalui `TKA_ALIAS_MAP`, canonical name matching, dan standard code matching.
- [`assertAllowedTkaSubjectId`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/canonical-subjects.ts): Memvalidasi kedua syarat wajib:
  1. `subject_id` ada di tabel `mata_pelajaran` Mansatas.
  2. `subject_id` terbukti menyelesaikan ke salah satu subjek kanonikal pada registry TKA resmi.

Jika mapel ada di Mansatas namun **bukan** subjek TKA resmi (contoh: *Pendidikan Jasmani Olahraga dan Kesehatan* / `mp-pjok`, *Seni Budaya* / `mp-sbk`, *Bahasa Sunda*, dsb.), operasi pembuatan atau pengubahan ujian TKA langsung ditolak dengan pesan error:
```text
Mata pelajaran '<nama_mapel>' (<id>) bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal
```

### 2. Penegakan Invarian pada Semua Jalur Integrasi
- **Domain Service TKA** ([`createTkaExam`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/exams.ts)): Memanggil `assertAllowedTkaSubjectId(mansatasDb, cleanSubjectId)` sebelum mendaftarkan ujian mapel dan memeriksa aturan 1-ujian-per-mapel-per-event.
- **Shared Exam Engine Creation** ([`createExam`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/exams.ts)): Jika `mode === 'tka'`, langsung memanggil `assertAllowedTkaSubjectId(mansatasDb, subjectId)` sehingga jalur generic exam authoring tidak dapat dibypass.
- **Shared Exam Engine Mutation** ([`updateExam`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/exams.ts)): Jika `existingExam.mode === 'tka'` dan `subject_id` diubah sebelum event `ready` / sebelum ada sesi ujian, memanggil `assertAllowedTkaSubjectId(mansatasDb, cleanSubjectId)`.

### 3. Suite Pengujian Otomatis Khusus (Issue 4)
Menambahkan 6 skenario pengujian komprehensif pada [`apps/worker/test/tka-remaining-fixes.test.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/test/tka-remaining-fixes.test.ts):
1. **Allowed canonical TKA Mansatas subject -> accepted**: Mapel kanonikal (`mp-fis`, `mp-kim`) berhasil dibuat baik via `createTkaExam` maupun shared `createExam`.
2. **Nonexistent Mansatas subject -> rejected**: ID mapel fiktif (`mp-ghost-404`) ditolak dengan kode 400.
3. **Synthetic `tka-*` ID -> rejected**: ID sintetis (`tka-fisika`, `tka-kimia`) ditolak dengan pesan error eksplisit bahwa ID sintetis dilarang.
4. **Real Mansatas `mata_pelajaran.id` but NOT registered in canonical TKA registry -> rejected**: Mapel nyata sekolah seperti `mp-pjok` dan `mp-sbk` yang ada di database sekolah ditolak tegas saat dicoba dibuat sebagai ujian TKA.
5. **Update mutable TKA exam to non-TKA Mansatas subject -> rejected**: Mengubah `subject_id` ujian TKA yang masih draft menjadi `mp-pjok` atau `mp-sbk` ditolak dengan status 400 dan mapel ujian lama tetap terlindungi; pengubahan ke mapel TKA kanonikal lain (`mp-bio`) berhasil.
6. **Kegiatan/Ulangan subject behavior -> unchanged**: Pembuatan dan pembaruan ujian mode `kegiatan` dan `ulangan` dengan mapel non-TKA seperti `mp-pjok` dan `mp-sbk` tetap diizinkan sepenuhnya tanpa terganggu aturan registry TKA.

---

## Architecture decision

1. **Prinsip Single Source of Truth**:
   Definisi subjek TKA tetap terpusat di [`canonical-subjects.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/canonical-subjects.ts). Tidak ada duplikasi daftar mapel atau hardcoded string di handler atau service lain.
2. **Resilient Schema Fallback**:
   Query ke Mansatas `mata_pelajaran` menggunakan fallback otomatis jika kolom opsional `kode_mapel` belum ada di lingkungan database tertentu, menjamin backward-compatibility penuh.
3. **Domain Isolation Terjaga**:
   Pengecekan registry kanonikal TKA hanya berlaku ketika `mode === 'tka'`, menjaga fleksibilitas penuh untuk domain `kegiatan`, `ulangan`, dan `pmb`.

---

## Files changed

- [`apps/worker/src/services/domains/tka/canonical-subjects.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/canonical-subjects.ts): Menambahkan `resolveSubjectRowToCanonical` dan `assertAllowedTkaSubjectId` dengan skema error terpadu dan fallback query kolom.
- [`apps/worker/src/services/domains/tka/exams.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/domains/tka/exams.ts): Menggunakan `assertAllowedTkaSubjectId` di dalam `createTkaExam`.
- [`apps/worker/src/services/exam-engine/exams.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/exams.ts): Menegakkan `assertAllowedTkaSubjectId` pada `createExam` (saat `mode === 'tka'`) dan `updateExam` (saat mengubah `subject_id` ujian TKA).
- [`apps/worker/test/tka-remaining-fixes.test.ts`](file:///c:/DATA/cbt-mansatas/apps/worker/test/tka-remaining-fixes.test.ts): Menambahkan seed `mp-pjok` dan `mp-sbk` serta subsuite pengujian `Issue 4: TKA Subject Registry Membership Invariant Verification` (6 skenario).

---

## Database changes

- Tidak ada migrasi skema baru yang diperlukan.
- Trigger SQLite `trg_cbt_exams_tka_subject_insert` dan `trg_cbt_exams_tka_subject_update` yang diimplementasikan pada patch sebelumnya tetap aktif melindungi level D1 dari baris NULL/kosong.

---

## API changes

- Tidak ada perubahan kontrak antarmuka API.
- Endpoint pembuatan/pembaruan ujian (`POST /api/tka/events/:id/exams`, `POST /api/admin/exams`, `PUT /api/admin/exams/:id`) memberikan error 400 yang informatif dan presisi jika diberikan mapel di luar registry kanonikal TKA.

---

## UI changes

- Tidak ada perubahan antarmuka UI. Frontend memilih mapel dari daftar coverage terverifikasi yang secara inheren adalah subjek kanonikal.

---

## Verification performed

### 1. Automated Test Suite (119/119 Tests Passed)
```bash
npx tsx --test test/*.test.ts
# Output:
# ℹ tests 119
# ℹ suites 18
# ℹ pass 119
# ℹ fail 0
# ℹ duration_ms ~650ms
```

Detail pengujian Issue 4:
- `4.1 Allowed canonical TKA Mansatas subject -> accepted` (PASS)
- `4.2 Nonexistent Mansatas subject -> rejected` (PASS)
- `4.3 Synthetic tka-* ID -> rejected` (PASS)
- `4.4 Real Mansatas mata_pelajaran.id but NOT registered in canonical TKA registry -> rejected` (PASS)
- `4.5 Update mutable TKA exam to non-TKA Mansatas subject -> rejected` (PASS)
- `4.6 Kegiatan/Ulangan subject behavior -> unchanged` (PASS)

### 2. Worker TypeScript Compilation Check
```bash
cd apps/worker && npx tsc --noEmit
# Exit code: 0 (0 errors)
```

### 3. Web Frontend TypeScript Compilation Check
```bash
cd apps/web && npx tsc --noEmit
# Exit code: 0 (0 errors)
```

### 4. Production Static Build (`apps/web`)
```bash
cd apps/web && npm run build
# Result: Compiled successfully
# Generating static pages: 12/12 (100% static export)
# Exit code: 0
```

---

## PMB regression check

- Seluruh unit test adapter dan routing PMB berjalan 100% lulus (`test/pmb-mansatas.test.ts`).
- Pembuatan dan pembaruan ujian PMB tidak dipengaruhi oleh aturan registri TKA.

---

## Known limitations

- Tidak ada limitation yang belum terselesaikan untuk Phase 5.

---

## Recommended next phase

- **Phase 6 — Semester Domain** (atau instruksi selanjutnya dari user). Sesuai aturan kerja, pengerjaan dihentikan di sini dan tidak memulai Phase 6 sebelum ada arahan eksplisit.
