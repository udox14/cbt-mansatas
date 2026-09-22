// ============================================================
// Phase 7: Semester Automatic Timetable Solver & Service
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { SemesterSlot, SemesterSchedule, TimetableSolverConfig } from './types.ts';
import { acquireGenerationLock, releaseGenerationLock, invalidateDownstreamRevisions, logGenerationResult } from './concurrency.ts';

export interface TimetableSolverResult {
  success: boolean;
  status: 'success' | 'impossible' | 'failed';
  message: string;
  scheduledCount?: number;
  preservedLockedCount?: number;
  scheduleSummary?: Array<{ examId: string; examTitle: string; slotId: string; slotLabel: string; slotDate: string }>;
  conflict?: { exam1Title: string; exam2Title: string; reason: string };
}

interface ExamInfo {
  id: string;
  title: string;
  target_grade: string;
  duration: number;
  subject_id: string;
}

/**
 * Calculates duration in minutes from HH:MM strings.
 */
function getSlotDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * Solves timetable scheduling using greedy coloring with MRV & degree heuristics.
 */
export async function autoSolveTimetable(
  db: D1Database,
  eventId: string,
  actorId: string,
  config: TimetableSolverConfig = {}
): Promise<TimetableSolverResult> {
  // 1. Check Event Freeze
  const event = await db
    .prepare('SELECT id, status FROM cbt_events WHERE id = ? AND mode = ?')
    .bind(eventId, 'semester')
    .first<{ id: string; status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      status: 'failed',
      message: `Cannot generate timetable in a ${event?.status || 'unknown'} semester event. Event must be in draft status.`,
    };
  }

  // 2. Acquire generation lock
  const lock = await acquireGenerationLock(db, eventId, 'timetable', actorId);
  if (!lock.acquired || !lock.batchId) {
    return { success: false, status: 'failed', message: lock.error || 'Failed to acquire generation lock.' };
  }

  const batchId = lock.batchId;

  try {
    // 3. Fetch slots and exams
    const { results: slots } = await db
      .prepare('SELECT * FROM cbt_semester_slots WHERE event_id = ? ORDER BY slot_date ASC, sequence_order ASC, start_time ASC')
      .bind(eventId)
      .all<SemesterSlot>();

    if (!slots || slots.length === 0) {
      const msg = 'No time slots configured for this event.';
      await logGenerationResult(db, eventId, 'timetable', actorId, null, config, 'impossible', msg);
      await releaseGenerationLock(db, eventId, 'timetable', batchId);
      return { success: false, status: 'impossible', message: msg };
    }

    const { results: exams } = await db
      .prepare('SELECT id, title, target_grade, duration_minutes as duration, subject_id FROM cbt_exams WHERE event_id = ? AND mode = ?')
      .bind(eventId, 'semester')
      .all<ExamInfo>();

    if (!exams || exams.length === 0) {
      await releaseGenerationLock(db, eventId, 'timetable', batchId);
      return { success: true, status: 'success', message: 'No exams to schedule.', scheduledCount: 0 };
    }

    // 4. Fetch existing schedules to preserve locked
    const { results: existingSchedules } = await db
      .prepare('SELECT * FROM cbt_semester_schedules WHERE event_id = ?')
      .bind(eventId)
      .all<SemesterSchedule>();

    const preserveLocked = config.preserve_locked !== false;
    const lockedSchedules = preserveLocked
      ? (existingSchedules || []).filter((s) => s.is_locked === 1)
      : [];

    const lockedExamIds = new Set(lockedSchedules.map((s) => s.exam_id));
    const unlockedExams = exams.filter((e) => !lockedExamIds.has(e.id));

    // 5. Build conflict graph:
    // Two exams conflict if they target the same grade OR share classes via cbt_semester_exam_classes
    const { results: examClasses } = await db
      .prepare('SELECT exam_id, class_id FROM cbt_semester_exam_classes WHERE event_id = ?')
      .bind(eventId)
      .all<{ exam_id: string; class_id: string }>();

    const examClassMap = new Map<string, Set<string>>();
    for (const ec of (examClasses || [])) {
      if (!examClassMap.has(ec.exam_id)) examClassMap.set(ec.exam_id, new Set());
      examClassMap.get(ec.exam_id)!.add(ec.class_id);
    }

    const conflictsWith = (e1: ExamInfo, e2: ExamInfo): boolean => {
      if (e1.target_grade === e2.target_grade) return true;
      const c1 = examClassMap.get(e1.id);
      const c2 = examClassMap.get(e2.id);
      if (c1 && c2) {
        for (const cls of c1) {
          if (c2.has(cls)) return true;
        }
      }
      return false;
    };

    // Track slots usage
    // slotId -> list of scheduled exam IDs
    const slotUsage = new Map<string, string[]>();
    for (const s of slots) slotUsage.set(s.id, []);

    // Add locked exams to slot usage
    for (const ls of lockedSchedules) {
      if (slotUsage.has(ls.slot_id)) {
        slotUsage.get(ls.slot_id)!.push(ls.exam_id);
      }
    }

    // Track exams per date per grade
    const dateGradeUsage = new Map<string, Map<string, number>>(); // date -> grade -> count
    for (const s of slots) {
      if (!dateGradeUsage.has(s.slot_date)) dateGradeUsage.set(s.slot_date, new Map());
    }

    for (const ls of lockedSchedules) {
      const slot = slots.find((s) => s.id === ls.slot_id);
      const exam = exams.find((e) => e.id === ls.exam_id);
      if (slot && exam) {
        const gradeMap = dateGradeUsage.get(slot.slot_date)!;
        gradeMap.set(exam.target_grade, (gradeMap.get(exam.target_grade) || 0) + 1);
      }
    }

    const maxExamsPerDay = config.max_exams_per_day || 3;

    // 6. MRV (Minimum Remaining Values) / Degree Greedy Assignment
    // Order unlocked exams by degree (number of conflicting exams) descending
    const degreeMap = new Map<string, number>();
    for (const e1 of unlockedExams) {
      let degree = 0;
      for (const e2 of exams) {
        if (e1.id !== e2.id && conflictsWith(e1, e2)) degree++;
      }
      degreeMap.set(e1.id, degree);
    }

    unlockedExams.sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0));

    const newAssignments: Array<{ examId: string; slotId: string }> = [];

    for (const exam of unlockedExams) {
      let assignedSlotId: string | null = null;

      // Find valid slots where duration fits and no conflicting exam is scheduled in this slot
      for (const slot of slots) {
        const slotDuration = getSlotDurationMinutes(slot.start_time, slot.end_time);
        if (exam.duration > slotDuration) {
          continue; // Slot too short
        }

        // Daily grade limit check
        const gradeCountOnDate = dateGradeUsage.get(slot.slot_date)!.get(exam.target_grade) || 0;
        if (gradeCountOnDate >= maxExamsPerDay) {
          continue;
        }

        // Conflict check within slot
        const currentlyInSlot = slotUsage.get(slot.id)!;
        const hasConflict = currentlyInSlot.some((inSlotExamId) => {
          const inSlotExam = exams.find((e) => e.id === inSlotExamId);
          return inSlotExam ? conflictsWith(exam, inSlotExam) : false;
        });

        if (!hasConflict) {
          assignedSlotId = slot.id;
          slotUsage.get(slot.id)!.push(exam.id);
          const gradeMap = dateGradeUsage.get(slot.slot_date)!;
          gradeMap.set(exam.target_grade, gradeCountOnDate + 1);
          break;
        }
      }

      if (!assignedSlotId) {
        const msg = `Impossible to schedule exam '${exam.title}' (Grade ${exam.target_grade}) without conflicts in available time slots.`;
        await logGenerationResult(db, eventId, 'timetable', actorId, null, config, 'impossible', msg);
        await releaseGenerationLock(db, eventId, 'timetable', batchId);
        return {
          success: false,
          status: 'impossible',
          message: msg,
          conflict: { exam1Title: exam.title, exam2Title: 'Time Slots Capacity', reason: 'Insufficient collision-free slots' },
        };
      }

      newAssignments.push({ examId: exam.id, slotId: assignedSlotId });
    }

    // 7. Atomic Write & Token Purge
    const statements = [
      // Delete unlocked schedules
      db.prepare('DELETE FROM cbt_semester_schedules WHERE event_id = ? AND is_locked = 0').bind(eventId),
    ];

    // Insert newly scheduled exams and reconcile roster and tokens
    for (const item of newAssignments) {
      const assignedSlot = slots.find((s) => s.id === item.slotId);

      statements.push(
        db.prepare(`
          INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id, is_locked, updated_at)
          VALUES (?, ?, ?, ?, 0, datetime('now'))
        `).bind(crypto.randomUUID(), eventId, item.examId, item.slotId)
      );

      // Reconcile cbt_exam_roster tanggal_tes and sesi_tes atomically
      if (assignedSlot) {
        statements.push(
          db.prepare(`
            UPDATE cbt_exam_roster
            SET tanggal_tes = ?, sesi_tes = ?
            WHERE exam_id = ?
          `).bind(assignedSlot.slot_date, assignedSlot.slot_label, item.examId)
        );
      }

      // Purge exam tokens for rescheduled exams (mandatory invariant)
      statements.push(
        db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?').bind(item.examId)
      );
    }

    await db.batch(statements);

    // 8. Invalidate downstream stages
    await invalidateDownstreamRevisions(db, eventId, 'timetable');

    const summaryMsg = `Successfully scheduled ${newAssignments.length} exams across ${slots.length} time slots. Preserved ${lockedSchedules.length} locked schedules.`;
    await logGenerationResult(db, eventId, 'timetable', actorId, null, config, 'success', summaryMsg);

    await releaseGenerationLock(db, eventId, 'timetable', batchId);

    const scheduleSummary = [
      ...lockedSchedules.map((ls) => {
        const slot = slots.find((s) => s.id === ls.slot_id);
        const exam = exams.find((e) => e.id === ls.exam_id);
        return { examId: ls.exam_id, examTitle: exam?.title || ls.exam_id, slotId: ls.slot_id, slotLabel: slot?.slot_label || '', slotDate: slot?.slot_date || '' };
      }),
      ...newAssignments.map((na) => {
        const slot = slots.find((s) => s.id === na.slotId);
        const exam = exams.find((e) => e.id === na.examId);
        return { examId: na.examId, examTitle: exam?.title || na.examId, slotId: na.slotId, slotLabel: slot?.slot_label || '', slotDate: slot?.slot_date || '' };
      }),
    ];

    return {
      success: true,
      status: 'success',
      message: summaryMsg,
      scheduledCount: newAssignments.length,
      preservedLockedCount: lockedSchedules.length,
      scheduleSummary,
    };
  } catch (err: any) {
    await releaseGenerationLock(db, eventId, 'timetable', batchId);
    await logGenerationResult(db, eventId, 'timetable', actorId, null, config, 'failed', err.message || 'Internal error');
    return { success: false, status: 'failed', message: err.message || 'Timetable solver failed.' };
  }
}

/**
 * Toggles a schedule's lock.
 */
export async function setScheduleLock(
  db: D1Database,
  eventId: string,
  scheduleId: string,
  isLocked: boolean
): Promise<{ success: boolean; error?: string }> {
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot modify locks in a frozen or active event.' };
  }

  const result = await db
    .prepare(`
      UPDATE cbt_semester_schedules
      SET is_locked = ?, updated_at = datetime('now')
      WHERE id = ? AND event_id = ?
    `)
    .bind(isLocked ? 1 : 0, scheduleId, eventId)
    .run();

  return { success: result.success };
}
