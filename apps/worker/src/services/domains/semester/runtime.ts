// ============================================================
// Semester Domain — Authoritative Runtime Schedule Authorization
//
// Authoritative schedule validation hook executed on the student session start path.
// Enforces:
// 1. Asia/Jakarta (WIB = UTC+7) server-derived wall clock authority
// 2. Strict window boundaries: before slot, active slot, after slot, date rollover
// 3. Late-start cutoff policy (remaining_slot_time < exam.duration_minutes -> 403)
// 4. Clean pass-through for non-semester modes
// ============================================================

import type { SemesterScheduleAuthResult } from './types.ts';

/**
 * Formats a Date object into Asia/Jakarta (WIB = UTC+7) date string (YYYY-MM-DD) and time string (HH:MM).
 */
export function getWibTimeParts(date: Date = new Date()): { dateStr: string; timeStr: string } {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA outputs YYYY-MM-DD

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = timeParts.find((p) => p.type === 'hour')?.value || '00';
  const minute = timeParts.find((p) => p.type === 'minute')?.value || '00';
  const timeStr = `${hour}:${minute}`;

  return { dateStr, timeStr };
}

/**
 * Authoritative Semester exam schedule authorization helper.
 * Enforces schedule presence, time windows, and late-start cutoff.
 */
export async function authorizeSemesterExamSchedule(
  db: D1Database,
  examId: string,
  currentDate: Date = new Date(),
  isResumedSession: boolean = false
): Promise<SemesterScheduleAuthResult> {
  // 1. Resolve exam and event mode
  const exam = await db
    .prepare(
      `SELECT e.id, e.title, e.duration_minutes, e.mode, e.event_id, ev.mode as event_mode
       FROM cbt_exams e
       LEFT JOIN cbt_events ev ON e.event_id = ev.id
       WHERE e.id = ?`
    )
    .bind(examId)
    .first<{
      id: string;
      title: string;
      duration_minutes: number;
      mode: string | null;
      event_id: string | null;
      event_mode: string | null;
    }>();

  if (!exam) {
    return { allowed: false, error: 'Ujian tidak ditemukan', status: 404 };
  }

  // If this exam is NOT in semester mode, schedule validation is a no-op (pass-through)
  const isSemester = exam.mode === 'semester' || exam.event_mode === 'semester';
  if (!isSemester) {
    return { allowed: true };
  }

  // 2. Fetch canonical schedule and slot binding
  const schedule = await db
    .prepare(
      `SELECT sch.id, sch.slot_id, sl.slot_label, sl.slot_date, sl.start_time, sl.end_time
       FROM cbt_semester_schedules sch
       JOIN cbt_semester_slots sl ON sch.slot_id = sl.id
       WHERE sch.exam_id = ?`
    )
    .bind(examId)
    .first<{
      id: string;
      slot_id: string;
      slot_label: string;
      slot_date: string;
      start_time: string;
      end_time: string;
    }>();

  if (!schedule) {
    return {
      allowed: false,
      error: 'Ujian semester ini belum memiliki jadwal sesi yang terdaftar. Hubungi panitia ujian.',
      status: 403,
    };
  }

  // 3. Evaluate Asia/Jakarta wall-clock time
  const { dateStr: nowWibDate, timeStr: nowWibTime } = getWibTimeParts(currentDate);

  // Calculate remaining slot minutes and latest valid start time
  const [nowH, nowM] = nowWibTime.split(':').map(Number);
  const [endH, endM] = schedule.end_time.split(':').map(Number);
  const remainingMinutes = (endH * 60 + endM) - (nowH * 60 + nowM);

  const latestStartTotalMinutes = (endH * 60 + endM) - exam.duration_minutes;
  const latestH = Math.floor(latestStartTotalMinutes / 60);
  const latestM = latestStartTotalMinutes % 60;
  const latestStartTime = `${String(latestH).padStart(2, '0')}:${String(latestM).padStart(2, '0')}`;

  const scheduleContext = {
    slot_id: schedule.slot_id,
    slot_label: schedule.slot_label,
    slot_date: schedule.slot_date,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    jadwal_status: 'aktif' as 'belum' | 'aktif' | 'selesai',
    remaining_minutes: remainingMinutes,
    latest_start_time: latestStartTime,
  };

  // 4. Date validation
  if (nowWibDate < schedule.slot_date) {
    scheduleContext.jadwal_status = 'belum';
    return {
      allowed: false,
      error: `Ujian belum dimulai. Ujian dijadwalkan pada tanggal ${schedule.slot_date} pukul ${schedule.start_time} - ${schedule.end_time} WIB.`,
      status: 403,
      scheduleContext,
    };
  }

  if (nowWibDate > schedule.slot_date) {
    scheduleContext.jadwal_status = 'selesai';
    return {
      allowed: false,
      error: `Jadwal ujian telah berakhir pada tanggal ${schedule.slot_date} pukul ${schedule.end_time} WIB.`,
      status: 403,
      scheduleContext,
    };
  }

  // Same date: Time window validation
  if (nowWibTime < schedule.start_time) {
    scheduleContext.jadwal_status = 'belum';
    return {
      allowed: false,
      error: `Sesi ujian '${schedule.slot_label}' belum dimulai. Ujian dimulai pukul ${schedule.start_time} WIB.`,
      status: 403,
      scheduleContext,
    };
  }

  if (nowWibTime > schedule.end_time) {
    scheduleContext.jadwal_status = 'selesai';
    return {
      allowed: false,
      error: `Sesi ujian '${schedule.slot_label}' telah berakhir pada pukul ${schedule.end_time} WIB.`,
      status: 403,
      scheduleContext,
    };
  }

  // 5. Late-start cutoff policy (only for unstarted sessions!)
  // Resumed sessions continue under server-side session timer authority
  if (!isResumedSession) {
    if (remainingMinutes < exam.duration_minutes) {
      return {
        allowed: false,
        error: `Sisa waktu sesi (${remainingMinutes} menit) tidak mencukupi untuk durasi penuh ujian (${exam.duration_minutes} menit). Batas akhir masuk ujian adalah pukul ${latestStartTime} WIB.`,
        status: 403,
        scheduleContext,
      };
    }
  }

  return {
    allowed: true,
    scheduleContext,
  };
}
