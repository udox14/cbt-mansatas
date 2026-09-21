# Implementation Plan: Phase 2 — Decompose Existing Admin & Shared Examination Engine (Revised)

## 1. Overview & Objectives

Transform the monolithic admin architecture in both backend and frontend by decomposing them into a modular **Shared Examination Engine** and **Platform Modules**, strictly using the **Strangler Pattern** without altering existing exam execution behavior.

Crucially, per architectural directive, **the legacy PMB database (`pmb-man1-tasik` tables: `pendaftar`, `prestasi`, etc.) is retired**. All current and future PMB participant data is sourced from `mansatas-db` via adapters into `cbt_exam_roster`. The shared examination engine must not query the retired PMB database.

```text
                               PHASE 2 DECOMPOSITION
                               
     Frontend (apps/web)                              Backend (apps/worker)
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│ apps/web/src/app/admin/         │             │ apps/worker/src/routes/admin.ts │
│ page.tsx (Slim Shell ~180 L)    │             │ (Slim Orchestrator ~200 L)      │
└──────────────┬──────────────────┘             └────────────────┬────────────────┘
               │                                                 │ Mounts
     Imports   ▼                                                 ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│ src/features/exam-engine/       │             │ src/routes/exam-engine/         │
│  ├── exams/ (ExamsPage, Modal)  │             │  ├── authoring.ts               │
│  ├── questions/ (QuestionsView) │             │  ├── runtime-admin.ts           │
│  ├── tokens/ (TokensView)       │             │  ├── monitoring.ts              │
│  ├── monitoring/ (MonitorView)  │             │  ├── results.ts                 │
│  ├── results/ (ResultsView)     │             │  └── rooms.ts                   │
│  ├── analytics/ (AnalyticsView) │             └────────────────┬────────────────┘
│  ├── assignments/ (AssignView)  │                              │ Calls
│  └── rooms/ (RoomsPage)         │                              ▼
├─────────────────────────────────┤             ┌─────────────────────────────────┐
│ src/features/platform/          │             │ src/services/exam-engine/       │
│  ├── events/ (EventMgmtPage)    │             │  ├── exams.ts                   │
│  ├── participants/ (PesertaPage)│             │  ├── questions.ts               │
│  ├── staff/ (PelaksanaPage)     │             │  ├── tokens.ts                  │
│  └── settings/ (SettingsPage)   │             │  ├── scoring.ts                 │
└─────────────────────────────────┘             │  ├── results.ts                 │
                                                │  ├── monitoring.ts              │
                                                │  ├── analytics.ts               │
                                                │  ├── assignments.ts             │
                                                │  └── rooms.ts                   │
                                                └─────────────────────────────────┘
```

---

## 2. Legacy PMB Dependency Audit & Retirement

Before decomposition, all codebase references to legacy PMB were audited:

| Legacy Symbol / Query | Classification | Action in Phase 2 | Rationale |
| :--- | :--- | :--- | :--- |
| `syncRoomsFromPmb` / `POST /rooms/sync` | **B (Dead code)** | **REMOVE** | Rooms are canonically owned by `cbt_rooms`. No sync from dead table. |
| `ensureRoomEventColumn` | **B (Dead code)** | **REMOVE** | DDL migration belongs in SQL scripts, not runtime query helpers. |
| `GET /rooms` querying `pmbTable` for candidate count | **C (Incorrect coupling)** | **REFACTOR** | Candidate counts derive canonically from `cbt_exam_roster` + `cbt_users`. |
| `getAssignedTokenTargets` PMB fallback | **C (Incorrect coupling)** | **REFACTOR** | Room/session token targets derive canonically from `cbt_exam_roster`. |
| `getAssignedResultParticipants` PMB fallback | **C (Incorrect coupling)** | **REFACTOR** | Participants and room mapping derive canonically from `cbt_exam_roster`. |
| `/api/admin/pendaftar*` endpoints | **B (Dead code)** | **RETIRE** | Dead compatibility endpoints for retired database with zero active users/data. |
| `PesertaPage` PMB `pendaftar` fetching | **C (Incorrect coupling)** | **REFACTOR** | Decomposed `PesertaPage` manages roster via `cbt_exam_roster` and `cbt_users`. |
| PMB student login DDMMYYYY (`auth.ts`) | **A (Current behavior)** | **PRESERVE** | Baseline test compatibility preserved without coupling to shared engine. |

---

## 3. Proposed Changes

### Component 1: Backend Services (`apps/worker/src/services/exam-engine/`)

Pure business logic and database access decoupled from legacy PMB:

#### [NEW] [exams.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/exams.ts)
- `listExams(db, query)`: Fetches exams with question counts and event metadata.
- `getExamById(db, id)`: Fetches single exam.
- `createExam(db, payload, user)`: Validates payload, resolves event context & mode via `resolveExamEventAndMode`.
- `updateExam(db, id, payload)`: Validates immutability once roster is assigned, derives mode, updates record.
- `deleteExam(db, id)`: Deletes exam and associated questions/options/tokens without unintended cascade.

#### [NEW] [questions.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/questions.ts)
- `listExamQuestions(db, examId)`: Questions with options sorted by `question_order`.
- `createQuestion(db, examId, payload)`: Creates question and options.
- `bulkCreateQuestions(db, examId, questions)`: Batch inserts imported questions and options.
- `updateQuestion(db, id, payload)`: Updates question and options.
- `deleteQuestion(db, id)`: Deletes question and options.

#### [NEW] [tokens.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/tokens.ts)
- `listExamTokens(db, examId)`: Retrieves active and inactive room tokens.
- `toggleTokenActive(db, examId, tokenId, isActive)`: Toggles token state.
- `generateExamTokens(db, examId, tokenId?)`: Generates 6-char alphanumeric tokens for targets mapped in `cbt_exam_roster`.
- `setExamTokenCode(db, examId, tokenCode)`: Sets custom token code.
- `getAssignedTokenTargets(db, examId)`: Resolves targets from `cbt_exam_roster` and `cbt_rooms` without PMB database query.

#### [NEW] [scoring.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/scoring.ts)
- `recomputeMissingExamResults(db, examId)`: Evaluates submitted sessions without results against correct options and updates `cbt_exam_results`. Preserves exact calculation logic and golden test values.

#### [NEW] [results.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/results.ts)
- `getExamResults(db, examId)`: Retrieves student scores, violations count, and duration.
- `getExamResultsExport(db, examId)`: Formats results and roster metadata for Excel/Word exports.
- `deleteExamResult(db, examId, sessionId)`: Removes graded result record.
- `getAssignedResultParticipants(db, examId)`: Resolves participants canonically from `cbt_exam_roster` and `cbt_users`.

#### [NEW] [monitoring.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/monitoring.ts)
- `getExamSessions(db, examId)`: Active sessions, heartbeats, cheat violation counts, and progress for live monitoring.

#### [NEW] [analytics.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/analytics.ts)
- `getQuestionAnalytics(db, examId)`: Computes item difficulty index ($P$), distractor discrimination index ($D$), and option selection frequencies. Exact algorithmic preservation.

#### [NEW] [assignments.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/assignments.ts)
- `listExamAssignments(db, examId)`: Lists participants assigned to an exam.
- `assignParticipant(db, examId, payload)`: Single participant assignment.
- `assignByRoom(db, examId, roomId)`: Assigns entire room.
- `assignBySesi(db, examId, sesi)`: Assigns session group.
- `assignByGroup(db, examId, group)`: Assigns room/session group.
- `batchDeleteAssignments(db, examId, ids)`: Batch unassignment.
- `deleteAssignment(db, examId, id)`: Single unassignment.

#### [NEW] [rooms.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/services/exam-engine/rooms.ts)
- `listRooms(db, query)`: Fetches rooms, capacities, and proctor assignments with candidate count derived canonically from `cbt_exam_roster`.
- `createRoom(db, payload)`: Creates new examination room in `cbt_rooms`.
- `updateRoom(db, id, payload)`: Updates room metadata/capacity.
- `deleteRoom(db, id)`: Removes room.
- `listProctors(db)`: Fetches proctor accounts.
- `assignProctor(db, id, roomId)`: Binds proctor to room.

---

### Component 2: Backend Route Modules (`apps/worker/src/routes/exam-engine/`)

Thin Hono route handlers delegating to services with strict RBAC/admin authorization:

#### [NEW] [authoring.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/exam-engine/authoring.ts)
- `GET /exams`, `GET /exams/:id`, `POST /exams`, `PUT /exams/:id`, `DELETE /exams/:id`
- `GET /exams/:examId/questions`, `POST /exams/:examId/questions`, `POST /exams/:examId/questions/bulk`, `PUT /questions/:id`, `DELETE /questions/:id`

#### [NEW] [runtime-admin.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/exam-engine/runtime-admin.ts)
- `GET /exams/:examId/tokens`, `POST /exams/:examId/tokens/:tokenId/active`, `POST /exams/:examId/tokens/generate`, `POST /exams/:examId/tokens/set-code`
- `GET /exams/:examId/assignments`, `POST /exams/:examId/assignments`, `POST /exams/:examId/assignments/room`, `POST /exams/:examId/assignments/sesi`, `POST /exams/:examId/assignments/group`, `POST /exams/:examId/assignments/batch-delete`, `DELETE /exams/:examId/assignments/:id`

#### [NEW] [monitoring.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/exam-engine/monitoring.ts)
- `GET /exams/:examId/sessions`

#### [NEW] [results.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/exam-engine/results.ts)
- `GET /exams/:examId/results`, `GET /exams/:examId/results-export`, `POST /exams/:examId/results/recompute-missing`, `DELETE /exams/:examId/results/:sessionId`, `GET /exams/:examId/question-analytics`

#### [NEW] [rooms.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/exam-engine/rooms.ts)
- `GET /rooms`, `POST /rooms`, `PUT /rooms/:id`, `DELETE /rooms/:id`, `GET /proctors`, `PUT /proctors/:id/assign`

#### [MODIFY] [admin.ts](file:///c:/DATA/cbt-mansatas/apps/worker/src/routes/admin.ts)
- Mounts decomposed exam-engine sub-routes.
- Retains operational platform routes (`/users`, `/gtk-users`, `/upload`, `/dummy-user`, `/settings`).
- Dead `/pendaftar*` and `/rooms/sync` endpoints retired.
- Line count drops from 1,649 to ~200 lines.

---

### Component 3: Frontend Feature Decomposition (`apps/web/src/features/`)

#### Cohesive Shared Modules:
- `src/features/exam-engine/types.ts`: Clean data contracts (`Exam`, `Question`, `QOption`, `Room`, `Proctor`, `CbtEvent`, `RosterParticipant`, `Page`, `ExamTab`).
- `src/features/exam-engine/components/theme.ts`: UI colors & constants (`C`).
- `src/features/exam-engine/components/StatusBadge.tsx`: Status indicator component.
- `src/features/exam-engine/components/TableHead.tsx`: Reusable table header.
- `src/features/exam-engine/components/KemenagLogo.tsx`: Madrasah/Kemenag branding logo.
- `src/features/exam-engine/utils/time.ts`: Date & time parsing utilities.

#### Exam Engine Views (`src/features/exam-engine/`):
- `exams/ExamsPage.tsx`: Exam listing, cards, tab routing for exam details.
- `exams/ExamEditModal.tsx`: Create / edit modal form.
- `questions/QuestionsView.tsx`: Question authoring, reordering, options, `RichEditor`, and `BulkImport`.
- `tokens/TokensView.tsx`: Room tokens management.
- `monitoring/MonitorView.tsx`: Live exam sessions monitoring.
- `results/ResultsView.tsx`: Graded scores, export triggers, recompute missing.
- `results/DownloadExamResultsModal.tsx`: Word docx score sheet modal.
- `analytics/AnalyticsView.tsx`: Psychometric item analysis.
- `assignments/AssignmentsView.tsx`: Participant assignments to exams.
- `rooms/RoomsPage.tsx`: Room list, capacity config, proctor binding (sync button removed).
- `rooms/DownloadAttendanceModal.tsx`: Word docx attendance modal.

#### Platform Views:
- `src/features/platform/events/EventManagementPage.tsx`: Neutral event management view (not Kegiatan domain).
- `src/features/platform/participants/PesertaPage.tsx`: Participant management built on `cbt_exam_roster` and `cbt_users`.
- `src/features/platform/staff/PelaksanaPage.tsx`: Staff / proctor / GTK management.
- `src/features/platform/settings/SettingsPage.tsx`: System settings.

#### [MODIFY] [page.tsx](file:///c:/DATA/cbt-mansatas/apps/web/src/app/admin/page.tsx)
- Slim orchestrator: layout, auth guard, event header, sidebar navigation, view switcher. Line count drops from 4,506 to ~180 lines.

---

## 4. Verification Plan

### Automated Tests
1. **Node.js Test Runner Suite:**
   ```bash
   node --experimental-strip-types --test test/*.test.ts
   ```
   - 39 existing tests must pass.
   - New `test/exam-engine-decomposition.test.ts`: verifying authoring, token generation, scoring golden values, and analytics golden values.
   - Negative authorization tests verifying 401/403 protections on extracted sub-routes.
2. **TypeScript Compilation:**
   ```bash
   npx tsc --noEmit (in apps/worker)
   ```
3. **Frontend Production Build:**
   ```bash
   npm run build (in apps/web)
   ```
   Ensuring static export across all 9 pages.
