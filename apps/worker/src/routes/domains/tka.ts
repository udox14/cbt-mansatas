// ============================================================
// TKA Domain — HTTP Router
//
// Mounts all TKA domain endpoints under /api/tka with:
// 1. Strict server-side RBAC evaluation (tka.* permissions)
// 2. Strict event.mode === 'tka' domain isolation & IDOR guards
// 3. Delegation of shared operations to Phase 2 exam engine
// 4. Exact compliance with shared view contracts (apiPrefix="/api/tka")
// ============================================================

import { Hono } from 'hono';
import type { Env, EventStatus } from '../../types.ts';
import { authMiddleware } from '../../middleware/auth.ts';
import { requirePermission } from '../../middleware/rbac.ts';
import { ok, err, newId } from '../../utils/helpers.ts';
import {
  listTkaAcademicYears,
  previewTkaParticipants,
} from '../../services/sources/tka.ts';
import {
  listTkaEvents,
  getTkaEventById,
  createTkaEvent,
  updateTkaEvent,
  transitionTkaEventStatus,
  deleteTkaEvent,
  assertTkaEvent,
  DomainMismatchError,
  EventFrozenError,
} from '../../services/domains/tka/events.ts';
import {
  snapshotTkaParticipants,
  syncTkaParticipants,
  assignParticipantRoom,
  bulkAssignParticipantRooms,
  generateTkaExamRosters,
} from '../../services/domains/tka/snapshot.ts';
import {
  listTkaExams,
  getTkaSubjectCoverage,
  createTkaExam,
  batchCreateCoveredTkaExams,
  deleteTkaExam,
} from '../../services/domains/tka/exams.ts';
import { checkTkaEventReadiness } from '../../services/domains/tka/readiness.ts';

// Shared Engine Services
import {
  listExamQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  bulkCreateQuestions,
} from '../../services/exam-engine/questions.ts';
import {
  listExamTokens,
  generateExamTokens,
  setExamTokenCode,
  toggleTokenActive,
} from '../../services/exam-engine/tokens.ts';
import {
  getExamSessions,
  unlockExamSession,
  resetSessionDevice,
  forceSubmitSession,
} from '../../services/exam-engine/monitoring.ts';
import {
  getExamResults,
  getExamResultsExport,
  deleteExamResult,
} from '../../services/exam-engine/results.ts';
import {
  getExamQuestionAnalytics,
} from '../../services/exam-engine/analytics.ts';
import { recomputeMissingExamResults } from '../../services/exam-engine/scoring.ts';
import { listRooms } from '../../services/exam-engine/rooms.ts';

const tka = new Hono<{ Bindings: Env }>();

// ── Base Authentication & Student Exclusion ──────────────────
tka.use('*', authMiddleware);

tka.use('*', async (c, next) => {
  const user = c.get('user');
  if (
    user?.role === 'student' ||
    (user?.roles?.includes('student') && !user?.roles?.includes('admin'))
  ) {
    return c.json(err('Akses ditolak: siswa tidak diizinkan mengakses administrasi TKA'), 403);
  }
  await next();
});

function handleDomainError(e: any, c: any) {
  if (e instanceof DomainMismatchError) {
    return c.json(err(e.message), 400);
  }
  if (e instanceof EventFrozenError) {
    return c.json(err(e.message), 409);
  }
  console.error('TKA domain error:', e);
  return c.json(err(e?.message || 'Terjadi kesalahan pada domain TKA'), 500);
}

/**
 * Asserts that an exam belongs to mode 'tka' and optionally matches an eventId.
 */
async function assertTkaExam(db: D1Database, examId: string, eventId?: string) {
  const exam = await db
    .prepare("SELECT * FROM cbt_exams WHERE id = ? AND mode = 'tka'")
    .bind(examId)
    .first<any>();

  if (!exam) {
    throw new DomainMismatchError('Ujian tidak ditemukan atau bukan merupakan domain TKA');
  }

  if (eventId && exam.event_id !== eventId) {
    throw new DomainMismatchError('Ujian tidak cocok dengan event TKA yang ditentukan');
  }

  return exam;
}

// ── 1. Academic Years & Event Management ──────────────────────

tka.get('/academic-years', requirePermission('tka.access'), async (c) => {
  if (!c.env.MANSATAS_DB) return c.json(ok([]));
  const years = await listTkaAcademicYears(c.env.MANSATAS_DB);
  return c.json(ok(years));
});

tka.get('/events', requirePermission('tka.access'), async (c) => {
  const status = c.req.query('status') as EventStatus | undefined;
  const ayId = c.req.query('academic_year_id') as string | undefined;
  const events = await listTkaEvents(c.env.DB, { status, academic_year_id: ayId });
  return c.json(ok(events));
});

tka.post('/events', requirePermission('tka.event.manage'), async (c) => {
  if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
  const body = await c.req.json<any>();
  const user = c.get('user');
  const result = await createTkaEvent(c.env.DB, c.env.MANSATAS_DB, body, user.sub || user.staff_id || 'system');
  if (!result.success) {
    return c.json(err(result.error || 'Gagal membuat event TKA'), 400);
  }
  return c.json(ok({ id: result.id }, 'Event TKA berhasil dibuat'), 201);
});

tka.get('/events/:id', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const event = await getTkaEventById(c.env.DB, eventId);
    return c.json(ok(event));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.put('/events/:id', requirePermission('tka.event.manage'), async (c) => {
  if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
  const eventId = c.req.param('id');
  const body = await c.req.json<any>();
  try {
    const result = await updateTkaEvent(c.env.DB, c.env.MANSATAS_DB, eventId, body);
    if (!result.success) return c.json(err(result.error || 'Gagal memperbarui event TKA'), 400);
    return c.json(ok(null, 'Event TKA berhasil diperbarui'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.delete('/events/:id', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const result = await deleteTkaEvent(c.env.DB, eventId);
    if (!result.success) return c.json(err(result.error || 'Gagal menghapus event TKA'), 409);
    return c.json(ok(null, 'Event TKA berhasil dihapus'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

const handleStatusChange = async (c: any) => {
  const eventId = c.req.param('id');
  const body = (await c.req.json()) as any;
  const targetStatus = body?.status as EventStatus;
  if (!targetStatus) return c.json(err('Status target wajib diisi'), 400);

  try {
    const result = await transitionTkaEventStatus(c.env.DB, eventId, targetStatus);
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || 'Gagal mengubah status event TKA',
          readiness: result.readiness,
        },
        400
      );
    }
    return c.json(ok({ id: eventId, status: targetStatus }, `Status event TKA diubah menjadi ${targetStatus}`));
  } catch (e) {
    return handleDomainError(e, c);
  }
};

tka.put('/events/:id/status', requirePermission('tka.event.manage'), handleStatusChange);
tka.post('/events/:id/status', requirePermission('tka.event.manage'), handleStatusChange);

tka.get('/events/:id/readiness', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const readiness = await checkTkaEventReadiness(c.env.DB, eventId, c.env.MANSATAS_DB);
    return c.json(ok(readiness));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 2. Participant Preview, Snapshot & Diff Sync ─────────────

tka.get('/events/:id/participants/preview', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const event = await assertTkaEvent(c.env.DB, eventId);
    if (!c.env.MANSATAS_DB) {
      return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    }
    if (!event.academic_year_id) {
      return c.json(err('Event TKA belum memiliki tahun ajaran terhubung'), 400);
    }
    const preview = await previewTkaParticipants(c.env.MANSATAS_DB, event.academic_year_id);
    return c.json(ok(preview));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/participants/snapshot', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    const result = await snapshotTkaParticipants(c.env.DB, c.env.MANSATAS_DB, eventId);
    return c.json(
      ok(result, `Berhasil snapshot ${result.total} siswa (${result.added} baru, ${result.updated} diperbarui)`)
    );
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/participants/sync', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    const result = await syncTkaParticipants(c.env.DB, c.env.MANSATAS_DB, eventId);
    return c.json(
      ok(
        result,
        `Sinkronisasi selesai: ${result.added} ditambah, ${result.removed} dihapus, ${result.updated} diperbarui, ${result.unchanged} tidak berubah`
      )
    );
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/events/:id/participants', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  const statusFilter = c.req.query('status');
  const classFilter = c.req.query('class_id');
  try {
    await assertTkaEvent(c.env.DB, eventId);
    let sql = 'SELECT * FROM cbt_tka_participants WHERE event_id = ?';
    const params: any[] = [eventId];

    if (statusFilter) {
      sql += ' AND validation_status = ?';
      params.push(statusFilter);
    }
    if (classFilter) {
      sql += ' AND class_id = ?';
      params.push(classFilter);
    }

    sql += ' ORDER BY class_name ASC, nama_lengkap ASC';
    const { results } = await c.env.DB.prepare(sql).bind(...params).all<any>();
    return c.json(ok(results || []));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/events/:id/rooms', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    await assertTkaEvent(c.env.DB, eventId);
    const rooms = await listRooms(c.env.DB, { event_id: eventId });
    return c.json(ok(rooms));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/rooms/assign', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const body = await c.req.json();
    const { student_id, room_id } = body;
    if (!student_id) return c.json(err('student_id wajib diisi'), 400);
    const res = await assignParticipantRoom(c.env.DB, eventId, student_id, room_id || null);
    if (!res.success) return c.json(err(res.error || 'Gagal alokasi ruangan'), 400);
    return c.json(ok({ success: true, message: 'Ruangan berhasil dialokasikan' }));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/rooms/bulk-assign', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const body = await c.req.json();
    const assignments = body.assignments;
    if (!Array.isArray(assignments)) {
      return c.json(err('assignments wajib berupa array'), 400);
    }
    const res = await bulkAssignParticipantRooms(c.env.DB, eventId, assignments);
    return c.json(ok({ success: true, updated: res.updated, message: 'Alokasi ruangan massal berhasil' }));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 3. Subject Coverage & Subject Exams ───────────────────────

tka.get('/events/:id/subject-coverage', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    const coverage = await getTkaSubjectCoverage(c.env.DB, c.env.MANSATAS_DB, eventId);
    return c.json(ok(coverage));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/events/:id/exams', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const exams = await listTkaExams(c.env.DB, eventId);
    return c.json(ok(exams));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/exams', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<any>();
  const user = c.get('user');
  try {
    if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    const result = await createTkaExam(
      c.env.DB,
      c.env.MANSATAS_DB,
      eventId,
      body,
      user.sub || user.staff_id || 'system'
    );
    if (!result.success) return c.json(err(result.error || 'Gagal membuat ujian mapel TKA'), 409);
    return c.json(ok({ id: result.id }, 'Ujian mapel TKA berhasil dibuat'), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/exams/batch-create', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  const user = c.get('user');
  try {
    if (!c.env.MANSATAS_DB) return c.json(err('MANSATAS_DB binding tidak tersedia'), 500);
    const result = await batchCreateCoveredTkaExams(
      c.env.DB,
      c.env.MANSATAS_DB,
      eventId,
      user.sub || user.staff_id || 'system'
    );
    return c.json(
      ok(result, `Batch create selesai: ${result.created} ujian dibuat, ${result.skipped} dilewati`)
    );
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.delete('/events/:id/exams/:examId', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  const examId = c.req.param('examId');
  try {
    const result = await deleteTkaExam(c.env.DB, eventId, examId);
    if (!result.success) return c.json(err(result.error || 'Gagal menghapus ujian mapel TKA'), 409);
    return c.json(ok(null, 'Ujian mapel TKA berhasil dihapus'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/roster/generate', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  try {
    const result = await generateTkaExamRosters(c.env.DB, eventId);
    return c.json(ok(result, `Roster berhasil dibuat: ${result.created} entri penugasan`));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 4. Rooms & Seating (Simple Manual / Bulk Assignment) ──────

tka.get('/events/:id/rooms', requirePermission('tka.access'), async (c) => {
  const eventId = c.req.param('id');
  try {
    await assertTkaEvent(c.env.DB, eventId);
    const { results: rooms } = await c.env.DB.prepare(
      `SELECT r.id, r.room_name, r.capacity,
              COUNT(DISTINCT p.id) as participant_count
       FROM cbt_rooms r
       LEFT JOIN cbt_tka_participants p ON r.id = p.room_id AND p.event_id = ?
       GROUP BY r.id
       ORDER BY r.room_name ASC`
    )
      .bind(eventId)
      .all<any>();

    return c.json(ok(rooms || []));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/rooms/assign', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<{ student_id: string; room_id: string | null }>();
  if (!body.student_id) return c.json(err('student_id wajib diisi'), 400);

  try {
    const result = await assignParticipantRoom(c.env.DB, eventId, body.student_id, body.room_id);
    if (!result.success) return c.json(err(result.error || 'Gagal mengalokasikan ruangan'), 400);
    return c.json(ok(null, 'Ruangan berhasil dialokasikan'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/events/:id/rooms/bulk-assign', requirePermission('tka.event.manage'), async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<{ assignments: Array<{ student_id: string; room_id: string | null }> }>();
  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    return c.json(err('Daftar penugasan ruangan wajib diisi'), 400);
  }

  try {
    const result = await bulkAssignParticipantRooms(c.env.DB, eventId, body.assignments);
    return c.json(ok(result, `Berhasil mengalokasikan ${result.updated} siswa ke ruangan`));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 5. Shared UI/API Contracts (apiPrefix="/api/tka") ─────────
// Exact delegation to shared engine matching QuestionsView, TokensView,
// MonitorView, ResultsView, AnalyticsView

// ── Questions ──
tka.get('/exams/:id/questions', requirePermission('tka.access'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const questions = await listExamQuestions(c.env.DB, examId);
    return c.json(ok(questions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/questions', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const body = await c.req.json<any>();
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await createQuestion(c.env.DB, examId, body);
    return c.json(ok(result.data, result.message), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/questions/bulk', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const body = await c.req.json<any>();
  try {
    await assertTkaExam(c.env.DB, examId);
    const items = Array.isArray(body) ? body : body.questions;
    if (!Array.isArray(items) || items.length === 0) {
      return c.json(err('Data butir soal bulk import tidak valid'), 400);
    }
    const result = await bulkCreateQuestions(c.env.DB, examId, items);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal mengimpor soal'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.put('/questions/:qId', requirePermission('tka.event.manage'), async (c) => {
  const qId = c.req.param('qId');
  const body = await c.req.json<any>();
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?')
      .bind(qId)
      .first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertTkaExam(c.env.DB, qRow.exam_id);

    const result = await updateQuestion(c.env.DB, qId, body);
    if (!result.success) return c.json(err(result.error || 'Gagal memperbarui soal'), 400);
    return c.json(ok(null, 'Soal berhasil diperbarui'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.delete('/questions/:qId', requirePermission('tka.event.manage'), async (c) => {
  const qId = c.req.param('qId');
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?')
      .bind(qId)
      .first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertTkaExam(c.env.DB, qRow.exam_id);

    const result = await deleteQuestion(c.env.DB, qId);
    return c.json(ok(null, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── Upload ──
tka.post('/upload', requirePermission('tka.event.manage'), async (c) => {
  try {
    const formData = await c.req.parseBody();
    const examId = formData['exam_id'] as string;
    const file = formData['file'] as File;

    if (!file) return c.json(err('File wajib diunggah'), 400);
    if (examId) {
      await assertTkaExam(c.env.DB, examId);
    }

    const ext = file.name.split('.').pop() || 'bin';
    const key = `tka-media/${newId()}.${ext}`;
    const buffer = await file.arrayBuffer();

    await c.env.R2.put(key, buffer, {
      httpMetadata: { contentType: file.type },
    });

    const url = `/r2/${key}`;
    return c.json(ok({ url }, 'File berhasil diunggah'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── Tokens ──
tka.get('/exams/:id/tokens', requirePermission('tka.access'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const tokens = await listExamTokens(c.env.DB, examId);
    return c.json(ok(tokens));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/tokens/generate', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await generateExamTokens(c.env.DB, examId, body);
    if (!result.success) return c.json(err(result.error || 'Gagal generate token'), (result.status as any) || 400);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/tokens/set-code', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const body = await c.req.json<{ token_code?: string }>();
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await setExamTokenCode(c.env.DB, examId, body.token_code);
    if (!result.success) return c.json(err(result.error || 'Gagal set token manual'), (result.status as any) || 400);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/tokens/:tokenId/active', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const tokenId = c.req.param('tokenId');
  const body = await c.req.json<{ is_active?: number }>();
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await toggleTokenActive(c.env.DB, examId, tokenId, body.is_active ?? 1);
    if (!result.success) return c.json(err(result.error || 'Gagal toggle token'), (result.status as any) || 400);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.put('/exams/:id/tokens/:tokenId/toggle', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const tokenId = c.req.param('tokenId');
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await toggleTokenActive(c.env.DB, examId, tokenId, body?.is_active);
    if (!result.success) return c.json(err(result.error || 'Gagal toggle token'), (result.status as any) || 400);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── Live Monitoring & Proctor Actions ──
tka.get('/exams/:id/sessions', requirePermission('tka.access'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const sessions = await getExamSessions(c.env.DB, examId);
    return c.json(ok(sessions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/exams/:id/monitoring', requirePermission('tka.access'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const sessions = await getExamSessions(c.env.DB, examId);
    return c.json(ok(sessions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/sessions/:sId/unlock', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sId');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await unlockExamSession(c.env.DB, sessionId);
    if (!result.success) return c.json(err(result.error || 'Gagal membuka kunci sesi'), 400);
    return c.json(ok(null, 'Sesi ujian berhasil dibuka'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/sessions/:sId/reset', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sId');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await resetSessionDevice(c.env.DB, sessionId);
    if (!result.success) return c.json(err(result.error || 'Gagal mereset perangkat sesi'), 400);
    return c.json(ok(null, 'Device lock berhasil direset'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/sessions/:sId/force-submit', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sId');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await forceSubmitSession(c.env.DB, sessionId);
    if (!result.success) return c.json(err(result.error || 'Gagal force submit sesi'), 400);
    return c.json(ok(null, 'Sesi ujian berhasil disubmit paksa'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/sessions/:sessionId/extend', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ minutes?: number }>().catch(() => ({} as { minutes?: number }));
  const minutes = Math.max(1, Math.min(120, Number(body.minutes || 15)));
  try {
    await assertTkaExam(c.env.DB, examId);
    const session = await c.env.DB.prepare(
      'SELECT id, started_at FROM cbt_exam_sessions WHERE id = ? AND exam_id = ?'
    ).bind(sessionId, examId).first<any>();

    if (!session) {
      return c.json(err('Sesi tidak ditemukan'), 404);
    }

    const currentStartedMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const adjustedStartedAt = new Date(currentStartedMs + minutes * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      `UPDATE cbt_exam_sessions
       SET started_at = ?, is_time_locked = 0, locked_at = NULL, last_heartbeat = datetime('now')
       WHERE id = ? AND exam_id = ?`
    ).bind(adjustedStartedAt, sessionId, examId).run();

    return c.json(ok({ added_minutes: minutes }, `Waktu sesi peserta berhasil diperpanjang ${minutes} menit`));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── Results & Analytics ──
tka.get('/exams/:id/results', requirePermission(['tka.results.read', 'tka.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const results = await getExamResults(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/exams/:id/results-export', requirePermission(['tka.results.read', 'tka.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const results = await getExamResultsExport(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/results/recompute-missing', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(result, result.repaired > 0
      ? `${result.repaired} hasil peserta berhasil dipulihkan`
      : 'Tidak ada hasil hilang yang perlu dipulihkan'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.post('/exams/:id/recover', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(result, 'Nilai berhasil dihitung ulang'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.delete('/exams/:id/results/:sessionId', requirePermission('tka.event.manage'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    await assertTkaExam(c.env.DB, examId);
    const result = await deleteExamResult(c.env.DB, examId, sessionId);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/exams/:id/question-analytics', requirePermission(['tka.results.read', 'tka.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const analytics = await getExamQuestionAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

tka.get('/exams/:id/analytics', requirePermission(['tka.results.read', 'tka.access']), async (c) => {
  const examId = c.req.param('id');
  try {
    await assertTkaExam(c.env.DB, examId);
    const analytics = await getExamQuestionAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

export default tka;
