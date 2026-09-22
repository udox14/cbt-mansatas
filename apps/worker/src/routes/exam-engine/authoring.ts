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
