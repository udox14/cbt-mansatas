// ============================================================
// Phase 7: Semester Automatic Room Allocation Solver & Service
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { SemesterParticipant, RoomAllocationConfig } from './types.ts';
import { acquireGenerationLock, releaseGenerationLock, invalidateDownstreamRevisions, logGenerationResult } from './concurrency.ts';

export interface RoomAllocationResult {
  success: boolean;
  status: 'success' | 'impossible' | 'failed';
  message: string;
  totalParticipants?: number;
  assignedCount?: number;
  preservedLockedCount?: number;
  roomSummary?: Array<{ roomId: string; roomName: string; capacity: number; assigned: number }>;
  shortage?: { required: number; available: number; deficit: number };
}

interface RoomRecord {
  id: string;
  name: string;
  capacity: number;
}

/**
 * Executes automatic room allocation with multi-row staging and atomic promotion.
 */
export async function autoAllocateRooms(
  db: D1Database,
  eventId: string,
  actorId: string,
  config: RoomAllocationConfig = {}
): Promise<RoomAllocationResult> {
  // 1. Check Event Freeze
  const event = await db
    .prepare('SELECT id, status FROM cbt_events WHERE id = ? AND mode = ?')
    .bind(eventId, 'semester')
    .first<{ id: string; status: string }>();

  if (!event) {
    return { success: false, status: 'failed', message: 'Semester event not found.' };
  }

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      status: 'failed',
      message: `Cannot allocate rooms in a ${event.status} semester event. Event must be in draft status.`,
    };
  }

  // 2. Acquire generation lock
  const lock = await acquireGenerationLock(db, eventId, 'room_allocation', actorId);
  if (!lock.acquired || !lock.batchId) {
    return { success: false, status: 'failed', message: lock.error || 'Failed to acquire generation lock.' };
  }

  const batchId = lock.batchId;

  try {
    // 3. Fetch rooms and participants
    const { results: rooms } = await db
      .prepare(`
        SELECT id, room_name as name, capacity FROM cbt_rooms
        WHERE event_id = ? OR event_id IS NULL
        ORDER BY room_name ASC
      `)
      .bind(eventId)
      .all<RoomRecord>();

    if (!rooms || rooms.length === 0) {
      await logGenerationResult(db, eventId, 'room_allocation', actorId, null, config, 'impossible', 'No rooms available.');
      await releaseGenerationLock(db, eventId, 'room_allocation', batchId);
      return {
        success: false,
        status: 'impossible',
        message: 'No rooms configured for this event.',
        shortage: { required: 1, available: 0, deficit: 1 },
      };
    }

    const { results: participants } = await db
      .prepare(`
        SELECT * FROM cbt_semester_participants
        WHERE event_id = ?
        ORDER BY grade ASC, class_name ASC, nama_lengkap ASC
      `)
      .bind(eventId)
      .all<SemesterParticipant>();

    if (!participants || participants.length === 0) {
      await releaseGenerationLock(db, eventId, 'room_allocation', batchId);
      return { success: true, status: 'success', message: 'No participants to allocate.', totalParticipants: 0, assignedCount: 0 };
    }

    // 4. Calculate available capacities accounting for locked participants
    const preserveLocked = config.preserve_locked !== false;
    const lockedParticipants = preserveLocked
      ? participants.filter((p) => p.is_room_locked === 1 && p.room_id !== null)
      : [];
    const unlockedParticipants = preserveLocked
      ? participants.filter((p) => p.is_room_locked !== 1 || p.room_id === null)
      : participants;

    const roomCapacityMap = new Map<string, { capacity: number; lockedCount: number; available: number; room: RoomRecord }>();
    let totalAvailableCapacity = 0;

    for (const r of rooms) {
      const lockedCount = lockedParticipants.filter((p) => p.room_id === r.id).length;
      const available = Math.max(0, r.capacity - lockedCount);
      roomCapacityMap.set(r.id, { capacity: r.capacity, lockedCount, available, room: r });
      totalAvailableCapacity += available;
    }

    if (totalAvailableCapacity < unlockedParticipants.length) {
      const deficit = unlockedParticipants.length - totalAvailableCapacity;
      const msg = `Total room capacity (${totalAvailableCapacity}) is insufficient for ${unlockedParticipants.length} participants (shortage of ${deficit} seats).`;
      await logGenerationResult(db, eventId, 'room_allocation', actorId, null, config, 'impossible', msg);
      await releaseGenerationLock(db, eventId, 'room_allocation', batchId);
      return {
        success: false,
        status: 'impossible',
        message: msg,
        shortage: { required: unlockedParticipants.length, available: totalAvailableCapacity, deficit },
      };
    }

    // 5. Strategy-based Assignment
    const stagingAssignments: Array<{ participantId: string; roomId: string; isLocked: number }> = [];

    // Include locked participants in staging with their preserved room
    for (const lp of lockedParticipants) {
      stagingAssignments.push({
        participantId: lp.id,
        roomId: lp.room_id!,
        isLocked: 1,
      });
    }

    // Group or order unlocked participants
    let sortedUnlocked = [...unlockedParticipants];
    if (config.gender_strategy === 'separate_rooms') {
      sortedUnlocked.sort((a, b) => (a.gender || '').localeCompare(b.gender || ''));
    }

    const strategy = config.strategy || 'balanced';

    if (strategy === 'fill_first') {
      let participantIdx = 0;
      for (const r of rooms) {
        const info = roomCapacityMap.get(r.id)!;
        let toAssign = Math.min(info.available, sortedUnlocked.length - participantIdx);
        for (let i = 0; i < toAssign; i++) {
          stagingAssignments.push({
            participantId: sortedUnlocked[participantIdx].id,
            roomId: r.id,
            isLocked: 0,
          });
          participantIdx++;
        }
        if (participantIdx >= sortedUnlocked.length) break;
      }
    } else {
      // Balanced distribution: round-robin or proportional
      const activeRooms = rooms.filter((r) => roomCapacityMap.get(r.id)!.available > 0);
      const roomAssignments = new Map<string, string[]>();
      for (const r of activeRooms) roomAssignments.set(r.id, []);

      let roomIdx = 0;
      for (const p of sortedUnlocked) {
        let attempts = 0;
        while (attempts < activeRooms.length) {
          const r = activeRooms[roomIdx];
          const assignedSoFar = roomAssignments.get(r.id)!.length;
          const available = roomCapacityMap.get(r.id)!.available;

          if (assignedSoFar < available) {
            roomAssignments.get(r.id)!.push(p.id);
            stagingAssignments.push({
              participantId: p.id,
              roomId: r.id,
              isLocked: 0,
            });
            roomIdx = (roomIdx + 1) % activeRooms.length;
            break;
          }
          roomIdx = (roomIdx + 1) % activeRooms.length;
          attempts++;
        }
      }
    }

    // 6. Multi-row Staging Write (max 20 rows / 100 bound parameters per query)
    const CHUNK_SIZE = 20;
    for (let i = 0; i < stagingAssignments.length; i += CHUNK_SIZE) {
      const chunk = stagingAssignments.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const bindings: any[] = [];
      for (const item of chunk) {
        bindings.push(batchId, eventId, item.participantId, item.roomId, item.isLocked);
      }

      await db
        .prepare(`
          INSERT INTO cbt_semester_rooms_staging (batch_id, event_id, participant_id, room_id, is_locked)
          VALUES ${placeholders}
        `)
        .bind(...bindings)
        .run();
    }

    // 7. Atomic Set-Based Promotion in single transaction batch
    const statements = [
      // Update unlocked participants' room_id
      db.prepare(`
        UPDATE cbt_semester_participants
        SET room_id = (
          SELECT s.room_id FROM cbt_semester_rooms_staging s
          WHERE s.batch_id = ? AND s.participant_id = cbt_semester_participants.id
        ),
        updated_at = datetime('now')
        WHERE id IN (
          SELECT participant_id FROM cbt_semester_rooms_staging
          WHERE batch_id = ? AND is_locked = 0
        )
      `).bind(batchId, batchId),

      // Synchronize exam rosters room_id for affected participants
      db.prepare(`
        UPDATE cbt_exam_roster
        SET room_id = (
          SELECT p.room_id FROM cbt_semester_participants p
          WHERE p.event_id = cbt_exam_roster.event_id AND p.student_id = cbt_exam_roster.source_id
        ),
        updated_at = datetime('now')
        WHERE event_id = ? AND source_id IN (
          SELECT student_id FROM cbt_semester_participants
          WHERE id IN (SELECT participant_id FROM cbt_semester_rooms_staging WHERE batch_id = ? AND is_locked = 0)
        )
      `).bind(eventId, batchId),

      // Purge staging records
      db.prepare('DELETE FROM cbt_semester_rooms_staging WHERE batch_id = ?').bind(batchId),
    ];

    await db.batch(statements);

    // 8. Invalidate downstream stages (seating, timetable, invigilators)
    await invalidateDownstreamRevisions(db, eventId, 'room_allocation');

    // 9. Build summary and log
    const roomSummary = rooms.map((r) => {
      const assigned = stagingAssignments.filter((a) => a.roomId === r.id).length;
      return { roomId: r.id, roomName: r.name, capacity: r.capacity, assigned };
    });

    const summaryMsg = `Successfully allocated ${unlockedParticipants.length} participants across ${rooms.length} rooms. Preserved ${lockedParticipants.length} locked assignments.`;
    await logGenerationResult(db, eventId, 'room_allocation', actorId, null, config, 'success', summaryMsg);

    await releaseGenerationLock(db, eventId, 'room_allocation', batchId);

    return {
      success: true,
      status: 'success',
      message: summaryMsg,
      totalParticipants: participants.length,
      assignedCount: unlockedParticipants.length,
      preservedLockedCount: lockedParticipants.length,
      roomSummary,
    };
  } catch (err: any) {
    // Clean up staging on failure
    await db.prepare('DELETE FROM cbt_semester_rooms_staging WHERE batch_id = ?').bind(batchId).run().catch(() => {});
    await releaseGenerationLock(db, eventId, 'room_allocation', batchId);
    await logGenerationResult(db, eventId, 'room_allocation', actorId, null, config, 'failed', err.message || 'Internal failure');
    return { success: false, status: 'failed', message: err.message || 'Room allocation failed.' };
  }
}

/**
 * Toggles a participant's room lock (pure lock mutation, separate from structural move).
 */
export async function setParticipantRoomLock(
  db: D1Database,
  eventId: string,
  participantId: string,
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
      UPDATE cbt_semester_participants
      SET is_room_locked = ?, updated_at = datetime('now')
      WHERE id = ? AND event_id = ?
    `)
    .bind(isLocked ? 1 : 0, participantId, eventId)
    .run();

  return { success: result.success };
}

/**
 * Manually assigns a participant to a specific room.
 * Atomically clears unlocked seat assignment if participant has one.
 * Rejects if participant has a locked seat assignment or locked room.
 */
export async function manualAssignParticipantRoom(
  db: D1Database,
  eventId: string,
  participantId: string,
  newRoomId: string | null
): Promise<{ success: boolean; error?: string }> {
  // Check event freeze
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot mutate rooms in a frozen or active event.' };
  }

  const participant = await db
    .prepare('SELECT * FROM cbt_semester_participants WHERE id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .first<SemesterParticipant>();

  if (!participant) {
    return { success: false, error: 'Participant not found.' };
  }

  if (participant.is_room_locked === 1) {
    return { success: false, error: 'Cannot change room for participant with a locked room. Unlock first.' };
  }

  // Check seat assignments
  const existingSeat = await db
    .prepare('SELECT id, is_locked FROM cbt_semester_seat_assignments WHERE participant_id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .first<{ id: string; is_locked: number }>();

  if (existingSeat) {
    if (existingSeat.is_locked === 1) {
      return { success: false, error: 'Cannot change room for participant with a locked seat assignment. Unlock seat first.' };
    }
  }

  const statements = [];

  // Clear unlocked seat assignment if changing room
  if (existingSeat && participant.room_id !== newRoomId) {
    statements.push(
      db.prepare('DELETE FROM cbt_semester_seat_assignments WHERE id = ?').bind(existingSeat.id)
    );
  }

  // Update participant room and pin lock
  statements.push(
    db.prepare(`
      UPDATE cbt_semester_participants
      SET room_id = ?, is_room_locked = 1, updated_at = datetime('now')
      WHERE id = ? AND event_id = ?
    `).bind(newRoomId, participantId, eventId)
  );

  // Sync exam roster
  statements.push(
    db.prepare(`
      UPDATE cbt_exam_roster
      SET room_id = ?, updated_at = datetime('now')
      WHERE event_id = ? AND source_id = ?
    `).bind(newRoomId, eventId, participant.student_id)
  );

  await db.batch(statements);

  // Invalidate downstream
  await invalidateDownstreamRevisions(db, eventId, 'room_allocation');

  return { success: true };
}
