// ============================================================
// Semester Domain — Event Management & Lifecycle Service
//
// Authoritative event lifecycle orchestration for mode = 'semester'.
// Enforces:
// 1. Strict mode === 'semester' domain isolation
// 2. Canonical 6-stage lifecycle with readiness gate on 'ready'
// 3. Rollback guard (ready -> configuration only if 0 sessions exist)
// 4. Atomic synchronization of member exams' active_status
// 5. Safe deletion guard
// ============================================================

import type { CbtEvent, EventStatus } from '../../../types.ts';
import { newId, now } from '../../../utils/helpers.ts';
import { validateEventTransition } from '../../platform/event-lifecycle.ts';
import { checkSemesterEventReadiness } from './readiness.ts';

export class DomainMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainMismatchError';
  }
}

export class EventFrozenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventFrozenError';
  }
}

/**
 * Asserts that an event exists and strictly belongs to mode 'semester'.
 */
export async function assertSemesterEvent(db: D1Database, eventId: string): Promise<CbtEvent> {
  const event = await db
    .prepare('SELECT * FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<CbtEvent>();

  if (!event) {
    throw new DomainMismatchError('Event tidak ditemukan');
  }

  if (event.mode !== 'semester') {
    throw new DomainMismatchError(
      `Event '${eventId}' bukan merupakan domain Semester (mode: '${event.mode}'). Operasi Semester ditolak.`
    );
  }

  return event;
}

/**
 * Lists all Semester events with optional filtering.
 */
export async function listSemesterEvents(
  db: D1Database,
  filters: { status?: EventStatus; academic_year_id?: string; activity_type?: string } = {}
): Promise<CbtEvent[]> {
  let sql = "SELECT * FROM cbt_events WHERE mode = 'semester'";
  const params: any[] = [];

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.academic_year_id) {
    sql += ' AND academic_year_id = ?';
    params.push(filters.academic_year_id);
  }
  if (filters.activity_type) {
    sql += ' AND activity_type = ?';
    params.push(filters.activity_type);
  }

  sql += ' ORDER BY created_at DESC';

  const { results } = await db.prepare(sql).bind(...params).all<CbtEvent>();
  return results || [];
}

/**
 * Retrieves a single Semester event by ID.
 */
export async function getSemesterEventById(db: D1Database, eventId: string): Promise<CbtEvent> {
  return assertSemesterEvent(db, eventId);
}

/**
 * Creates a new Semester event.
 */
export async function createSemesterEvent(
  db: D1Database,
  input: {
    code: string;
    name: string;
    activity_type?: string; // 'pas' | 'pat' | 'sas' | 'asas' | 'sumatif' | 'other'
    academic_year_id?: string;
    academic_year_name?: string;
    term?: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
  },
  createdBy?: string
): Promise<CbtEvent> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();

  if (!code) throw new Error('Kode event tidak boleh kosong');
  if (!name) throw new Error('Nama event tidak boleh kosong');

  // Check unique code
  const existing = await db
    .prepare('SELECT id FROM cbt_events WHERE code = ?')
    .bind(code)
    .first();
  if (existing) {
    throw new Error(`Kode event '${code}' sudah digunakan`);
  }

  const id = newId();
  const activityType = input.activity_type || 'pas';
  const createdAt = now();

  await db
    .prepare(
      `INSERT INTO cbt_events (
        id, code, name, mode, activity_type, participant_source, status,
        academic_year_id, academic_year_name, term, description,
        starts_at, ends_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'semester', ?, 'mansatas', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      code,
      name,
      activityType,
      input.academic_year_id || null,
      input.academic_year_name || null,
      input.term || null,
      input.description || null,
      input.starts_at || null,
      input.ends_at || null,
      createdBy || null,
      createdAt,
      createdAt
    )
    .run();

  return (await getSemesterEventById(db, id))!;
}

/**
 * Updates a Semester event configuration (only allowed before ready).
 */
export async function updateSemesterEvent(
  db: D1Database,
  eventId: string,
  input: {
    name?: string;
    activity_type?: string;
    academic_year_id?: string;
    academic_year_name?: string;
    term?: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
    proctor_access_before_minutes?: number;
    proctor_access_after_minutes?: number;
  }
): Promise<CbtEvent> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError(
      `Event '${eventId}' berada dalam status '${event.status}' dan konfigurasi telah dibekukan.`
    );
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name.trim());
  }
  if (input.activity_type !== undefined) {
    updates.push('activity_type = ?');
    params.push(input.activity_type);
  }
  if (input.academic_year_id !== undefined) {
    updates.push('academic_year_id = ?');
    params.push(input.academic_year_id);
  }
  if (input.academic_year_name !== undefined) {
    updates.push('academic_year_name = ?');
    params.push(input.academic_year_name);
  }
  if (input.term !== undefined) {
    updates.push('term = ?');
    params.push(input.term);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.starts_at !== undefined) {
    updates.push('starts_at = ?');
    params.push(input.starts_at);
  }
  if (input.ends_at !== undefined) {
    updates.push('ends_at = ?');
    params.push(input.ends_at);
  }
  if (input.proctor_access_before_minutes !== undefined) {
    updates.push('proctor_access_before_minutes = ?');
    params.push(input.proctor_access_before_minutes);
  }
  if (input.proctor_access_after_minutes !== undefined) {
    updates.push('proctor_access_after_minutes = ?');
    params.push(input.proctor_access_after_minutes);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(now());
    params.push(eventId);

    await db
      .prepare(`UPDATE cbt_events SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  return (await getSemesterEventById(db, eventId))!;
}

/**
 * Transitions a Semester event to a new lifecycle status.
 */
export async function transitionSemesterEventStatus(
  db: D1Database,
  eventId: string,
  targetStatus: EventStatus
): Promise<{ event: CbtEvent; readiness?: any }> {
  const event = await assertSemesterEvent(db, eventId);

  // Validate lifecycle transition
  validateEventTransition(event.status, targetStatus);

  // Transitioning to ready: enforce readiness gate
  let readinessResult = null;
  if (targetStatus === 'ready') {
    readinessResult = await checkSemesterEventReadiness(db, eventId);
    if (!readinessResult.eligible) {
      throw new Error(
        `Event '${event.name}' belum siap untuk beralih ke status 'ready'. Ditemukan ${readinessResult.blockers.length} kendala: ${readinessResult.blockers.join('; ')}`
      );
    }
  }

  // Rollback from ready -> configuration: check session safety
  if (event.status === 'ready' && targetStatus === 'configuration') {
    const sessionCheck = await db
      .prepare(
        `SELECT COUNT(*) as session_count
         FROM cbt_exam_sessions s
         JOIN cbt_exams e ON e.id = s.exam_id
         WHERE e.event_id = ?`
      )
      .bind(eventId)
      .first<{ session_count: number }>();

    if (sessionCheck && sessionCheck.session_count > 0) {
      throw new Error(
        `Rollback ke 'configuration' ditolak: sudah terdapat ${sessionCheck.session_count} sesi ujian siswa pada event ini.`
      );
    }
  }

  // Update event status
  const updatedAt = now();
  await db
    .prepare('UPDATE cbt_events SET status = ?, updated_at = ? WHERE id = ?')
    .bind(targetStatus, updatedAt, eventId)
    .run();

  // Synchronize member exams' active_status
  await db
    .prepare('UPDATE cbt_exams SET active_status = ?, updated_at = ? WHERE event_id = ?')
    .bind(targetStatus, updatedAt, eventId)
    .run();

  const updatedEvent = await getSemesterEventById(db, eventId);
  return { event: updatedEvent, readiness: readinessResult };
}

/**
 * Safely deletes a Semester event.
 */
export async function deleteSemesterEvent(db: D1Database, eventId: string): Promise<void> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError(
      `Event '${eventId}' berada dalam status '${event.status}' dan tidak dapat dihapus.`
    );
  }

  const sessionCheck = await db
    .prepare(
      `SELECT COUNT(*) as session_count
       FROM cbt_exam_sessions s
       JOIN cbt_exams e ON e.id = s.exam_id
       WHERE e.event_id = ?`
    )
    .bind(eventId)
    .first<{ session_count: number }>();

  if (sessionCheck && sessionCheck.session_count > 0) {
    throw new Error(
      `Event '${eventId}' tidak dapat dihapus karena sudah memiliki ${sessionCheck.session_count} sesi ujian.`
    );
  }

  await db.prepare('DELETE FROM cbt_events WHERE id = ?').bind(eventId).run();
}
