// ============================================================
// Admin APIs: multi-kegiatan, source participants, roster snapshot
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { err, newId, now, ok } from '../utils/helpers';
import {
  listMansatasParticipants,
  type NormalizedParticipant,
  type ParticipantFilters,
  type ParticipantSourceKey,
  MansatasConfigError,
} from '../services/participants';
import { getPmbDb, getPmbTable } from '../utils/pmb';

const adminEvents = new Hono<{ Bindings: Env }>();
adminEvents.use('*', authMiddleware, requireRole('admin'));

const PMB_EXCLUDE = "UPPER(COALESCE(jalur, '')) NOT LIKE '%PRESTASI%'";
const SOURCES: ParticipantSourceKey[] = ['pmb', 'mansatas', 'cbt_user'];

type EventRow = {
  id: string;
  code: string;
  name: string;
  activity_type: string;
  participant_source: ParticipantSourceKey;
  status: 'draft' | 'active' | 'archived';
};

type ExtendedFilters = ParticipantFilters & {
  jalur?: string;
  room_name?: string;
  tanggal_tes?: string;
  sesi_tes?: string;
};

function parseActive(value?: string): boolean | undefined {
  if (!value || value === 'all') return undefined;
  if (['1', 'true', 'yes', 'aktif', 'active'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'nonaktif', 'inactive'].includes(value.toLowerCase())) return false;
  return undefined;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function readFilters(c: any): ExtendedFilters {
  return {
    q: c.req.query('q')?.trim() || undefined,
    class_name: c.req.query('class_name')?.trim() || c.req.query('kelas')?.trim() || undefined,
    grade: c.req.query('grade')?.trim() || c.req.query('tingkat')?.trim() || undefined,
    gender: c.req.query('gender')?.trim() || c.req.query('jenis_kelamin')?.trim() || undefined,
    is_active: parseActive(c.req.query('is_active') || c.req.query('status_aktif')),
    page: boundedInt(c.req.query('page'), 1, 1, 100000),
    page_size: boundedInt(c.req.query('page_size'), 50, 1, 100),
    jalur: c.req.query('jalur')?.trim() || undefined,
    room_name: c.req.query('room_name')?.trim() || c.req.query('ruang_tes')?.trim() || undefined,
    tanggal_tes: c.req.query('tanggal_tes')?.trim() || undefined,
    sesi_tes: c.req.query('sesi_tes')?.trim() || undefined,
  };
}

function normalizePmb(row: any): NormalizedParticipant {
  return {
    source_key: 'pmb',
    source_id: String(row.source_id),
    username: String(row.username || row.nisn || ''),
    nisn: String(row.nisn || ''),
    full_name: String(row.full_name || ''),
    class_name: '',
    grade: '',
    gender: String(row.gender || ''),
    is_active: true,
    room_name: row.room_name || null,
    tanggal_tes: row.tanggal_tes || null,
    sesi_tes: row.sesi_tes || null,
    metadata: {
      source: 'pmb',
      no_pendaftaran: row.no_pendaftaran || null,
      jalur: row.jalur || null,
      asal_sekolah: row.asal_sekolah || null,
    },
  };
}

function normalizeCbtUser(row: any): NormalizedParticipant {
  return {
    source_key: 'cbt_user',
    source_id: String(row.source_id),
    username: String(row.username || ''),
    nisn: String(row.nisn || row.username || ''),
    full_name: String(row.full_name || ''),
    class_name: '',
    grade: '',
    gender: '',
    is_active: !!row.is_active,
    room_id: row.room_id || null,
    metadata: { source: 'cbt_user', role: row.role || 'student' },
  };
}

async function listPmbParticipants(
  db: D1Database,
  tableName: string,
  filters: ExtendedFilters,
  ids?: string[],
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  if (filters.is_active === false) return { items: [], total: 0 };
  const where: string[] = [PMB_EXCLUDE];
  const params: (string | number)[] = [];
  if (ids) {
    if (!ids.length) return { items: [], total: 0 };
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (filters.q) {
    where.push('(LOWER(COALESCE(nama_lengkap, \'\')) LIKE ? OR LOWER(COALESCE(nisn, \'\')) LIKE ?)');
    const q = `%${filters.q.toLowerCase()}%`;
    params.push(q, q);
  }
  if (filters.gender) {
    where.push('LOWER(COALESCE(jenis_kelamin, \'\')) = ?');
    params.push(filters.gender.toLowerCase());
  }
  if (filters.jalur) { where.push('LOWER(COALESCE(jalur, \'\')) = ?'); params.push(filters.jalur.toLowerCase()); }
  if (filters.room_name) { where.push('ruang_tes = ?'); params.push(filters.room_name); }
  if (filters.tanggal_tes) { where.push('tanggal_tes = ?'); params.push(filters.tanggal_tes); }
  if (filters.sesi_tes) { where.push('sesi_tes = ?'); params.push(filters.sesi_tes); }
  // PMB existing does not expose class/grade/status-active columns. Its
  // legacy behavior remains authoritative; those filters are applied by the
  // mansatas adapter where the mapped fields actually exist.
  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const page = Math.max(Number(filters.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size || 50), 1), 5000);
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT id AS source_id, nisn AS username, nisn, nama_lengkap AS full_name,
              jenis_kelamin AS gender, ruang_tes AS room_name, tanggal_tes, sesi_tes,
              no_pendaftaran, jalur, asal_sekolah
       FROM ${tableName}${whereSql}
       ORDER BY LOWER(COALESCE(nama_lengkap, '')), nisn
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all(),
    db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}${whereSql}`).bind(...params).first<any>(),
  ]);
  return {
    items: (rows.results as any[]).map(normalizePmb),
    total: Number(count?.total || 0),
  };
}

async function listCbtUsers(
  db: D1Database,
  filters: ExtendedFilters,
  ids?: string[],
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  if (filters.is_active === false) return { items: [], total: 0 };
  const where: string[] = ["role = 'student'", 'is_active = 1'];
  const params: (string | number)[] = [];
  if (ids) {
    if (!ids.length) return { items: [], total: 0 };
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (filters.q) {
    where.push('(LOWER(COALESCE(nama_lengkap, \'\')) LIKE ? OR LOWER(COALESCE(nisn, username, \'\')) LIKE ?)');
    const q = `%${filters.q.toLowerCase()}%`;
    params.push(q, q);
  }
  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const page = Math.max(Number(filters.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size || 50), 1), 5000);
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT id AS source_id, username, nisn, nama_lengkap AS full_name, room_id, is_active, role
       FROM cbt_users${whereSql}
       ORDER BY LOWER(COALESCE(nama_lengkap, '')), username
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all(),
    db.prepare(`SELECT COUNT(*) AS total FROM cbt_users${whereSql}`).bind(...params).first<any>(),
  ]);
  return {
    items: (rows.results as any[]).map(normalizeCbtUser),
    total: Number(count?.total || 0),
  };
}

async function listSourceParticipants(
  c: any,
  source: ParticipantSourceKey,
  filters: ExtendedFilters,
  ids?: string[],
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  if (source === 'mansatas') {
    return listMansatasParticipants(c.env, filters, { ids, max: 5000 });
  }
  if (source === 'pmb') return listPmbParticipants(getPmbDb(c.env), getPmbTable(c.env), filters, ids);
  return listCbtUsers(c.env.DB, filters, ids);
}

async function getEvent(db: D1Database, id: string): Promise<EventRow | null> {
  return db.prepare('SELECT id, code, name, activity_type, participant_source, status FROM cbt_events WHERE id=?')
    .bind(id).first<EventRow>();
}

function sourceFromEvent(event: EventRow): ParticipantSourceKey {
  return SOURCES.includes(event.participant_source) ? event.participant_source : 'pmb';
}

function validateEventBody(body: any) {
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  const source = body.participant_source as ParticipantSourceKey;
  if (!name || name.length > 120) return { error: 'Nama kegiatan wajib diisi dan maksimal 120 karakter' };
  if (!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code)) return { error: 'Kode kegiatan tidak valid' };
  if (!SOURCES.includes(source)) return { error: 'Sumber peserta tidak valid' };
  return { code, name, source, activityType: String(body.activity_type || 'other').trim().slice(0, 40) || 'other' };
}

adminEvents.get('/events', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(DISTINCT ex.id) AS exam_count, COUNT(DISTINCT r.id) AS roster_count
     FROM cbt_events e
     LEFT JOIN cbt_exams ex ON ex.event_id = e.id
     LEFT JOIN cbt_exam_roster r ON r.event_id = e.id
     GROUP BY e.id ORDER BY e.created_at DESC`
  ).all();
  return c.json(ok(results));
});

adminEvents.get('/events/roster-map', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT r.event_id, r.source_key, r.source_id, r.username, r.nisn, r.full_name,
                     r.class_name, r.grade, r.gender, r.room_id, rm.room_name, r.tanggal_tes, r.sesi_tes
     FROM cbt_exam_roster r
     LEFT JOIN cbt_rooms rm ON rm.id = r.room_id OR rm.room_name = r.room_id
     WHERE r.event_id IS NOT NULL`
  ).all();
  return c.json(ok(results));
});

adminEvents.get('/roster', async (c) => {
  const roomId = c.req.query('room_id');
  const eventId = c.req.query('event_id');
  let sql = `SELECT DISTINCT r.id, r.event_id, r.source_key, r.source_id, r.username, r.nisn, r.full_name,
                            r.class_name, r.grade, r.gender, r.room_id, COALESCE(rm.room_name, r.room_id) as room_name,
                            r.tanggal_tes, r.sesi_tes, e.code as event_code, e.name as event_name
             FROM cbt_exam_roster r
             LEFT JOIN cbt_rooms rm ON rm.id = r.room_id OR rm.room_name = r.room_id
             LEFT JOIN cbt_events e ON e.id = r.event_id`;
  const conditions: string[] = [];
  const params: any[] = [];
  if (roomId) {
    conditions.push(`(r.room_id = ? OR rm.room_name = ? OR rm.id = ?)`);
    params.push(roomId, roomId, roomId);
  }
  if (eventId) {
    conditions.push(`r.event_id = ?`);
    params.push(eventId);
  }
  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }
  sql += ` ORDER BY LOWER(r.full_name), r.nisn`;
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(results));
});


adminEvents.post('/events', async (c) => {
  const body = await c.req.json<any>();
  const parsed = validateEventBody(body);
  if ('error' in parsed) return c.json(err(parsed.error || 'Data kegiatan tidak valid'), 400);
  const id = newId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status, created_by)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(id, parsed.code, parsed.name, parsed.activityType, parsed.source, body.status === 'draft' ? 'draft' : 'active', c.get('user').sub).run();
  } catch (e: any) {
    if (String(e?.message || '').toLowerCase().includes('unique')) return c.json(err('Kode kegiatan sudah digunakan'), 409);
    throw e;
  }
  return c.json(ok({ id }, 'Kegiatan dibuat'), 201);
});

adminEvents.put('/events/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  const current = await getEvent(c.env.DB, eventId);
  if (!current) return c.json(err('Kegiatan tidak ditemukan'), 404);
  const body = await c.req.json<any>();
  const parsed = validateEventBody({ ...current, ...body });
  if ('error' in parsed) return c.json(err(parsed.error || 'Data kegiatan tidak valid'), 400);
  if (parsed.source !== current.participant_source) {
    const rosterCount = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE event_id=?').bind(eventId).first<any>();
    if (Number(rosterCount?.total || 0) > 0) return c.json(err('Sumber peserta tidak dapat diubah setelah roster dibuat'), 409);
  }
  await c.env.DB.prepare(
    `UPDATE cbt_events SET code=?, name=?, activity_type=?, participant_source=?, status=?, updated_at=? WHERE id=?`
  ).bind(parsed.code, parsed.name, parsed.activityType, parsed.source, body.status === 'archived' ? 'archived' : body.status === 'draft' ? 'draft' : current.status, now(), eventId).run();
  return c.json(ok(null, 'Kegiatan diperbarui'));
});

adminEvents.get('/events/:eventId/participants', async (c) => {
  const event = await getEvent(c.env.DB, c.req.param('eventId'));
  if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);
  const source = sourceFromEvent(event);
  try {
    const filters = readFilters(c);
    const result = await listSourceParticipants(c, source, filters);
    return c.json(ok({
      source,
      items: result.items,
      pagination: { page: filters.page, page_size: filters.page_size, total: result.total, total_pages: Math.ceil(result.total / Number(filters.page_size || 50)) },
    }));
  } catch (e) {
    if (e instanceof MansatasConfigError) return c.json(err(e.message), 503);
    throw e;
  }
});

adminEvents.post('/exams/:examId/roster/batch', async (c) => {
  const examId = c.req.param('examId');
  const body = await c.req.json<any>();
  const event = await getEvent(c.env.DB, String(body.event_id || ''));
  if (!event) return c.json(err('Kegiatan tidak ditemukan'), 404);
  const exam = await c.env.DB.prepare('SELECT id, event_id FROM cbt_exams WHERE id=?').bind(examId).first<any>();
  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);

  const filters: ExtendedFilters = {
    ...(body.filters || {}),
    page: 1,
    page_size: 5000,
  };
  const participantIds: string[] = Array.from(new Set<string>(
    (Array.isArray(body.participant_ids) ? body.participant_ids : []).map((id: unknown) => String(id).trim()).filter(Boolean)
  ));
  const selectAll = body.select_all === true;
  if (!selectAll && participantIds.length === 0) {
    return c.json(err('Pilih peserta atau aktifkan select_all'), 400);
  }
  let selected: { items: NormalizedParticipant[]; total: number };
  try {
    selected = await listSourceParticipants(c, sourceFromEvent(event), filters, selectAll ? undefined : participantIds);
  } catch (e) {
    if (e instanceof MansatasConfigError) return c.json(err(e.message), 503);
    throw e;
  }
  if (selected.total > 5000 && selectAll) return c.json(err('Hasil filter melebihi batas batch 5.000 peserta; persempit filter'), 413);
  const participants = selected.items;
  if (exam.event_id && exam.event_id !== event.id) {
    const rosterCount = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE exam_id=?').bind(examId).first<any>();
    const assignmentCount = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM cbt_exam_assignments WHERE exam_id=?').bind(examId).first<any>();
    if (Number(rosterCount?.total || 0) > 0 || Number(assignmentCount?.total || 0) > 0) {
      return c.json(err('Ujian sudah memiliki peserta/roster pada kegiatan lain'), 409);
    }
    await c.env.DB.prepare('UPDATE cbt_exams SET event_id=?, updated_at=? WHERE id=?').bind(event.id, now(), examId).run();
  } else if (!exam.event_id) {
    await c.env.DB.prepare('UPDATE cbt_exams SET event_id=?, updated_at=? WHERE id=?').bind(event.id, now(), examId).run();
  }
  const roomId = body.room_id ? String(body.room_id) : null;
  if (roomId) {
    const room = await c.env.DB.prepare('SELECT id FROM cbt_rooms WHERE id=?').bind(roomId).first();
    if (!room) return c.json(err('Ruangan tidak ditemukan'), 400);
  }
  const tanggalTes = String(body.tanggal_tes || '').trim().slice(0, 20);
  const sesiTes = String(body.sesi_tes || '').trim().slice(0, 120);
  const statements = participants.map(p => c.env.DB.prepare(
    `INSERT OR IGNORE INTO cbt_exam_roster
       (id, exam_id, event_id, source_key, source_id, username, nisn, full_name, class_name, grade, gender, is_active, metadata_json, room_id, tanggal_tes, sesi_tes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    newId(), examId, event.id, p.source_key, p.source_id, p.username, p.nisn || null, p.full_name,
    p.class_name || null, p.grade || null, p.gender || null, p.is_active ? 1 : 0,
    JSON.stringify(p.metadata || {}), roomId, tanggalTes, sesiTes,
  ));
  let added = 0;
  for (let i = 0; i < statements.length; i += 100) {
    const results = await c.env.DB.batch(statements.slice(i, i + 100));
    added += results.reduce((sum: number, result: any) => sum + Number(result?.meta?.changes || 0), 0);
  }
  return c.json(ok({ matched: participants.length, added, skipped: Math.max(0, participants.length - added) }, 'Roster berhasil diproses'));
});

adminEvents.get('/exams/:examId/roster', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, rm.room_name, e.name AS event_name, e.code AS event_code
     FROM cbt_exam_roster r
     LEFT JOIN cbt_rooms rm ON rm.id = r.room_id
     LEFT JOIN cbt_events e ON e.id = r.event_id
     WHERE r.exam_id=? ORDER BY LOWER(r.full_name), r.nisn`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

adminEvents.put('/exams/:examId/roster/:rosterId', async (c) => {
  const examId = c.req.param('examId');
  const rosterId = c.req.param('rosterId');
  const roster = await c.env.DB.prepare('SELECT id FROM cbt_exam_roster WHERE id=? AND exam_id=?').bind(rosterId, examId).first();
  if (!roster) return c.json(err('Roster tidak ditemukan'), 404);
  const body = await c.req.json<any>();
  const roomId = body.room_id ? String(body.room_id) : null;
  if (roomId) {
    const room = await c.env.DB.prepare('SELECT id FROM cbt_rooms WHERE id=?').bind(roomId).first();
    if (!room) return c.json(err('Ruangan tidak ditemukan'), 400);
  }
  await c.env.DB.prepare(
    `UPDATE cbt_exam_roster SET room_id=?, tanggal_tes=?, sesi_tes=?, updated_at=? WHERE id=? AND exam_id=?`
  ).bind(roomId, String(body.tanggal_tes || '').trim().slice(0, 20), String(body.sesi_tes || '').trim().slice(0, 120), now(), rosterId, examId).run();
  return c.json(ok(null, 'Roster diperbarui'));
});

adminEvents.delete('/exams/:examId/roster/:rosterId', async (c) => {
  const examId = c.req.param('examId');
  const rosterId = c.req.param('rosterId');
  const roster = await c.env.DB.prepare(
    'SELECT source_key, source_id FROM cbt_exam_roster WHERE id=? AND exam_id=?'
  ).bind(rosterId, examId).first<any>();
  if (!roster) return c.json(err('Roster tidak ditemukan'), 404);
  const userType = roster.source_key === 'pmb' ? 'pendaftar' : roster.source_key;
  const session = await c.env.DB.prepare(
    'SELECT id, status FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
  ).bind(examId, roster.source_id, userType).first<any>();
  if (session) return c.json(err('Roster tidak dapat dihapus setelah sesi dibuat'), 409);
  await c.env.DB.prepare('DELETE FROM cbt_exam_roster WHERE id=? AND exam_id=?').bind(rosterId, examId).run();
  return c.json(ok(null, 'Roster dihapus'));
});

export default adminEvents;
