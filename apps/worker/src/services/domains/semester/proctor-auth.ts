// ============================================================
// Phase 7: Semester Contextual Proctor Authorization & Actions
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { SemesterProctorContext } from './types.ts';
import { now, newId } from '../../../utils/helpers.ts';
import { unlockExamSession, resetSessionDevice, forceSubmitSession } from '../../exam-engine/monitoring.ts';

export interface ProctorResolutionResult {
  authorized: boolean;
  error?: string;
  context?: SemesterProctorContext;
  isAdminBypass?: boolean;
}

// Helper to parse WIB date and time into a Date object
function parseWibDateTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour - 7, minute);
  return new Date(utcMs);
}

/**
 * Resolves whether the calling user is an authorized contextual proctor for a room and slot.
 * Enforces canonical event proctor access window (starts_at - before_minutes, ends_at + after_minutes).
 */
export async function resolveProctorContext(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string,
  user: any,
  mockCurrentTime?: Date
): Promise<ProctorResolutionResult> {
  // 1. Check Global Admin / Platform Manager bypass
  const isGlobalAdmin =
    user.role === 'admin' ||
    (Array.isArray(user.permissions) && (user.permissions.includes('platform.manage') || user.permissions.includes('semester.manage')));

  // Fetch event for canonical proctor access window configuration
  const event = await db
    .prepare('SELECT id, proctor_access_before_minutes, proctor_access_after_minutes FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ id: string; proctor_access_before_minutes?: number; proctor_access_after_minutes?: number }>();

  // Fetch slot and room details
  const slot = await db
    .prepare('SELECT * FROM cbt_semester_slots WHERE id = ? AND event_id = ?')
    .bind(slotId, eventId)
    .first<{ id: string; slot_label: string; slot_date: string; start_time: string; end_time: string }>();

  if (!slot) {
    return { authorized: false, error: 'Time slot not found in this event.' };
  }

  const room = await db
    .prepare('SELECT id, room_name as name FROM cbt_rooms WHERE id = ?')
    .bind(roomId)
    .first<{ id: string; name: string }>();

  if (!room) {
    return { authorized: false, error: 'Room not found.' };
  }

  // Calculate WIB time window from canonical event configuration
  const beforeMinutes = typeof event?.proctor_access_before_minutes === 'number' ? event.proctor_access_before_minutes : 30;
  const afterMinutes = typeof event?.proctor_access_after_minutes === 'number' ? event.proctor_access_after_minutes : 45;

  const windowStart = new Date(parseWibDateTime(slot.slot_date, slot.start_time).getTime() - beforeMinutes * 60 * 1000);
  const windowEnd = new Date(parseWibDateTime(slot.slot_date, slot.end_time).getTime() + afterMinutes * 60 * 1000);
  const currentTime = mockCurrentTime || new Date();

  let windowStatus: 'early' | 'active' | 'expired' = 'active';
  let isWindowActive = true;

  if (currentTime < windowStart) {
    windowStatus = 'early';
    isWindowActive = false;
  } else if (currentTime > windowEnd) {
    windowStatus = 'expired';
    isWindowActive = false;
  }

  if (isGlobalAdmin) {
    return {
      authorized: true,
      isAdminBypass: true,
      context: {
        assignment_id: 'admin_bypass',
        event_id: eventId,
        slot_id: slotId,
        room_id: roomId,
        invigilator_order: 1,
        staff_id: user.staff_id || user.id,
        staff_name: user.nama_lengkap || user.username || 'Administrator',
        slot_label: slot.slot_label,
        slot_date: slot.slot_date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        room_name: room.name,
        is_window_active: true, // admin bypass window
        window_status: windowStatus,
      },
    };
  }

  // 2. Resolve Staff Profile
  const staff = await db
    .prepare(`
      SELECT id, nama, mansatas_user_id
      FROM cbt_staff_profiles
      WHERE is_active = 1 AND (
        id = ? OR
        (mansatas_user_id IS NOT NULL AND mansatas_user_id = ?) OR
        id = (SELECT staff_id FROM cbt_users WHERE id = ?)
      )
    `)
    .bind(user.staff_id || user.id, user.mansatas_user_id || user.id, user.id)
    .first<{ id: string; nama: string; mansatas_user_id: string | null }>();

  if (!staff) {
    return { authorized: false, error: 'User is not linked to an active staff profile.' };
  }

  // 3. Resolve Assignment
  const assignment = await db
    .prepare(`
      SELECT * FROM cbt_semester_invigilator_assignments
      WHERE event_id = ? AND slot_id = ? AND room_id = ? AND staff_id = ?
    `)
    .bind(eventId, slotId, roomId, staff.id)
    .first<{ id: string; invigilator_order: number }>();

  if (!assignment) {
    return { authorized: false, error: 'Anda bukan pengawas yang ditugaskan di ruangan dan jadwal sesi ini.' };
  }

  const context: SemesterProctorContext = {
    assignment_id: assignment.id,
    event_id: eventId,
    slot_id: slotId,
    room_id: roomId,
    invigilator_order: assignment.invigilator_order,
    staff_id: staff.id,
    staff_name: staff.nama,
    slot_label: slot.slot_label,
    slot_date: slot.slot_date,
    start_time: slot.start_time,
    end_time: slot.end_time,
    room_name: room.name,
    is_window_active: isWindowActive,
    window_status: windowStatus,
  };

  if (!isWindowActive) {
    return {
      authorized: false,
      error:
        windowStatus === 'early'
          ? 'Jendela waktu pengawasan belum dibuka (dibuka 30 menit sebelum sesi dimulai).'
          : 'Jendela waktu pengawasan sudah berakhir.',
      context,
    };
  }

  return { authorized: true, context };
}

/**
 * Queries all distinct exam tokens scheduled in a specific room and slot.
 */
export async function getRoomSlotTokens(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string
): Promise<Array<{ exam_id: string; exam_title: string; token: string; expires_at: string | null; is_active: number }>> {
  const { results } = await db
    .prepare(`
      SELECT DISTINCT
        e.id as exam_id,
        e.title as exam_title,
        t.token_code as token,
        t.expires_at,
        t.is_active
      FROM cbt_semester_schedules s
      JOIN cbt_exams e ON e.id = s.exam_id
      JOIN cbt_semester_exam_classes sec ON sec.exam_id = e.id
      JOIN cbt_semester_participants p ON p.class_id = sec.class_id AND p.event_id = s.event_id
      JOIN cbt_exam_tokens t ON t.exam_id = e.id AND (t.room_id = p.room_id OR t.room_id IS NULL)
      WHERE s.event_id = ? AND s.slot_id = ? AND p.room_id = ? AND t.is_active = 1
      ORDER BY e.title ASC
    `)
    .bind(eventId, slotId, roomId)
    .all<{ exam_id: string; exam_title: string; token: string; expires_at: string | null; is_active: number }>();

  return results || [];
}

/**
 * Fetches all student exam sessions for participants assigned to a room during a slot.
 */
export async function getRoomSlotSessions(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string
): Promise<any[]> {
  const { results } = await db
    .prepare(`
      SELECT DISTINCT
        p.id as participant_id,
        p.student_id,
        p.nama_lengkap,
        p.nomor_peserta,
        p.class_name,
        p.grade,
        st.seat_number,
        st.seat_label,
        e.id as exam_id,
        e.title as exam_title,
        e.duration_minutes as duration,
        es.id as session_id,
        COALESCE(es.status, 'not_started') as session_status,
        COALESCE(es.cheat_warnings, 0) as cheat_warnings,
        es.is_time_locked,
        es.started_at,
        es.finished_at,
        es.last_heartbeat,
        es.device_id
      FROM cbt_semester_participants p
      JOIN cbt_semester_exam_classes sec ON sec.class_id = p.class_id AND sec.event_id = p.event_id
      JOIN cbt_semester_schedules s ON s.exam_id = sec.exam_id AND s.slot_id = ? AND s.event_id = p.event_id
      JOIN cbt_exams e ON e.id = s.exam_id
      LEFT JOIN cbt_semester_seat_assignments sa ON sa.participant_id = p.id AND sa.event_id = p.event_id
      LEFT JOIN cbt_semester_seats st ON st.id = sa.seat_id
      LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = p.student_id
      WHERE p.event_id = ? AND p.room_id = ?
      ORDER BY st.seat_number ASC, p.nama_lengkap ASC
    `)
    .bind(slotId, eventId, roomId)
    .all();

  return results || [];
}

/**
 * Validates that a session belongs to a student in this room taking an exam in this slot.
 */
async function verifySessionBelongsToRoomSlot(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string,
  sessionId: string
): Promise<{ valid: boolean; session?: any; error?: string }> {
  const session = await db
    .prepare(`
      SELECT
        es.*,
        e.id as exam_id,
        e.title as exam_title
      FROM cbt_exam_sessions es
      JOIN cbt_exams e ON e.id = es.exam_id
      JOIN cbt_semester_schedules s ON s.exam_id = e.id AND s.slot_id = ? AND s.event_id = ?
      JOIN cbt_semester_participants p ON p.student_id = es.user_id AND p.event_id = ? AND p.room_id = ?
      WHERE es.id = ?
    `)
    .bind(slotId, eventId, eventId, roomId, sessionId)
    .first<any>();

  if (!session) {
    return { valid: false, error: 'Sesi ujian tidak ditemukan pada ruangan dan jadwal sesi ini.' };
  }

  return { valid: true, session };
}

/**
 * Unlocks a locked exam session for a student in this room-slot.
 */
export async function unlockProctorSession(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string,
  sessionId: string,
  proctorActorId: string
): Promise<{ success: boolean; error?: string }> {
  const verification = await verifySessionBelongsToRoomSlot(db, eventId, roomId, slotId, sessionId);
  if (!verification.valid || !verification.session) {
    return { success: false, error: verification.error };
  }

  // Delegate directly to shared examination engine canonical operation
  return await unlockExamSession(db, sessionId);
}

/**
 * Resets a student's session device ID via shared examination engine.
 */
export async function resetProctorSessionDevice(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string,
  sessionId: string,
  proctorActorId: string
): Promise<{ success: boolean; error?: string }> {
  const verification = await verifySessionBelongsToRoomSlot(db, eventId, roomId, slotId, sessionId);
  if (!verification.valid) {
    return { success: false, error: verification.error };
  }

  // Delegate directly to shared examination engine canonical operation
  return await resetSessionDevice(db, sessionId);
}

/**
 * Force submits an active session in emergency via shared examination engine.
 */
export async function forceSubmitProctorSession(
  db: D1Database,
  eventId: string,
  roomId: string,
  slotId: string,
  sessionId: string,
  proctorActorId: string
): Promise<{ success: boolean; error?: string }> {
  const verification = await verifySessionBelongsToRoomSlot(db, eventId, roomId, slotId, sessionId);
  if (!verification.valid || !verification.session) {
    return { success: false, error: verification.error };
  }

  // Delegate directly to shared examination engine canonical operation
  return await forceSubmitSession(db, sessionId);
}
