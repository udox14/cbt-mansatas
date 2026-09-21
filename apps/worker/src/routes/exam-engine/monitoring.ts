import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok } from '../../utils/helpers.ts';
import { getExamSessions } from '../../services/exam-engine/monitoring.ts';


export const monitoringRoutes = new Hono<{ Bindings: Env }>();

monitoringRoutes.get('/exams/:examId/sessions', async (c) => {
  const sessions = await getExamSessions(c.env.DB, c.req.param('examId'));
  return c.json(ok(sessions));
});
