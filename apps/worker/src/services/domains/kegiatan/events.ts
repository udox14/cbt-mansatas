// ============================================================
// Kegiatan Domain — Events Management Service
//
// Governs Kegiatan events with strict domain boundary checks,
// canonical lifecycle transition reuse, and deterministic readiness gates.
// ============================================================

import type { CbtEvent, EventStatus } from '../../../types.ts';
import { newId, now } from '../../../utils/helpers.ts';
import {
  validateEventTransition,
  validateEventPayload,
} from '../../platform/event-lifecycle.ts';
import { checkKegiatanEventReadiness, type EventReadinessResult } from './readiness.ts';

export interface KegiatanEventSummary extends CbtEvent {
  exam_count: number;
  roster_count: number;
}

export class DomainMismatchError extends Error {
  readonly code = 'DOMAIN_MISMATCH';
  constructor(message = 'Event ini bukan bagian dari domain kegiatan') {
    super(message);
    this.name = 'DomainMismatchError';
  }
}

/**
 * Lists all events belonging strictly to the 'kegiatan' mode.
 * Participant count is DISTINCT per event (source_key + source_id).
 */
export async function listKegiatanEvents(
  db: D1Database,
  filters: { status?: EventStatus } = {}
): Promise<KegiatanEventSummary[]> {
  let sql = `
    SELECT e.id, e.code, e.name, e.mode, e.activity_type, e.participant_source, e.status,
           e.academic_year_id, e.academic_year_name, e.term,
           e.proctor_access_before_minutes, e.proctor_access_after_minutes,
           e.description, e.starts_at, e.ends_at,
           e.created_by, e.created_at, e.updated_at,
           COUNT(DISTINCT ex.id) AS exam_count,
           COUNT(DISTINCT r.source_key || ':' || r.source_id) AS roster_count
    FROM cbt_events e
    LEFT JOIN cbt_exams ex ON ex.event_id = e.id
    LEFT JOIN cbt_exam_roster r ON r.event_id = e.id
    WHERE e.mode = 'kegiatan'
  `;

  const params: any[] = [];
  if (filters.status) {
    sql += ' AND e.status = ?';
    params.push(filters.status);
  }

  sql += ' GROUP BY e.id ORDER BY e.created_at DESC';

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  return (results || []).map((row) => ({
    ...row,
    exam_count: Number(row.exam_count || 0),
    roster_count: Number(row.roster_count || 0),
  }));
}

/**
 * Retrieves a single Kegiatan event by ID with strict domain boundary check.
 */
export async function getKegiatanEventById(
  db: D1Database,
  eventId: string
): Promise<KegiatanEventSummary | null> {
  const event = await db
    .prepare(
      `SELECT e.id, e.code, e.name, e.mode, e.activity_type, e.participant_source, e.status,
              e.academic_year_id, e.academic_year_name, e.term,
              e.proctor_access_before_minutes, e.proctor_access_after_minutes,
              e.description, e.starts_at, e.ends_at,
              e.created_by, e.created_at, e.updated_at,
              COUNT(DISTINCT ex.id) AS exam_count,
              COUNT(DISTINCT r.source_key || ':' || r.source_id) AS roster_count
       FROM cbt_events e
       LEFT JOIN cbt_exams ex ON ex.event_id = e.id
       LEFT JOIN cbt_exam_roster r ON r.event_id = e.id
       WHERE e.id = ?
       GROUP BY e.id`
    )
    .bind(eventId)
    .first<any>();

  if (!event) return null;
  if (event.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${event.mode}', bukan domain 'kegiatan'`);
  }

  return {
    ...event,
    exam_count: Number(event.exam_count || 0),
    roster_count: Number(event.roster_count || 0),
  };
}

/**
 * Creates a new Kegiatan event enforcing mode='kegiatan'.
 */
export async function createKegiatanEvent(
  db: D1Database,
  body: any,
  actorUserId: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const payload = {
    ...body,
    mode: 'kegiatan',
    participant_source: body.participant_source || 'mansatas',
  };

  const validation = validateEventPayload(payload, false);
  if (validation.error || !validation.data) {
    return { success: false, error: validation.error || 'Payload tidak valid' };
  }

  const {
    code,
    name,
    participantSource,
    academicYearId,
    academicYearName,
    term,
    proctorAccessBeforeMinutes,
    proctorAccessAfterMinutes,
  } = validation.data;

  const id = newId();
  const initialStatus = (body.status === 'configuration' ? 'configuration' : 'draft') as EventStatus;
  const description = body.description ? String(body.description).trim().slice(0, 1000) : null;
  const startsAt = body.starts_at ? String(body.starts_at).trim() : null;
  const endsAt = body.ends_at ? String(body.ends_at).trim() : null;

  try {
    await db
      .prepare(
        `INSERT INTO cbt_events (
           id, code, name, mode, activity_type, participant_source, status,
           academic_year_id, academic_year_name, term,
           proctor_access_before_minutes, proctor_access_after_minutes,
           description, starts_at, ends_at,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, 'kegiatan', 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        code,
        name,
        participantSource,
        initialStatus,
        academicYearId,
        academicYearName,
        term,
        proctorAccessBeforeMinutes,
        proctorAccessAfterMinutes,
        description,
        startsAt,
        endsAt,
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

/**
 * Updates a Kegiatan event, enforcing domain isolation and mode immutability.
 */
export async function updateKegiatanEvent(
  db: D1Database,
  eventId: string,
  body: any
): Promise<{ success: boolean; error?: string }> {
  const current = await db
    .prepare('SELECT * FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!current) {
    return { success: false, error: 'Kegiatan tidak ditemukan' };
  }

  if (current.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${current.mode}', bukan 'kegiatan'`);
  }

  const payload = {
    ...current,
    ...body,
    mode: 'kegiatan', // Mode remains strictly immutable
  };

  const validation = validateEventPayload(payload, true);
  if (validation.error || !validation.data) {
    return { success: false, error: validation.error || 'Payload tidak valid' };
  }

  const {
    code,
    name,
    participantSource,
    academicYearId,
    academicYearName,
    term,
    proctorAccessBeforeMinutes,
    proctorAccessAfterMinutes,
  } = validation.data;

  const description = body.description !== undefined ? (body.description ? String(body.description).trim().slice(0, 1000) : null) : current.description;
  const startsAt = body.starts_at !== undefined ? (body.starts_at ? String(body.starts_at).trim() : null) : current.starts_at;
  const endsAt = body.ends_at !== undefined ? (body.ends_at ? String(body.ends_at).trim() : null) : current.ends_at;

  await db
    .prepare(
      `UPDATE cbt_events
       SET code = ?, name = ?, participant_source = ?,
           academic_year_id = ?, academic_year_name = ?, term = ?,
           proctor_access_before_minutes = ?, proctor_access_after_minutes = ?,
           description = ?, starts_at = ?, ends_at = ?,
           updated_at = ?
       WHERE id = ? AND mode = 'kegiatan'`
    )
    .bind(
      code,
      name,
      participantSource,
      academicYearId,
      academicYearName,
      term,
      proctorAccessBeforeMinutes,
      proctorAccessAfterMinutes,
      description,
      startsAt,
      endsAt,
      now(),
      eventId
    )
    .run();

  return { success: true };
}

/**
 * Transitions a Kegiatan event status by:
 * 1. Verifying domain boundary (mode == 'kegiatan')
 * 2. Evaluating server-side readiness gate when transitioning configuration -> ready
 * 3. Delegating lifecycle transition validation to canonical validateEventTransition
 * 4. Persisting the transition.
 */
export async function transitionKegiatanEventStatus(
  db: D1Database,
  eventId: string,
  targetStatus: EventStatus
): Promise<{ success: boolean; error?: string; readiness?: EventReadinessResult }> {
  const current = await db
    .prepare('SELECT id, status, mode FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!current) {
    return { success: false, error: 'Kegiatan tidak ditemukan' };
  }

  if (current.mode !== 'kegiatan') {
    throw new DomainMismatchError(`Event '${eventId}' bertipe '${current.mode}', bukan 'kegiatan'`);
  }

  // 1. Kegiatan-specific Readiness Gate
  if (current.status === 'configuration' && targetStatus === 'ready') {
    const readiness = await checkKegiatanEventReadiness(db, eventId);
    if (!readiness.ready) {
      const failedChecks = readiness.checks.filter((c) => c.blocking && !c.ok);
      const reasons = failedChecks.map((c) => c.message).join('; ');
      return {
        success: false,
        error: `Kegiatan belum siap: ${reasons}`,
        readiness,
      };
    }
  }

  // 2. Canonical platform lifecycle transition evaluation
  const transitionCheck = validateEventTransition(current.status as EventStatus, targetStatus);
  if (!transitionCheck.valid) {
    return { success: false, error: transitionCheck.error };
  }

  // 3. Persist transition
  await db
    .prepare('UPDATE cbt_events SET status = ?, updated_at = ? WHERE id = ? AND mode = ?')
    .bind(targetStatus, now(), eventId, 'kegiatan')
    .run();

  return { success: true };
}
