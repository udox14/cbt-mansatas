// ============================================================
// Semester Domain — HTTP Router
//
// Mounts all Semester domain endpoints under /api/semester with:
// 1. Strict server-side RBAC evaluation (semester.* permissions)
// 2. Strict event.mode === 'semester' domain isolation & IDOR guards
// 3. Multi-grade participant snapshot & resync
// 4. Multi-class academic audience mapping & roster materialization
// 5. Discrete time slot & non-overlapping schedule management
// 6. Delegation of shared engine operations (questions, tokens, monitoring, results)
// ============================================================

import { Hono } from 'hono';
import type { Env, EventStatus } from '../../types.ts';
import { authMiddleware } from '../../middleware/auth.ts';
import { requirePermission } from '../../middleware/rbac.ts';
import { ok, err, newId } from '../../utils/helpers.ts';

// Domain Services
import {
  listSemesterEvents,
  getSemesterEventById,
  createSemesterEvent,
  updateSemesterEvent,
  transitionSemesterEventStatus,
  deleteSemesterEvent,
  assertSemesterEvent,
  DomainMismatchError,
  EventFrozenError,
} from '../../services/domains/semester/events.ts';
import {
  snapshotSemesterParticipants,
  listSemesterParticipants,
  assignSemesterParticipantRooms,
  generateSemesterParticipantNumbers,
} from '../../services/domains/semester/snapshot.ts';
import {
  listSemesterExams,
  getSemesterExamById,
  createSemesterExam,
  updateSemesterExam,
  deleteSemesterExam,
} from '../../services/domains/semester/exams.ts';
import {
  discoverAvailableClasses,
  listSemesterExamClasses,
  assignSemesterExamClasses,
  materializeSemesterExamRoster,
  materializeAllSemesterRosters,
} from '../../services/domains/semester/audience.ts';
import {
  listSemesterSlots,
  createSemesterSlot,
  updateSemesterSlot,
  deleteSemesterSlot,
  listSemesterSchedules,
  assignSemesterExamSlot,
  removeSemesterExamSlot,
  detectSemesterParticipantConflicts,
  ScheduleConflictError,
} from '../../services/domains/semester/scheduling.ts';
import { checkSemesterEventReadiness } from '../../services/domains/semester/readiness.ts';

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
import { getExamQuestionAnalytics } from '../../services/exam-engine/analytics.ts';
import { recomputeMissingExamResults } from '../../services/exam-engine/scoring.ts';
import { listRooms, createRoom } from '../../services/exam-engine/rooms.ts';
import automationRoutes from './semester-automation.ts';
import proctorRoutes from './semester-proctor.ts';

const semester = new Hono<{ Bindings: Env }>();

// ── Base Authentication & Student Exclusion ──────────────────
semester.use('*', authMiddleware);

semester.use('*', async (c, next) => {
  const user = c.get('user');
  if (
    user?.role === 'student' ||
    (user?.roles?.includes('student') && !user?.roles?.includes('admin'))
  ) {
    return c.json(err('Akses ditolak: siswa tidak diizinkan mengakses administrasi Semester'), 403);
  }
  await next();
});

// ── Mount Phase 7 Sub-Routers ────────────────────────────────
semester.route('/', automationRoutes);
semester.route('/proctor', proctorRoutes);

function handleDomainError(e: any, c: any) {
  if (e instanceof DomainMismatchError) {
    return c.json(err(e.message), 400);
  }
  if (e instanceof EventFrozenError) {
    return c.json(err(e.message), 409);
  }
  if (e instanceof ScheduleConflictError) {
    return c.json(err(e.message), 409);
  }
  const msg = e instanceof Error ? e.message : 'Terjadi kesalahan sistem';
  return c.json(err(msg), 500);
}

// ── 1. Event Management ──────────────────────────────────────

semester.get('/academic-years', requirePermission('semester.access'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(ok([]));
    }
    const { results } = await c.env.MANSATAS_DB
      .prepare(
        `SELECT id, nama, semester, is_active
         FROM tahun_ajaran
         ORDER BY is_active DESC, nama DESC`
      )
      .all<any>();
    return c.json(ok(results || []));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/subjects', requirePermission('semester.access'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const grade = c.req.query('grade');
    let sql = 'SELECT id, nama_mapel, kode_mapel, tingkat FROM mata_pelajaran';
    const params: any[] = [];
    if (grade) {
      sql += ' WHERE tingkat IS NULL OR tingkat = ?';
      params.push(grade);
    }
    sql += ' ORDER BY nama_mapel ASC';
    const { results } = await c.env.MANSATAS_DB.prepare(sql).bind(...params).all<any>();
    return c.json(ok(results || []));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events', requirePermission('semester.access'), async (c) => {
  try {
    const status = c.req.query('status') as EventStatus | undefined;
    const academicYearId = c.req.query('academic_year_id') || undefined;
    const activityType = c.req.query('activity_type') || undefined;

    const events = await listSemesterEvents(c.env.DB, {
      status,
      academic_year_id: academicYearId,
      activity_type: activityType,
    });
    return c.json(ok(events));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get('user');
    const event = await createSemesterEvent(c.env.DB, body, user?.sub);
    return c.json(ok(event, 'Event semester berhasil dibuat'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id', requirePermission('semester.access'), async (c) => {
  try {
    const event = await getSemesterEventById(c.env.DB, c.req.param('id'));
    return c.json(ok(event));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/events/:id', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json();
    const updated = await updateSemesterEvent(c.env.DB, c.req.param('id'), body);
    return c.json(ok(updated, 'Konfigurasi event semester berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/events/:id', requirePermission('semester.event.manage'), async (c) => {
  try {
    await deleteSemesterEvent(c.env.DB, c.req.param('id'));
    return c.json(ok({ deleted: true }, 'Event semester berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/status', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json<{ status: EventStatus }>();
    if (!body?.status) {
      return c.json(err('Parameter status wajib diisi'), 400);
    }
    const result = await transitionSemesterEventStatus(c.env.DB, c.req.param('id'), body.status);
    return c.json(ok(result, `Status event semester berhasil diubah menjadi '${body.status}'`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id/readiness', requirePermission('semester.access'), async (c) => {
  try {
    const readiness = await checkSemesterEventReadiness(c.env.DB, c.req.param('id'));
    return c.json(ok(readiness));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 2. Participant Snapshot & Room Assignment ────────────────

semester.get('/events/:id/participants', requirePermission('semester.access'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const grade = c.req.query('grade') || undefined;
    const classId = c.req.query('class_id') || undefined;
    const roomId = c.req.query('room_id') || undefined;
    const q = c.req.query('q') || undefined;
    const page = c.req.query('page') ? Number(c.req.query('page')) : undefined;
    const pageSize = c.req.query('page_size') ? Number(c.req.query('page_size')) : undefined;

    const result = await listSemesterParticipants(c.env.DB, eventId, {
      grade,
      class_id: classId,
      room_id: roomId,
      q,
      page,
      page_size: pageSize,
    });
    return c.json(ok(result));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/participants/snapshot', requirePermission('semester.event.manage'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const body = await c.req.json<{ grades?: string[] }>().catch(() => ({}));
    const summary = await snapshotSemesterParticipants(
      c.env.DB,
      c.env.MANSATAS_DB,
      c.req.param('id'),
      body
    );
    return c.json(ok(summary, 'Snapshot peserta semester berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/participants/rooms', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json<{ assignments: { participant_id: string; room_id: string | null }[] }>();
    if (!body?.assignments || !Array.isArray(body.assignments)) {
      return c.json(err('Parameter assignments array wajib diisi'), 400);
    }
    const result = await assignSemesterParticipantRooms(c.env.DB, c.req.param('id'), body.assignments);
    return c.json(ok(result, `${result.updatedCount} peserta berhasil ditetapkan ruangannya`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/participants/generate-numbers', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { prefix?: string };
    const result = await generateSemesterParticipantNumbers(
      c.env.DB,
      c.req.param('id'),
      body.prefix || 'SEM'
    );
    return c.json(ok(result, `${result.totalNumbered} nomor peserta berhasil digenerate`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 3. Exam Management ───────────────────────────────────────

semester.get('/events/:id/exams', requirePermission('semester.access'), async (c) => {
  try {
    const exams = await listSemesterExams(c.env.DB, c.req.param('id'));
    return c.json(ok(exams));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/exams', requirePermission('semester.event.manage'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const body = await c.req.json();
    const user = c.get('user');
    const exam = await createSemesterExam(
      c.env.DB,
      c.env.MANSATAS_DB,
      c.req.param('id'),
      body,
      user?.sub
    );
    return c.json(ok(exam, 'Ujian semester berhasil dibuat'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id/exams/:examId', requirePermission('semester.access'), async (c) => {
  try {
    const exam = await getSemesterExamById(c.env.DB, c.req.param('id'), c.req.param('examId'));
    return c.json(ok(exam));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/events/:id/exams/:examId', requirePermission('semester.event.manage'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const body = await c.req.json();
    const updated = await updateSemesterExam(
      c.env.DB,
      c.env.MANSATAS_DB,
      c.req.param('id'),
      c.req.param('examId'),
      body
    );
    return c.json(ok(updated, 'Ujian semester berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/events/:id/exams/:examId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await deleteSemesterExam(c.env.DB, c.req.param('id'), c.req.param('examId'));
    return c.json(ok({ deleted: true }, 'Ujian semester berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 4. Academic Audience & Roster ────────────────────────────

semester.get('/events/:id/classes/discover', requirePermission('semester.access'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const grade = c.req.query('grade') || '10';
    const subjectId = c.req.query('subject_id') || undefined;
    const event = await assertSemesterEvent(c.env.DB, c.req.param('id'));
    const classes = await discoverAvailableClasses(
      c.env.MANSATAS_DB,
      grade,
      subjectId,
      event.academic_year_id || undefined
    );
    return c.json(ok(classes));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id/exams/:examId/classes', requirePermission('semester.access'), async (c) => {
  try {
    const classes = await listSemesterExamClasses(c.env.DB, c.req.param('id'), c.req.param('examId'));
    return c.json(ok(classes));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/exams/:examId/classes', requirePermission('semester.event.manage'), async (c) => {
  try {
    if (!c.env.MANSATAS_DB) {
      return c.json(err('Binding database Mansatas (MANSATAS_DB) belum terkonfigurasi'), 500);
    }
    const body = await c.req.json<{ class_ids: string[] }>();
    if (!body?.class_ids || !Array.isArray(body.class_ids)) {
      return c.json(err('Parameter class_ids array wajib diisi'), 400);
    }
    const result = await assignSemesterExamClasses(
      c.env.DB,
      c.env.MANSATAS_DB,
      c.req.param('id'),
      c.req.param('examId'),
      body.class_ids
    );
    return c.json(ok(result, `${result.assignedCount} kelas berhasil ditetapkan sebagai cakupan ujian`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/generate-rosters', requirePermission('semester.event.manage'), async (c) => {
  try {
    const result = await materializeAllSemesterRosters(c.env.DB, c.req.param('id'));
    return c.json(ok(result, `Roster berhasil dibuat: ${result.totalRosterEntries} entri untuk ${result.totalExamsProcessed} ujian`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/exams/:examId/materialize-roster', requirePermission('semester.event.manage'), async (c) => {
  try {
    const result = await materializeSemesterExamRoster(c.env.DB, c.req.param('id'), c.req.param('examId'));
    return c.json(ok(result, `Roster ujian berhasil disinkronkan (${result.enrolledCount} peserta aktif)`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 5. Time Slots & Schedules ────────────────────────────────

semester.get('/events/:id/slots', requirePermission('semester.access'), async (c) => {
  try {
    const slots = await listSemesterSlots(c.env.DB, c.req.param('id'));
    return c.json(ok(slots));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/slots', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json();
    const slot = await createSemesterSlot(c.env.DB, c.req.param('id'), body);
    return c.json(ok(slot, 'Sesi waktu berhasil dibuat'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/events/:id/slots/:slotId', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json();
    const updated = await updateSemesterSlot(c.env.DB, c.req.param('id'), c.req.param('slotId'), body);
    return c.json(ok(updated, 'Sesi waktu berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/events/:id/slots/:slotId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await deleteSemesterSlot(c.env.DB, c.req.param('id'), c.req.param('slotId'));
    return c.json(ok({ deleted: true }, 'Sesi waktu berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id/schedules', requirePermission('semester.access'), async (c) => {
  try {
    const schedules = await listSemesterSchedules(c.env.DB, c.req.param('id'));
    return c.json(ok(schedules));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/schedules', requirePermission('semester.event.manage'), async (c) => {
  try {
    const body = await c.req.json<{ exam_id: string; slot_id: string }>();
    if (!body?.exam_id || !body?.slot_id) {
      return c.json(err('exam_id dan slot_id wajib diisi'), 400);
    }
    const schedule = await assignSemesterExamSlot(c.env.DB, c.req.param('id'), body.exam_id, body.slot_id);
    return c.json(ok(schedule, 'Ujian berhasil dijadwalkan ke sesi'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/events/:id/schedules/:schedId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await removeSemesterExamSlot(c.env.DB, c.req.param('id'), c.req.param('schedId'));
    return c.json(ok({ deleted: true }, 'Jadwal ujian berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/events/:id/conflicts', requirePermission('semester.access'), async (c) => {
  try {
    const conflicts = await detectSemesterParticipantConflicts(c.env.DB, c.req.param('id'));
    return c.json(ok(conflicts));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 6. Rooms ─────────────────────────────────────────────────

semester.get('/events/:id/rooms', requirePermission('semester.access'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    // Fetch global rooms or rooms bound to this event
    const { results } = await c.env.DB
      .prepare('SELECT * FROM cbt_rooms WHERE event_id IS NULL OR event_id = ? ORDER BY room_name ASC')
      .bind(eventId)
      .all();
    return c.json(ok(results || []));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/events/:id/rooms', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const body = await c.req.json<{ room_name: string; capacity?: number; is_global?: boolean }>();
    if (!body?.room_name?.trim()) {
      return c.json(err('room_name wajib diisi'), 400);
    }
    const room = await createRoom(c.env.DB, {
      room_name: body.room_name.trim(),
      capacity: body.capacity || 40,
      event_id: body.is_global ? undefined : eventId,
    });
    return c.json(ok(room, 'Ruangan berhasil ditambahkan'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 7. Shared Examination Engine Integrations ────────────────

// Helper to assert exam belongs to semester event
async function assertExamInSemesterEvent(db: D1Database, examId: string) {
  const exam = await db
    .prepare(
      `SELECT e.*, ev.mode as event_mode
       FROM cbt_exams e
       LEFT JOIN cbt_events ev ON e.event_id = ev.id
       WHERE e.id = ?`
    )
    .bind(examId)
    .first<any>();

  if (!exam) throw new Error('Ujian tidak ditemukan');
  if (exam.mode !== 'semester' && exam.event_mode !== 'semester') {
    throw new DomainMismatchError('Ujian bukan merupakan domain Semester');
  }
  return exam;
}

// Questions
semester.get('/exams/:id/questions', requirePermission('semester.access'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const questions = await listExamQuestions(c.env.DB, c.req.param('id'));
    return c.json(ok(questions));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/questions', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json();
    const created = await createQuestion(c.env.DB, c.req.param('id'), body);
    return c.json(ok(created, 'Soal berhasil ditambahkan'), 201);
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/exams/:id/questions/:qId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json();
    const updated = await updateQuestion(c.env.DB, c.req.param('qId'), body);
    return c.json(ok(updated, 'Soal berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/exams/:id/questions/:qId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await deleteQuestion(c.env.DB, c.req.param('qId'));
    return c.json(ok({ deleted: true }, 'Soal berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/questions/bulk', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json();
    const questions = Array.isArray(body) ? body : body?.questions;
    if (!Array.isArray(questions)) return c.json(err('Format data bulk questions tidak valid'), 400);
    const count = await bulkCreateQuestions(c.env.DB, c.req.param('id'), questions);
    return c.json(ok({ count }, `${count} butir soal berhasil diimpor`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/questions/:qId', requirePermission('semester.event.manage'), async (c) => {
  const qId = c.req.param('qId');
  const body = await c.req.json<any>();
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?').bind(qId).first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertExamInSemesterEvent(c.env.DB, qRow.exam_id);
    const updated = await updateQuestion(c.env.DB, qId, body);
    return c.json(ok(updated, 'Soal berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/questions/:qId', requirePermission('semester.event.manage'), async (c) => {
  const qId = c.req.param('qId');
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?').bind(qId).first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertExamInSemesterEvent(c.env.DB, qRow.exam_id);
    await deleteQuestion(c.env.DB, qId);
    return c.json(ok({ deleted: true }, 'Soal berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/upload', requirePermission('semester.event.manage'), async (c) => {
  try {
    const formData = await c.req.parseBody();
    const examId = formData['exam_id'] as string;
    const file = formData['file'] as File;

    if (!file) return c.json(err('File wajib diunggah'), 400);
    if (examId) {
      await assertExamInSemesterEvent(c.env.DB, examId);
    }

    const ext = file.name?.split('.').pop() || 'bin';
    const key = `semester-media/${newId()}.${ext}`;
    const buffer = await file.arrayBuffer();

    if (c.env.R2) {
      await c.env.R2.put(key, buffer, {
        httpMetadata: { contentType: file.type },
      });
    }

    const url = `/r2/${key}`;
    return c.json(ok({ url }, 'File berhasil diunggah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// Tokens
semester.get('/exams/:id/tokens', requirePermission('semester.access'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const tokens = await listExamTokens(c.env.DB, c.req.param('id'));
    return c.json(ok(tokens));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/tokens/generate', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json<{ room_id?: string; token_id?: string }>().catch(() => ({} as any));
    const tokens = await generateExamTokens(c.env.DB, c.req.param('id'), {
      room_ids: body?.room_id ? [body.room_id] : undefined,
      token_id: body?.token_id,
    });
    return c.json(ok(tokens, 'Token berhasil digenerate'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.put('/exams/:id/tokens/code', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json<{ token_code: string; room_id?: string | null }>();
    if (!body?.token_code) return c.json(err('token_code wajib diisi'), 400);
    const token = await setExamTokenCode(c.env.DB, c.req.param('id'), body.token_code);
    return c.json(ok(token, 'Kode token berhasil diatur'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/tokens/set-code', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const body = await c.req.json<{ token_code: string }>();
    if (!body?.token_code) return c.json(err('token_code wajib diisi'), 400);
    const token = await setExamTokenCode(c.env.DB, c.req.param('id'), body.token_code);
    return c.json(ok(token, 'Kode token berhasil diatur'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/tokens/:tokenId/active', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const token = await toggleTokenActive(c.env.DB, c.req.param('id'), c.req.param('tokenId'));
    return c.json(ok(token, 'Status token berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/tokens/:tokenId/toggle', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const token = await toggleTokenActive(c.env.DB, c.req.param('id'), c.req.param('tokenId'));
    return c.json(ok(token, 'Status token berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// Monitoring & Sessions
semester.get('/exams/:id/sessions', requirePermission('semester.access'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const sessions = await getExamSessions(c.env.DB, c.req.param('id'));
    return c.json(ok(sessions));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/sessions/:sessionId/unlock', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await unlockExamSession(c.env.DB, c.req.param('sessionId'));
    return c.json(ok({ unlocked: true }, 'Sesi siswa berhasil dibuka'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/sessions/:sessionId/reset-device', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await resetSessionDevice(c.env.DB, c.req.param('sessionId'));
    return c.json(ok({ reset: true }, 'Kunci perangkat sesi siswa berhasil direset'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/sessions/:sessionId/force-submit', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await forceSubmitSession(c.env.DB, c.req.param('sessionId'));
    return c.json(ok({ submitted: true }, 'Sesi siswa berhasil diselesaikan paksa'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// Results & Analytics
semester.get('/exams/:id/results', requirePermission('semester.results.view'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await recomputeMissingExamResults(c.env.DB, c.req.param('id'));
    const results = await getExamResults(c.env.DB, c.req.param('id'));
    return c.json(ok(results));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/exams/:id/results/export', requirePermission('semester.results.view'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const rows = await getExamResultsExport(c.env.DB, c.req.param('id'));
    return c.json(ok(rows));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/exams/:id/results-export', requirePermission('semester.results.view'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const rows = await getExamResultsExport(c.env.DB, c.req.param('id'));
    return c.json(ok(rows));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.delete('/exams/:id/results/:sessionId', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    await deleteExamResult(c.env.DB, c.req.param('id'), c.req.param('sessionId'));
    return c.json(ok({ deleted: true }, 'Hasil ujian siswa berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.post('/exams/:id/results/recompute-missing', requirePermission('semester.event.manage'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const repaired = await recomputeMissingExamResults(c.env.DB, c.req.param('id'));
    return c.json(ok({ repaired }, `${repaired} hasil ujian berhasil dikalkulasi ulang`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/exams/:id/analytics', requirePermission('semester.results.view'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const analytics = await getExamQuestionAnalytics(c.env.DB, c.req.param('id'));
    return c.json(ok(analytics));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

semester.get('/exams/:id/question-analytics', requirePermission('semester.results.view'), async (c) => {
  try {
    await assertExamInSemesterEvent(c.env.DB, c.req.param('id'));
    const analytics = await getExamQuestionAnalytics(c.env.DB, c.req.param('id'));
    return c.json(ok(analytics));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

export default semester;
