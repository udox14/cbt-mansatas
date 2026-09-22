// ============================================================
// TKA Domain — Event Management & Lifecycle Service
//
// Authoritative event lifecycle orchestration for mode = 'tka'.
// Enforces:
// 1. Strict mode === 'tka' domain isolation
// 2. Canonical 6-stage lifecycle with readiness gate on 'ready'
// 3. Atomic synchronization of member exams' active_status
// 4. Freeze boundary enforcement
// ============================================================

import type { CbtEvent, EventStatus } from '../../../types.ts';
import { newId, now } from '../../../utils/helpers.ts';
import {
  validateEventTransition,
  VALID_TRANSITIONS,
} from '../../platform/event-lifecycle.ts';
import { checkTkaEventReadiness } from './readiness.ts';

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
 * Asserts that an event exists and strictly belongs to mode 'tka'.
 */
export async function assertTkaEvent(db: D1Database, eventId: string): Promise<CbtEvent> {
  const event = await db
    .prepare('SELECT * FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<CbtEvent>();

  if (!event) {
    throw new DomainMismatchError('Event tidak ditemukan');
  }

  if (event.mode !== 'tka') {
    throw new DomainMismatchError(
      `Event '${eventId}' bukan merupakan domain TKA (mode: '${event.mode}'). Operasi TKA ditolak.`
    );
  }

  return event;
}

/**
 * Lists all TKA events with optional filtering.
 */
export async function listTkaEvents(
  db: D1Database,
  filters: { status?: EventStatus; academic_year_id?: string } = {}
): Promise<CbtEvent[]> {
  let sql = "SELECT * FROM cbt_events WHERE mode = 'tka'";
  const params: any[] = [];

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.academic_year_id) {
    sql += ' AND academic_year_id = ?';
    params.push(filters.academic_year_id);
  }

  sql += ' ORDER BY created_at DESC';

  const { results } = await db.prepare(sql).bind(...params).all<CbtEvent>();
  return results || [];
}

/**
 * Retrieves a single TKA event by ID.
 */
export async function getTkaEventById(db: D1Database, eventId: string): Promise<CbtEvent> {
  return assertTkaEvent(db, eventId);
}

/**
 * Creates a new TKA event.
 */
export async function createTkaEvent(
  db: D1Database,
  mansatasDb: D1Database,
  input: {
    code: string;
    name: string;
    academic_year_id: string;
    academic_year_name?: string;
    description?: string;
  },
  createdBy: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const code = (input.code || '').trim().toUpperCase();
  const name = (input.name || '').trim();
  const academicYearId = (input.academic_year_id || '').trim();

  if (!code) return { success: false, error: 'Kode event TKA wajib diisi' };
  if (!name) return { success: false, error: 'Nama event TKA wajib diisi' };
  if (!academicYearId) return { success: false, error: 'Tahun ajaran wajib dipilih' };

  // Validate that academic_year_id exists in MANSATAS_DB
  if (mansatasDb) {
    const taRow = await mansatasDb
      .prepare('SELECT id, nama FROM tahun_ajaran WHERE id = ?')
      .bind(academicYearId)
      .first<any>();
    if (!taRow) {
      return {
        success: false,
        error: `Tahun ajaran '${academicYearId}' tidak valid atau tidak ditemukan di database sekolah`,
      };
    }
  }

  // Check code uniqueness
  const existing = await db
    .prepare('SELECT id FROM cbt_events WHERE code = ?')
    .bind(code)
    .first();
  if (existing) {
    return { success: false, error: `Event dengan kode '${code}' sudah ada` };
  }

  const id = newId();
  await db
    .prepare(
      `INSERT INTO cbt_events (
        id, code, name, mode, activity_type, participant_source,
        status, academic_year_id, academic_year_name, description,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'tka', 'tka', 'mansatas', 'draft', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      code,
      name,
      academicYearId,
      input.academic_year_name || null,
      input.description || null,
      createdBy,
      now(),
      now()
    )
    .run();

  return { success: true, id };
}

/**
 * Updates a TKA event's configuration.
 */
export async function updateTkaEvent(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  input: {
    name?: string;
    academic_year_id?: string;
    academic_year_name?: string;
    description?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const event = await assertTkaEvent(db, eventId);

  // If status >= ready, academic year is frozen
  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    if (input.academic_year_id && input.academic_year_id !== event.academic_year_id) {
      throw new EventFrozenError('Tahun ajaran tidak dapat diubah setelah event mencapai status Ready');
    }
  }

  const updates: string[] = ['updated_at = ?'];
  const params: any[] = [now()];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name.trim());
  }
  if (input.academic_year_id !== undefined) {
    const trimmedTa = String(input.academic_year_id).trim();
    if (!trimmedTa) {
      return { success: false, error: 'Tahun ajaran tidak boleh kosong' };
    }
    if (mansatasDb) {
      const taRow = await mansatasDb
        .prepare('SELECT id, nama FROM tahun_ajaran WHERE id = ?')
        .bind(trimmedTa)
        .first<any>();
      if (!taRow) {
        return { success: false, error: `Tahun ajaran '${trimmedTa}' tidak valid di database sekolah` };
      }
    }
    updates.push('academic_year_id = ?');
    params.push(trimmedTa);
  }
  if (input.academic_year_name !== undefined) {
    updates.push('academic_year_name = ?');
    params.push(input.academic_year_name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }

  params.push(eventId);
  await db.prepare(`UPDATE cbt_events SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  return { success: true };
}

/**
 * Transitions TKA event lifecycle status and atomically synchronizes member exams.
 */
export async function transitionTkaEventStatus(
  db: D1Database,
  eventId: string,
  targetStatus: EventStatus
): Promise<{ success: boolean; error?: string; readiness?: any }> {
  const event = await assertTkaEvent(db, eventId);

  // 1. Validate canonical transition
  const transCheck = validateEventTransition(event.status, targetStatus);
  if (!transCheck.valid) {
    return { success: false, error: transCheck.error };
  }

  // 2. If transitioning to 'ready', evaluate the 10-point readiness gate
  if (targetStatus === 'ready') {
    const readiness = await checkTkaEventReadiness(db, eventId);
    if (!readiness.ready) {
      return {
        success: false,
        error: 'Event TKA belum memenuhi kriteria kesiapan.',
        readiness,
      };
    }
  }

  // 3. Map event status to synchronized exam active_status
  let examActiveStatus: 'draft' | 'configuration' | 'ready' | 'active' | 'finished' = 'draft';
  if (targetStatus === 'draft') examActiveStatus = 'draft';
  else if (targetStatus === 'configuration') examActiveStatus = 'configuration';
  else if (targetStatus === 'ready') examActiveStatus = 'ready';
  else if (targetStatus === 'active') examActiveStatus = 'active';
  else if (targetStatus === 'completed' || targetStatus === 'archived') examActiveStatus = 'finished';

  // 4. Atomic batch update
  const stmts = [
    db
      .prepare('UPDATE cbt_events SET status = ?, updated_at = ? WHERE id = ?')
      .bind(targetStatus, now(), eventId),
    db
      .prepare(
        "UPDATE cbt_exams SET active_status = ?, updated_at = ? WHERE event_id = ? AND mode = 'tka'"
      )
      .bind(examActiveStatus, now(), eventId),
  ];

  await db.batch(stmts);

  return { success: true };
}

/**
 * Deletes a draft TKA event. Blocked if status >= ready or sessions exist.
 */
export async function deleteTkaEvent(
  db: D1Database,
  eventId: string
): Promise<{ success: boolean; error?: string }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      error: `Event tidak dapat dihapus dalam status '${event.status}'. Gunakan arsip atau batalkan ke draft.`,
    };
  }

  const sessionCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM cbt_exam_sessions s
       JOIN cbt_exams e ON s.exam_id = e.id
       WHERE e.event_id = ?`
    )
    .bind(eventId)
    .first<any>();

  if (Number(sessionCount?.cnt || 0) > 0) {
    return {
      success: false,
      error: 'Event tidak dapat dihapus karena sudah ada sesi ujian siswa yang tercatat.',
    };
  }

  // Safely delete cascade
  await db.prepare('DELETE FROM cbt_events WHERE id = ?').bind(eventId).run();
  return { success: true };
}
