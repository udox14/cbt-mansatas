import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok, err } from '../../utils/helpers.ts';
import {
  listExamTokens,
  toggleTokenActive,
  generateExamTokens,
  setExamTokenCode,
} from '../../services/exam-engine/tokens.ts';
import {
  listExamAssignments,
  createExamAssignments,
  assignExamRoom,
  assignExamSesi,
  assignExamGroup,
  batchDeleteExamAssignments,
  deleteExamAssignment,
} from '../../services/exam-engine/assignments.ts';


export const runtimeAdminRoutes = new Hono<{ Bindings: Env }>();

// ── TOKENS ───────────────────────────────────────────────────

runtimeAdminRoutes.get('/exams/:examId/tokens', async (c) => {
  const tokens = await listExamTokens(c.env.DB, c.req.param('examId'));
  return c.json(ok(tokens));
});

runtimeAdminRoutes.post('/exams/:examId/tokens/:tokenId/active', async (c) => {
  const { is_active } = await c.req.json<{ is_active: boolean | number }>();
  const result = await toggleTokenActive(
    c.env.DB,
    c.req.param('examId'),
    c.req.param('tokenId'),
    is_active
  );
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/tokens/generate', async (c) => {
  const examId = c.req.param('examId');
  const body = await c.req.json<{
    room_ids?: string[];
    groups?: { tanggal_tes?: string; sesi_tes?: string }[];
    token_id?: string;
  }>();

  const result = await generateExamTokens(c.env.DB, examId, body);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/tokens/set-code', async (c) => {
  const examId = c.req.param('examId');
  const body = await c.req.json<{ token_code?: string }>();
  const result = await setExamTokenCode(c.env.DB, examId, body?.token_code);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

// ── ASSIGNMENTS ──────────────────────────────────────────────

runtimeAdminRoutes.get('/exams/:examId/assignments', async (c) => {
  const assignments = await listExamAssignments(c.env.DB, c.req.param('examId'));
  return c.json(ok(assignments));
});

runtimeAdminRoutes.post('/exams/:examId/assignments', async (c) => {
  const { users } = await c.req.json<{ users: { user_id: string; user_type: string }[] }>();
  const result = await createExamAssignments(c.env.DB, c.req.param('examId'), users);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/assignments/room', async (c) => {
  const { rooms } = await c.req.json<{ rooms: string[] }>();
  const result = await assignExamRoom(c.env.DB, c.req.param('examId'), rooms);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/assignments/sesi', async (c) => {
  const { sessions } = await c.req.json<{ sessions: string[] }>();
  const result = await assignExamSesi(c.env.DB, c.req.param('examId'), sessions);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/assignments/group', async (c) => {
  const { groups } = await c.req.json<{ groups: { tanggal_tes: string; sesi_tes: string }[] }>();
  const result = await assignExamGroup(c.env.DB, c.req.param('examId'), groups);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.post('/exams/:examId/assignments/batch-delete', async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const result = await batchDeleteExamAssignments(c.env.DB, c.req.param('examId'), ids);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

runtimeAdminRoutes.delete('/exams/:examId/assignments/:id', async (c) => {
  const result = await deleteExamAssignment(c.env.DB, c.req.param('examId'), c.req.param('id'));
  return c.json(ok(result.data, result.message));
});
