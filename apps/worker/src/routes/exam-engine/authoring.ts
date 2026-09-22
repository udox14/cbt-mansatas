import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok, err } from '../../utils/helpers.ts';
import {
  listExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
} from '../../services/exam-engine/exams.ts';
import {
  listExamQuestions,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
} from '../../services/exam-engine/questions.ts';
import { authMiddleware } from '../../middleware/auth.ts';
import {
  generateAiQuestions,
  listAiRuns,
  listAiDrafts,
  updateAiDraft,
  deleteAiDraft,
  acceptAiDrafts,
  assertAiQuestionAuthoringAccess,
} from '../../services/exam-engine/ai-authoring.ts';

export const authoringRoutes = new Hono<{ Bindings: Env }>();

// ── EXAMS ────────────────────────────────────────────────────

authoringRoutes.get('/exams', async (c) => {
  const query = {
    event_id: c.req.query('event_id'),
    active_status: c.req.query('active_status'),
    mode: c.req.query('mode'),
  };
  const exams = await listExams(c.env.DB, query);
  return c.json(ok(exams));
});

authoringRoutes.get('/exams/:id', async (c) => {
  const exam = await getExamById(c.env.DB, c.req.param('id'));
  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);
  return c.json(ok(exam));
});

authoringRoutes.post('/exams', async (c) => {
  const b = await c.req.json();
  const user = c.get('user' as any);
  const result = await createExam(c.env.DB, b, user, c.env.MANSATAS_DB);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

authoringRoutes.put('/exams/:id', async (c) => {
  const b = await c.req.json();
  const result = await updateExam(c.env.DB, c.req.param('id'), b, c.env.MANSATAS_DB);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

authoringRoutes.delete('/exams/:id', async (c) => {
  const result = await deleteExam(c.env.DB, c.req.param('id'));
  return c.json(ok(result.data, result.message));
});

// ── QUESTIONS ────────────────────────────────────────────────

authoringRoutes.get('/exams/:examId/questions', async (c) => {
  const questions = await listExamQuestions(c.env.DB, c.req.param('examId'));
  return c.json(ok(questions));
});

authoringRoutes.post('/exams/:examId/questions', async (c) => {
  const b = await c.req.json();
  const result = await createQuestion(c.env.DB, c.req.param('examId'), b);
  return c.json(ok(result.data, result.message), 201);
});

authoringRoutes.post('/exams/:examId/questions/bulk', async (c) => {
  const { questions } = await c.req.json<{ questions: any[] }>();
  const result = await bulkCreateQuestions(c.env.DB, c.req.param('examId'), questions);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

authoringRoutes.put('/questions/:id', async (c) => {
  const b = await c.req.json();
  const result = await updateQuestion(c.env.DB, c.req.param('id'), b);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

authoringRoutes.delete('/questions/:id', async (c) => {
  const result = await deleteQuestion(c.env.DB, c.req.param('id'));
  return c.json(ok(result.data, result.message));
});

// ── AI QUESTION GENERATOR ────────────────────────────────────

export const genericAiRoutes = new Hono<{ Bindings: Env }>();
genericAiRoutes.use('/exams/:examId/ai/*', authMiddleware);

genericAiRoutes.post('/exams/:examId/ai/generate', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const actorStaffId = user?.staff_id || user?.sub || 'admin';
  const body = await c.req.json<any>();

  const result = await generateAiQuestions(c.env.DB, c.env, examId, actorStaffId, body);
  if (!result.success) {
    return c.json(err(result.error!, (result as any).data), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

genericAiRoutes.get('/exams/:examId/ai/runs', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const runs = await listAiRuns(c.env.DB, examId);
  return c.json(ok(runs));
});

genericAiRoutes.get('/exams/:examId/ai/drafts', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const runId = c.req.query('run_id');
  const drafts = await listAiDrafts(c.env.DB, examId, runId);
  return c.json(ok(drafts));
});

genericAiRoutes.put('/exams/:examId/ai/drafts/:draftId', async (c) => {
  const examId = c.req.param('examId');
  const draftId = c.req.param('draftId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const body = await c.req.json<any>();
  const result = await updateAiDraft(c.env.DB, examId, draftId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

genericAiRoutes.delete('/exams/:examId/ai/drafts/:draftId', async (c) => {
  const examId = c.req.param('examId');
  const draftId = c.req.param('draftId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const result = await deleteAiDraft(c.env.DB, examId, draftId);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(null, result.message));
});

genericAiRoutes.post('/exams/:examId/ai/drafts/accept', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user' as any);
  const auth = await assertAiQuestionAuthoringAccess(c.env.DB, user, examId);
  if (!auth.success) {
    return c.json(err(auth.error!), (auth.status as any) || 403);
  }

  const body = await c.req.json<{ draft_ids?: string[]; draftIds?: string[] }>();
  const draftIds = body.draft_ids || body.draftIds || [];

  const result = await acceptAiDrafts(c.env.DB, examId, draftIds);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 200);
});

authoringRoutes.route('/', genericAiRoutes);

