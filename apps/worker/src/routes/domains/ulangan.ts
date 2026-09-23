// ============================================================
// Ulangan Domain — HTTP Router
//
// Mounts all teacher Ulangan Harian endpoints with:
// 1. Strict server-side RBAC evaluation
// 2. Strict teacher ownership & IDOR protection via assertUlanganOwnership
// 3. Delegation to Phase 2 shared examination engine services
// 4. Scoped media upload and student session monitoring
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { authMiddleware } from '../../middleware/auth.ts';
import { requirePermission } from '../../middleware/rbac.ts';
import { ok, err, newId, now } from '../../utils/helpers.ts';
import {
  listTeacherAssignments,
  getActiveAcademicYear,
  getTeachingAssignmentById,
  listActiveStudentsInClass,
} from '../../services/sources/teaching-assignments.ts';
import {
  createUlanganExam,
  listUlanganExams,
  getUlanganExamDetail,
  updateUlanganExam,
  deleteUlanganExam,
  transitionUlanganStatus,
  assertUlanganOwnership,
  DomainMismatchError,
  NotFoundError,
  ForbiddenError,
} from '../../services/domains/ulangan/exams.ts';
import {
  snapshotWholeClassRoster,
  listUlanganRoster,
  removeStudentFromUlanganRoster,
  clearUlanganRoster,
} from '../../services/domains/ulangan/roster.ts';
import { checkUlanganReadiness } from '../../services/domains/ulangan/readiness.ts';
import {
  listExamQuestions,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
} from '../../services/exam-engine/questions.ts';
import {
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
  listExamTokens,
  generateExamTokens,
  setExamTokenCode,
  toggleTokenActive,
} from '../../services/exam-engine/tokens.ts';
import { getExamSessions } from '../../services/exam-engine/monitoring.ts';
import {
  getExamResults,
  getExamResultsExport,
  deleteExamResult,
} from '../../services/exam-engine/results.ts';
import { getExamQuestionAnalytics } from '../../services/exam-engine/analytics.ts';
import { recomputeMissingExamResults } from '../../services/exam-engine/scoring.ts';

const ulangan = new Hono<{ Bindings: Env }>();

// ── Base Authentication & Student Rejection Guard ───────────
ulangan.use('*', authMiddleware);

ulangan.use('*', async (c, next) => {
  const user = c.get('user');
  if (user?.role === 'student' || (user?.roles?.includes('student') && !user?.roles?.includes('admin'))) {
    return c.json(err('Akses ditolak: siswa tidak diizinkan mengakses administrasi Ulangan Harian'), 403);
  }
  await next();
});

// Helper to catch ownership errors uniformly
function handleDomainError(e: any, c: any) {
  if (e instanceof DomainMismatchError) return c.json(err(e.message), 400);
  if (e instanceof NotFoundError) return c.json(err(e.message), 404);
  if (e instanceof ForbiddenError) return c.json(err(e.message), 403);
  console.error('Ulangan route error:', e);
  return c.json(err(e?.message || 'Terjadi kesalahan pada server'), 500);
}

// ── 1. Teaching Assignments (from Mansatas) ──────────────────

ulangan.get('/teaching-assignments', requirePermission('ulangan.access'), async (c) => {
  const user = c.get('user');
  if (!c.env.MANSATAS_DB) {
    return c.json(ok([]));
  }

  // Resolve Mansatas guru_id
  let guruId = user.mansatas_user_id;
  if (!guruId && c.env.DB) {
    const profile = await c.env.DB
      .prepare('SELECT mansatas_user_id FROM cbt_staff_profiles WHERE id = ?')
      .bind(user.staff_id || user.sub)
      .first<any>();
    guruId = profile?.mansatas_user_id;
  }

  const [activeYear, assignments] = await Promise.all([
    getActiveAcademicYear(c.env.MANSATAS_DB),
    guruId ? listTeacherAssignments(c.env.MANSATAS_DB, guruId) : Promise.resolve([]),
  ]);

  return c.json({
    success: true,
    data: assignments,
    active_academic_year: activeYear,
  });
});

ulangan.get('/teaching-assignments/:assignmentId/preview', requirePermission('ulangan.access'), async (c) => {
  const assignmentId = c.req.param('assignmentId');
  const user = c.get('user');

  if (!c.env.MANSATAS_DB) {
    return c.json(err('Koneksi MANSATAS_DB belum tersedia'), 500);
  }

  let guruId = user.mansatas_user_id;
  if (!guruId && c.env.DB) {
    const profile = await c.env.DB
      .prepare('SELECT mansatas_user_id FROM cbt_staff_profiles WHERE id = ?')
      .bind(user.staff_id || user.sub)
      .first<any>();
    guruId = profile?.mansatas_user_id;
  }

  const isGlobalAdmin =
    user?.role === 'admin' ||
    user?.roles?.includes('admin') ||
    user?.permissions?.includes('platform.manage') ||
    user?.permissions?.includes('*');

  const assignment = await getTeachingAssignmentById(
    c.env.MANSATAS_DB,
    assignmentId,
    isGlobalAdmin ? undefined : guruId
  );

  if (!assignment) {
    return c.json(err('Penugasan mengajar tidak ditemukan atau bukan penugasan Anda'), 404);
  }

  const students = await listActiveStudentsInClass(c.env.MANSATAS_DB, assignment.kelas_id);
  return c.json(
    ok({
      assignment,
      students,
      total_students: students.length,
    })
  );
});

// ── 2. Ulangan Assessments (CRUD & Lifecycle) ────────────────

ulangan.get('/exams', requirePermission('ulangan.access'), async (c) => {
  const user = c.get('user');
  const filters = {
    active_status: c.req.query('active_status') || undefined,
    q: c.req.query('q') || undefined,
  };
  const exams = await listUlanganExams(c.env.DB, user, filters);
  return c.json(ok(exams));
});

ulangan.post('/exams', requirePermission('ulangan.exam.create'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<any>();

  const result = await createUlanganExam(c.env.DB, c.env.MANSATAS_DB, body, user);
  if (!result.success) {
    return c.json(err(result.error || 'Gagal membuat ulangan harian'), (result.status as any) || 400);
  }
  return c.json(ok(result.data, 'Ulangan harian berhasil dibuat'), 201);
});

ulangan.get('/exams/:id', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    const detail = await getUlanganExamDetail(c.env.DB, examId, user);
    return c.json(ok(detail));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.put('/exams/:id', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    const result = await updateUlanganExam(c.env.DB, examId, body, user);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal memperbarui ulangan'), (result.status as any) || 400);
    }
    return c.json(ok(null, 'Pengaturan ulangan berhasil diperbarui'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/exams/:id', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    const result = await deleteUlanganExam(c.env.DB, examId, user);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal menghapus ulangan'), (result.status as any) || 400);
    }
    return c.json(ok(null, 'Ulangan dan data terkait berhasil dihapus'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

const handleStatusTransition = async (c: any) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { action?: string; status?: string };
  const rawTarget = body.action || body.status;
  if (!rawTarget) {
    return c.json(err('Aksi status (action atau status) wajib diisi: siap/ready, buka/active, selesai/completed, atau draft'), 400);
  }

  try {
    const result = await transitionUlanganStatus(c.env.DB, examId, rawTarget, user);
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || 'Gagal mengubah status ulangan',
          readiness: result.readiness,
        },
        400
      );
    }
    return c.json(ok({ status: result.status }, `Status ulangan berhasil diubah menjadi ${result.status}`));
  } catch (e) {
    return handleDomainError(e, c);
  }
};

ulangan.put('/exams/:id/status', requirePermission('ulangan.exam.manage_own'), handleStatusTransition);
ulangan.post('/exams/:id/status', requirePermission('ulangan.exam.manage_own'), handleStatusTransition);

ulangan.get('/exams/:id/readiness', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const report = await checkUlanganReadiness(c.env.DB, examId);
    return c.json(ok(report));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 3. Roster Management (Derived from Assigned Class) ────────

ulangan.get('/exams/:id/roster', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    const roster = await listUlanganRoster(c.env.DB, examId, user);
    return c.json(ok(roster));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

const handleSnapshot = async (c: any) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    const result = await snapshotWholeClassRoster(c.env.DB, c.env.MANSATAS_DB, examId, user);
    return c.json(ok(result, `Berhasil snapshot ${result.added} siswa ke roster ujian (${result.skipped} dilewati/duplikat)`));
  } catch (e) {
    return handleDomainError(e, c);
  }
};

ulangan.post('/exams/:id/roster/snapshot', requirePermission('ulangan.exam.manage_own'), handleSnapshot);
ulangan.post('/exams/:id/roster/snapshot-class', requirePermission('ulangan.exam.manage_own'), handleSnapshot);

ulangan.delete('/exams/:id/roster', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    const result = await clearUlanganRoster(c.env.DB, examId, user);
    return c.json(ok(result, 'Daftar peserta ulangan berhasil dikosongkan'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/exams/:id/roster/:rosterId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const rosterId = c.req.param('rosterId');
  const user = c.get('user');
  try {
    const result = await removeStudentFromUlanganRoster(c.env.DB, examId, rosterId, user);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal menghapus siswa dari roster'), 409);
    }
    return c.json(ok(null, 'Siswa berhasil dihapus dari roster ulangan'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 4. Question Authoring (Delegates to Shared Engine) ────────

ulangan.get('/exams/:id/questions', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const questions = await listExamQuestions(c.env.DB, examId);
    return c.json(ok(questions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/questions', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await createQuestion(c.env.DB, examId, body);
    return c.json(ok(result.data, result.message), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/questions/bulk', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ questions: any[] }>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await bulkCreateQuestions(c.env.DB, examId, body.questions || []);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal mengimpor soal'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.put('/questions/:id', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const questionId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?').bind(questionId).first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertUlanganOwnership(c.env.DB, qRow.exam_id, user);
    const result = await updateQuestion(c.env.DB, questionId, body);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal memperbarui soal'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/questions/:id', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const questionId = c.req.param('id');
  const user = c.get('user');
  try {
    const qRow = await c.env.DB.prepare('SELECT exam_id FROM cbt_questions WHERE id = ?').bind(questionId).first<any>();
    if (!qRow) return c.json(err('Soal tidak ditemukan'), 404);
    await assertUlanganOwnership(c.env.DB, qRow.exam_id, user);
    const result = await deleteQuestion(c.env.DB, questionId);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.put('/exams/:id/questions/:questionId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const questionId = c.req.param('questionId');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await updateQuestion(c.env.DB, questionId, body);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal memperbarui soal'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/exams/:id/questions/:questionId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const questionId = c.req.param('questionId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await deleteQuestion(c.env.DB, questionId);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 4B. AI Question Generator (Teacher Owned — RPPM Pattern) ────────────────

ulangan.post('/exams/:id/ai/prompt', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await buildExamAiPrompt(c.env.DB, examId, body);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(result.data));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/ai/validate', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await validatePastedAiQuestions(c.env.DB, examId, body);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(result.data));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/ai/revalidate', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await revalidateEditedAiQuestion(c.env.DB, examId, body);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(result.data));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/ai/import', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ questions: any[] }>();
  const questions = body.questions || [];
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await importReviewedAiQuestions(c.env.DB, examId, questions);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/ai/generate', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const actorStaffId = user?.staff_id || user?.sub;
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await generateAiQuestions(c.env.DB, c.env, examId, actorStaffId, body);
    if (!result.success) {
      return c.json(err(result.error!, (result as any).data), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message), 201);
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.get('/exams/:id/ai/runs', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const runs = await listAiRuns(c.env.DB, examId);
    return c.json(ok(runs));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.get('/exams/:id/ai/drafts', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const runId = c.req.query('run_id');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const drafts = await listAiDrafts(c.env.DB, examId, runId);
    return c.json(ok(drafts));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.put('/exams/:id/ai/drafts/:draftId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const draftId = c.req.param('draftId');
  const user = c.get('user');
  const body = await c.req.json<any>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await updateAiDraft(c.env.DB, examId, draftId, body);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(null, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/exams/:id/ai/drafts/:draftId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const draftId = c.req.param('draftId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await deleteAiDraft(c.env.DB, examId, draftId);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(null, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/ai/drafts/accept', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ draft_ids?: string[]; draftIds?: string[] }>();
  const draftIds = body.draft_ids || body.draftIds || [];
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await acceptAiDrafts(c.env.DB, examId, draftIds);
    if (!result.success) {
      return c.json(err(result.error!), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message), 200);
  } catch (e) {
    return handleDomainError(e, c);
  }
});


// ── 5. Scoped R2 Media Upload ────────────────────────────────

ulangan.post('/exams/:id/upload', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);

    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return c.json(err('File tidak ditemukan'), 400);
    }

    const uploadFile = file as unknown as {
      name: string;
      size: number;
      type: string;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };

    const ext = uploadFile.name.split('.').pop()?.toLowerCase() || '';
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'm4a'];
    if (!allowed.includes(ext)) {
      return c.json(err(`Tipe file .${ext} tidak diizinkan`), 400);
    }

    if (uploadFile.size > 10 * 1024 * 1024) {
      return c.json(err('Ukuran file maksimal 10MB'), 400);
    }

    const key = `ulangan/${examId}/${Date.now()}-${newId().slice(0, 8)}.${ext}`;
    await c.env.R2.put(key, await uploadFile.arrayBuffer(), {
      httpMetadata: { contentType: uploadFile.type },
    });

    return c.json(ok({ url: `/r2/${key}`, key }));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/upload', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const user = c.get('user');
  try {
    const formData = await c.req.formData();
    const examId = String(c.req.query('exam_id') || formData.get('exam_id') || '').trim();
    if (!examId) {
      return c.json(err('exam_id wajib disertakan untuk upload media ulangan'), 400);
    }
    await assertUlanganOwnership(c.env.DB, examId, user);

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return c.json(err('File tidak ditemukan'), 400);
    }

    const uploadFile = file as unknown as {
      name: string;
      size: number;
      type: string;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };

    const ext = uploadFile.name.split('.').pop()?.toLowerCase() || '';
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'm4a'];
    if (!allowed.includes(ext)) {
      return c.json(err(`Tipe file .${ext} tidak diizinkan`), 400);
    }

    if (uploadFile.size > 10 * 1024 * 1024) {
      return c.json(err('Ukuran file maksimal 10MB'), 400);
    }

    const key = `ulangan/${examId}/${Date.now()}-${newId().slice(0, 8)}.${ext}`;
    await c.env.R2.put(key, await uploadFile.arrayBuffer(), {
      httpMetadata: { contentType: uploadFile.type },
    });

    return c.json(ok({ url: `/r2/${key}`, key }));
  } catch (e) {
    return handleDomainError(e, c);
  }
});



// ── 6. Token Management (Single Exam Token) ──────────────────

ulangan.get('/exams/:id/tokens', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const tokens = await listExamTokens(c.env.DB, examId);
    return c.json(ok(tokens));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/tokens/generate', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await generateExamTokens(c.env.DB, examId, body);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/tokens/set-code', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ token_code?: string }>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await setExamTokenCode(c.env.DB, examId, body.token_code);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal menyetel token'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.put('/exams/:id/tokens/:tokenId/toggle', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const tokenId = c.req.param('tokenId');
  const user = c.get('user');
  const body = await c.req.json<{ is_active: number | boolean }>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await toggleTokenActive(c.env.DB, examId, tokenId, body.is_active);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal mengubah status token'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/tokens/:tokenId/active', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const tokenId = c.req.param('tokenId');
  const user = c.get('user');
  const body = await c.req.json<{ is_active: number | boolean }>();
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await toggleTokenActive(c.env.DB, examId, tokenId, body.is_active);
    if (!result.success) {
      return c.json(err(result.error || 'Gagal mengubah status token'), (result.status as any) || 400);
    }
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// ── 7. Monitoring & Student Sessions (Teacher Oversight) ─────

ulangan.get('/exams/:id/monitoring', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const sessions = await getExamSessions(c.env.DB, examId);
    return c.json(ok(sessions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/sessions/:sessionId/unlock', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    await c.env.DB.prepare(
      "UPDATE cbt_exam_sessions SET device_id = NULL, status = 'active', last_heartbeat = datetime('now') WHERE id = ? AND exam_id = ?"
    )
      .bind(sessionId, examId)
      .run();
    return c.json(ok(null, 'Sesi siswa berhasil di-unlock'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/sessions/:sessionId/reset', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    await c.env.DB.prepare(
      "UPDATE cbt_exam_sessions SET is_time_locked = 0, cheat_warnings = 0, locked_at = NULL, last_heartbeat = datetime('now') WHERE id = ? AND exam_id = ?"
    )
      .bind(sessionId, examId)
      .run();
    return c.json(ok(null, 'Kunci waktu sesi siswa berhasil di-reset'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/sessions/:sessionId/force-submit', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    await c.env.DB.prepare(
      "UPDATE cbt_exam_sessions SET status = 'submitted', finished_at = datetime('now'), is_time_locked = 0, locked_at = NULL, last_heartbeat = datetime('now') WHERE id = ? AND exam_id = ?"
    )
      .bind(sessionId, examId)
      .run();

    // Recompute score for forced submission
    await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(null, 'Sesi siswa berhasil di-force submit'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/sessions/:sessionId/extend', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  const body = await c.req.json<{ minutes?: number }>().catch(() => ({} as { minutes?: number }));
  const minutes = Math.max(1, Math.min(120, Number(body.minutes || 15)));
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
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

// ── 8. Results & Analytics ───────────────────────────────────

ulangan.get('/exams/:id/results', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const results = await getExamResults(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/results/recompute', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(result, 'Nilai berhasil dihitung ulang'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.get('/exams/:id/analytics', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const analytics = await getExamQuestionAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

// Aliases for shared frontend views compatibility
ulangan.get('/exams/:id/sessions', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const sessions = await getExamSessions(c.env.DB, examId);
    return c.json(ok(sessions));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.get('/exams/:id/question-analytics', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const analytics = await getExamQuestionAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.get('/exams/:id/results-export', requirePermission('ulangan.access'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const results = await getExamResultsExport(c.env.DB, examId);
    return c.json(ok(results));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.post('/exams/:id/results/recompute-missing', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await recomputeMissingExamResults(c.env.DB, examId);
    return c.json(ok(result, result.repaired > 0
      ? `${result.repaired} hasil peserta berhasil dipulihkan`
      : 'Tidak ada hasil hilang yang perlu dipulihkan'));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

ulangan.delete('/exams/:id/results/:sessionId', requirePermission('ulangan.exam.manage_own'), async (c) => {
  const examId = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  try {
    await assertUlanganOwnership(c.env.DB, examId, user);
    const result = await deleteExamResult(c.env.DB, examId, sessionId);
    return c.json(ok(result.data, result.message));
  } catch (e) {
    return handleDomainError(e, c);
  }
});

export default ulangan;
