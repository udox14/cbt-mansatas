// ============================================================
// Phase 7: Semester Seating Distribution & Room Layout Service
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type {
  SemesterRoomLayout,
  SemesterSeat,
  SemesterSeatAssignment,
  SemesterParticipant,
  SeatingDistributionConfig,
} from './types.ts';
import { acquireGenerationLock, releaseGenerationLock, invalidateDownstreamRevisions, logGenerationResult } from './concurrency.ts';

export interface SeatingDistributionResult {
  success: boolean;
  status: 'success' | 'impossible' | 'failed';
  message: string;
  totalAssigned?: number;
  preservedLockedCount?: number;
  roomDetails?: Array<{ roomId: string; roomName: string; totalSeats: number; assignedCount: number }>;
  shortage?: { roomId: string; required: number; available: number };
}

/**
 * Deterministic pseudo-random number generator (LCG) based on seed.
 */
function createSeededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Gets or initializes the room layout metadata.
 * If none configured, creates a default logical fallback matching room capacity.
 */
export async function getRoomLayout(
  db: D1Database,
  eventId: string,
  roomId: string
): Promise<SemesterRoomLayout> {
  const existing = await db
    .prepare('SELECT * FROM cbt_semester_room_layouts WHERE event_id = ? AND room_id = ?')
    .bind(eventId, roomId)
    .first<SemesterRoomLayout>();

  if (existing) {
    return existing;
  }

  // Fallback: create from room capacity
  const room = await db
    .prepare('SELECT id, room_name as name, capacity FROM cbt_rooms WHERE id = ?')
    .bind(roomId)
    .first<{ id: string; name: string; capacity: number }>();

  const capacity = room?.capacity || 30;
  const layoutId = crypto.randomUUID();

  await db
    .prepare(`
      INSERT INTO cbt_semester_room_layouts (id, event_id, room_id, layout_type, total_seats, required_invigilators)
      VALUES (?, ?, ?, 'logical_fallback', ?, 1)
    `)
    .bind(layoutId, eventId, roomId, capacity)
    .run();

  // Create logical seats if not existing
  await ensureSeatsExistForLayout(db, eventId, roomId, capacity);

  return {
    id: layoutId,
    event_id: eventId,
    room_id: roomId,
    layout_type: 'logical_fallback',
    total_seats: capacity,
    rows_count: null,
    cols_count: null,
    desk_group_count: null,
    is_irregular: 0,
    required_invigilators: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Ensures seats exist in cbt_semester_seats for a given room.
 */
async function ensureSeatsExistForLayout(
  db: D1Database,
  eventId: string,
  roomId: string,
  capacity: number
): Promise<void> {
  const existingSeats = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_semester_seats WHERE event_id = ? AND room_id = ?')
    .bind(eventId, roomId)
    .first<{ cnt: number }>();

  if ((existingSeats?.cnt || 0) >= capacity) {
    return;
  }

  // Insert sequential logical seats
  const CHUNK_SIZE = 10;
  for (let start = 1; start <= capacity; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, capacity);
    const chunk: Array<{ num: number; label: string; row: number; col: number; desk: number | null }> = [];

    for (let s = start; s <= end; s++) {
      const label = `K-${String(s).padStart(2, '0')}`;
      chunk.push({ num: s, label, row: s, col: 1, desk: null });
    }

    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const bindings: any[] = [];
    for (const item of chunk) {
      bindings.push(
        crypto.randomUUID(),
        eventId,
        roomId,
        item.num,
        item.label,
        item.row,
        item.col,
        item.desk,
        item.num
      );
    }

    await db
      .prepare(`
        INSERT OR IGNORE INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label, row_num, col_num, desk_group, sequence_order)
        VALUES ${placeholders}
      `)
      .bind(...bindings)
      .run();
  }
}

/**
 * Configures or reconfigures a physical room layout.
 * Enforces total seats match room capacity.
 */
export async function configureRoomLayout(
  db: D1Database,
  eventId: string,
  roomId: string,
  config: {
    rows_count?: number;
    cols_count?: number;
    desk_group_count?: number;
    is_irregular?: boolean;
    required_invigilators?: number;
    custom_seats?: Array<{
      seat_number: number;
      seat_label: string;
      row_num: number;
      col_num: number;
      desk_group?: number;
    }>;
  }
): Promise<{ success: boolean; error?: string; layout?: SemesterRoomLayout }> {
  // Check event freeze
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot modify room layouts in a frozen or active event.' };
  }

  const room = await db
    .prepare('SELECT id, capacity FROM cbt_rooms WHERE id = ?')
    .bind(roomId)
    .first<{ id: string; capacity: number }>();

  if (!room) {
    return { success: false, error: 'Room not found.' };
  }

  // Check if locked seat assignments exist in this room
  const lockedCount = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_semester_seat_assignments WHERE event_id = ? AND room_id = ? AND is_locked = 1')
    .bind(eventId, roomId)
    .first<{ cnt: number }>();

  if ((lockedCount?.cnt || 0) > 0) {
    return { success: false, error: 'Cannot reconfigure room layout while locked seat assignments exist in this room.' };
  }

  const isIrregular = config.is_irregular ? 1 : 0;
  let seatsToInsert: Array<{ seat_number: number; seat_label: string; row_num: number; col_num: number; desk_group?: number; seq: number }> = [];

  if (config.custom_seats && config.custom_seats.length > 0) {
    if (config.custom_seats.length !== room.capacity) {
      return {
        success: false,
        error: `Custom seats count (${config.custom_seats.length}) must exactly match room capacity (${room.capacity}).`,
      };
    }
    seatsToInsert = config.custom_seats.map((s, idx) => ({
      ...s,
      seq: idx + 1,
    }));
  } else {
    // Generate grid based on rows and columns
    const rows = config.rows_count || Math.ceil(room.capacity / 4);
    const cols = config.cols_count || 4;
    const totalGrid = rows * cols;
    if (totalGrid < room.capacity) {
      return {
        success: false,
        error: `Grid dimensions (${rows}x${cols} = ${totalGrid}) cannot hold room capacity (${room.capacity}).`,
      };
    }

    let seatNum = 1;
    for (let r = 1; r <= rows && seatNum <= room.capacity; r++) {
      for (let c = 1; c <= cols && seatNum <= room.capacity; c++) {
        const desk = Math.ceil(c / 2) + (r - 1) * Math.ceil(cols / 2);
        seatsToInsert.push({
          seat_number: seatNum,
          seat_label: `R${r}-C${c}`,
          row_num: r,
          col_num: c,
          desk_group: desk,
          seq: seatNum,
        });
        seatNum++;
      }
    }
  }

  // Rebuild seats for this room in single batch
  const statements = [
    // Delete existing unlocked seat assignments first
    db.prepare('DELETE FROM cbt_semester_seat_assignments WHERE event_id = ? AND room_id = ? AND is_locked = 0').bind(eventId, roomId),
    // Delete existing seats
    db.prepare('DELETE FROM cbt_semester_seats WHERE event_id = ? AND room_id = ?').bind(eventId, roomId),
    // Upsert room layout
    db.prepare(`
      INSERT INTO cbt_semester_room_layouts (id, event_id, room_id, layout_type, total_seats, rows_count, cols_count, desk_group_count, is_irregular, required_invigilators, updated_at)
      VALUES (?, ?, ?, 'physical_configured', ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(event_id, room_id) DO UPDATE SET
        layout_type = 'physical_configured',
        total_seats = excluded.total_seats,
        rows_count = excluded.rows_count,
        cols_count = excluded.cols_count,
        desk_group_count = excluded.desk_group_count,
        is_irregular = excluded.is_irregular,
        required_invigilators = excluded.required_invigilators,
        updated_at = datetime('now')
    `).bind(
      crypto.randomUUID(),
      eventId,
      roomId,
      room.capacity,
      config.rows_count || null,
      config.cols_count || null,
      config.desk_group_count || null,
      isIrregular,
      config.required_invigilators || 1
    ),
  ];

  await db.batch(statements);

  // Insert generated seats in chunks
  const CHUNK_SIZE = 10;
  for (let i = 0; i < seatsToInsert.length; i += CHUNK_SIZE) {
    const chunk = seatsToInsert.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const bindings: any[] = [];
    for (const item of chunk) {
      bindings.push(
        crypto.randomUUID(),
        eventId,
        roomId,
        item.seat_number,
        item.seat_label,
        item.row_num,
        item.col_num,
        item.desk_group || null,
        item.seq
      );
    }
    await db
      .prepare(`
        INSERT INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label, row_num, col_num, desk_group, sequence_order)
        VALUES ${placeholders}
      `)
      .bind(...bindings)
      .run();
  }

  // Invalidate downstream
  await invalidateDownstreamRevisions(db, eventId, 'seating');

  const layout = await getRoomLayout(db, eventId, roomId);
  return { success: true, layout };
}

/**
 * Fetches all physical seats in a room.
 */
export async function getRoomSeats(
  db: D1Database,
  eventId: string,
  roomId: string
): Promise<SemesterSeat[]> {
  await getRoomLayout(db, eventId, roomId); // ensure seats exist
  const { results } = await db
    .prepare('SELECT * FROM cbt_semester_seats WHERE event_id = ? AND room_id = ? ORDER BY sequence_order ASC, seat_number ASC')
    .bind(eventId, roomId)
    .all<SemesterSeat>();
  return results || [];
}

/**
 * Fetches seat assignments for a room with participant details.
 */
export async function getRoomSeatAssignments(
  db: D1Database,
  eventId: string,
  roomId: string
): Promise<SemesterSeatAssignment[]> {
  const { results } = await db
    .prepare(`
      SELECT
        sa.*,
        p.nama_lengkap as participant_name,
        p.nomor_peserta,
        p.class_name,
        p.grade,
        p.gender,
        s.seat_number,
        s.seat_label,
        s.row_num,
        s.col_num,
        s.desk_group
      FROM cbt_semester_seat_assignments sa
      JOIN cbt_semester_participants p ON p.id = sa.participant_id
      JOIN cbt_semester_seats s ON s.id = sa.seat_id
      WHERE sa.event_id = ? AND sa.room_id = ?
      ORDER BY s.sequence_order ASC, s.seat_number ASC
    `)
    .bind(eventId, roomId)
    .all<SemesterSeatAssignment>();
  return results || [];
}

/**
 * Executes automatic seating distribution solver across all rooms.
 * Uses cross-grade desk pairing to minimize copying, with multi-row staging and atomic promotion.
 */
export async function autoDistributeSeats(
  db: D1Database,
  eventId: string,
  actorId: string,
  config: SeatingDistributionConfig = {}
): Promise<SeatingDistributionResult> {
  // 1. Check Event Freeze
  const event = await db
    .prepare('SELECT id, status FROM cbt_events WHERE id = ? AND mode = ?')
    .bind(eventId, 'semester')
    .first<{ id: string; status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      status: 'failed',
      message: `Cannot distribute seats in a ${event?.status || 'unknown'} semester event. Event must be in draft status.`,
    };
  }

  // 2. Acquire generation lock
  const lock = await acquireGenerationLock(db, eventId, 'seating', actorId);
  if (!lock.acquired || !lock.batchId) {
    return { success: false, status: 'failed', message: lock.error || 'Failed to acquire generation lock.' };
  }

  const batchId = lock.batchId;
  const rng = config.seed !== undefined ? createSeededRandom(config.seed) : Math.random;

  try {
    // 3. Fetch rooms with assigned participants
    const { results: roomGroups } = await db
      .prepare(`
        SELECT r.id as room_id, r.room_name, r.capacity, COUNT(p.id) as participant_count
        FROM cbt_rooms r
        JOIN cbt_semester_participants p ON p.room_id = r.id AND p.event_id = ?
        WHERE r.event_id = ? OR r.event_id IS NULL
        GROUP BY r.id
        ORDER BY r.room_name ASC
      `)
      .bind(eventId, eventId)
      .all<{ room_id: string; room_name: string; capacity: number; participant_count: number }>();

    if (!roomGroups || roomGroups.length === 0) {
      await releaseGenerationLock(db, eventId, 'seating', batchId);
      return { success: true, status: 'success', message: 'No rooms with assigned participants to seat.', totalAssigned: 0 };
    }

    const stagingAssignments: Array<{ participantId: string; roomId: string; seatId: string; isLocked: number }> = [];
    const roomDetails: Array<{ roomId: string; roomName: string; totalSeats: number; assignedCount: number }> = [];
    let totalLockedPreserved = 0;

    for (const rg of roomGroups) {
      // Ensure layout and seats exist
      const layout = await getRoomLayout(db, eventId, rg.room_id);
      const seats = await getRoomSeats(db, eventId, rg.room_id);

      if (seats.length < rg.participant_count) {
        const msg = `Room ${rg.room_name} has ${seats.length} seats but ${rg.participant_count} assigned participants.`;
        await logGenerationResult(db, eventId, 'seating', actorId, config.seed || null, config, 'impossible', msg);
        await releaseGenerationLock(db, eventId, 'seating', batchId);
        return {
          success: false,
          status: 'impossible',
          message: msg,
          shortage: { roomId: rg.room_id, required: rg.participant_count, available: seats.length },
        };
      }

      // Fetch participants for this room
      const { results: participants } = await db
        .prepare('SELECT * FROM cbt_semester_participants WHERE event_id = ? AND room_id = ? ORDER BY grade ASC, nama_lengkap ASC')
        .bind(eventId, rg.room_id)
        .all<SemesterParticipant>();

      // Fetch existing seat assignments for this room
      const { results: existingAssignments } = await db
        .prepare('SELECT * FROM cbt_semester_seat_assignments WHERE event_id = ? AND room_id = ?')
        .bind(eventId, rg.room_id)
        .all<SemesterSeatAssignment>();

      const preserveLocked = config.preserve_locked !== false;
      const lockedAssignments = preserveLocked
        ? (existingAssignments || []).filter((a) => a.is_locked === 1)
        : [];
      totalLockedPreserved += lockedAssignments.length;

      const lockedParticipantIds = new Set(lockedAssignments.map((a) => a.participant_id));
      const occupiedSeatIds = new Set(lockedAssignments.map((a) => a.seat_id));

      for (const la of lockedAssignments) {
        stagingAssignments.push({
          participantId: la.participant_id,
          roomId: rg.room_id,
          seatId: la.seat_id,
          isLocked: 1,
        });
      }

      // Unlocked participants and available seats
      const unlockedParticipants = (participants || []).filter((p) => !lockedParticipantIds.has(p.id));
      const availableSeats = seats.filter((s) => !occupiedSeatIds.has(s.id));

      // Anti-copying cross-grade pairing ONLY if room layout is physical_configured
      const isPhysical = layout.layout_type === 'physical_configured';
      const crossGrade = isPhysical && config.cross_grade_pairing !== false;
      let orderedParticipants: SemesterParticipant[] = [];

      if (crossGrade) {
        // Group by grade
        const gradeGroups = new Map<string, SemesterParticipant[]>();
        for (const p of unlockedParticipants) {
          if (!gradeGroups.has(p.grade)) gradeGroups.set(p.grade, []);
          gradeGroups.get(p.grade)!.push(p);
        }

        // Shuffle within grades if seed/random
        for (const [grade, list] of gradeGroups.entries()) {
          list.sort(() => rng() - 0.5);
        }

        // Interleave grades (e.g. Grade 10, Grade 11, Grade 10, Grade 11)
        const grades = Array.from(gradeGroups.keys()).sort();
        let added = true;
        let gradeIdx = 0;
        while (added) {
          added = false;
          for (let i = 0; i < grades.length; i++) {
            const g = grades[(gradeIdx + i) % grades.length];
            const list = gradeGroups.get(g)!;
            if (list.length > 0) {
              orderedParticipants.push(list.shift()!);
              added = true;
            }
          }
          gradeIdx = (gradeIdx + 1) % grades.length;
        }
      } else {
        orderedParticipants = [...unlockedParticipants].sort(() => rng() - 0.5);
      }

      // Assign to available seats: for physical layouts order by desk group, for logical fallback order strictly by sequence_order
      if (isPhysical) {
        availableSeats.sort((a, b) => {
          if (a.desk_group && b.desk_group && a.desk_group !== b.desk_group) {
            return a.desk_group - b.desk_group;
          }
          return a.sequence_order - b.sequence_order;
        });
      } else {
        availableSeats.sort((a, b) => a.sequence_order - b.sequence_order);
      }

      for (let i = 0; i < orderedParticipants.length; i++) {
        const participant = orderedParticipants[i];
        const seat = availableSeats[i];
        stagingAssignments.push({
          participantId: participant.id,
          roomId: rg.room_id,
          seatId: seat.id,
          isLocked: 0,
        });
      }

      roomDetails.push({
        roomId: rg.room_id,
        roomName: rg.room_name,
        totalSeats: seats.length,
        assignedCount: (participants || []).length,
      });
    }

    // 4. Multi-Row Staging Write (max 16 rows / 96 bound parameters per statement)
    const CHUNK_SIZE = 16;
    for (let i = 0; i < stagingAssignments.length; i += CHUNK_SIZE) {
      const chunk = stagingAssignments.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const bindings: any[] = [];
      for (const item of chunk) {
        bindings.push(batchId, eventId, item.participantId, item.roomId, item.seatId, item.isLocked);
      }

      await db
        .prepare(`
          INSERT INTO cbt_semester_seat_assignments_staging (batch_id, event_id, participant_id, room_id, seat_id, is_locked)
          VALUES ${placeholders}
        `)
        .bind(...bindings)
        .run();
    }

    // 5. Atomic Promotion
    const statements = [
      // Delete unlocked seat assignments in target rooms
      db.prepare(`
        DELETE FROM cbt_semester_seat_assignments
        WHERE event_id = ? AND is_locked = 0
      `).bind(eventId),

      // Insert new unlocked assignments from staging
      db.prepare(`
        INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id, is_locked)
        SELECT lower(hex(randomblob(16))), event_id, participant_id, room_id, seat_id, 0
        FROM cbt_semester_seat_assignments_staging
        WHERE batch_id = ? AND is_locked = 0
      `).bind(batchId),

      // Purge staging
      db.prepare('DELETE FROM cbt_semester_seat_assignments_staging WHERE batch_id = ?').bind(batchId),
    ];

    await db.batch(statements);

    // 6. Invalidate downstream stages
    await invalidateDownstreamRevisions(db, eventId, 'seating');

    const summaryMsg = `Distributed seating for ${stagingAssignments.length} participants across ${roomGroups.length} rooms. Preserved ${totalLockedPreserved} locked seat assignments.`;
    await logGenerationResult(db, eventId, 'seating', actorId, config.seed || null, config, 'success', summaryMsg);

    await releaseGenerationLock(db, eventId, 'seating', batchId);

    return {
      success: true,
      status: 'success',
      message: summaryMsg,
      totalAssigned: stagingAssignments.length,
      preservedLockedCount: totalLockedPreserved,
      roomDetails,
    };
  } catch (err: any) {
    await db.prepare('DELETE FROM cbt_semester_seat_assignments_staging WHERE batch_id = ?').bind(batchId).run().catch(() => {});
    await releaseGenerationLock(db, eventId, 'seating', batchId);
    await logGenerationResult(db, eventId, 'seating', actorId, config.seed || null, config, 'failed', err.message || 'Internal error');
    return { success: false, status: 'failed', message: err.message || 'Seating distribution failed.' };
  }
}

/**
 * Manually assigns a participant to a specific seat.
 * Atomically pins participant.is_room_locked = 1.
 * Supports swapping if seat is occupied by an unlocked participant and swap=true.
 */
export async function manualAssignParticipantSeat(
  db: D1Database,
  eventId: string,
  participantId: string,
  targetSeatId: string,
  options: { swap?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  // Check freeze
  const event = await db
    .prepare('SELECT status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<{ status: string }>();

  if (!event || ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return { success: false, error: 'Cannot modify seat assignments in a frozen or active event.' };
  }

  const participant = await db
    .prepare('SELECT * FROM cbt_semester_participants WHERE id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .first<SemesterParticipant>();

  if (!participant || !participant.room_id) {
    return { success: false, error: 'Participant has no room assigned.' };
  }

  const seat = await db
    .prepare('SELECT * FROM cbt_semester_seats WHERE id = ? AND event_id = ?')
    .bind(targetSeatId, eventId)
    .first<SemesterSeat>();

  if (!seat) {
    return { success: false, error: 'Seat not found.' };
  }

  if (seat.room_id !== participant.room_id) {
    return { success: false, error: 'Target seat belongs to a different room than participant.' };
  }

  // Check if target seat is already occupied
  const existingAtSeat = await db
    .prepare('SELECT * FROM cbt_semester_seat_assignments WHERE seat_id = ? AND event_id = ?')
    .bind(targetSeatId, eventId)
    .first<SemesterSeatAssignment>();

  const existingParticipantAssignment = await db
    .prepare('SELECT * FROM cbt_semester_seat_assignments WHERE participant_id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .first<SemesterSeatAssignment>();

  if (existingAtSeat && existingAtSeat.participant_id !== participantId) {
    if (existingAtSeat.is_locked === 1) {
      return { success: false, error: 'Target seat is occupied by a locked participant. Unlock first.' };
    }

    if (!options.swap) {
      return { success: false, error: 'Target seat is already occupied. Set swap=true to swap.' };
    }

    // Swap seats between the two participants
    const idsToDelete = [existingAtSeat.id];
    if (existingParticipantAssignment) idsToDelete.push(existingParticipantAssignment.id);

    const statements = [
      // 1. Delete existing assignment(s) first to avoid transient UNIQUE constraint collision on (event_id, seat_id)
      db.prepare(`DELETE FROM cbt_semester_seat_assignments WHERE id IN (${idsToDelete.map(() => '?').join(', ')})`).bind(...idsToDelete),

      // 2. Re-insert participant with target seat
      db.prepare(`
        INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id, is_locked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(
        existingParticipantAssignment ? existingParticipantAssignment.id : crypto.randomUUID(),
        eventId,
        participantId,
        participant.room_id,
        targetSeatId
      ),
    ];

    // 3. Re-insert existing occupant into participant's previous seat (if participant had one)
    if (existingParticipantAssignment) {
      statements.push(
        db.prepare(`
          INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id, is_locked)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          existingAtSeat.id,
          eventId,
          existingAtSeat.participant_id,
          existingAtSeat.room_id,
          existingParticipantAssignment.seat_id,
          existingAtSeat.is_locked
        )
      );
    }

    // 4. Atomically pin participant.is_room_locked = 1
    statements.push(
      db.prepare('UPDATE cbt_semester_participants SET is_room_locked = 1, updated_at = datetime(\'now\') WHERE id = ?').bind(participantId)
    );

    await db.batch(statements);
    await invalidateDownstreamRevisions(db, eventId, 'seating');
    return { success: true };
  }

  // Unoccupied or re-assigning own seat
  const statements = [
    existingParticipantAssignment
      ? db.prepare('UPDATE cbt_semester_seat_assignments SET seat_id = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(targetSeatId, existingParticipantAssignment.id)
      : db.prepare('INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id, is_locked) VALUES (?, ?, ?, ?, ?, 0)').bind(crypto.randomUUID(), eventId, participantId, participant.room_id, targetSeatId),

    // Atomically pin participant.is_room_locked = 1
    db.prepare('UPDATE cbt_semester_participants SET is_room_locked = 1, updated_at = datetime(\'now\') WHERE id = ?').bind(participantId),
  ];

  await db.batch(statements);
  await invalidateDownstreamRevisions(db, eventId, 'seating');
  return { success: true };
}

/**
 * Toggles a seat assignment's lock.
 * If locking, atomically pins participant's room lock (is_room_locked = 1).
 */
export async function setSeatAssignmentLock(
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

  const assignment = await db
    .prepare('SELECT * FROM cbt_semester_seat_assignments WHERE id = ? AND event_id = ?')
    .bind(assignmentId, eventId)
    .first<SemesterSeatAssignment>();

  if (!assignment) {
    return { success: false, error: 'Seat assignment not found.' };
  }

  const statements = [
    db.prepare(`
      UPDATE cbt_semester_seat_assignments
      SET is_locked = ?, updated_at = datetime('now')
      WHERE id = ? AND event_id = ?
    `).bind(isLocked ? 1 : 0, assignmentId, eventId),
  ];

  if (isLocked) {
    // Atomically pin participant's room lock
    statements.push(
      db.prepare(`
        UPDATE cbt_semester_participants
        SET is_room_locked = 1, updated_at = datetime('now')
        WHERE id = ? AND event_id = ?
      `).bind(assignment.participant_id, eventId)
    );
  }

  await db.batch(statements);
  return { success: true };
}
