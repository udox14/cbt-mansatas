// ============================================================
// Kegiatan Domain — Participants & Roster Snapshot Service
//
// Governs participant browsing from Mansatas student adapter and
// explicit ID roster snapshotting into cbt_exam_roster.
// ============================================================

import { newId, now } from '../../../utils/helpers.ts';
import {
  listStudentsFromMansatas,
  type MansatasStudentFilters,
} from '../../sources/students.ts';
import { DomainMismatchError } from './events.ts';

export interface RosterSnapshotOptions {
  room_id?: string | null;
  tanggal_tes?: string;
  sesi_tes?: string;
}

export interface RosterSnapshotResult {
  matched: number;
  added: number;
  skipped: number;
}

/**
 * Lists eligible students from Mansatas student adapter.
 */
export async function listKegiatanEligibleStudents(
  mansatasDb: D1Database | undefined,
  filters: MansatasStudentFilters
) {
  if (!mansatasDb) {
    return { items: [], total: 0 };
  }
  return listStudentsFromMansatas(mansatasDb, filters);
}

/**
 * Lists snapshotted roster participants for a Kegiatan event (and optional exam).
 */
export async function listKegiatanEventRoster(
  db: D1Database,
  eventId: string,
  examId?: string
) {
  const event = await db
    .prepare('SELECT id, mode FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!event) {
    throw new Error('Kegiatan tidak ditemukan');
  }
  if (event.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${event.mode}', bukan 'kegiatan'`);
  }

  let sql = `
    SELECT r.id, r.exam_id, r.event_id, r.source_key, r.source_id, r.username, r.nisn, r.full_name,
           r.class_name, r.grade, r.gender, r.room_id, r.tanggal_tes, r.sesi_tes,
           r.created_at, r.updated_at,
           ex.title AS exam_title,
           rm.room_name
    FROM cbt_exam_roster r
    LEFT JOIN cbt_exams ex ON ex.id = r.exam_id
    LEFT JOIN cbt_rooms rm ON rm.id = r.room_id
    WHERE r.event_id = ?
  `;
  const params: any[] = [eventId];

  if (examId) {
    sql += ' AND r.exam_id = ?';
    params.push(examId);
  }

  sql += ' ORDER BY LOWER(r.full_name), r.nisn';

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  return results || [];
}

/**
 * Snapshots explicit student IDs from Mansatas into cbt_exam_roster.
 * Strictly requires explicit student_ids (no implicit mass filter mutation).
 */
export async function batchSnapshotToKegiatanRoster(
  db: D1Database,
  mansatasDb: D1Database | undefined,
  eventId: string,
  examId: string,
  studentIds: string[],
  options: RosterSnapshotOptions = {}
): Promise<RosterSnapshotResult> {
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    throw new Error('Daftar ID siswa wajib disertakan (pilih minimal 1 siswa)');
  }

  // 1. Validate event and domain boundary
  const event = await db
    .prepare('SELECT id, mode FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!event) {
    throw new Error('Kegiatan tidak ditemukan');
  }
  if (event.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${event.mode}', bukan 'kegiatan'`);
  }

  // 2. Validate exam belongs to this event
  const exam = await db
    .prepare('SELECT id, event_id FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<any>();

  if (!exam) {
    throw new Error('Ujian tidak ditemukan');
  }
  if (exam.event_id !== eventId) {
    throw new Error(`Ujian '${examId}' tidak terdaftar pada kegiatan '${eventId}'`);
  }

  // 3. Resolve students via Mansatas adapter
  if (!mansatasDb) {
    throw new Error('Database MANSATAS_DB tidak terhubung');
  }

  const MAX_BATCH_ROSTER_SIZE = 1000;
  const cleanIds = Array.from(new Set(studentIds.map((id) => String(id).trim()).filter(Boolean)));
  if (cleanIds.length === 0) {
    throw new Error('Daftar ID siswa tidak valid');
  }
  if (cleanIds.length > MAX_BATCH_ROSTER_SIZE) {
    throw new Error('Maksimal 1.000 siswa per operasi snapshot');
  }

  const { items: students } = await listStudentsFromMansatas(mansatasDb, {}, cleanIds);
  if (students.length === 0) {
    return { matched: 0, added: 0, skipped: 0 };
  }

  // 4. Validate room if specified
  const roomId = options.room_id ? String(options.room_id).trim() : null;
  if (roomId) {
    const room = await db.prepare('SELECT id FROM cbt_rooms WHERE id = ?').bind(roomId).first();
    if (!room) {
      throw new Error('Ruangan tidak ditemukan');
    }
  }

  const tanggalTes = String(options.tanggal_tes || '').trim().slice(0, 20);
  const sesiTes = String(options.sesi_tes || '').trim().slice(0, 120);

  // 5. Batch insert statements into cbt_exam_roster
  const statements = students.map((s) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO cbt_exam_roster
           (id, exam_id, event_id, source_key, source_id, username, nisn, full_name, class_name, grade, gender, is_active, metadata_json, room_id, tanggal_tes, sesi_tes, created_at, updated_at)
         VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId(),
        examId,
        eventId,
        s.source_id,
        s.username,
        s.nisn || null,
        s.full_name,
        s.class_name || null,
        s.grade || null,
        s.gender || null,
        s.is_active ? 1 : 0,
        JSON.stringify(s.metadata || {}),
        roomId,
        tanggalTes,
        sesiTes,
        now(),
        now()
      )
  );

  let added = 0;
  const BATCH_CHUNK_SIZE = 50;
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);
    const results = await db.batch(chunk);
    added += results.reduce((sum, res: any) => sum + Number(res?.meta?.changes || 0), 0);
  }

  const skipped = Math.max(0, students.length - added);
  return {
    matched: students.length,
    added,
    skipped,
  };
}

/**
 * Removes a student from a Kegiatan exam roster.
 * Rejects if the student has an active or submitted exam session.
 */
export async function removeStudentFromKegiatanRoster(
  db: D1Database,
  eventId: string,
  examId: string,
  rosterId: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Verify event domain
  const event = await db
    .prepare('SELECT id, mode FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!event) {
    return { success: false, error: 'Kegiatan tidak ditemukan' };
  }
  if (event.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${event.mode}', bukan 'kegiatan'`);
  }

  // 2. Verify roster entry
  const roster = await db
    .prepare(
      'SELECT id, source_key, source_id FROM cbt_exam_roster WHERE id = ? AND exam_id = ? AND event_id = ?'
    )
    .bind(rosterId, examId, eventId)
    .first<any>();

  if (!roster) {
    return { success: false, error: 'Peserta roster tidak ditemukan' };
  }

  // 3. Prevent removal if student has an exam session
  const session = await db
    .prepare(
      'SELECT id, status FROM cbt_exam_sessions WHERE exam_id = ? AND user_id = ? AND user_type = ?'
    )
    .bind(examId, roster.source_id, 'mansatas')
    .first<any>();

  if (session) {
    return {
      success: false,
      error: 'Peserta tidak dapat dihapus dari roster karena sesi ujian telah dibuat atau selesai',
    };
  }

  await db
    .prepare('DELETE FROM cbt_exam_roster WHERE id = ? AND exam_id = ? AND event_id = ?')
    .bind(rosterId, examId, eventId)
    .run();

  return { success: true };
}
