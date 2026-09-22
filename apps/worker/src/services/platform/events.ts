// ============================================================
// Event Management Service
//
// Encapsulates database operations for CBT events with explicit mode scoping,
// academic year snapshots, proctor time windows, and lifecycle verification.
// ============================================================

import type { CbtEvent, ExamMode, EventStatus } from '../../types.ts';
import { newId, now } from '../../utils/helpers.ts';
import {
  validateEventPayload,
  validateEventTransition,
  validatePmbEventIntegrity,
  isValidExamMode,
} from './event-lifecycle.ts';

export interface EventListFilters {
  mode?: ExamMode;
  status?: EventStatus;
}

export async function getEventById(db: D1Database, eventId: string): Promise<CbtEvent | null> {
  return db
    .prepare(
      `SELECT id, code, name, mode, activity_type, participant_source, status,
              academic_year_id, academic_year_name, term,
              proctor_access_before_minutes, proctor_access_after_minutes,
              created_by, created_at, updated_at
       FROM cbt_events
       WHERE id = ?`
    )
    .bind(eventId)
    .first<CbtEvent>();
}

export async function listEvents(
  db: D1Database,
  filters: EventListFilters = {}
): Promise<Array<CbtEvent & { exam_count: number; roster_count: number }>> {
  let sql = `
    SELECT e.id, e.code, e.name, e.mode, e.activity_type, e.participant_source, e.status,
           e.academic_year_id, e.academic_year_name, e.term,
           e.proctor_access_before_minutes, e.proctor_access_after_minutes,
           e.created_by, e.created_at, e.updated_at,
           COUNT(DISTINCT ex.id) AS exam_count,
           COUNT(DISTINCT r.source_key || ':' || r.source_id) AS roster_count
    FROM cbt_events e
    LEFT JOIN cbt_exams ex ON ex.event_id = e.id
    LEFT JOIN cbt_exam_roster r ON r.event_id = e.id
  `;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.mode && isValidExamMode(filters.mode)) {
    conditions.push('e.mode = ?');
    params.push(filters.mode);
  }

  if (filters.status) {
    conditions.push('e.status = ?');
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' GROUP BY e.id ORDER BY e.created_at DESC';

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  return results || [];
}

export async function createEventRecord(
  db: D1Database,
  body: any,
  actorUserId: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const validation = validateEventPayload(body, false);
  if (validation.error || !validation.data) {
    return { success: false, error: validation.error || 'Payload tidak valid' };
  }

  const {
    code,
    name,
    mode,
    activityType,
    participantSource,
    academicYearId,
    academicYearName,
    term,
    proctorAccessBeforeMinutes,
    proctorAccessAfterMinutes,
  } = validation.data;

  const id = newId();
  const initialStatus = (body.status === 'configuration' ? 'configuration' : 'draft') as EventStatus;

  try {
    await db
      .prepare(
        `INSERT INTO cbt_events (
           id, code, name, mode, activity_type, participant_source, status,
           academic_year_id, academic_year_name, term,
           proctor_access_before_minutes, proctor_access_after_minutes,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        code,
        name,
        mode,
        activityType,
        participantSource,
        initialStatus,
        academicYearId,
        academicYearName,
        term,
        proctorAccessBeforeMinutes,
        proctorAccessAfterMinutes,
        actorUserId,
        now(),
        now()
      )
      .run();

    return { success: true, id };
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return { success: false, error: 'Kode kegiatan sudah digunakan' };
    }
    throw err;
  }
}

export async function updateEventRecord(
  db: D1Database,
  eventId: string,
  body: any
): Promise<{ success: boolean; error?: string }> {
  const current = await getEventById(db, eventId);
  if (!current) {
    return { success: false, error: 'Kegiatan tidak ditemukan' };
  }

  const pmbCheck = validatePmbEventIntegrity(eventId, { mode: body.mode, code: body.code });
  if (!pmbCheck.valid) {
    return { success: false, error: pmbCheck.error };
  }

  const validation = validateEventPayload({ ...current, ...body }, true);
  if (validation.error || !validation.data) {
    return { success: false, error: validation.error || 'Payload tidak valid' };
  }

  const {
    code,
    name,
    mode,
    activityType,
    participantSource,
    academicYearId,
    academicYearName,
    term,
    proctorAccessBeforeMinutes,
    proctorAccessAfterMinutes,
  } = validation.data;

  // Invariant 1: Event mode is immutable once the event has exams or roster
  if (mode !== current.mode) {
    const examCheck = await db
      .prepare('SELECT COUNT(*) AS total FROM cbt_exams WHERE event_id = ?')
      .bind(eventId)
      .first<any>();
    const rosterCheck = await db
      .prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE event_id = ?')
      .bind(eventId)
      .first<any>();

    const totalExams = Number(examCheck?.total || 0);
    const totalRoster = Number(rosterCheck?.total || 0);

    if (totalExams > 0 || totalRoster > 0) {
      return {
        success: false,
        error: `Mode kegiatan '${current.mode}' tidak dapat diubah karena kegiatan sudah memiliki ${totalExams} ujian dan ${totalRoster} peserta roster.`,
      };
    }
  }

  // Invariant 2: Protect participant_source if roster already exists
  if (participantSource !== current.participant_source) {
    const rosterCheck = await db
      .prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE event_id = ?')
      .bind(eventId)
      .first<any>();
    if (Number(rosterCheck?.total || 0) > 0) {
      return { success: false, error: 'Sumber peserta tidak dapat diubah setelah roster dibuat' };
    }
  }

  // Lifecycle status transition check if status is modified
  let nextStatus: EventStatus = current.status;
  if (body.status && body.status !== current.status) {
    const transitionCheck = validateEventTransition(current.status, body.status);
    if (!transitionCheck.valid) {
      return { success: false, error: transitionCheck.error };
    }
    nextStatus = body.status;
  }

  await db
    .prepare(
      `UPDATE cbt_events
       SET code = ?, name = ?, mode = ?, activity_type = ?, participant_source = ?,
           status = ?, academic_year_id = ?, academic_year_name = ?, term = ?,
           proctor_access_before_minutes = ?, proctor_access_after_minutes = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      code,
      name,
      mode,
      activityType,
      participantSource,
      nextStatus,
      academicYearId,
      academicYearName,
      term,
      proctorAccessBeforeMinutes,
      proctorAccessAfterMinutes,
      now(),
      eventId
    )
    .run();

  return { success: true };
}
