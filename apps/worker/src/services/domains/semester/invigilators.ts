// ============================================================
// Phase 7: Semester Invigilators Pool, Blackouts & Assignment Service
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type {
  SemesterInvigilatorPoolEntry,
  SemesterStaffBlackout,
  SemesterInvigilatorAssignment,
  InvigilatorAssignmentConfig,
} from './types.ts';
import { acquireGenerationLock, releaseGenerationLock, logGenerationResult } from './concurrency.ts';

export interface InvigilatorAssignmentResult {
  success: boolean;
  status: 'success' | 'impossible' | 'failed';
  message: string;
  totalAssigned?: number;
  preservedLockedCount?: number;
  assignmentSummary?: Array<{ slotId: string; roomId: string; invigilatorOrder: number; staffName: string }>;
  shortage?: { slotId: string; roomId: string; required: number; available: number };
}

interface StaffRecord {
  id: string;
  nama: string;
  nip: string | null;
  email: string | null;
  mansatas_user_id: string | null;
  is_active: number;
}

/**
 * Synchronizes the invigilator pool from active cbt_staff_profiles.
 */
export async function syncInvigilatorPoolFromStaff(
  db: D1Database,
  eventId: string
): Promise<{ addedCount: number }> {
  const { results: staffList } = await db
    .prepare('SELECT id, nama, nip, email, mansatas_user_id, is_active FROM cbt_staff_profiles WHERE is_active = 1')
    .all<StaffRecord>();

  if (!staffList || staffList.length === 0) {
    return { addedCount: 0 };
  }

  let added = 0;
  for (const staff of staffList) {
    const res = await db
      .prepare(`
        INSERT OR IGNORE INTO cbt_semester_invigilator_pool (id, event_id, staff_id, is_eligible)
        VALUES (?, ?, ?, 1)
      `)
      .bind(crypto.randomUUID(), eventId, staff.id)
      .run();

    if (res.meta.changes && res.meta.changes > 0) {
      added++;
    }
  }

  return { addedCount: added };
}

/**
 * Fetches the invigilator pool for an event with assignment counts.
 */
export async function getInvigilatorPool(
  db: D1Database,
  eventId: string
): Promise<SemesterInvigilatorPoolEntry[]> {
  const { results } = await db
    .prepare(`
      SELECT
        p.*,
        s.nama as staff_name,
        s.nip,
        s.email,
        (
          SELECT COUNT(*)
          FROM cbt_semester_invigilator_assignments a
          WHERE a.event_id = p.event_id AND a.staff_id = p.staff_id
        ) as assigned_count
      FROM cbt_semester_invigilator_pool p
      JOIN cbt_staff_profiles s ON s.id = p.staff_id
      WHERE p.event_id = ?
      ORDER BY s.nama ASC
    `)
    .bind(eventId)
    .all<SemesterInvigilatorPoolEntry>();

  return results || [];
}

/**
 * Toggles or updates a staff member's eligibility in the pool.
 */
export async function setInvigilatorEligibility(
  db: D1Database,
  eventId: string,
  staffId: string,
  isEligible: boolean,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot modify invigilator pool in a frozen or active event.' };
  }

  const result = await db
    .prepare(`
      UPDATE cbt_semester_invigilator_pool
      SET is_eligible = ?, notes = ?, updated_at = datetime('now')
      WHERE event_id = ? AND staff_id = ?
    `)
    .bind(isEligible ? 1 : 0, notes || null, eventId, staffId)
    .run();

  return { success: result.success };
}

/**
 * Fetches staff blackout constraints for an event.
 */
export async function getStaffBlackouts(
  db: D1Database,
  eventId: string,
  staffId?: string
): Promise<SemesterStaffBlackout[]> {
  if (staffId) {
    const { results } = await db
      .prepare(`
        SELECT b.*, s.nama as staff_name, sl.slot_label
        FROM cbt_semester_staff_blackouts b
        JOIN cbt_staff_profiles s ON s.id = b.staff_id
        LEFT JOIN cbt_semester_slots sl ON sl.id = b.slot_id
        WHERE b.event_id = ? AND b.staff_id = ?
        ORDER BY b.created_at DESC
      `)
      .bind(eventId, staffId)
      .all<SemesterStaffBlackout>();
    return results || [];
  }

  const { results } = await db
    .prepare(`
      SELECT b.*, s.nama as staff_name, sl.slot_label
      FROM cbt_semester_staff_blackouts b
      JOIN cbt_staff_profiles s ON s.id = b.staff_id
      LEFT JOIN cbt_semester_slots sl ON sl.id = b.slot_id
      WHERE b.event_id = ?
      ORDER BY b.created_at DESC
    `)
    .bind(eventId)
    .all<SemesterStaffBlackout>();
  return results || [];
}

/**
 * Adds a staff blackout with semantic date validation.
 */
export async function addStaffBlackout(
  db: D1Database,
  eventId: string,
  staffId: string,
  slotId: string | null,
  blackoutDate: string | null,
  reason: string | null
): Promise<{ success: boolean; error?: string; id?: string }> {
  // Check freeze and date window
  const event = await db
    .prepare('SELECT status, starts_at, ends_at FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string; starts_at: string | null; ends_at: string | null }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot add blackouts in a frozen or active event.' };
  }

  if (!slotId && !blackoutDate) {
    return { success: false, error: 'Either slot_id or blackout_date must be provided.' };
  }

  // Semantic date validation
  if (blackoutDate) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(blackoutDate) || isNaN(new Date(blackoutDate).getTime())) {
      return { success: false, error: 'blackout_date must be a valid ISO date string (YYYY-MM-DD).' };
    }

    if (event.starts_at && event.ends_at) {
      const eventStart = event.starts_at.slice(0, 10);
      const eventEnd = event.ends_at.slice(0, 10);
      if (blackoutDate < eventStart || blackoutDate > eventEnd) {
        return {
          success: false,
          error: `Tanggal blackout (${blackoutDate}) berada di luar rentang tanggal pelaksanaan event (${eventStart} s/d ${eventEnd}).`,
        };
      }
    }
  }

  const blackoutId = crypto.randomUUID();
  const result = await db
    .prepare(`
      INSERT INTO cbt_semester_staff_blackouts (id, event_id, staff_id, slot_id, blackout_date, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(blackoutId, eventId, staffId, slotId || null, blackoutDate || null, reason || null)
    .run();

  if (!result.success) {
    return { success: false, error: 'Failed to record staff blackout.' };
  }

  return { success: true, id: blackoutId };
}

/**
 * Removes a staff blackout constraint.
 */
export async function removeStaffBlackout(
  db: D1Database,
  eventId: string,
  blackoutId: string
): Promise<{ success: boolean; error?: string }> {
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot remove blackouts in a frozen or active event.' };
  }

  const result = await db
    .prepare('DELETE FROM cbt_semester_staff_blackouts WHERE id = ? AND event_id = ?')
    .bind(blackoutId, eventId)
    .run();

  return { success: result.success };
}

/**
 * Fetches invigilator assignments for an event, optionally filtered by slot or room.
 */
export async function getInvigilatorAssignments(
  db: D1Database,
  eventId: string,
  slotId?: string,
  roomId?: string
): Promise<SemesterInvigilatorAssignment[]> {
  let query = `
    SELECT
      a.*,
      sl.slot_label,
      sl.slot_date,
      sl.start_time,
      sl.end_time,
      r.room_name as room_name
    FROM cbt_semester_invigilator_assignments a
    JOIN cbt_semester_slots sl ON sl.id = a.slot_id
    JOIN cbt_rooms r ON r.id = a.room_id
    WHERE a.event_id = ?
  `;
  const bindings: any[] = [eventId];

  if (slotId) {
    query += ' AND a.slot_id = ?';
    bindings.push(slotId);
  }
  if (roomId) {
    query += ' AND a.room_id = ?';
    bindings.push(roomId);
  }

  query += ' ORDER BY sl.slot_date ASC, sl.start_time ASC, r.room_name ASC, a.invigilator_order ASC';

  const { results } = await db.prepare(query).bind(...bindings).all<SemesterInvigilatorAssignment>();
  return results || [];
}

/**
 * Executes automatic invigilator assignment solver with workload balancing and hard blackout constraints.
 */
export async function autoAssignInvigilators(
  db: D1Database,
  eventId: string,
  actorId: string,
  config: InvigilatorAssignmentConfig = {}
): Promise<InvigilatorAssignmentResult> {
  // 1. Check Event Freeze
  const event = await db
    .prepare('SELECT id, status FROM cbt_events WHERE id = ? AND mode = ?')
    .bind(eventId, 'semester')
    .first<{ id: string; status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      status: 'failed',
      message: `Cannot assign invigilators in a ${event?.status || 'unknown'} semester event. Event must be in draft status.`,
    };
  }

  // 2. Acquire generation lock
  const lock = await acquireGenerationLock(db, eventId, 'invigilators', actorId);
  if (!lock.acquired || !lock.batchId) {
    return { success: false, status: 'failed', message: lock.error || 'Failed to acquire generation lock.' };
  }

  const batchId = lock.batchId;

  try {
    // 3. Derive operational targets: (slot_id, room_id) with scheduled exams and assigned students
    const { results: operationalTargets } = await db
      .prepare(`
        SELECT DISTINCT
          s.slot_id,
          p.room_id,
          sl.slot_date,
          sl.start_time,
          sl.end_time,
          COALESCE(rl.required_invigilators, 1) as required_invigilators
        FROM cbt_semester_schedules s
        JOIN cbt_semester_slots sl ON sl.id = s.slot_id
        JOIN cbt_semester_exam_classes sec ON sec.exam_id = s.exam_id
        JOIN cbt_semester_participants p ON p.class_id = sec.class_id AND p.event_id = s.event_id
        LEFT JOIN cbt_semester_room_layouts rl ON rl.room_id = p.room_id AND rl.event_id = s.event_id
        WHERE s.event_id = ? AND p.room_id IS NOT NULL
        ORDER BY sl.slot_date ASC, sl.start_time ASC, p.room_id ASC
      `)
      .bind(eventId)
      .all<{
        slot_id: string;
        room_id: string;
        slot_date: string;
        start_time: string;
        end_time: string;
        required_invigilators: number;
      }>();

    if (!operationalTargets || operationalTargets.length === 0) {
      await releaseGenerationLock(db, eventId, 'invigilators', batchId);
      return { success: true, status: 'success', message: 'No operational room-slot targets to assign.', totalAssigned: 0 };
    }

    // 4. Fetch eligible staff pool and blackouts
    const { results: eligiblePool } = await db
      .prepare(`
        SELECT p.staff_id, s.nama, s.mansatas_user_id
        FROM cbt_semester_invigilator_pool p
        JOIN cbt_staff_profiles s ON s.id = p.staff_id
        WHERE p.event_id = ? AND p.is_eligible = 1 AND s.is_active = 1
      `)
      .bind(eventId)
      .all<{ staff_id: string; nama: string; mansatas_user_id: string | null }>();

    if (!eligiblePool || eligiblePool.length === 0) {
      const msg = 'No eligible staff members in the invigilator pool for this event.';
      await logGenerationResult(db, eventId, 'invigilators', actorId, null, config, 'impossible', msg);
      await releaseGenerationLock(db, eventId, 'invigilators', batchId);
      return { success: false, status: 'impossible', message: msg };
    }

    const { results: blackouts } = await db
      .prepare('SELECT staff_id, slot_id, blackout_date FROM cbt_semester_staff_blackouts WHERE event_id = ?')
      .bind(eventId)
      .all<{ staff_id: string; slot_id: string | null; blackout_date: string | null }>();

    // 5. Fetch existing locked assignments
    const { results: existingAssignments } = await db
      .prepare('SELECT * FROM cbt_semester_invigilator_assignments WHERE event_id = ?')
      .bind(eventId)
      .all<SemesterInvigilatorAssignment>();

    const preserveLocked = config.preserve_locked !== false;
    const lockedAssignments = preserveLocked
      ? (existingAssignments || []).filter((a) => a.is_locked === 1)
      : [];

    // Track staff usage
    const staffTotalAssignments = new Map<string, number>();
    const staffSlotAssignments = new Map<string, Set<string>>(); // staff_id -> Set of slot_ids
    const staffDateAssignments = new Map<string, Map<string, number>>(); // staff_id -> date -> count

    for (const staff of eligiblePool) {
      staffTotalAssignments.set(staff.staff_id, 0);
      staffSlotAssignments.set(staff.staff_id, new Set());
      staffDateAssignments.set(staff.staff_id, new Map());
    }

    const stagingAssignments: Array<{
      slotId: string;
      roomId: string;
      invigilatorOrder: number;
      staffId: string;
      staffName: string;
      mansatasUserId: string | null;
      isLocked: number;
    }> = [];

    // Populate usage with locked assignments
    for (const la of lockedAssignments) {
      stagingAssignments.push({
        slotId: la.slot_id,
        roomId: la.room_id,
        invigilatorOrder: la.invigilator_order,
        staffId: la.staff_id,
        staffName: la.staff_name,
        mansatasUserId: la.mansatas_user_id,
        isLocked: 1,
      });

      staffTotalAssignments.set(la.staff_id, (staffTotalAssignments.get(la.staff_id) || 0) + 1);
      if (staffSlotAssignments.has(la.staff_id)) {
        staffSlotAssignments.get(la.staff_id)!.add(la.slot_id);
      }
    }

    const maxSessionsPerDay = config.max_sessions_per_day || 3;

    // Helper to check hard blackout
    const isStaffBlackedOut = (staffId: string, slotId: string, slotDate: string): boolean => {
      return (blackouts || []).some(
        (b) => b.staff_id === staffId && (b.slot_id === slotId || b.blackout_date === slotDate)
      );
    };

    // 6. Assign invigilators to targets
    for (const target of operationalTargets) {
      for (let order = 1; order <= target.required_invigilators; order++) {
        // Check if locked assignment already occupies this slot+room+order
        const existingLocked = lockedAssignments.find(
          (la) => la.slot_id === target.slot_id && la.room_id === target.room_id && la.invigilator_order === order
        );
        if (existingLocked) {
          continue; // Already preserved
        }

        // Find eligible staff
        // Must not be blacked out, not assigned to another room in the same slot, and not exceeded daily limit
        const candidates = eligiblePool.filter((staff) => {
          if (isStaffBlackedOut(staff.staff_id, target.slot_id, target.slot_date)) return false;
          if (staffSlotAssignments.get(staff.staff_id)!.has(target.slot_id)) return false;

          const dateCount = staffDateAssignments.get(staff.staff_id)?.get(target.slot_date) || 0;
          if (dateCount >= maxSessionsPerDay) return false;

          // If second invigilator in the same room-slot, cannot be the same person as order 1
          if (order > 1) {
            const alreadyAssignedToTarget = stagingAssignments.some(
              (sa) => sa.slotId === target.slot_id && sa.roomId === target.room_id && sa.staffId === staff.staff_id
            );
            if (alreadyAssignedToTarget) return false;
          }

          return true;
        });

        if (candidates.length === 0) {
          const msg = `Impossible to assign invigilator ${order} for room in slot ${target.slot_id}: all eligible staff are blacked out or busy.`;
          await logGenerationResult(db, eventId, 'invigilators', actorId, null, config, 'impossible', msg);
          await releaseGenerationLock(db, eventId, 'invigilators', batchId);
          return {
            success: false,
            status: 'impossible',
            message: msg,
            shortage: { slotId: target.slot_id, roomId: target.room_id, required: target.required_invigilators, available: 0 },
          };
        }

        // Workload balancing: pick candidate with lowest total assignments
        candidates.sort((a, b) => {
          return (staffTotalAssignments.get(a.staff_id) || 0) - (staffTotalAssignments.get(b.staff_id) || 0);
        });

        const selected = candidates[0];

        stagingAssignments.push({
          slotId: target.slot_id,
          roomId: target.room_id,
          invigilatorOrder: order,
          staffId: selected.staff_id,
          staffName: selected.nama,
          mansatasUserId: selected.mansatas_user_id,
          isLocked: 0,
        });

        // Update tracking
        staffTotalAssignments.set(selected.staff_id, (staffTotalAssignments.get(selected.staff_id) || 0) + 1);
        staffSlotAssignments.get(selected.staff_id)!.add(target.slot_id);

        const curDateMap = staffDateAssignments.get(selected.staff_id)!;
        curDateMap.set(target.slot_date, (curDateMap.get(target.slot_date) || 0) + 1);
      }
    }

    // 7. Multi-Row Staging Write (max 11 rows / 99 bound parameters per statement)
    const CHUNK_SIZE = 11;
    for (let i = 0; i < stagingAssignments.length; i += CHUNK_SIZE) {
      const chunk = stagingAssignments.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const bindings: any[] = [];
      for (const item of chunk) {
        bindings.push(
          batchId,
          eventId,
          item.slotId,
          item.roomId,
          item.invigilatorOrder,
          item.staffId,
          item.staffName,
          item.mansatasUserId,
          item.isLocked
        );
      }

      await db
        .prepare(`
          INSERT INTO cbt_semester_invig_staging (batch_id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name, mansatas_user_id, is_locked)
          VALUES ${placeholders}
        `)
        .bind(...bindings)
        .run();
    }

    // 8. Atomic Promotion
    const statements = [
      // Delete unlocked assignments
      db.prepare('DELETE FROM cbt_semester_invigilator_assignments WHERE event_id = ? AND is_locked = 0').bind(eventId),

      // Insert unlocked from staging
      db.prepare(`
        INSERT INTO cbt_semester_invigilator_assignments (id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name, mansatas_user_id, is_locked)
        SELECT lower(hex(randomblob(16))), event_id, slot_id, room_id, invigilator_order, staff_id, staff_name, mansatas_user_id, 0
        FROM cbt_semester_invig_staging
        WHERE batch_id = ? AND is_locked = 0
      `).bind(batchId),

      // Purge staging
      db.prepare('DELETE FROM cbt_semester_invig_staging WHERE batch_id = ?').bind(batchId),
    ];

    await db.batch(statements);

    const summaryMsg = `Successfully assigned invigilators for ${stagingAssignments.length} room-slots. Preserved ${lockedAssignments.length} locked assignments.`;
    await logGenerationResult(db, eventId, 'invigilators', actorId, null, config, 'success', summaryMsg);

    await releaseGenerationLock(db, eventId, 'invigilators', batchId);

    return {
      success: true,
      status: 'success',
      message: summaryMsg,
      totalAssigned: stagingAssignments.length,
      preservedLockedCount: lockedAssignments.length,
      assignmentSummary: stagingAssignments.map((a) => ({
        slotId: a.slotId,
        roomId: a.roomId,
        invigilatorOrder: a.invigilatorOrder,
        staffName: a.staffName,
      })),
    };
  } catch (err: any) {
    await db.prepare('DELETE FROM cbt_semester_invig_staging WHERE batch_id = ?').bind(batchId).run().catch(() => {});
    await releaseGenerationLock(db, eventId, 'invigilators', batchId);
    await logGenerationResult(db, eventId, 'invigilators', actorId, null, config, 'failed', err.message || 'Internal error');
    return { success: false, status: 'failed', message: err.message || 'Invigilator assignment failed.' };
  }
}

/**
 * Toggles an invigilator assignment's lock.
 */
export async function setInvigilatorAssignmentLock(
  db: D1Database,
  eventId: string,
  assignmentId: string,
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
      UPDATE cbt_semester_invigilator_assignments
      SET is_locked = ?, updated_at = datetime('now')
      WHERE id = ? AND event_id = ?
    `)
    .bind(isLocked ? 1 : 0, assignmentId, eventId)
    .run();

  return { success: result.success };
}
