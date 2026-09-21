import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok } from '../../utils/helpers.ts';
import {
  getExamResults,
  getExamResultsExport,
  deleteExamResult,
} from '../../services/exam-engine/results.ts';
import { recomputeMissingExamResults } from '../../services/exam-engine/scoring.ts';
import { getExamQuestionAnalytics } from '../../services/exam-engine/analytics.ts';


export const resultsRoutes = new Hono<{ Bindings: Env }>();

resultsRoutes.get('/exams/:examId/results', async (c) => {
  const results = await getExamResults(c.env.DB, c.req.param('examId'));
  return c.json(ok(results));
});

resultsRoutes.get('/exams/:examId/results-export', async (c) => {
  const exportRows = await getExamResultsExport(c.env.DB, c.req.param('examId'));
  return c.json(ok(exportRows));
});

resultsRoutes.post('/exams/:examId/results/recompute-missing', async (c) => {
  const result = await recomputeMissingExamResults(c.env.DB, c.req.param('examId'));
  return c.json(ok(result, result.repaired > 0
    ? `${result.repaired} hasil peserta berhasil dipulihkan`
    : 'Tidak ada hasil hilang yang perlu dipulihkan'));
});

resultsRoutes.delete('/exams/:examId/results/:sessionId', async (c) => {
  const result = await deleteExamResult(
    c.env.DB,
    c.req.param('examId'),
    c.req.param('sessionId')
  );
  return c.json(ok(result.data, result.message));
});

resultsRoutes.get('/exams/:examId/question-analytics', async (c) => {
  const analytics = await getExamQuestionAnalytics(c.env.DB, c.req.param('examId'));
  return c.json(ok(analytics));
});
