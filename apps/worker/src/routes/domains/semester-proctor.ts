// ============================================================
// Phase 7: Semester Contextual Proctor HTTP Router
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok, err } from '../../utils/helpers.ts';
import {
  resolveProctorContext,
  getRoomSlotTokens,
  getRoomSlotSessions,
  unlockProctorSession,
  resetProctorSessionDevice,
  forceSubmitProctorSession,
} from '../../services/domains/semester/proctor-auth.ts';

const proctorRouter = new Hono<{ Bindings: Env }>();

// ── 1. Resolve Proctor Context & Window Status ──────────────
proctorRouter.get('/context', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.query('room_id');
  const slotId = c.req.query('slot_id');

  if (!eventId || !roomId || !slotId) {
    return c.json(err('Parameter event_id, room_id, dan slot_id wajib diisi'), 400);
  }

  const result = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!result.authorized) {
    return c.json(err(result.error || 'Akses pengawasan ditolak', result.context), 403);
  }

  return c.json(ok(result.context));
});

// ── 2. Get Multi-Exam Tokens in Room-Slot ───────────────────
proctorRouter.get('/rooms/:roomId/slots/:slotId/tokens', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.param('roomId');
  const slotId = c.req.param('slotId');

  if (!eventId) {
    return c.json(err('Parameter event_id wajib diisi'), 400);
  }

  const auth = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!auth.authorized) {
    return c.json(err(auth.error || 'Akses ditolak', auth.context), 403);
  }

  const tokens = await getRoomSlotTokens(c.env.DB, eventId, roomId, slotId);
  return c.json(ok(tokens));
});

// ── 3. Get Student Sessions in Room-Slot ────────────────────
proctorRouter.get('/rooms/:roomId/slots/:slotId/sessions', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.param('roomId');
  const slotId = c.req.param('slotId');

  if (!eventId) {
    return c.json(err('Parameter event_id wajib diisi'), 400);
  }

  const auth = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!auth.authorized) {
    return c.json(err(auth.error || 'Akses ditolak', auth.context), 403);
  }

  const sessions = await getRoomSlotSessions(c.env.DB, eventId, roomId, slotId);
  return c.json(ok(sessions));
});

// ── 4. Unlock Session (IDOR-protected) ──────────────────────
proctorRouter.post('/rooms/:roomId/slots/:slotId/sessions/:sessionId/unlock', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.param('roomId');
  const slotId = c.req.param('slotId');
  const sessionId = c.req.param('sessionId');

  if (!eventId) {
    return c.json(err('Parameter event_id wajib diisi'), 400);
  }

  const auth = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!auth.authorized) {
    return c.json(err(auth.error || 'Akses ditolak', auth.context), 403);
  }

  const actorId = (user as any).id || (user as any).sub || '';
  const result = await unlockProctorSession(c.env.DB, eventId, roomId, slotId, sessionId, actorId);
  if (!result.success) {
    return c.json(err(result.error || 'Gagal membuka kunci sesi'), 400);
  }

  return c.json(ok(null, 'Sesi siswa berhasil dibuka kuncinya'));
});

// ── 5. Reset Device ID (IDOR-protected) ─────────────────────
proctorRouter.post('/rooms/:roomId/slots/:slotId/sessions/:sessionId/reset-device', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.param('roomId');
  const slotId = c.req.param('slotId');
  const sessionId = c.req.param('sessionId');

  if (!eventId) {
    return c.json(err('Parameter event_id wajib diisi'), 400);
  }

  const auth = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!auth.authorized) {
    return c.json(err(auth.error || 'Akses ditolak', auth.context), 403);
  }

  const actorId = (user as any).id || (user as any).sub || '';
  const result = await resetProctorSessionDevice(c.env.DB, eventId, roomId, slotId, sessionId, actorId);
  if (!result.success) {
    return c.json(err(result.error || 'Gagal mereset perangkat sesi'), 400);
  }

  return c.json(ok(null, 'Perangkat siswa berhasil direset'));
});

// ── 6. Force Submit Session (IDOR-protected) ────────────────
proctorRouter.post('/rooms/:roomId/slots/:slotId/sessions/:sessionId/force-submit', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const roomId = c.req.param('roomId');
  const slotId = c.req.param('slotId');
  const sessionId = c.req.param('sessionId');

  if (!eventId) {
    return c.json(err('Parameter event_id wajib diisi'), 400);
  }

  const auth = await resolveProctorContext(c.env.DB, eventId, roomId, slotId, user);
  if (!auth.authorized) {
    return c.json(err(auth.error || 'Akses ditolak', auth.context), 403);
  }

  const actorId = (user as any).id || (user as any).sub || '';
  const result = await forceSubmitProctorSession(c.env.DB, eventId, roomId, slotId, sessionId, actorId);
  if (!result.success) {
    return c.json(err(result.error || 'Gagal memaksa submit ujian'), 400);
  }

  return c.json(ok(null, 'Sesi siswa berhasil di-submit'));
});

export default proctorRouter;
