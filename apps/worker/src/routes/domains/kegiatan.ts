// ============================================================
// Kegiatan Domain — HTTP Router
//
// Mounts all Kegiatan domain endpoints with:
// 1. Strict server-side RBAC evaluation
// 2. Strict event.mode === 'kegiatan' domain boundaries
// 3. Explicit student_ids roster snapshotting
// 4. Delegation of exam persistence to Phase 2 shared exam engine
// ============================================================

import { Hono } from 'hono';
import type { Env, EventStatus } from '../../types.ts';
import { authMiddleware } from '../../middleware/auth.ts';
import { requirePermission } from '../../middleware/rbac.ts';
import { ok, err } from '../../utils/helpers.ts';
import { listClassesFromMansatas } from '../../services/sources/students.ts';
import {
  listKegiatanEvents,
  getKegiatanEventById,
  createKegiatanEvent,
  updateKegiatanEvent,
  transitionKegiatanEventStatus,
  DomainMismatchError,
} from '../../services/domains/kegiatan/events.ts';
import { checkKegiatanEventReadiness } from '../../services/domains/kegiatan/readiness.ts';
import {
  listKegiatanEligibleStudents,
  listKegiatanEventRoster,
  batchSnapshotToKegiatanRoster,
  removeStudentFromKegiatanRoster,
} from '../../services/domains/kegiatan/participants.ts';
import { createExam, listExams } from '../../services/exam-engine/exams.ts';
import {
  assertAiQuestionAuthoringAccess,
  generateAiQuestions,
  listAiRuns,
  listAiDrafts,
  updateAiDraft,
  deleteAiDraft,
  acceptAiDrafts,
  buildExamAiPrompt,
  validatePastedAiQuestions,
  revalidateEditedAiQuestion,
  importReviewedAiQuestions,
} from '../../services/exam-engine/ai-authoring.ts';
import {
  getExamResults,
  getExamResultsExport,
  deleteExamResult,
} from '../../services/exam-engine/results.ts';
import { getExamSessions } from '../../services/exam-engine/monitoring.ts';
import { getExamQuestionAnalytics } from '../../services/exam-engine/analytics.ts';
import { recomputeMissingExamResults } from '../../services/exam-engine/scoring.ts';



const kegiatan = new Hono<{ Bindings: Env }>();

// ── Base Authentication & RBAC Guard ─────────────────────────
kegiatan.use('*', authMiddleware);

// Ensure student role is strictly rejected from all administrative Kegiatan endpoints
kegiatan.use('*', async (c, next) => {
  const user = c.get('user');
  if (user?.role === 'student' || (user?.roles?.includes('student') && !user?.roles?.includes('admin'))) {
    return c.json(err('Akses ditolak: siswa tidak diizinkan mengakses administrasi Kegiatan'), 403);
  }
  await next();
});

// ── 1. Event Listing & Details ───────────────────────────────

kegiatan.get('/events', requirePermission('kegiatan.event.read'), async (c) => {
  const status = c.req.query('status') as EventStatus | undefined;
  const events = await listKegiatanEvents(c.env.DB, { status });
  return c.json(ok(events));
});

kegiatan.post('/events', requirePermission('kegiatan.event.create'), async (c) => {
  const body = await c.req.json<any>();
  const user = c.get('user');
  const result = await createKegiatanEvent(c.env.DB, body, user.sub);
  if (!result.success) {
    return c.json(err(result.error || 'Gagal membuat kegiatan'), 400);
  }
  return c.json(ok({ id: result.id }, 'Kegiatan berhasil dibuat'), 201);
});

kegiatan.get('/events/:eventId', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  try {
    const event = await getKegiatanEventById(c.env.DB, eventId);
    if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);
    return c.json(ok(event));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

kegiatan.put('/events/:eventId', requirePermission('kegiatan.event.update'), async (c) => {
  const eventId = c.req.param('eventId');
  const body = await c.req.json<any>();
  try {
    const result = await updateKegiatanEvent(c.env.DB, eventId, body);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal memperbarui kegiatan'), 400);
    }
    return c.json(ok(null, 'Kegiatan berhasil diperbarui'));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

kegiatan.put('/events/:eventId/status', requirePermission('kegiatan.event.transition'), async (c) => {
  const eventId = c.req.param('eventId');
  const body = await c.req.json<any>();
  const targetStatus = body.status as EventStatus;
  if (!targetStatus) {
    return c.json(err('Status target wajib diisi'), 400);
  }

  try {
    const result = await transitionKegiatanEventStatus(c.env.DB, eventId, targetStatus);
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || 'Gagal mengubah status kegiatan',
          readiness: result.readiness,
        },
        400
      );
    }
    return c.json(ok({ id: eventId, status: targetStatus }, `Status kegiatan diubah menjadi ${targetStatus}`));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

// ── 2. Readiness Evaluation ──────────────────────────────────

kegiatan.get('/events/:eventId/readiness', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  try {
    const event = await getKegiatanEventById(c.env.DB, eventId);
    if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);

    const readiness = await checkKegiatanEventReadiness(c.env.DB, eventId);
    return c.json(ok(readiness));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

// ── 3. Participants & Roster ─────────────────────────────────

kegiatan.get('/classes', requirePermission('kegiatan.event.read'), async (c) => {
  if (!c.env.MANSATAS_DB) {
    return c.json(ok([]));
  }
  const classes = await listClassesFromMansatas(c.env.MANSATAS_DB);
  return c.json(ok(classes));
});

kegiatan.get('/events/:eventId/participants', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  try {
    const event = await getKegiatanEventById(c.env.DB, eventId);
    if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);

    const filters = {
      q: c.req.query('q')?.trim() || undefined,
      class_id: c.req.query('class_id')?.trim() || undefined,
      grade: c.req.query('grade')?.trim() || undefined,
      gender: c.req.query('gender')?.trim() || undefined,
      page: Number(c.req.query('page') || 1),
      page_size: Number(c.req.query('page_size') || 50),
    };

    const result = await listKegiatanEligibleStudents(c.env.MANSATAS_DB, filters);
    return c.json(
      ok({
        items: result.items,
        pagination: {
          page: filters.page,
          page_size: filters.page_size,
          total: result.total,
          total_pages: Math.ceil(result.total / filters.page_size),
        },
      })
    );
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

kegiatan.get('/events/:eventId/roster', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.query('exam_id') || undefined;
  try {
    const roster = await listKegiatanEventRoster(c.env.DB, eventId, examId);
    return c.json(ok(roster));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

kegiatan.post('/events/:eventId/exams/:examId/roster', requirePermission('kegiatan.roster.manage'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const body = await c.req.json<any>();

  const studentIds = body.student_ids;
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return c.json(err('Daftar ID siswa wajib disertakan (pilih minimal 1 siswa)'), 400);
  }
  if (studentIds.length > 1000) {
    return c.json(err('Maksimal 1.000 siswa per operasi snapshot'), 400);
  }

  try {
    const result = await batchSnapshotToKegiatanRoster(
      c.env.DB,
      c.env.MANSATAS_DB,
      eventId,
      examId,
      studentIds,
      {
        room_id: body.room_id,
        tanggal_tes: body.tanggal_tes,
        sesi_tes: body.sesi_tes,
      }
    );
    return c.json(ok(result, 'Roster peserta berhasil diproses'));
  } catch (e: any) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    return c.json(err(e?.message || 'Gagal memproses snapshot roster'), 400);
  }
});

kegiatan.delete('/events/:eventId/exams/:examId/roster/:rosterId', requirePermission('kegiatan.roster.manage'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const rosterId = c.req.param('rosterId');

  try {
    const result = await removeStudentFromKegiatanRoster(c.env.DB, eventId, examId, rosterId);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal menghapus peserta'), 409);
    }
    return c.json(ok(null, 'Peserta berhasil dihapus dari roster'));
  } catch (e: any) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    return c.json(err(e?.message || 'Gagal menghapus peserta roster'), 400);
  }
});

// ── 4. Exam Management (Delegates directly to Shared Engine) ─

kegiatan.get('/events/:eventId/exams', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  try {
    const event = await getKegiatanEventById(c.env.DB, eventId);
    if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);

    const exams = await listExams(c.env.DB, { event_id: eventId, mode: 'kegiatan' });
    return c.json(ok(exams));
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

kegiatan.post('/events/:eventId/exams', requirePermission('kegiatan.exam.create'), async (c) => {
  const eventId = c.req.param('eventId');
  try {
    const event = await getKegiatanEventById(c.env.DB, eventId);
    if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);

    const body = await c.req.json<any>();
    const user = c.get('user');

    // Delegate creation to shared examination engine
    const result = await createExam(
      c.env.DB,
      {
        ...body,
        event_id: eventId,
        mode: 'kegiatan', // Server authoritative mode inheritance
      },
      user
    );

    if (!result.success) {
      return c.json(err(result.error || 'Gagal membuat ujian kegiatan'), (result.status as any) || 400);
    }

    return c.json(ok({ id: result.data?.id }, 'Ujian kegiatan berhasil dibuat'), 201);
  } catch (e) {
    if (e instanceof DomainMismatchError) {
      return c.json(err(e.message), 400);
    }
    throw e;
  }
});

// ── AI Question Generator (Kegiatan Scoped) ──────────────────

async function assertKegiatanAiAccess(c: any, examId: string, eventId?: string) {
  const user = c.get('user');
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return { ok: false, response: c.json(err(auth.error!), (auth.status as any) || 403) };
  }
  const examMode = auth.exam?.mode || auth.exam?.event_mode;
  if (examMode !== 'kegiatan') {
    return { ok: false, response: c.json(err('Ujian bukan merupakan domain Kegiatan'), 400) };
  }
  if (eventId && auth.exam?.event_id !== eventId) {
    return { ok: false, response: c.json(err('Ujian tidak cocok dengan kegiatan yang ditentukan'), 400) };
  }
  return { ok: true, exam: auth.exam, user };
}

// RPPM AI Question Generator Endpoints
kegiatan.post('/exams/:id/ai/prompt', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const body = await c.req.json<any>();
  const result = await buildExamAiPrompt(c.env.DB, examId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data));
});

kegiatan.post('/exams/:id/ai/validate', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const body = await c.req.json<any>();
  const result = await validatePastedAiQuestions(c.env.DB, examId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data));
});

kegiatan.post('/exams/:id/ai/revalidate', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const body = await c.req.json<any>();
  const result = await revalidateEditedAiQuestion(c.env.DB, examId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data));
});

kegiatan.post('/exams/:id/ai/import', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const body = await c.req.json<{ questions: any[] }>();
  const questions = body.questions || [];
  const result = await importReviewedAiQuestions(c.env.DB, examId, questions);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

// Flat route: /exams/:id/ai/generate
kegiatan.post('/exams/:id/ai/generate', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const actorStaffId = check.user?.staff_id || check.user?.sub;
  const body = await c.req.json<any>();

  const result = await generateAiQuestions(c.env.DB, c.env, examId, actorStaffId, body);
  if (!result.success) {
    return c.json(err(result.error!, (result as any).data), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

// Event-nested route: /events/:eventId/exams/:examId/ai/generate
kegiatan.post('/events/:eventId/exams/:examId/ai/generate', requirePermission('kegiatan.event.update'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const actorStaffId = check.user?.staff_id || check.user?.sub;
  const body = await c.req.json<any>();

  const result = await generateAiQuestions(c.env.DB, c.env, examId, actorStaffId, body);
  if (!result.success) {
    return c.json(err(result.error!, (result as any).data), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

kegiatan.get('/exams/:id/ai/runs', requirePermission('kegiatan.event.read'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const runs = await listAiRuns(c.env.DB, examId);
  return c.json(ok(runs));
});

kegiatan.get('/events/:eventId/exams/:examId/ai/runs', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const runs = await listAiRuns(c.env.DB, examId);
  return c.json(ok(runs));
});

kegiatan.get('/exams/:id/ai/drafts', requirePermission('kegiatan.event.read'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const runId = c.req.query('run_id');
  const drafts = await listAiDrafts(c.env.DB, examId, runId);
  return c.json(ok(drafts));
});

kegiatan.get('/events/:eventId/exams/:examId/ai/drafts', requirePermission('kegiatan.event.read'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const runId = c.req.query('run_id');
  const drafts = await listAiDrafts(c.env.DB, examId, runId);
  return c.json(ok(drafts));
});

kegiatan.put('/exams/:id/ai/drafts/:draftId', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const draftId = c.req.param('draftId');
  const body = await c.req.json<any>();

  const result = await updateAiDraft(c.env.DB, examId, draftId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

kegiatan.put('/events/:eventId/exams/:examId/ai/drafts/:draftId', requirePermission('kegiatan.event.update'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const draftId = c.req.param('draftId');
  const body = await c.req.json<any>();

  const result = await updateAiDraft(c.env.DB, examId, draftId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

kegiatan.delete('/exams/:id/ai/drafts/:draftId', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const draftId = c.req.param('draftId');
  const result = await deleteAiDraft(c.env.DB, examId, draftId);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

kegiatan.delete('/events/:eventId/exams/:examId/ai/drafts/:draftId', requirePermission('kegiatan.event.update'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const draftId = c.req.param('draftId');
  const result = await deleteAiDraft(c.env.DB, examId, draftId);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

kegiatan.post('/exams/:id/ai/drafts/accept', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const check = await assertKegiatanAiAccess(c, examId);
  if (!check.ok) return check.response;

  const body = await c.req.json<{ draft_ids?: string[]; draftIds?: string[] }>();
  const draftIds = body.draft_ids || body.draftIds || [];

  const result = await acceptAiDrafts(c.env.DB, examId, draftIds);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 200);
});

kegiatan.post('/events/:eventId/exams/:examId/ai/drafts/accept', requirePermission('kegiatan.event.update'), async (c) => {
  const eventId = c.req.param('eventId');
  const examId = c.req.param('examId');
  const check = await assertKegiatanAiAccess(c, examId, eventId);
  if (!check.ok) return check.response;

  const body = await c.req.json<{ draft_ids?: string[]; draftIds?: string[] }>();
  const draftIds = body.draft_ids || body.draftIds || [];

  const result = await acceptAiDrafts(c.env.DB, examId, draftIds);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 200);
});

// ── Results & Monitoring Endpoints for Kegiatan ──────────────

async function assertKegiatanExam(db: D1Database, examId: string) {
  const exam = await db.prepare(
    `SELECT e.id, e.event_id, ev.mode FROM cbt_exams e
     JOIN cbt_events ev ON ev.id = e.event_id
     WHERE e.id = ?`
  ).bind(examId).first<any>();
  if (!exam) throw new Error('Ujian tidak ditemukan');
  if (exam.mode !== 'kegiatan') throw new Error('Ujian bukan merupakan domain Kegiatan');
  return exam;
}

kegiatan.get('/exams/:id/results', requirePermission(['kegiatan.event.read', 'kegiatan.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const results = await getExamResults(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal memuat hasil ujian'), 400);
  }
});

kegiatan.get('/exams/:id/results-export', requirePermission(['kegiatan.event.read', 'kegiatan.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const results = await getExamResultsExport(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal memuat export hasil ujian'), 400);
  }
});

kegiatan.get('/exams/:id/sessions', requirePermission(['kegiatan.event.read', 'kegiatan.access']), async (c) => {
  const examId = c.req.param('id');
  const roomId = c.req.query('room_id') || null;
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const sessions = await getExamSessions(c.env.DB, examId, roomId);
    return c.json(ok(sessions));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal memuat sesi ujian'), 400);
  }
});

kegiatan.get('/exams/:id/question-analytics', requirePermission(['kegiatan.event.read', 'kegiatan.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const analytics = await getExamQuestionAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal memuat analitik soal'), 400);
  }
});

kegiatan.post('/exams/:id/results/recompute-missing', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const result = await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(result, result.repaired > 0
      ? `${result.repaired} hasil peserta berhasil dipulihkan`
      : 'Tidak ada hasil hilang yang perlu dipulihkan'));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal menghitung ulang hasil ujian'), 400);
  }
});

kegiatan.delete('/exams/:id/results/:sessionId', requirePermission('kegiatan.event.update'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    await assertKegiatanExam(c.env.DB, examId);
    const result = await deleteExamResult(c.env.DB, examId, sessionId);
    return c.json(ok(result.data, result.message));
  } catch (e: any) {
    return c.json(err(e?.message || 'Gagal menghapus hasil ujian'), 400);
  }
});

export default kegiatan;

