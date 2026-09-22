// ============================================================
// Phase 7: Semester Automation, Seating & Invigilation Router
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { requirePermission } from '../../middleware/rbac.ts';
import { ok, err } from '../../utils/helpers.ts';
import { assertSemesterEvent, DomainMismatchError, EventFrozenError } from '../../services/domains/semester/events.ts';
import { getGenerationLogs } from '../../services/domains/semester/concurrency.ts';
import {
  autoAllocateRooms,
  setParticipantRoomLock,
  manualAssignParticipantRoom,
} from '../../services/domains/semester/room-allocation.ts';
import {
  getRoomLayout,
  configureRoomLayout,
  getRoomSeats,
  getRoomSeatAssignments,
  autoDistributeSeats,
  manualAssignParticipantSeat,
  setSeatAssignmentLock,
} from '../../services/domains/semester/seating.ts';
import {
  autoSolveTimetable,
  setScheduleLock,
} from '../../services/domains/semester/timetable-solver.ts';
import {
  syncInvigilatorPoolFromStaff,
  getInvigilatorPool,
  setInvigilatorEligibility,
  getStaffBlackouts,
  addStaffBlackout,
  removeStaffBlackout,
  getInvigilatorAssignments,
  autoAssignInvigilators,
  setInvigilatorAssignmentLock,
} from '../../services/domains/semester/invigilators.ts';

const automation = new Hono<{ Bindings: Env }>();

function handleDomainError(e: any, c: any) {
  if (e instanceof DomainMismatchError) return c.json(err(e.message), 403);
  if (e instanceof EventFrozenError) return c.json(err(e.message), 409);
  return c.json(err(e.message || 'Internal domain error'), 400);
}

// ── 1. Generation Audit Logs ─────────────────────────────────
automation.get('/events/:id/automation/logs', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const stage = c.req.query('stage') as any;
    const logs = await getGenerationLogs(c.env.DB, eventId, stage);
    return c.json(ok(logs));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 2. Room Allocation Automation & Locks ─────────────────────
automation.post('/events/:id/automation/rooms', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const user = c.get('user');
    const actorId = (user as any).id || (user as any).sub || '';
    const body = await c.req.json().catch(() => ({}));
    const result = await autoAllocateRooms(c.env.DB, eventId, actorId, body);
    if (!result.success) {
      const code = result.status === 'impossible' ? 409 : 400;
      return c.json(err(result.message, result), code);
    }
    return c.json(ok(result, result.message));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/participants/:pId/room-lock', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const participantId = c.req.param('pId');
    const body = await c.req.json().catch(() => ({}));
    const isLocked = body.is_locked !== false && body.is_locked !== 0;
    const res = await setParticipantRoomLock(c.env.DB, eventId, participantId, isLocked);
    if (!res.success) return c.json(err(res.error || 'Failed to toggle room lock'), 400);
    return c.json(ok({ is_room_locked: isLocked ? 1 : 0 }, 'Kunci ruangan peserta berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.put('/events/:id/participants/:pId/room', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const participantId = c.req.param('pId');
    const body = await c.req.json().catch(() => ({}));
    const res = await manualAssignParticipantRoom(c.env.DB, eventId, participantId, body.room_id || null);
    if (!res.success) return c.json(err(res.error || 'Gagal mengubah ruangan peserta'), 400);
    return c.json(ok(null, 'Ruangan peserta berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 3. Room Layouts & Seating Distribution ───────────────────
automation.get('/events/:id/rooms/:roomId/layout', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const roomId = c.req.param('roomId');
    await assertSemesterEvent(c.env.DB, eventId);
    const layout = await getRoomLayout(c.env.DB, eventId, roomId);
    return c.json(ok(layout));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/rooms/:roomId/layout', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const roomId = c.req.param('roomId');
    const body = await c.req.json().catch(() => ({}));
    const res = await configureRoomLayout(c.env.DB, eventId, roomId, body);
    if (!res.success) return c.json(err(res.error || 'Gagal menyimpan tata letak ruangan'), 400);
    return c.json(ok(res.layout, 'Tata letak ruangan berhasil disimpan'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.get('/events/:id/rooms/:roomId/seats', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const roomId = c.req.param('roomId');
    await assertSemesterEvent(c.env.DB, eventId);
    const seats = await getRoomSeats(c.env.DB, eventId, roomId);
    return c.json(ok(seats));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.get('/events/:id/rooms/:roomId/seating', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const roomId = c.req.param('roomId');
    await assertSemesterEvent(c.env.DB, eventId);
    const assignments = await getRoomSeatAssignments(c.env.DB, eventId, roomId);
    return c.json(ok(assignments));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/automation/seating', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const user = c.get('user');
    const actorId = (user as any).id || (user as any).sub || '';
    const body = await c.req.json().catch(() => ({}));
    const result = await autoDistributeSeats(c.env.DB, eventId, actorId, body);
    if (!result.success) {
      const code = result.status === 'impossible' ? 409 : 400;
      return c.json(err(result.message, result), code);
    }
    return c.json(ok(result, result.message));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/participants/:pId/seat', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const participantId = c.req.param('pId');
    const body = await c.req.json().catch(() => ({}));
    if (!body.seat_id) return c.json(err('seat_id wajib diisi'), 400);
    const res = await manualAssignParticipantSeat(c.env.DB, eventId, participantId, body.seat_id, { swap: body.swap });
    if (!res.success) return c.json(err(res.error || 'Gagal menetapkan nomor kursi'), 400);
    return c.json(ok(null, 'Nomor kursi peserta berhasil ditetapkan'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/seating/:assignmentId/lock', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const assignmentId = c.req.param('assignmentId');
    const body = await c.req.json().catch(() => ({}));
    const isLocked = body.is_locked !== false && body.is_locked !== 0;
    const res = await setSeatAssignmentLock(c.env.DB, eventId, assignmentId, isLocked);
    if (!res.success) return c.json(err(res.error || 'Gagal mengubah kunci kursi'), 400);
    return c.json(ok({ is_locked: isLocked ? 1 : 0 }, 'Kunci penetapan kursi berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 4. Timetable Automation & Locks ──────────────────────────
automation.post('/events/:id/automation/timetable', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const user = c.get('user');
    const actorId = (user as any).id || (user as any).sub || '';
    const body = await c.req.json().catch(() => ({}));
    const result = await autoSolveTimetable(c.env.DB, eventId, actorId, body);
    if (!result.success) {
      const code = result.status === 'impossible' ? 409 : 400;
      return c.json(err(result.message, result), code);
    }
    return c.json(ok(result, result.message));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/schedules/:scheduleId/lock', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const scheduleId = c.req.param('scheduleId');
    const body = await c.req.json().catch(() => ({}));
    const isLocked = body.is_locked !== false && body.is_locked !== 0;
    const res = await setScheduleLock(c.env.DB, eventId, scheduleId, isLocked);
    if (!res.success) return c.json(err(res.error || 'Gagal mengubah kunci jadwal'), 400);
    return c.json(ok({ is_locked: isLocked ? 1 : 0 }, 'Kunci jadwal ujian berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

// ── 5. Invigilator Pool, Blackouts & Automation ──────────────
automation.get('/events/:id/invigilators/pool', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const pool = await getInvigilatorPool(c.env.DB, eventId);
    return c.json(ok(pool));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/invigilators/pool/sync', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const res = await syncInvigilatorPoolFromStaff(c.env.DB, eventId);
    return c.json(ok(res, `Sinkronisasi selesai: ${res.addedCount} staf baru ditambahkan ke pool pengawas.`));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.put('/events/:id/invigilators/pool/:staffId', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const staffId = c.req.param('staffId');
    const body = await c.req.json().catch(() => ({}));
    const isEligible = body.is_eligible !== false && body.is_eligible !== 0;
    const res = await setInvigilatorEligibility(c.env.DB, eventId, staffId, isEligible, body.notes);
    if (!res.success) return c.json(err(res.error || 'Gagal memperbarui status pengawas'), 400);
    return c.json(ok(null, 'Status pengawas berhasil diperbarui'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.get('/events/:id/invigilators/blackouts', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const staffId = c.req.query('staff_id');
    const blackouts = await getStaffBlackouts(c.env.DB, eventId, staffId);
    return c.json(ok(blackouts));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/invigilators/blackouts', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    if (!body.staff_id) return c.json(err('staff_id wajib diisi'), 400);
    const res = await addStaffBlackout(
      c.env.DB,
      eventId,
      body.staff_id,
      body.slot_id || null,
      body.blackout_date || null,
      body.reason || null
    );
    if (!res.success) return c.json(err(res.error || 'Gagal menambahkan blackout'), 400);
    return c.json(ok({ id: res.id }, 'Batasan blackout staf berhasil ditambahkan'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.delete('/events/:id/invigilators/blackouts/:blackoutId', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const blackoutId = c.req.param('blackoutId');
    const res = await removeStaffBlackout(c.env.DB, eventId, blackoutId);
    if (!res.success) return c.json(err(res.error || 'Gagal menghapus blackout'), 400);
    return c.json(ok(null, 'Batasan blackout berhasil dihapus'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.get('/events/:id/invigilators/assignments', requirePermission('semester.event.view'), async (c) => {
  try {
    const eventId = c.req.param('id');
    await assertSemesterEvent(c.env.DB, eventId);
    const slotId = c.req.query('slot_id');
    const roomId = c.req.query('room_id');
    const assignments = await getInvigilatorAssignments(c.env.DB, eventId, slotId, roomId);
    return c.json(ok(assignments));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/automation/invigilators', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const user = c.get('user');
    const actorId = (user as any).id || (user as any).sub || '';
    const body = await c.req.json().catch(() => ({}));
    const result = await autoAssignInvigilators(c.env.DB, eventId, actorId, body);
    if (!result.success) {
      const code = result.status === 'impossible' ? 409 : 400;
      return c.json(err(result.message, result), code);
    }
    return c.json(ok(result, result.message));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

automation.post('/events/:id/invigilators/assignments/:assignmentId/lock', requirePermission('semester.event.manage'), async (c) => {
  try {
    const eventId = c.req.param('id');
    const assignmentId = c.req.param('assignmentId');
    const body = await c.req.json().catch(() => ({}));
    const isLocked = body.is_locked !== false && body.is_locked !== 0;
    const res = await setInvigilatorAssignmentLock(c.env.DB, eventId, assignmentId, isLocked);
    if (!res.success) return c.json(err(res.error || 'Gagal mengubah kunci pengawas'), 400);
    return c.json(ok({ is_locked: isLocked ? 1 : 0 }, 'Kunci penugasan pengawas berhasil diubah'));
  } catch (e: any) {
    return handleDomainError(e, c);
  }
});

export default automation;
