// ============================================================
// TKA Domain — Participant Snapshot & Exam Assignment Service
//
// Handles:
// 1. Initial snapshotting of Grade 12 students and choices
// 2. Atomic diff-based re-synchronization with session guard
// 3. Exactly-5-subject entitlement materialization into cbt_exam_roster
// 4. Canonical room authority synchronization
// 5. Freeze boundary enforcement
// ============================================================

import type { TkaParticipant, TkaValidationStatus } from '../../../types.ts';
import { newId, now } from '../../../utils/helpers.ts';
import { assertTkaEvent, EventFrozenError } from './events.ts';
import { previewTkaParticipants, EvaluatedTkaChoice } from '../../sources/tka.ts';

export interface TkaSyncResult {
  added: number;
  removed: number;
  updated: number;
  unchanged: number;
  roster_rows_created: number;
  roster_rows_removed: number;
}

/**
 * Checks if any exam session already exists for any exam under this TKA event.
 */
export async function hasExistingExamSessions(db: D1Database, eventId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM cbt_exam_sessions s
       JOIN cbt_exams e ON s.exam_id = e.id
       WHERE e.event_id = ?`
    )
    .bind(eventId)
    .first<any>();
  return Number(row?.cnt || 0) > 0;
}

/**
 * Takes snapshot of Grade 12 students and choices into cbt_tka_participants.
 */
export async function snapshotTkaParticipants(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string
): Promise<{ added: number; updated: number; total: number }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError(
      `Peserta tidak dapat disnapshot karena event telah berstatus '${event.status}' (beku)`
    );
  }

  if (!event.academic_year_id) {
    throw new Error('Event TKA belum memiliki tahun ajaran terhubung');
  }

  const taRow = await mansatasDb
    .prepare('SELECT id FROM tahun_ajaran WHERE id = ?')
    .bind(event.academic_year_id)
    .first<any>();
  if (!taRow) {
    throw new Error(`Tahun ajaran '${event.academic_year_id}' pada event tidak valid atau tidak terdaftar di database sekolah`);
  }

  const preview = await previewTkaParticipants(mansatasDb, event.academic_year_id);
  const eligible = preview.eligible_participants;

  if (eligible.length === 0) {
    return { added: 0, updated: 0, total: 0 };
  }

  // Fetch existing snapshot rows to preserve room_id
  const { results: existingRows } = await db
    .prepare('SELECT student_id, room_id FROM cbt_tka_participants WHERE event_id = ?')
    .bind(eventId)
    .all<{ student_id: string; room_id: string | null }>();

  const existingMap = new Map<string, string | null>();
  for (const r of existingRows || []) {
    existingMap.set(r.student_id, r.room_id || null);
  }

  const stmts: any[] = [];
  let added = 0;
  let updated = 0;

  for (const p of eligible) {
    const isExisting = existingMap.has(p.student_id);
    const preservedRoomId = isExisting ? existingMap.get(p.student_id) : null;

    if (isExisting) updated++;
    else added++;

    stmts.push(
      db
        .prepare(
          `INSERT INTO cbt_tka_participants (
            id, event_id, student_id, nisn, nama_lengkap, class_id, class_name,
            gender, mapel_pilihan1_raw, mapel_pilihan2_raw,
            mapel_pilihan1_subject_id, mapel_pilihan2_subject_id,
            validation_status, validation_notes, room_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id, student_id) DO UPDATE SET
            nisn = excluded.nisn,
            nama_lengkap = excluded.nama_lengkap,
            class_id = excluded.class_id,
            class_name = excluded.class_name,
            gender = excluded.gender,
            mapel_pilihan1_raw = excluded.mapel_pilihan1_raw,
            mapel_pilihan2_raw = excluded.mapel_pilihan2_raw,
            mapel_pilihan1_subject_id = excluded.mapel_pilihan1_subject_id,
            mapel_pilihan2_subject_id = excluded.mapel_pilihan2_subject_id,
            validation_status = excluded.validation_status,
            validation_notes = excluded.validation_notes,
            updated_at = excluded.updated_at`
        )
        .bind(
          newId(),
          eventId,
          p.student_id,
          p.nisn,
          p.nama_lengkap,
          p.class_id,
          p.class_name,
          p.gender,
          p.pilihan1_raw,
          p.pilihan2_raw,
          p.pilihan1_subject_id,
          p.pilihan2_subject_id,
          p.validation_status, // Explicit value, no default
          p.validation_notes,
          preservedRoomId || null,
          now(),
          now()
        )
    );
  }

  // Execute in chunks
  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }

  // If subject exams exist, synchronize the exam rosters
  await generateTkaExamRosters(db, eventId);

  return { added, updated, total: eligible.length };
}

/**
 * Performs an atomic, diff-based re-sync of student choices from Mansatas.
 * Strictly rejected if sessions exist or status >= ready.
 */
export async function syncTkaParticipants(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string
): Promise<TkaSyncResult> {
  const event = await assertTkaEvent(db, eventId);

  // 1. Guard: freeze boundary
  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError(
      `Sinkronisasi peserta ditolak karena event telah berstatus '${event.status}' (beku)`
    );
  }

  // 2. Guard: session attempt exists
  const hasSessions = await hasExistingExamSessions(db, eventId);
  if (hasSessions) {
    throw new Error(
      'Sinkronisasi peserta ditolak: sudah terdapat sesi ujian siswa yang tercatat pada event ini'
    );
  }

  if (!event.academic_year_id) {
    throw new Error('Event TKA belum memiliki tahun ajaran terhubung');
  }

  const taRow = await mansatasDb
    .prepare('SELECT id FROM tahun_ajaran WHERE id = ?')
    .bind(event.academic_year_id)
    .first<any>();
  if (!taRow) {
    throw new Error(`Tahun ajaran '${event.academic_year_id}' pada event tidak valid atau tidak terdaftar di database sekolah`);
  }

  // 3. Fetch current live Mansatas state
  const preview = await previewTkaParticipants(mansatasDb, event.academic_year_id);
  const liveMap = new Map<string, EvaluatedTkaChoice>();
  for (const p of preview.eligible_participants) {
    liveMap.set(p.student_id, p);
  }

  // 4. Fetch current CBT snapshot
  const { results: snapRows } = await db
    .prepare('SELECT * FROM cbt_tka_participants WHERE event_id = ?')
    .bind(eventId)
    .all<TkaParticipant>();

  const currentMap = new Map<string, TkaParticipant>();
  for (const r of snapRows || []) {
    currentMap.set(r.student_id, r);
  }

  let added = 0;
  let removed = 0;
  let updated = 0;
  let unchanged = 0;

  const stmts: any[] = [];

  // A. Check for added or updated students
  for (const [studentId, live] of liveMap.entries()) {
    const existing = currentMap.get(studentId);
    if (!existing) {
      added++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO cbt_tka_participants (
              id, event_id, student_id, nisn, nama_lengkap, class_id, class_name,
              gender, mapel_pilihan1_raw, mapel_pilihan2_raw,
              mapel_pilihan1_subject_id, mapel_pilihan2_subject_id,
              validation_status, validation_notes, room_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
          )
          .bind(
            newId(),
            eventId,
            live.student_id,
            live.nisn,
            live.nama_lengkap,
            live.class_id,
            live.class_name,
            live.gender,
            live.pilihan1_raw,
            live.pilihan2_raw,
            live.pilihan1_subject_id,
            live.pilihan2_subject_id,
            live.validation_status,
            live.validation_notes,
            now(),
            now()
          )
      );
    } else {
      // Check if choices or demographic data changed
      const isChoiceDiff =
        existing.mapel_pilihan1_raw !== live.pilihan1_raw ||
        existing.mapel_pilihan2_raw !== live.pilihan2_raw ||
        existing.mapel_pilihan1_subject_id !== live.pilihan1_subject_id ||
        existing.mapel_pilihan2_subject_id !== live.pilihan2_subject_id ||
        existing.validation_status !== live.validation_status;

      if (isChoiceDiff || existing.nama_lengkap !== live.nama_lengkap || existing.class_name !== live.class_name) {
        updated++;
        stmts.push(
          db
            .prepare(
              `UPDATE cbt_tka_participants SET
                nisn = ?, nama_lengkap = ?, class_id = ?, class_name = ?,
                gender = ?, mapel_pilihan1_raw = ?, mapel_pilihan2_raw = ?,
                mapel_pilihan1_subject_id = ?, mapel_pilihan2_subject_id = ?,
                validation_status = ?, validation_notes = ?, updated_at = ?
              WHERE event_id = ? AND student_id = ?`
            )
            .bind(
              live.nisn,
              live.nama_lengkap,
              live.class_id,
              live.class_name,
              live.gender,
              live.pilihan1_raw,
              live.pilihan2_raw,
              live.pilihan1_subject_id,
              live.pilihan2_subject_id,
              live.validation_status,
              live.validation_notes,
              now(),
              eventId,
              studentId
            )
        );
      } else {
        unchanged++;
      }
    }
  }

  // B. Check for removed students
  for (const [studentId, existing] of currentMap.entries()) {
    if (!liveMap.has(studentId)) {
      removed++;
      // Delete participant
      stmts.push(
        db
          .prepare('DELETE FROM cbt_tka_participants WHERE event_id = ? AND student_id = ?')
          .bind(eventId, studentId)
      );
      // Delete from roster
      stmts.push(
        db
          .prepare(
            "DELETE FROM cbt_exam_roster WHERE event_id = ? AND source_key = 'mansatas' AND source_id = ?"
          )
          .bind(eventId, studentId)
      );
    }
  }

  // Execute snapshot mutations
  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }

  // Synchronize exam roster assignments
  const rosterResult = await generateTkaExamRosters(db, eventId);

  return {
    added,
    removed,
    updated,
    unchanged,
    roster_rows_created: rosterResult.created,
    roster_rows_removed: rosterResult.removed,
  };
}

/**
 * Assigns a room to a TKA participant and synchronously updates all their exam roster rows.
 * Maintains: cbt_tka_participants.room_id = canonical authority before freeze.
 */
export async function assignParticipantRoom(
  db: D1Database,
  eventId: string,
  studentId: string,
  roomId: string | null
): Promise<{ success: boolean; error?: string }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penugasan ruangan telah dibekukan pada status Ready/Active');
  }

  // Validate room if provided
  if (roomId) {
    const room = await db.prepare('SELECT id FROM cbt_rooms WHERE id = ?').bind(roomId).first();
    if (!room) return { success: false, error: 'Ruangan tidak ditemukan' };
  }

  const stmts = [
    // 1. Update event-level participant snapshot authority
    db
      .prepare('UPDATE cbt_tka_participants SET room_id = ?, updated_at = ? WHERE event_id = ? AND student_id = ?')
      .bind(roomId, now(), eventId, studentId),
    // 2. Synchronize materialized exam roster rows
    db
      .prepare(
        "UPDATE cbt_exam_roster SET room_id = ?, updated_at = ? WHERE event_id = ? AND source_key = 'mansatas' AND source_id = ?"
      )
      .bind(roomId, now(), eventId, studentId),
  ];

  await db.batch(stmts);
  return { success: true };
}

/**
 * Bulk assigns rooms to participants and synchronously updates roster rows.
 */
export async function bulkAssignParticipantRooms(
  db: D1Database,
  eventId: string,
  assignments: Array<{ student_id: string; room_id: string | null }>
): Promise<{ success: boolean; updated: number }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penugasan ruangan telah dibekukan pada status Ready/Active');
  }

  const stmts: any[] = [];
  for (const a of assignments) {
    stmts.push(
      db
        .prepare('UPDATE cbt_tka_participants SET room_id = ?, updated_at = ? WHERE event_id = ? AND student_id = ?')
        .bind(a.room_id, now(), eventId, a.student_id)
    );
    stmts.push(
      db
        .prepare(
          "UPDATE cbt_exam_roster SET room_id = ?, updated_at = ? WHERE event_id = ? AND source_key = 'mansatas' AND source_id = ?"
        )
        .bind(a.room_id, now(), eventId, a.student_id)
    );
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }

  return { success: true, updated: assignments.length };
}

/**
 * Materializes 5-subject roster rows into cbt_exam_roster for all valid participants.
 * Each valid student gets:
 * - 3 Mandatory Subject Exams (MAT, BIN, BIG)
 * - 2 Elective Subject Exams (Pilihan 1 & Pilihan 2)
 */
export async function generateTkaExamRosters(
  db: D1Database,
  eventId: string
): Promise<{ created: number; removed: number }> {
  // 1. Fetch all subject exams under this TKA event
  const { results: exams } = await db
    .prepare("SELECT id, subject_id, subject_name FROM cbt_exams WHERE event_id = ? AND mode = 'tka'")
    .bind(eventId)
    .all<{ id: string; subject_id: string; subject_name: string }>();

  if (!exams || exams.length === 0) {
    return { created: 0, removed: 0 };
  }

  // Map subject_id -> exam_id
  const subjectToExamMap = new Map<string, string>();
  for (const x of exams) {
    if (x.subject_id) {
      subjectToExamMap.set(x.subject_id, x.id);
    }
  }

  // 2. Fetch all valid participants from cbt_tka_participants
  const { results: participants } = await db
    .prepare(
      "SELECT * FROM cbt_tka_participants WHERE event_id = ? AND validation_status = 'valid'"
    )
    .bind(eventId)
    .all<TkaParticipant>();

  if (!participants || participants.length === 0) {
    return { created: 0, removed: 0 };
  }

  // Fetch mandatory subjects from Mansatas mata_pelajaran mapped in the event
  // Identify mandatory exams by comparing subject_name or standard code
  const mandatoryExamIds: string[] = [];
  for (const x of exams) {
    const sName = (x.subject_name || '').toLowerCase();
    if (
      sName === 'matematika' ||
      sName === 'bahasa indonesia' ||
      sName === 'bahasa inggris'
    ) {
      mandatoryExamIds.push(x.id);
    }
  }

  const insertStmts: any[] = [];
  let createdCount = 0;

  for (const p of participants) {
    // Collect the 5 exam IDs for this student
    const entitledExamIds = new Set<string>();

    // Mandatory exams
    for (const mId of mandatoryExamIds) {
      entitledExamIds.add(mId);
    }

    // Elective 1 exam
    if (p.mapel_pilihan1_subject_id) {
      const e1Id = subjectToExamMap.get(p.mapel_pilihan1_subject_id);
      if (e1Id) entitledExamIds.add(e1Id);
    }

    // Elective 2 exam
    if (p.mapel_pilihan2_subject_id) {
      const e2Id = subjectToExamMap.get(p.mapel_pilihan2_subject_id);
      if (e2Id) entitledExamIds.add(e2Id);
    }

    for (const examId of entitledExamIds) {
      createdCount++;
      insertStmts.push(
        db
          .prepare(
            `INSERT INTO cbt_exam_roster (
              id, exam_id, event_id, source_key, source_id,
              username, nisn, full_name, class_name, grade, gender,
              is_active, metadata_json, room_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?, '12', ?, 1, ?, ?, ?, ?)
            ON CONFLICT(exam_id, source_key, source_id) DO UPDATE SET
              full_name = excluded.full_name,
              class_name = excluded.class_name,
              room_id = excluded.room_id,
              updated_at = excluded.updated_at`
          )
          .bind(
            newId(),
            examId,
            eventId,
            p.student_id,
            p.nisn || p.student_id,
            p.nisn,
            p.nama_lengkap,
            p.class_name,
            p.gender,
            JSON.stringify({ class_id: p.class_id }),
            p.room_id || null,
            now(),
            now()
          )
      );
    }
  }

  for (let i = 0; i < insertStmts.length; i += 50) {
    await db.batch(insertStmts.slice(i, i + 50));
  }

  return { created: createdCount, removed: 0 };
}
