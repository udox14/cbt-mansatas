# Implementation Plan: Phase 5 — TKA Domain (Corrected & Approved)

## 1. Overview & Architectural Principles

Implement **Phase 5 — TKA Domain** for CBT MANSATAS adhering strictly to:
> **Multiple Exam Domains + One Shared Examination Engine**

TKA (Tes Kemampuan Akademik) is the centralized school-wide academic assessment for Grade 12 students. Every participating student is evaluated across **exactly 5 subjects**:
- **3 Mandatory Subjects (Wajib)**: *Matematika*, *Bahasa Indonesia*, *Bahasa Inggris*
- **2 Elective Subjects (Pilihan)**: Chosen by the student from the verified institutional registry in Mansatas (`tka_mapel_pilihan`)

Canonical CBT mode remains **strictly `tka`** (one of exactly five modes: `pmb`, `kegiatan`, `tka`, `semester`, `ulangan`). Execution variations (such as Tryout, Simulasi, or Institutional Official TKA) are represented using existing event title and description fields without introducing new CBT modes or speculative schema columns.

---

## 2. Audited Mansatas TKA Schema & Institutional Subject Registry

### 2.1 Mansatas Database Contract (`MANSATAS_DB`)
Verified against `udox14/mansatas-app` and `MANSATAS-INTEGRATION.md`:
1. **`tka_mapel_pilihan`**:
   - `id`: `TEXT PRIMARY KEY`
   - `siswa_id`: `TEXT NOT NULL` (references `siswa.id`)
   - `tahun_ajaran_id`: `TEXT NOT NULL` (references `tahun_ajaran.id`)
   - `mapel_pilihan1`: `TEXT NOT NULL` (string name or abbreviation of chosen elective 1)
   - `mapel_pilihan2`: `TEXT NOT NULL` (string name or abbreviation of chosen elective 2)
   - `updated_at`: `TEXT`
   - Constraint: `UNIQUE(siswa_id, tahun_ajaran_id)`
   - **Architectural Fact**: Choices are stored as free-form strings, NOT foreign keys to `mata_pelajaran.id`.
2. **`siswa`**:
   - `id`: `TEXT PRIMARY KEY`, `nisn`: `TEXT`, `nama_lengkap`: `TEXT NOT NULL`, `jenis_kelamin`: `TEXT ('L'|'P')`, `kelas_id`: `TEXT NOT NULL`, `status`: `TEXT NOT NULL` (active filter: `'aktif'`).
3. **`kelas`**:
   - `id`: `TEXT PRIMARY KEY`, `tingkat`: `12`, `kelompok`: `TEXT`, `nomor_kelas`: `INTEGER/TEXT`.
4. **`riwayat_kelas`**:
   - `siswa_id`, `kelas_id`, `tahun_ajaran_id` (used as fallback when `siswa.kelas_id` current record does not match the academic year of the event).
5. **`tahun_ajaran`**:
   - `id`: `TEXT PRIMARY KEY`, `nama`: `TEXT`, `semester`: `TEXT`, `is_active`: `INTEGER`.
6. **`mata_pelajaran`**:
   - `id`: `TEXT PRIMARY KEY`, `nama_mapel`: `TEXT NOT NULL`, `kode_mapel`: `TEXT`, `kelompok`: `TEXT`.

### 2.2 Preservation of `cbt_exams.subject_id` Semantic
In Phase 4 (Ulangan Harian), `cbt_exams.subject_id` was established to store the authoritative Mansatas `mata_pelajaran.id`.
To prevent schema overload and maintain semantic compatibility:
- We do **NOT** store synthetic strings (like `tka-fisika`) inside `cbt_exams.subject_id`.
- The resolution pipeline is:
  $$\text{Raw Choice String} \longrightarrow \text{Explicit Alias Resolver} \longrightarrow \text{Canonical Subject Definition} \longrightarrow \text{Verified Mansatas } \mathtt{mata\_pelajaran.id} \longrightarrow \mathtt{cbt\_exams.subject\_id}$$
- In `cbt_exams`: `subject_id` stores Mansatas `mata_pelajaran.id`, and `subject_name` stores the official subject name.

### 2.3 Verified Institutional Subject Registry
Audited against MAN 1 Tasikmalaya curriculum and Mansatas TKA options:

**Mandatory Subjects (3 Mapel Wajib)**:
1. Matematika (`MAT`)
2. Bahasa Indonesia (`BIN`)
3. Bahasa Inggris (`BIG`)

**Elective Subjects (19 Mapel Pilihan)**:
1. Matematika Tingkat Lanjut (`MAT-L`)
2. Bahasa Indonesia Tingkat Lanjut (`BIN-L`)
3. Bahasa Inggris Tingkat Lanjut (`BIG-L`)
4. Fisika (`FIS`)
5. Kimia (`KIM`)
6. Biologi (`BIO`)
7. Pendidikan Pancasila dan Kewarganegaraan / PPKn (`PPKN`)
8. Ekonomi (`EKO`)
9. Geografi (`GEO`)
10. Sosiologi (`SOS`)
11. Sejarah (`SEJ`)
12. Antropologi (`ANT`)
13. Bahasa Arab (`ARB`)
14. Bahasa Jepang (`JPN`)
15. Bahasa Jerman (`GER`)
16. Bahasa Prancis (`FRA`)
17. Bahasa Mandarin (`CHN`)
18. Bahasa Korea (`KOR`)
19. Projek Kreatif dan Kewirausahaan / PKWU (`PKWU`)

### 2.4 Explicit Non-Fuzzy Alias Resolution Strategy
- Centralized dictionary in `apps/worker/src/services/domains/tka/canonical-subjects.ts`.
- Maps exact lowercase, trimmed, whitespace-collapsed string tokens to canonical subjects.
- **Rule**: If a string does not match any entry in the dictionary, `resolveCanonicalTkaSubject(raw)` returns `null`.
- **Zero Fuzzy Matching**: No Levenshtein distance, no `.includes()`, no AI guessing. Unresolved strings produce `validation_status = 'unresolved'` and block readiness.

---

## 3. Event & Exam Model & Invariants

### 3.1 Event-to-Exam Cardinality
- **1 TKA Event (`cbt_events`) contains Multiple Subject Exams (`cbt_exams`)**.
- 3 Mandatory Subject Exams are created under the event.
- Elective Subject Exams are created corresponding to the electives chosen by valid participants.

### 3.2 One TKA Exam Per Subject Per Event Invariant
$$\forall \text{ subject } s \text{ in TKA event } e: \quad \text{COUNT}(\mathtt{cbt\_exams} \text{ where } \mathtt{event\_id}=e \land \mathtt{subject\_id}=s) \le 1$$
- **Application Guard**: `createTkaExam` verifies that no existing exam in the event shares the same `subject_id`. Attempting to create a duplicate subject exam is rejected with **409 Conflict**.
- **Database Safety Net**:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject
  ON cbt_exams(event_id, subject_id)
  WHERE mode = 'tka';
  ```
  Kegiatan and other multi-exam domains remain completely unconstrained.

### 3.3 Exact Subject Exam Coverage
Readiness verifies:
$$\text{Required Subject Set} = \{ 3 \text{ Mandatory Subjects} \} \cup \bigcup_{p \in \text{Valid Participants}} \{ p.\text{pilihan1}, p.\text{pilihan2} \}$$
For every required subject, **exactly one exam** must exist in `cbt_exams`.
Any unused/zombie subject exam (0 participants enrolled and not a mandatory subject) must be removed before transitioning to `ready`.

---

## 4. Participant Snapshot, Invariant, & Sync Model

### 4.1 Additive Schema: `cbt_tka_participants`
To decouple runtime execution from live Mansatas queries and maintain an immutable historical audit:

```sql
CREATE TABLE IF NOT EXISTS cbt_tka_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  nisn TEXT,
  nama_lengkap TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT,
  gender TEXT,
  mapel_pilihan1_raw TEXT,
  mapel_pilihan2_raw TEXT,
  mapel_pilihan1_subject_id TEXT,
  mapel_pilihan2_subject_id TEXT,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending')),
  validation_notes TEXT,
  room_id TEXT REFERENCES cbt_rooms(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tka_participants_event ON cbt_tka_participants(event_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_tka_participants_student ON cbt_tka_participants(student_id);
```

**Key Constraint**: `validation_status` has **NO default value**. Every insert/upsert must write the deterministic result computed by the server validator.

### 4.2 Exactly-Five-Subject Invariant
$$\text{Entitlement per Valid Participant} = 3 \text{ Mandatory} + 2 \text{ Distinct Electives} = 5 \text{ Subjects}$$

Validation statuses:
- `valid`: 3 mandatory + 2 distinct valid electives resolved.
- `missing_option`: Choice 1 or Choice 2 is null/empty.
- `duplicate_option`: Choice 1 resolves to the same subject as Choice 2.
- `duplicate_mandatory`: An elective duplicates a mandatory subject.
- `unresolved`: Choice string cannot be mapped to any canonical institutional subject.

### 4.3 Data-Quality & Exclusion Diagnostics (`/participants/preview`)
The preview endpoint categorizes Mansatas Grade 12 records into:
- `eligible`: Active Grade 12 students with choices ready for snapshotting.
- `data_quality_error`:
  - `NO_TKA_CHOICE_RECORD`: Active Grade 12 student with no record in `tka_mapel_pilihan` for the event's academic year.
  - `MISSING_OPTION`, `DUPLICATE_OPTION`, `DUPLICATE_MANDATORY`, `UNRESOLVED`.
- `ineligible`: Students not in Grade 12 or inactive.

### 4.4 Atomic Deterministic Sync (`POST /participants/sync`)
- Permitted only while event status is `draft` or `configuration`.
- **Pre-execution Guard**: Rejects sync with **409 Conflict** if ANY student session exists in `cbt_exam_sessions` for any exam under this event.
- Calculates diff:
  - `added`: Insert into `cbt_tka_participants`.
  - `removed`: Delete from `cbt_tka_participants` and remove pre-runtime roster assignments in `cbt_exam_roster`.
  - `changed_choices`: Update `cbt_tka_participants`; remove obsolete elective roster rows, add new elective roster rows, retain mandatory roster rows and room assignments.
  - `retained`: Preserve existing `room_id` assignment.
- Executed as an atomic batch.
- After `ready`, sync is strictly rejected with **409 Conflict**.

---

## 5. Canonical Room Authority & Explicit Token Policy

### 5.1 Canonical Room Authority
- `cbt_tka_participants.room_id` = Event-level TKA room assignment authority before freeze.
- `cbt_exam_roster.room_id` = Runtime materialized copy for each entitled exam.
- **Synchronization**: Changing a participant's room during `draft/configuration` updates `cbt_tka_participants.room_id` AND synchronously updates `room_id` across all `cbt_exam_roster` rows for that student in the event:
  ```sql
  UPDATE cbt_exam_roster
  SET room_id = ?
  WHERE event_id = ? AND source_key = 'mansatas' AND source_id = ?;
  ```
- At `ready`, participant room assignments and roster room assignments are frozen.
- **Capacity Policy**: Simple manual or bulk room assignment. No automatic capacity distribution algorithms are invented for TKA (deferred to Semester Phase 6).

### 5.2 Chosen Explicit Token Policy: Exam-Room Scoped
Since TKA is a centralized, proctored examination where physical room assignment is mandatory (`isRoomRequiredForExam('tka') === true`):
- **Chosen Policy**: **Exam-Room Scoped Tokens**.
- Every required subject exam $\times$ every assigned room with enrolled participants must have an active token in `cbt_exam_tokens`:
  $$\forall \text{ exam } x \in \text{Event Exams}, \forall \text{ room } r \in \text{Assigned Rooms}(x): \quad \exists \text{ active token for } (x, r)$$
- Reuses shared `services/exam-engine/tokens.ts` directly.
- Readiness gate deterministically checks this condition.

---

## 6. Lifecycle Authority & Historical Freeze

### 6.1 Lifecycle Authority
- `cbt_events.status` is the lifecycle authority:
  `draft -> configuration -> ready -> active -> completed -> archived`
- Legal rollbacks: `ready -> configuration`, `configuration -> draft`.
- Member exams (`cbt_exams.active_status`) are synchronized mirrors:
  - Event `configuration` $\rightarrow$ Exams `configuration`
  - Event `ready` $\rightarrow$ Readiness passes $\rightarrow$ Exams `ready`
  - Event `active` $\rightarrow$ Exams `active`
  - Event `completed` $\rightarrow$ Exams `finished`
- Generic exam update routes are guarded against independently altering a TKA child exam's active status.

### 6.2 Immutable Freeze at `ready`
Once transitioned to `ready`, the following are frozen:
1. Academic-year context
2. Participant population and demographic snapshot
3. Raw elective choices and resolved subject identities
4. Subject exam set
5. Participant-to-exam roster assignments
6. Room assignments

Student runtime interacts only with CBT-owned snapshots (`cbt_exam_roster`, `cbt_exam_sessions`, etc.). Live queries to Mansatas `tka_mapel_pilihan` or `siswa` are never performed at runtime.

---

## 7. Deterministic 10-Point Readiness Gate

`checkTkaEventReadiness(db, eventId)` evaluates:
1. **Event Identity**: Event exists and `mode === 'tka'`.
2. **Academic Year**: `academic_year_id` is populated and valid.
3. **Participant Population**: `COUNT(cbt_tka_participants) > 0`.
4. **Validation Invariant**: **100% of participants have `validation_status = 'valid'`**. (Zero missing, duplicate, or unresolved choices).
5. **Mandatory Exams Exist**: Exactly 3 exams for Matematika, Bahasa Indonesia, Bahasa Inggris exist.
6. **Elective Exams Exist**: Every elective chosen by at least 1 valid student has a corresponding exam.
7. **Question Quality**: Every subject exam has $> 0$ questions, total points $> 0$, and correct keys configured.
8. **Roster Assignments**: Every valid student has exactly 5 roster rows in `cbt_exam_roster`.
9. **Room Assignments**: Every roster row has `room_id != NULL`.
10. **Active Tokens**: Active exam-room tokens exist for every required exam $\times$ assigned room.

---

## 8. Shared UI / API Contract Matrix

Shared views remain strictly **exam-level**. In `TkaWorkspace.tsx`, the administrator selects a subject exam, which then embeds the shared view with `apiPrefix="/api/tka"`.

| Shared Component | Method | Relative Path Emitted | Exam ID Req. | Target `/api/tka` Route | Permission Guard | Shared Service Delegation |
|:---|:---:|:---|:---:|:---|:---|:---|
| `QuestionsView` | `GET` | `/exams/:id/questions` | Yes | `/api/tka/exams/:id/questions` | `tka.access` | `listExamQuestions` |
| `QuestionsView` | `POST` | `/exams/:id/questions` | Yes | `/api/tka/exams/:id/questions` | `tka.event.manage` | `createQuestion` |
| `QuestionsView` | `PUT` | `/questions/:qId` | Exam in payload | `/api/tka/questions/:qId` | `tka.event.manage` | `updateQuestion` |
| `QuestionsView` | `DELETE`| `/questions/:qId` | Query param | `/api/tka/questions/:qId` | `tka.event.manage` | `deleteQuestion` |
| `BulkImport` | `POST` | `/exams/:id/questions/bulk` | Yes | `/api/tka/exams/:id/questions/bulk` | `tka.event.manage` | `bulkCreateQuestions` |
| `QuestionsView` | `POST` | `/upload` | In FormData | `/api/tka/upload` | `tka.event.manage` | R2 Media Service |
| `TokensView` | `GET` | `/exams/:id/tokens` | Yes | `/api/tka/exams/:id/tokens` | `tka.access` | `listExamTokens` |
| `TokensView` | `POST` | `/exams/:id/tokens/generate` | Yes | `/api/tka/exams/:id/tokens/generate` | `tka.event.manage` | `generateExamTokens` |
| `TokensView` | `POST` | `/exams/:id/tokens/set-code` | Yes | `/api/tka/exams/:id/tokens/set-code` | `tka.event.manage` | `setExamTokenCode` |
| `TokensView` | `POST` | `/exams/:id/tokens/:tokenId/active` | Yes | `/api/tka/exams/:id/tokens/:tokenId/active` | `tka.event.manage` | `toggleTokenActive` |
| `MonitorView` | `GET` | `/exams/:id/monitoring` | Yes | `/api/tka/exams/:id/monitoring` | `tka.access` | `getExamSessions` |
| `MonitorView` | `POST` | `/exams/:id/sessions/:sId/unlock` | Yes | `/api/tka/exams/:id/sessions/:sId/unlock` | `tka.event.manage` | `unlockExamSession` |
| `MonitorView` | `POST` | `/exams/:id/sessions/:sId/reset` | Yes | `/api/tka/exams/:id/sessions/:sId/reset` | `tka.event.manage` | `resetSessionDevice` |
| `MonitorView` | `POST` | `/exams/:id/sessions/:sId/force-submit` | Yes | `/api/tka/exams/:id/sessions/:sId/force-submit` | `tka.event.manage` | `forceSubmitSession` |
| `ResultsView` | `GET` | `/exams/:id/results` | Yes | `/api/tka/exams/:id/results` | `tka.results.read` | `getExamResults` |
| `AnalyticsView` | `GET` | `/exams/:id/analytics` | Yes | `/api/tka/exams/:id/analytics` | `tka.results.read` | `getExamAnalytics` |

---

## 9. RBAC & IDOR Boundaries

### 9.1 Permissions
- `tka.access`: View TKA events, dashboard, and preview diagnostics.
- `tka.event.create`: Create new TKA event.
- `tka.event.manage`: Manage configuration, snapshot, sync, exams, roster, rooms, tokens, and lifecycle.
- `tka.results.read`: View results and analytics.
- Role `admin` or permission `platform.manage` or `*` grants full administrative oversight.
- Students and unauthorized staff receive **403 Forbidden**.

### 9.2 IDOR & Isolation Guard
- Every route verifies `event.mode === 'tka'`. Non-TKA events return **404/400**.
- Child exam operations verify `exam.event_id === event.id` and `exam.mode === 'tka'`.

---

## 10. Database Migration (`apps/worker/migration-phase5-tka.sql`)

```sql
-- ============================================================
-- PHASE 5 Migration: Additive tables and invariants for TKA Domain
-- ============================================================

-- 1. Additive table for event-level participant snapshot and choice tracking
CREATE TABLE IF NOT EXISTS cbt_tka_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  nisn TEXT,
  nama_lengkap TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT,
  gender TEXT,
  mapel_pilihan1_raw TEXT,
  mapel_pilihan2_raw TEXT,
  mapel_pilihan1_subject_id TEXT,
  mapel_pilihan2_subject_id TEXT,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending')),
  validation_notes TEXT,
  room_id TEXT REFERENCES cbt_rooms(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tka_participants_event ON cbt_tka_participants(event_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_tka_participants_student ON cbt_tka_participants(student_id);

-- 2. Partial unique index enforcing at most one exam per subject per TKA event
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_tka_event_subject
ON cbt_exams(event_id, subject_id)
WHERE mode = 'tka';
```

---

## 11. Complete API Endpoints Plan (`/api/tka/*`)

| Method | Path | Permission | Description |
|:---|:---|:---|:---|
| `GET` | `/academic-years` | `tka.access` | Lists academic years from Mansatas |
| `GET` | `/events` | `tka.access` | Lists TKA events |
| `POST` | `/events` | `tka.event.create` | Creates new TKA event |
| `GET` | `/events/:id` | `tka.access` | Gets TKA event details |
| `PUT` | `/events/:id` | `tka.event.manage` | Updates event configuration |
| `PUT` | `/events/:id/status` | `tka.event.manage` | Transitions event status (evaluates readiness on `ready`) |
| `GET` | `/events/:id/readiness` | `tka.access` | Evaluates deterministic readiness report |
| `GET` | `/events/:id/participants/preview`| `tka.access` | Previews Grade 12 students & choices with diagnostics |
| `POST` | `/events/:id/participants/snapshot`| `tka.event.manage` | Snapshots Grade 12 students & choices into `cbt_tka_participants` |
| `POST` | `/events/:id/participants/sync` | `tka.event.manage` | Diff-based re-sync of student choices (blocked if >= ready or sessions exist) |
| `GET` | `/events/:id/participants` | `tka.access` | Lists snapshotted participants with validation status |
| `GET` | `/events/:id/subject-coverage` | `tka.access` | Returns subject coverage matrix & participant counts |
| `GET` | `/events/:id/exams` | `tka.access` | Lists subject exams under this event |
| `POST` | `/events/:id/exams` | `tka.event.manage` | Creates a subject exam (guarded: max 1 per subject) |
| `PUT` | `/events/:id/exams/:examId` | `tka.event.manage` | Updates subject exam settings |
| `DELETE` | `/events/:id/exams/:examId` | `tka.event.manage` | Deletes subject exam (blocked if >= ready) |
| `POST` | `/events/:id/roster/generate` | `tka.event.manage` | Generates 5-subject `cbt_exam_roster` assignments |
| `GET` | `/events/:id/rooms` | `tka.access` | Lists rooms and assignment counts |
| `POST` | `/events/:id/rooms/assign` | `tka.event.manage` | Assigns room to participant and synchronizes roster rows |
| `GET` | `/exams/:examId/questions` | `tka.access` | Shared `listExamQuestions` |
| `POST` | `/exams/:examId/questions` | `tka.event.manage` | Shared `createQuestion` |
| `POST` | `/exams/:examId/questions/bulk` | `tka.event.manage` | Shared `bulkCreateQuestions` |
| `PUT` | `/questions/:questionId` | `tka.event.manage` | Shared `updateQuestion` |
| `DELETE` | `/questions/:questionId` | `tka.event.manage` | Shared `deleteQuestion` |
| `POST` | `/upload` | `tka.event.manage` | Scoped R2 media upload |
| `GET` | `/exams/:examId/tokens` | `tka.access` | Shared `listExamTokens` |
| `POST` | `/exams/:examId/tokens/generate` | `tka.event.manage` | Shared `generateExamTokens` |
| `POST` | `/exams/:examId/tokens/set-code` | `tka.event.manage` | Shared `setExamTokenCode` |
| `POST` | `/exams/:examId/tokens/:tokenId/active` | `tka.event.manage` | Shared `toggleTokenActive` |
| `GET` | `/exams/:examId/monitoring` | `tka.access` | Shared `getExamSessions` |
| `POST` | `/exams/:examId/sessions/:sId/unlock` | `tka.event.manage` | Shared `unlockExamSession` |
| `POST` | `/exams/:examId/sessions/:sId/reset` | `tka.event.manage` | Shared `resetSessionDevice` |
| `POST` | `/exams/:examId/sessions/:sId/force-submit` | `tka.event.manage` | Shared `forceSubmitSession` |
| `GET` | `/exams/:examId/results` | `tka.results.read` | Shared `getExamResults` |
| `GET` | `/exams/:examId/analytics` | `tka.results.read` | Shared `getExamAnalytics` |

---

## 12. Automated Test Plan (`apps/worker/test/tka-domain.test.ts`)

1. **Source Adapter & Grade-12 Filtering**:
   - Queries only active Grade 12 students in specified academic year.
   - Verifies fallback to `riwayat_kelas`.
2. **Canonical Mapping & Alias Resolution**:
   - Tests every supported alias in `TKA_ALIAS_MAP`.
   - Verifies case insensitivity and whitespace tolerance.
3. **Deterministic Unresolved Alias Handling**:
   - Rejects unmapped strings and sets `validation_status = 'unresolved'`.
4. **Subject ID Compatibility with Ulangan**:
   - Proves `cbt_exams.subject_id` stores Mansatas `mata_pelajaran.id`.
5. **One TKA Exam Per Subject Per Event Invariant**:
   - Exam #1 Fisika in TKA event $\rightarrow$ success.
   - Exam #2 Fisika in same event $\rightarrow$ rejected by application guard AND database partial unique index.
   - Exam Kimia in same event $\rightarrow$ success.
   - Multiple exams in Kegiatan $\rightarrow$ unchanged.
6. **Exactly-Five Invariant Validation**:
   - 3 mandatory + 2 valid distinct choices $\rightarrow$ `valid`.
   - Missing choice 1 or 2 $\rightarrow$ `missing_option`.
   - Choice 1 equals choice 2 $\rightarrow$ `duplicate_option`.
   - Choice duplicates mandatory subject $\rightarrow$ `duplicate_mandatory`.
7. **Participant Snapshot & Idempotency**:
   - Writes to `cbt_tka_participants`.
   - Verifies `validation_status` has no default and is explicitly written.
8. **Diff-Based Atomic Sync**:
   - Verifies diff calculation (added, removed, changed choices, unchanged).
   - Verifies room assignment preservation.
   - Rejects sync if any session exists.
   - Rejects sync if status is `ready` or higher.
9. **Data-Quality & Diagnostic Reporting**:
   - Verifies preview returns structured diagnostics for unassigned choices or anomalies.
10. **Canonical Room Authority & Materialized Roster Sync**:
    - Changing participant room synchronizes all 5 roster rows.
    - Proves participant room and roster room never drift.
11. **Exam-Room Token Policy Verification**:
    - Generates tokens per exam-room.
    - Readiness fails if any exam $\times$ assigned room lacks an active token; passes when all are configured.
12. **Exact Subject Exam Coverage**:
    - Readiness verifies all required subjects have exactly one exam.
    - Readiness flags zombie/unpopulated elective exams.
13. **Domain Isolation & IDOR**:
    - Rejects PMB, Kegiatan, Semester, and Ulangan event IDs on `/api/tka/*`.
    - Rejects cross-event exam ID injection.
14. **Student Runtime Authorization**:
    - Student can start entitled subject exam.
    - Student attempting non-entitled subject exam receives 403.
15. **Event / Exam Lifecycle Synchronization**:
    - Synchronizes `active_status` on all member exams upon event status transition.
    - Guards member exams from direct status modification.
16. **Historical Stability after Freeze**:
    - Live Mansatas mutations after freeze do not alter snapshotted rosters or completed results.

---

## 13. Canonical Project Roadmap

```text
Phase 1A — Secure Staff Identity & RBAC       ✅
Phase 1B — Event Context & Lifecycle          ✅
Phase 2  — Shared Examination Engine          ✅
Phase 3  — Kegiatan Domain                    ✅
Phase 4  — Ulangan Harian Domain              ✅
Phase 5  — TKA Domain                         ← CURRENT
Phase 6  — Semester Foundation
Phase 7  — Semester Automation
Phase 8  — AI Question Generator V1
Phase 9  — Consolidation / Reporting / Load Hardening
```
*(Immutable question versioning remains an architectural target for future phases, not Phase 9).*
