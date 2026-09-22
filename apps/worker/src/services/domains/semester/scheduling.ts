// ============================================================
// Semester Domain — Scheduling & Slot Service
//
// Manages discrete time slots and canonical exam-to-slot bindings.
// Enforces:
// 1. Asia/Jakarta (WIB) time normalization (YYYY-MM-DD, HH:MM)
// 2. Non-overlapping slots on the same date (adjacent windows permitted)
// 3. Participant schedule collision detection (zero common students)
// 4. Atomic token invalidation on reschedule
// 5. Roster compatibility schedule field synchronization
// ============================================================

import type { SemesterSlot, SemesterSchedule, SemesterConflict } from './types.ts';
import { assertSemesterEvent, EventFrozenError } from './events.ts';
import { newId, now } from '../../../utils/helpers.ts';
import { invalidateDownstreamRevisions } from './concurrency.ts';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleConflictError extends Error {
  public status: number = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleConflictError';
  }
}

/**
 * Normalizes and validates slot date and times.
 */
export function normalizeSlotTiming(date: string, start: string, end: string): { slot_date: string; start_time: string; end_time: string } {
  const slot_date = date.trim();
  const start_time = start.trim();
  const end_time = end.trim();

  if (!DATE_REGEX.test(slot_date)) {
    throw new Error(`Format tanggal slot '${slot_date}' tidak valid. Gunakan format YYYY-MM-DD.`);
  }
  if (!TIME_REGEX.test(start_time)) {
    throw new Error(`Format jam mulai '${start_time}' tidak valid. Gunakan format 24 jam HH:MM (contoh: 07:30).`);
  }
  if (!TIME_REGEX.test(end_time)) {
    throw new Error(`Format jam selesai '${end_time}' tidak valid. Gunakan format 24 jam HH:MM (contoh: 09:00).`);
  }

  // Lexical comparison in fixed-length 24h format matches chronological order
  if (start_time >= end_time) {
    throw new Error(`Jam selesai (${end_time}) harus lebih besar daripada jam mulai (${start_time}).`);
  }

  return { slot_date, start_time, end_time };
}

/**
 * Checks whether two time windows on the same date overlap.
 * Non-overlapping condition: max(start_A, start_B) < min(end_A, end_B)
 * Note: Adjacent slots (e.g. 07:30-09:00 and 09:00-10:30) do NOT overlap.
 */
export function isOverlappingTimeWindow(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const maxStart = startA > startB ? startA : startB;
  const minEnd = endA < endB ? endA : endB;
  return maxStart < minEnd;
}

/**
 * Lists all time slots defined for a Semester event.
 */
export async function listSemesterSlots(
  db: D1Database,
  eventId: string
): Promise<SemesterSlot[]> {
  await assertSemesterEvent(db, eventId);

  const { results } = await db
    .prepare(
      `SELECT * FROM cbt_semester_slots
       WHERE event_id = ?
       ORDER BY slot_date ASC, sequence_order ASC, start_time ASC`
    )
    .bind(eventId)
    .all<SemesterSlot>();

  return results || [];
}

/**
 * Creates a new time slot with non-overlapping enforcement.
 */
export async function createSemesterSlot(
  db: D1Database,
  eventId: string,
  input: {
    slot_label?: string;
    label?: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    sequence_order?: number;
  }
): Promise<SemesterSlot> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Jadwal dan sesi dibekukan pada status ready atau lebih tinggi.');
  }

  const rawLabel = input.slot_label || input.label;
  const label = String(rawLabel || '').trim();
  if (!label) throw new Error('Label sesi tidak boleh kosong');

  const { slot_date, start_time, end_time } = normalizeSlotTiming(
    input.slot_date,
    input.start_time,
    input.end_time
  );

  // Check overlap against existing slots on the same date
  const existingSlots = await listSemesterSlots(db, eventId);
  const sameDateSlots = existingSlots.filter((s) => s.slot_date === slot_date);

  for (const existing of sameDateSlots) {
    if (isOverlappingTimeWindow(start_time, end_time, existing.start_time, existing.end_time)) {
      throw new ScheduleConflictError(
        `Sesi baru (${start_time} - ${end_time}) bertabrakan waktu dengan sesi yang sudah ada '${existing.slot_label}' (${existing.start_time} - ${existing.end_time}) pada tanggal ${slot_date}. Sesi tidak boleh tumpang tindih.`
      );
    }
  }

  const id = newId();
  const currentTimestamp = now();
  const sequenceOrder = input.sequence_order || (sameDateSlots.length + 1);

  await db
    .prepare(
      `INSERT INTO cbt_semester_slots (
        id, event_id, slot_label, slot_date, start_time, end_time, sequence_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, eventId, label, slot_date, start_time, end_time, sequenceOrder, currentTimestamp, currentTimestamp)
    .run();

  const created = await db
    .prepare('SELECT * FROM cbt_semester_slots WHERE id = ?')
    .bind(id)
    .first<SemesterSlot>();

  return created!;
}

/**
 * Updates an existing time slot.
 */
export async function updateSemesterSlot(
  db: D1Database,
  eventId: string,
  slotId: string,
  input: {
    slot_label?: string;
    slot_date?: string;
    start_time?: string;
    end_time?: string;
    sequence_order?: number;
  }
): Promise<SemesterSlot> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Jadwal dan sesi dibekukan pada status ready atau lebih tinggi.');
  }

  const slot = await db
    .prepare('SELECT * FROM cbt_semester_slots WHERE id = ? AND event_id = ?')
    .bind(slotId, eventId)
    .first<SemesterSlot>();

  if (!slot) {
    throw new Error('Sesi tidak ditemukan');
  }

  const rawInputLabel = input.slot_label !== undefined ? input.slot_label : (input as any).label;
  const label = rawInputLabel !== undefined ? String(rawInputLabel).trim() : slot.slot_label;
  const targetDate = input.slot_date || slot.slot_date;
  const targetStart = input.start_time || slot.start_time;
  const targetEnd = input.end_time || slot.end_time;
  const sequenceOrder = input.sequence_order !== undefined ? input.sequence_order : slot.sequence_order;

  const { slot_date, start_time, end_time } = normalizeSlotTiming(targetDate, targetStart, targetEnd);

  // Check overlap against other slots on the same date
  const allSlots = await listSemesterSlots(db, eventId);
  const otherSlots = allSlots.filter((s) => s.id !== slotId && s.slot_date === slot_date);

  for (const existing of otherSlots) {
    if (isOverlappingTimeWindow(start_time, end_time, existing.start_time, existing.end_time)) {
      throw new ScheduleConflictError(
        `Perubahan sesi (${start_time} - ${end_time}) bertabrakan waktu dengan sesi '${existing.slot_label}' (${existing.start_time} - ${existing.end_time}) pada tanggal ${slot_date}.`
      );
    }
  }

  const currentTimestamp = now();

  await db
    .prepare(
      `UPDATE cbt_semester_slots
       SET slot_label = ?, slot_date = ?, start_time = ?, end_time = ?, sequence_order = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`
    )
    .bind(label, slot_date, start_time, end_time, sequenceOrder, currentTimestamp, slotId, eventId)
    .run();

  // If timing changed, synchronize roster and purge stale tokens for all exams bound to this slot
  const timingChanged = slot.slot_date !== slot_date || slot.start_time !== start_time || slot.end_time !== end_time || slot.slot_label !== label;
  if (timingChanged) {
    const { results: boundExams } = await db
      .prepare('SELECT exam_id FROM cbt_semester_schedules WHERE slot_id = ? AND event_id = ?')
      .bind(slotId, eventId)
      .all<{ exam_id: string }>();

    const sesiStr = `${label} (${start_time} - ${end_time} WIB)`;

    for (const b of boundExams || []) {
      // Synchronize roster
      await db
        .prepare(
          `UPDATE cbt_exam_roster
           SET tanggal_tes = ?, sesi_tes = ?, updated_at = ?
           WHERE exam_id = ? AND event_id = ?`
        )
        .bind(slot_date, sesiStr, currentTimestamp, b.exam_id, eventId)
        .run();

      // Purge stale tokens
      await db
        .prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?')
        .bind(b.exam_id)
        .run();
    }
  }

  return (await db.prepare('SELECT * FROM cbt_semester_slots WHERE id = ?').bind(slotId).first<SemesterSlot>())!;
}

/**
 * Deletes a time slot (blocked if bound to schedules).
 */
export async function deleteSemesterSlot(
  db: D1Database,
  eventId: string,
  slotId: string
): Promise<void> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penghapusan sesi dibekukan pada status ready atau lebih tinggi.');
  }

  const bound = await db
    .prepare('SELECT COUNT(*) as count FROM cbt_semester_schedules WHERE slot_id = ? AND event_id = ?')
    .bind(slotId, eventId)
    .first<{ count: number }>();

  if (bound && bound.count > 0) {
    throw new Error(
      `Sesi tidak dapat dihapus karena masih terikat pada ${bound.count} ujian. Hapus atau pindahkan jadwal ujian terlebih dahulu.`
    );
  }

  await db
    .prepare('DELETE FROM cbt_semester_slots WHERE id = ? AND event_id = ?')
    .bind(slotId, eventId)
    .run();
}

/**
 * Lists all exam-to-slot schedules for a Semester event with joined slot and exam details.
 */
export async function listSemesterSchedules(
  db: D1Database,
  eventId: string
): Promise<SemesterSchedule[]> {
  await assertSemesterEvent(db, eventId);

  const sql = `
    SELECT sch.id, sch.event_id, sch.exam_id, sch.slot_id, sch.created_at, sch.updated_at,
           e.title AS exam_title, e.subject_name, e.target_grade,
           sl.slot_label, sl.slot_date, sl.start_time, sl.end_time
    FROM cbt_semester_schedules sch
    JOIN cbt_exams e ON sch.exam_id = e.id
    JOIN cbt_semester_slots sl ON sch.slot_id = sl.id
    WHERE sch.event_id = ?
    ORDER BY sl.slot_date ASC, sl.sequence_order ASC, sl.start_time ASC, e.title ASC
  `;

  const { results } = await db.prepare(sql).bind(eventId).all<SemesterSchedule>();
  return results || [];
}

/**
 * Assigns an exam to a canonical slot, checking participant collisions and synchronizing roster & tokens.
 */
export async function assignSemesterExamSlot(
  db: D1Database,
  eventId: string,
  examId: string,
  slotId: string
): Promise<SemesterSchedule> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penjadwalan ujian dibekukan pada status ready atau lebih tinggi.');
  }

  // 1. Verify exam
  const exam = await db
    .prepare('SELECT id, event_id, mode, title, duration_minutes FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<{ id: string; event_id: string; mode: string; title: string; duration_minutes: number }>();

  if (!exam || exam.event_id !== eventId || exam.mode !== 'semester') {
    throw new Error('Ujian semester tidak ditemukan pada event ini');
  }

  // 2. Verify slot
  const slot = await db
    .prepare('SELECT * FROM cbt_semester_slots WHERE id = ? AND event_id = ?')
    .bind(slotId, eventId)
    .first<SemesterSlot>();

  if (!slot) {
    throw new Error('Sesi waktu tidak ditemukan pada event ini');
  }

  // 3. Check exam duration fits slot duration
  const [sH, sM] = slot.start_time.split(':').map(Number);
  const [eH, eM] = slot.end_time.split(':').map(Number);
  const slotDurationMinutes = (eH * 60 + eM) - (sH * 60 + sM);

  if (exam.duration_minutes > slotDurationMinutes) {
    throw new Error(
      `Durasi ujian (${exam.duration_minutes} menit) melebihi durasi sesi (${slotDurationMinutes} menit: ${slot.start_time} - ${slot.end_time}). Ujian tidak muat dalam sesi ini.`
    );
  }

  // 4. Participant Collision Detection: ensure zero common students or audience classes in other exams sharing this slot
  // 4a. Check class audience collision (via cbt_semester_exam_classes)
  const classCollision = await db
    .prepare(
      `SELECT sec1.class_id, e2.title as conflicting_exam
       FROM cbt_semester_exam_classes sec1
       JOIN cbt_semester_exam_classes sec2 ON sec1.class_id = sec2.class_id AND sec1.event_id = sec2.event_id
       JOIN cbt_semester_schedules sch ON sch.exam_id = sec2.exam_id
       JOIN cbt_exams e2 ON e2.id = sec2.exam_id
       WHERE sec1.exam_id = ?
         AND sch.slot_id = ?
         AND sch.exam_id != ?
       LIMIT 1`
    )
    .bind(examId, slotId, examId)
    .first<{ class_id: string; conflicting_exam: string }>();

  if (classCollision) {
    throw new ScheduleConflictError(
      `Tabrakan jadwal peserta terdeteksi: Kelas '${classCollision.class_id}' juga terdaftar pada ujian '${classCollision.conflicting_exam}' yang dijadwalkan pada sesi yang sama (${slot.slot_label}, ${slot.slot_date} ${slot.start_time} - ${slot.end_time} WIB). Dua ujian dengan peserta/kelas yang sama tidak boleh berada dalam satu sesi.`
    );
  }

  // 4b. Check materialized roster collision (via cbt_exam_roster)
  const collision = await db
    .prepare(
      `SELECT r1.source_id as student_id, r1.full_name, e2.title as conflicting_exam
       FROM cbt_exam_roster r1
       JOIN cbt_exam_roster r2 ON r1.source_id = r2.source_id AND r1.event_id = r2.event_id
       JOIN cbt_semester_schedules sch ON sch.exam_id = r2.exam_id
       JOIN cbt_exams e2 ON e2.id = r2.exam_id
       WHERE r1.exam_id = ?
         AND sch.slot_id = ?
         AND sch.exam_id != ?
       LIMIT 1`
    )
    .bind(examId, slotId, examId)
    .first<{ student_id: string; full_name: string; conflicting_exam: string }>();

  if (collision) {
    throw new ScheduleConflictError(
      `Tabrakan jadwal peserta terdeteksi: Siswa '${collision.full_name}' (ID: ${collision.student_id}) juga terdaftar pada ujian '${collision.conflicting_exam}' yang dijadwalkan pada sesi yang sama (${slot.slot_label}, ${slot.slot_date} ${slot.start_time} - ${slot.end_time} WIB). Dua ujian dengan peserta yang sama tidak boleh berada dalam satu sesi.`
    );
  }

  // Check if existing schedule is locked
  const existingSch = await db
    .prepare('SELECT id, slot_id, is_locked FROM cbt_semester_schedules WHERE event_id = ? AND exam_id = ?')
    .bind(eventId, examId)
    .first<{ id: string; slot_id: string; is_locked: number }>();

  if (existingSch && existingSch.is_locked === 1 && existingSch.slot_id !== slotId) {
    throw new Error('Jadwal ujian ini sedang terkunci (locked). Buka kunci jadwal terlebih dahulu.');
  }

  // 5. Upsert schedule binding
  const currentTimestamp = now();
  await db
    .prepare(
      `INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id, is_locked, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(event_id, exam_id) DO UPDATE SET
         slot_id = excluded.slot_id,
         updated_at = excluded.updated_at`
    )
    .bind(newId(), eventId, examId, slotId, currentTimestamp, currentTimestamp)
    .run();

  // 6. Synchronize roster compatibility fields
  const sesiStr = `${slot.slot_label} (${slot.start_time} - ${slot.end_time} WIB)`;
  await db
    .prepare(
      `UPDATE cbt_exam_roster
       SET tanggal_tes = ?, sesi_tes = ?, updated_at = ?
       WHERE exam_id = ? AND event_id = ?`
    )
    .bind(slot.slot_date, sesiStr, currentTimestamp, examId, eventId)
    .run();

  // 7. Atomically purge existing tokens for the exam (they are now obsolete)
  await db
    .prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?')
    .bind(examId)
    .run();

  // Invalidate downstream
  await invalidateDownstreamRevisions(db, eventId, 'timetable');

  const updatedSchedules = await listSemesterSchedules(db, eventId);
  return updatedSchedules.find((s) => s.exam_id === examId)!;
}

/**
 * Removes an exam's schedule binding, resetting roster schedule fields and purging tokens.
 */
export async function removeSemesterExamSlot(
  db: D1Database,
  eventId: string,
  scheduleOrExamId: string
): Promise<void> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penjadwalan ujian dibekukan pada status ready atau lebih tinggi.');
  }

  const sch = await db
    .prepare('SELECT id, exam_id, is_locked FROM cbt_semester_schedules WHERE (id = ? OR exam_id = ?) AND event_id = ?')
    .bind(scheduleOrExamId, scheduleOrExamId, eventId)
    .first<{ id: string; exam_id: string; is_locked: number }>();

  if (!sch) {
    throw new Error('Jadwal tidak ditemukan');
  }

  if (sch.is_locked === 1) {
    throw new Error('Jadwal ujian ini sedang terkunci (locked). Buka kunci jadwal terlebih dahulu.');
  }

  const currentTimestamp = now();

  // 1. Delete schedule
  await db
    .prepare('DELETE FROM cbt_semester_schedules WHERE id = ? AND event_id = ?')
    .bind(sch.id, eventId)
    .run();

  // 2. Clear roster compatibility fields
  await db
    .prepare(
      `UPDATE cbt_exam_roster
       SET tanggal_tes = '', sesi_tes = '', updated_at = ?
       WHERE exam_id = ? AND event_id = ?`
    )
    .bind(currentTimestamp, sch.exam_id, eventId)
    .run();

  // 3. Purge tokens
  await db
    .prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?')
    .bind(sch.exam_id)
    .run();

  // Invalidate downstream
  await invalidateDownstreamRevisions(db, eventId, 'timetable');
}

/**
 * Detects all participant collisions across exams sharing slots in a Semester event.
 */
export async function detectSemesterParticipantConflicts(
  db: D1Database,
  eventId: string
): Promise<SemesterConflict[]> {
  await assertSemesterEvent(db, eventId);

  const sql = `
    SELECT
      sl.id AS slot_id,
      sl.slot_label,
      sl.slot_date,
      sl.start_time,
      sl.end_time,
      e1.id AS exam1_id,
      e1.title AS exam1_title,
      e2.id AS exam2_id,
      e2.title AS exam2_title,
      r1.source_id AS conflicting_student_id,
      r1.full_name AS conflicting_student_name
    FROM cbt_semester_schedules sch1
    JOIN cbt_semester_schedules sch2
      ON sch1.event_id = sch2.event_id
     AND sch1.slot_id = sch2.slot_id
     AND sch1.exam_id < sch2.exam_id
    JOIN cbt_semester_slots sl ON sl.id = sch1.slot_id
    JOIN cbt_exams e1 ON e1.id = sch1.exam_id
    JOIN cbt_exams e2 ON e2.id = sch2.exam_id
    JOIN cbt_exam_roster r1 ON r1.exam_id = e1.id
    JOIN cbt_exam_roster r2 ON r2.exam_id = e2.id AND r1.source_id = r2.source_id
    WHERE sch1.event_id = ?
    ORDER BY sl.slot_date ASC, sl.start_time ASC, r1.full_name ASC
  `;

  const { results } = await db.prepare(sql).bind(eventId).all<SemesterConflict>();
  return results || [];
}
