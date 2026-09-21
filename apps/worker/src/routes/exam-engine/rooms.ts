import { Hono } from 'hono';
import type { Env } from '../../types.ts';
import { ok, err } from '../../utils/helpers.ts';
import {
  listRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  listProctors,
  assignProctor,
} from '../../services/exam-engine/rooms.ts';


export const roomsRoutes = new Hono<{ Bindings: Env }>();

roomsRoutes.get('/rooms', async (c) => {
  const eventId = c.req.query('event_id');
  const rooms = await listRooms(c.env.DB, { event_id: eventId });
  return c.json(ok(rooms));
});

roomsRoutes.post('/rooms', async (c) => {
  const b = await c.req.json();
  const result = await createRoom(c.env.DB, b);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message), 201);
});

roomsRoutes.put('/rooms/:id', async (c) => {
  const b = await c.req.json();
  const result = await updateRoom(c.env.DB, c.req.param('id'), b);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

roomsRoutes.delete('/rooms/:id', async (c) => {
  const result = await deleteRoom(c.env.DB, c.req.param('id'));
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});

roomsRoutes.get('/proctors', async (c) => {
  const proctors = await listProctors(c.env.DB);
  return c.json(ok(proctors));
});

roomsRoutes.put('/proctors/:id/assign', async (c) => {
  const { room_id } = await c.req.json<{ room_id: string | null }>();
  const result = await assignProctor(c.env.DB, c.req.param('id'), room_id);
  if (!result.success) {
    return c.json(err(result.error!), (result.status as any) || 400);
  }
  return c.json(ok(result.data, result.message));
});
