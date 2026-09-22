// ============================================================
// Semester Domain — Participant Snapshot & Resync Service
//
// Manages the event-level multi-grade student entitlement snapshot.
// Enforces:
// 1. Multi-grade student discovery from MANSATAS_DB (Grades 10, 11, 12)
// 2. Historical academic-year class promotion resolution via riwayat_kelas fallback
// 3. Atomic diff-based resync (preserves existing room_id and nomor_peserta)
// 4. Freeze boundary enforcement (no mutations at ready+)
// 5. Canonical room assignment with roster synchronization
// ============================================================

import type { SemesterParticipant } from './types.ts';
import { assertSemesterEvent, EventFrozenError } from './events.ts';
import { formatStudentClassName } from '../../sources/students.ts';
import { getActiveAcademicYear } from '../../sources/teaching-assignments.ts';
import { newId, now } from '../../../utils/helpers.ts';
import { invalidateDownstreamRevisions } from './concurrency.ts';

export interface SnapshotOptions {
  grades?: string[]; // e.g. ['10', '11', '12'] (default: all three)
}

export interface SnapshotSummary {
  totalDiscovered: number;
  inserted: number;
  updated: number;
  removed: number;
  preservedRooms: number;
}

/**
 * Snapshots or atomically resyncs multi-grade students from MANSATAS_DB into cbt_semester_participants.
 */
export async function snapshotSemesterParticipants(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  options: SnapshotOptions = {}
): Promise<SnapshotSummary> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError(
      `Event '${eventId}' berada dalam status '${event.status}' dan partisipan telah dibekukan.`
    );
  }

  const targetGrades = options.grades && options.grades.length > 0
    ? options.grades
    : ['10', '11', '12'];

  // 1. Resolve Academic Year Context
  let useHistoricalFallback = false;
  let academicYearId = event.academic_year_id;

  if (academicYearId) {
    const activeYear = await getActiveAcademicYear(mansatasDb);
    if (activeYear && activeYear.id !== academicYearId) {
      useHistoricalFallback = true;
    }
  }

  // 2. Fetch Active Students from MANSATAS_DB
  let sourceStudents: any[] = [];

  if (useHistoricalFallback && academicYearId) {
    // Historical resolution via riwayat_kelas
    const sql = `
      SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin,
             k.id AS kelas_id, k.tingkat, k.kelompok, k.nomor_kelas
      FROM riwayat_kelas rk
      JOIN siswa s ON rk.siswa_id = s.id
      JOIN kelas k ON rk.kelas_id = k.id
      WHERE rk.tahun_ajaran_id = ?
        AND (LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')
        AND k.tingkat IN (${targetGrades.map(() => '?').join(',')})
      ORDER BY CAST(k.tingkat AS INTEGER) ASC, k.kelompok ASC, CAST(k.nomor_kelas AS INTEGER) ASC, s.nama_lengkap ASC
    `;
    const { results } = await mansatasDb
      .prepare(sql)
      .bind(academicYearId, ...targetGrades)
      .all<any>();
    sourceStudents = results || [];
  } else {
    // Current class resolution with riwayat_kelas fallback
    const sql = `
      SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin,
             COALESCE(k.id, rk_k.id) AS kelas_id,
             COALESCE(k.tingkat, rk_k.tingkat) AS tingkat,
             COALESCE(k.kelompok, rk_k.kelompok) AS kelompok,
             COALESCE(k.nomor_kelas, rk_k.nomor_kelas) AS nomor_kelas
      FROM siswa s
      LEFT JOIN kelas k ON s.kelas_id = k.id
      LEFT JOIN riwayat_kelas rk ON s.id = rk.siswa_id ${academicYearId ? 'AND rk.tahun_ajaran_id = ?' : ''}
      LEFT JOIN kelas rk_k ON rk.kelas_id = rk_k.id
      WHERE (LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')
        AND CAST(COALESCE(k.tingkat, rk_k.tingkat) AS INTEGER) IN (${targetGrades.map(() => '?').join(',')})
      ORDER BY CAST(COALESCE(k.tingkat, rk_k.tingkat) AS INTEGER) ASC, COALESCE(k.kelompok, rk_k.kelompok) ASC, CAST(COALESCE(k.nomor_kelas, rk_k.nomor_kelas) AS INTEGER) ASC, s.nama_lengkap ASC
    `;
    const bindParams = academicYearId ? [academicYearId, ...targetGrades] : targetGrades;
    const { results } = await mansatasDb
      .prepare(sql)
      .bind(...bindParams)
      .all<any>();
    sourceStudents = results || [];
  }

  // 3. Fetch Existing CBT Semester Participants for Event
  const { results: existingRows } = await db
    .prepare(
      `SELECT id, student_id, room_id, nomor_peserta
       FROM cbt_semester_participants
       WHERE event_id = ?`
    )
    .bind(eventId)
    .all<{ id: string; student_id: string; room_id: string | null; nomor_peserta: string | null }>();

  const existingMap = new Map<string, { id: string; room_id: string | null; nomor_peserta: string | null }>();
  for (const row of existingRows || []) {
    existingMap.set(row.student_id, {
      id: row.id,
      room_id: row.room_id,
      nomor_peserta: row.nomor_peserta,
    });
  }

  const currentSourceIds = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let preservedRooms = 0;
  const currentTimestamp = now();

  // 4. Atomic Diff-Based Upsert
  for (const row of sourceStudents) {
    const studentId = String(row.id);
    currentSourceIds.add(studentId);

    const className = formatStudentClassName(row.tingkat, row.kelompok, row.nomor_kelas);
    const grade = String(row.tingkat || '');
    const gender = row.jenis_kelamin ? String(row.jenis_kelamin) : null;
    const nisn = row.nisn ? String(row.nisn) : null;
    const nisLokal = row.nis_lokal ? String(row.nis_lokal) : null;
    const classId = row.kelas_id ? String(row.kelas_id) : null;
    const namaLengkap = String(row.nama_lengkap || '').trim();

    const existing = existingMap.get(studentId);

    if (!existing) {
      // New participant
      await db
        .prepare(
          `INSERT INTO cbt_semester_participants (
            id, event_id, student_id, nisn, nis_lokal, nama_lengkap, gender,
            class_id, class_name, grade, room_id, nomor_peserta, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
        )
        .bind(
          newId(),
          eventId,
          studentId,
          nisn,
          nisLokal,
          namaLengkap,
          gender,
          classId,
          className,
          grade,
          currentTimestamp,
          currentTimestamp
        )
        .run();
      inserted++;
    } else {
      // Existing participant: update metadata without wiping room_id or nomor_peserta
      if (existing.room_id) {
        preservedRooms++;
      }
      await db
        .prepare(
          `UPDATE cbt_semester_participants
           SET nisn = ?, nis_lokal = ?, nama_lengkap = ?, gender = ?,
               class_id = ?, class_name = ?, grade = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          nisn,
          nisLokal,
          namaLengkap,
          gender,
          classId,
          className,
          grade,
          currentTimestamp,
          existing.id
        )
        .run();
      updated++;
    }
  }

  // 5. Detect and Handle Removed Students
  let removed = 0;
  for (const [studentId, existing] of existingMap.entries()) {
    if (!currentSourceIds.has(studentId)) {
      // Check if student already has active sessions in this event
      const sessionCheck = await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM cbt_exam_sessions s
           JOIN cbt_exams e ON e.id = s.exam_id
           WHERE e.event_id = ? AND s.student_id = ?`
        )
        .bind(eventId, studentId)
        .first<{ count: number }>();

      if (sessionCheck && sessionCheck.count > 0) {
        // Participant has exam sessions; cannot delete
        continue;
      }

      await db
        .prepare('DELETE FROM cbt_semester_participants WHERE id = ?')
        .bind(existing.id)
        .run();
      removed++;
    }
  }

  return {
    totalDiscovered: sourceStudents.length,
    inserted,
    updated,
    removed,
    preservedRooms,
  };
}

/**
 * Lists participants enrolled in a Semester event with filtering and pagination.
 */
export async function listSemesterParticipants(
  db: D1Database,
  eventId: string,
  filters: {
    grade?: string;
    class_id?: string;
    room_id?: string;
    q?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<{ items: SemesterParticipant[]; total: number }> {
  await assertSemesterEvent(db, eventId);

  let where = 'WHERE event_id = ?';
  const params: any[] = [eventId];

  if (filters.grade) {
    where += ' AND grade = ?';
    params.push(filters.grade);
  }
  if (filters.class_id) {
    where += ' AND class_id = ?';
    params.push(filters.class_id);
  }
  if (filters.room_id) {
    where += ' AND room_id = ?';
    params.push(filters.room_id);
  }
  if (filters.q?.trim()) {
    where += ' AND (nama_lengkap LIKE ? OR nisn LIKE ? OR nomor_peserta LIKE ? OR class_name LIKE ?)';
    const term = `%${filters.q.trim()}%`;
    params.push(term, term, term, term);
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM cbt_semester_participants ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total || 0;

  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(200, Math.max(1, filters.page_size || 50));
  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT * FROM cbt_semester_participants
    ${where}
    ORDER BY CAST(grade AS INTEGER) ASC, class_name ASC, nama_lengkap ASC
    LIMIT ? OFFSET ?
  `;

  const { results } = await db
    .prepare(sql)
    .bind(...params, pageSize, offset)
    .all<SemesterParticipant>();

  return { items: results || [], total };
}

/**
 * Assigns rooms to participants and synchronously updates any existing cbt_exam_roster records.
 */
export async function assignSemesterParticipantRooms(
  db: D1Database,
  eventId: string,
  assignments: { participant_id: string; room_id: string | null }[]
): Promise<{ updatedCount: number }> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penugasan ruangan dibekukan pada status ready atau lebih tinggi.');
  }

  let updatedCount = 0;
  const currentTimestamp = now();

  for (const { participant_id, room_id } of assignments) {
    // Validate room scope if not null
    if (room_id) {
      const room = await db
        .prepare('SELECT id, event_id FROM cbt_rooms WHERE id = ?')
        .bind(room_id)
        .first<{ id: string; event_id: string | null }>();

      if (!room) {
        throw new Error(`Ruangan '${room_id}' tidak ditemukan`);
      }

      if (room.event_id !== null && room.event_id !== eventId) {
        throw new Error(
          `Ruangan '${room_id}' bukan ruangan global dan bukan milik event semester ini.`
        );
      }
    }

    // Check participant lock
    const pRecord = await db
      .prepare('SELECT id, student_id, room_id, is_room_locked FROM cbt_semester_participants WHERE id = ? AND event_id = ?')
      .bind(participant_id, eventId)
      .first<{ id: string; student_id: string; room_id: string | null; is_room_locked: number }>();

    if (!pRecord) continue;

    if (pRecord.is_room_locked === 1 && pRecord.room_id !== room_id) {
      throw new Error(`Peserta '${participant_id}' memiliki ruangan terkunci (locked). Buka kunci terlebih dahulu.`);
    }

    // Check seat assignment
    const seatAssign = await db
      .prepare('SELECT id, is_locked FROM cbt_semester_seat_assignments WHERE participant_id = ? AND event_id = ?')
      .bind(participant_id, eventId)
      .first<{ id: string; is_locked: number }>();

    if (seatAssign && pRecord.room_id !== room_id) {
      if (seatAssign.is_locked === 1) {
        throw new Error('Peserta memiliki alokasi kursi terkunci (locked). Buka kunci kursi terlebih dahulu.');
      }
      // Service must clear unlocked seat before changing room
      await db.prepare('DELETE FROM cbt_semester_seat_assignments WHERE id = ?').bind(seatAssign.id).run();
    }

    // 1. Update participant room
    const res = await db
      .prepare(
        `UPDATE cbt_semester_participants
         SET room_id = ?, updated_at = ?
         WHERE id = ? AND event_id = ?`
      )
      .bind(room_id, currentTimestamp, participant_id, eventId)
      .run();

    if (res.meta?.changes && res.meta.changes > 0) {
      updatedCount++;

      // 2. Synchronously update cbt_exam_roster.room_id for this participant
      await db
        .prepare(
          `UPDATE cbt_exam_roster
           SET room_id = ?, updated_at = ?
           WHERE event_id = ? AND source_id = ?`
        )
        .bind(room_id, currentTimestamp, eventId, pRecord.student_id)
        .run();
    }
  }

  if (updatedCount > 0) {
    await invalidateDownstreamRevisions(db, eventId, 'room_allocation');
  }

  return { updatedCount };
}

/**
 * Generates unique participant numbers within the event (e.g. SEM-10-001).
 */
export async function generateSemesterParticipantNumbers(
  db: D1Database,
  eventId: string,
  prefix: string = 'SEM'
): Promise<{ totalNumbered: number }> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penomoran peserta dibekukan pada status ready.');
  }

  const { results: participants } = await db
    .prepare(
      `SELECT id, grade, class_name, nama_lengkap
       FROM cbt_semester_participants
       WHERE event_id = ?
       ORDER BY CAST(grade AS INTEGER) ASC, class_name ASC, nama_lengkap ASC`
    )
    .bind(eventId)
    .all<{ id: string; grade: string; class_name: string; nama_lengkap: string }>();

  if (!participants || participants.length === 0) {
    return { totalNumbered: 0 };
  }

  let index = 1;
  const currentTimestamp = now();

  for (const p of participants) {
    const pad = String(index).padStart(4, '0');
    const nomor = `${prefix}-${p.grade}-${pad}`;

    await db
      .prepare(
        `UPDATE cbt_semester_participants
         SET nomor_peserta = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(nomor, currentTimestamp, p.id)
      .run();

    index++;
  }

  return { totalNumbered: participants.length };
}
