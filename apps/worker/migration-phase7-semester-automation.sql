-- ============================================================
-- Phase 7: Semester Automation & Seating Distribution Migration
-- Pure D1 / SQLite additive migration with comprehensive triggers
-- ============================================================

-- 1. Additive Locks on Phase 6 Tables
ALTER TABLE cbt_semester_participants ADD COLUMN is_room_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_room_locked IN (0, 1));
ALTER TABLE cbt_semester_schedules ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1));

-- 2. Concurrency Controls
CREATE TABLE IF NOT EXISTS cbt_semester_generation_controls (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('room_allocation', 'seating', 'timetable', 'invigilators')),
  active_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running')),
  started_at TEXT,
  actor_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_semester_gen_controls ON cbt_semester_generation_controls(event_id, stage);

-- 3. Room Layout Metadata & Provenance
CREATE TABLE IF NOT EXISTS cbt_semester_room_layouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  layout_type TEXT NOT NULL CHECK (layout_type IN ('logical_fallback', 'physical_configured')),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  rows_count INTEGER,
  cols_count INTEGER,
  desk_group_count INTEGER,
  is_irregular INTEGER NOT NULL DEFAULT 0 CHECK (is_irregular IN (0, 1)),
  required_invigilators INTEGER NOT NULL DEFAULT 1 CHECK (required_invigilators IN (1, 2)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_layouts_room ON cbt_semester_room_layouts(event_id, room_id);

-- 4. Physical Seats Definition
CREATE TABLE IF NOT EXISTS cbt_semester_seats (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL CHECK (seat_number > 0),
  seat_label TEXT NOT NULL,
  row_num INTEGER NOT NULL DEFAULT 1 CHECK (row_num > 0),
  col_num INTEGER NOT NULL DEFAULT 1 CHECK (col_num > 0),
  desk_group INTEGER CHECK (desk_group IS NULL OR desk_group > 0),
  sequence_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, room_id, seat_number),
  UNIQUE(event_id, room_id, seat_label),
  UNIQUE(event_id, room_id, row_num, col_num)
);

CREATE INDEX IF NOT EXISTS idx_semester_seats_room ON cbt_semester_seats(event_id, room_id, sequence_order);

-- 5. Participant Seat Assignments
CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES cbt_semester_participants(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL REFERENCES cbt_semester_seats(id) ON DELETE CASCADE,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, participant_id),
  UNIQUE(event_id, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_seat_assign_room ON cbt_semester_seat_assignments(event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_semester_seat_assign_seat ON cbt_semester_seat_assignments(seat_id);

-- 6. Staging Tables for Multi-Row Bounded Scale Generation
CREATE TABLE IF NOT EXISTS cbt_semester_rooms_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, participant_id)
);

CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, participant_id)
);

CREATE TABLE IF NOT EXISTS cbt_semester_invig_staging (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  invigilator_order INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  mansatas_user_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, slot_id, room_id, invigilator_order)
);

-- 7. Invigilator Pool & Blackouts
CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_pool (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  is_eligible INTEGER NOT NULL DEFAULT 1 CHECK (is_eligible IN (0, 1)),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_invig_pool_event ON cbt_semester_invigilator_pool(event_id, is_eligible);

CREATE TABLE IF NOT EXISTS cbt_semester_staff_blackouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  slot_id TEXT REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  blackout_date TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (
    slot_id IS NOT NULL OR (
      blackout_date IS NOT NULL AND
      length(blackout_date) = 10 AND
      blackout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_semester_blackouts_lookup ON cbt_semester_staff_blackouts(event_id, staff_id);

-- 8. Invigilator Assignments
CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE RESTRICT,
  invigilator_order INTEGER NOT NULL DEFAULT 1 CHECK (invigilator_order IN (1, 2)),
  staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE RESTRICT,
  staff_name TEXT NOT NULL,
  mansatas_user_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, slot_id, staff_id),
  UNIQUE(event_id, slot_id, room_id, invigilator_order)
);

CREATE INDEX IF NOT EXISTS idx_semester_invig_slot ON cbt_semester_invigilator_assignments(event_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_semester_invig_staff ON cbt_semester_invigilator_assignments(staff_id);

-- 9. Immutable Generation Logs
CREATE TABLE IF NOT EXISTS cbt_semester_generation_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('room_allocation', 'seating', 'timetable', 'invigilators')),
  actor_id TEXT NOT NULL,
  seed INTEGER,
  configuration TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'impossible', 'failed')),
  summary TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_semester_gen_logs_event ON cbt_semester_generation_logs(event_id, stage, created_at);

-- ============================================================
-- DB Integrity Triggers
-- ============================================================

-- 1. Immutable Generation Logs Triggers
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_gen_logs_no_update
BEFORE UPDATE ON cbt_semester_generation_logs
BEGIN
  SELECT RAISE(ABORT, 'cbt_semester_generation_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_gen_logs_no_delete
BEFORE DELETE ON cbt_semester_generation_logs
BEGIN
  SELECT RAISE(ABORT, 'cbt_semester_generation_logs entries cannot be deleted');
END;

-- 2. Phase 6 Lock Columns Freeze Guards
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_freeze_lock_update
BEFORE UPDATE OF is_room_locked ON cbt_semester_participants
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot toggle is_room_locked in a frozen or active semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_freeze_lock_update
BEFORE UPDATE OF is_locked ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot toggle is_locked on schedules in a frozen or active semester event')
  END;
END;

-- 3. Schedule Lock Structural Protection & Delete Guard
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_locked_protect
BEFORE UPDATE ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN OLD.is_locked = 1 AND (OLD.slot_id != NEW.slot_id OR OLD.exam_id != NEW.exam_id OR OLD.event_id != NEW.event_id)
      THEN RAISE(ABORT, 'Transitioning schedule from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_schedules_locked_delete
BEFORE DELETE ON cbt_semester_schedules
BEGIN
  SELECT CASE
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked schedule. Unlock first.')
  END;
END;

-- 4. Reverse Room Integrity & Seat Protection
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_participants_room_change_integrity
BEFORE UPDATE OF room_id ON cbt_semester_participants
WHEN NEW.room_id IS NOT OLD.room_id
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_seat_assignments WHERE participant_id = OLD.id AND is_locked = 1
    ) THEN RAISE(ABORT, 'Cannot change room for participant with a locked seat assignment. Unlock seat first.')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_seat_assignments WHERE participant_id = OLD.id
    ) THEN RAISE(ABORT, 'Participant has an active seat assignment. Service must clear unlocked seat before changing room.')
  END;
END;

-- 5. Seats Integrity, Structural Protection & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_integrity_insert
BEFORE INSERT ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seats can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert seats into a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Seat room must be global or belong to this semester event')
    WHEN NEW.seat_number <= 0 OR NEW.row_num <= 0 OR NEW.col_num <= 0
      THEN RAISE(ABORT, 'Seat numbers, rows, and columns must be positive integers')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_integrity_update
BEFORE UPDATE ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify seats in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seats can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Seat room must be global or belong to this semester event')
    WHEN NEW.seat_number <= 0 OR NEW.row_num <= 0 OR NEW.col_num <= 0
      THEN RAISE(ABORT, 'Seat numbers, rows, and columns must be positive integers')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seats_freeze_delete
BEFORE DELETE ON cbt_semester_seats
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete seats from a frozen or active semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE seat_id = OLD.id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot delete a seat that has a locked seat assignment')
  END;
END;

-- 6. Seat Assignment Integrity & Locked Protection
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_integrity_insert
BEFORE INSERT ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seat_assignments can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot assign seats in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Assigned participant must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat room must match participant assigned room')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_seats WHERE id = NEW.seat_id AND event_id = NEW.event_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat must exist in the target room and event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_integrity_update
BEFORE UPDATE ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify seat assignments in a frozen or active semester event')
    WHEN OLD.is_locked = 1 AND (OLD.participant_id != NEW.participant_id OR OLD.room_id != NEW.room_id OR OLD.seat_id != NEW.seat_id)
      THEN RAISE(ABORT, 'Transitioning seat assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_seat_assignments can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Assigned participant must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_participants WHERE id = NEW.participant_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat room must match participant assigned room')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_seats WHERE id = NEW.seat_id AND event_id = NEW.event_id AND room_id = NEW.room_id)
      THEN RAISE(ABORT, 'Assigned seat must exist in the target room and event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_seat_assign_freeze_delete
BEFORE DELETE ON cbt_semester_seat_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete seat assignments from a frozen or active semester event')
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked seat assignment. Unlock first.')
  END;
END;

-- 7. Room Layouts Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_integrity_insert
BEFORE INSERT ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_room_layouts can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert room layouts in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Layout room must be global or belong to this semester event')
    WHEN NEW.layout_type = 'physical_configured' AND NEW.total_seats != (SELECT capacity FROM cbt_rooms WHERE id = NEW.room_id)
      THEN RAISE(ABORT, 'Physical layout seat count must match room capacity')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_integrity_update
BEFORE UPDATE ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify room layouts in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.room_id != NEW.room_id
      THEN RAISE(ABORT, 'Cannot move room layout to another event or room')
    WHEN NEW.layout_type = 'physical_configured' AND NEW.total_seats != (SELECT capacity FROM cbt_rooms WHERE id = NEW.room_id)
      THEN RAISE(ABORT, 'Physical layout seat count must match room capacity')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE room_id = OLD.room_id AND event_id = OLD.event_id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot modify room layout while locked seat assignments exist in this room')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_room_layouts_freeze_delete
BEFORE DELETE ON cbt_semester_room_layouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete room layouts from a frozen or active semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_semester_seat_assignments WHERE room_id = OLD.room_id AND event_id = OLD.event_id AND is_locked = 1)
      THEN RAISE(ABORT, 'Cannot delete room layout while locked seat assignments exist in this room')
  END;
END;

-- 8. Invigilator Pool Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_integrity_insert
BEFORE INSERT ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_pool can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert into invigilator pool in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Staff must be an active cbt_staff_profile')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_integrity_update
BEFORE UPDATE ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify invigilator pool in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.staff_id != NEW.staff_id
      THEN RAISE(ABORT, 'Cannot change event or staff profile reference in invigilator pool')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Staff must be an active cbt_staff_profile')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_pool_freeze_delete
BEFORE DELETE ON cbt_semester_invigilator_pool
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete from invigilator pool in a frozen or active semester event')
  END;
END;

-- 9. Staff Blackouts Integrity & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_integrity_insert
BEFORE INSERT ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_staff_blackouts can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot insert staff blackouts in a frozen or active semester event')
    WHEN NEW.slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Blackout slot must belong to the same semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_integrity_update
BEFORE UPDATE ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify staff blackouts in a frozen or active semester event')
    WHEN OLD.event_id != NEW.event_id OR OLD.staff_id != NEW.staff_id
      THEN RAISE(ABORT, 'Cannot change event or staff reference in staff blackout')
    WHEN NEW.slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Blackout slot must belong to the same semester event')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_staff_blackouts_freeze_delete
BEFORE DELETE ON cbt_semester_staff_blackouts
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete staff blackouts in a frozen or active semester event')
  END;
END;

-- 10. Invigilator Assignments Hard Constraints, Locked Protection & Freeze
CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_integrity_insert
BEFORE INSERT ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_assignments can only belong to a semester event')
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot assign invigilators in a frozen or active semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Slot must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Room must be global or belong to this semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Assigned staff must be an active cbt_staff_profile')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_invigilator_pool WHERE event_id = NEW.event_id AND staff_id = NEW.staff_id AND is_eligible = 1)
      THEN RAISE(ABORT, 'Staff member is not in the eligible invigilator pool for this event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_staff_blackouts sb
      JOIN cbt_semester_slots sl ON sl.id = NEW.slot_id
      WHERE sb.event_id = NEW.event_id AND sb.staff_id = NEW.staff_id
        AND (sb.slot_id = NEW.slot_id OR sb.blackout_date = sl.slot_date)
    ) THEN RAISE(ABORT, 'Staff member has an active blackout constraint for this slot or date')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_integrity_update
BEFORE UPDATE ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot modify invigilator assignments in a frozen or active semester event')
    WHEN OLD.is_locked = 1 AND (OLD.staff_id != NEW.staff_id OR OLD.slot_id != NEW.slot_id OR OLD.room_id != NEW.room_id OR OLD.invigilator_order != NEW.invigilator_order)
      THEN RAISE(ABORT, 'Transitioning invigilator assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
      THEN RAISE(ABORT, 'cbt_semester_invigilator_assignments can only belong to a semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
      THEN RAISE(ABORT, 'Slot must belong to the same semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id))
      THEN RAISE(ABORT, 'Room must be global or belong to this semester event')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_staff_profiles WHERE id = NEW.staff_id AND is_active = 1)
      THEN RAISE(ABORT, 'Assigned staff must be an active cbt_staff_profile')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_invigilator_pool WHERE event_id = NEW.event_id AND staff_id = NEW.staff_id AND is_eligible = 1)
      THEN RAISE(ABORT, 'Staff member is not in the eligible invigilator pool for this event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_staff_blackouts sb
      JOIN cbt_semester_slots sl ON sl.id = NEW.slot_id
      WHERE sb.event_id = NEW.event_id AND sb.staff_id = NEW.staff_id
        AND (sb.slot_id = NEW.slot_id OR sb.blackout_date = sl.slot_date)
    ) THEN RAISE(ABORT, 'Staff member has an active blackout constraint for this slot or date')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_semester_invig_freeze_delete
BEFORE DELETE ON cbt_semester_invigilator_assignments
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = OLD.event_id AND status IN ('ready', 'active', 'completed', 'archived'))
      THEN RAISE(ABORT, 'Cannot delete invigilators from a frozen or active semester event')
    WHEN OLD.is_locked = 1
      THEN RAISE(ABORT, 'Cannot delete a locked invigilator assignment. Unlock first.')
  END;
END;

-- 11. Room Capacity & Delete Integrity
CREATE TRIGGER IF NOT EXISTS trg_cbt_rooms_semester_capacity_integrity
BEFORE UPDATE OF capacity ON cbt_rooms
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_room_layouts
      WHERE room_id = OLD.id AND layout_type = 'physical_configured' AND total_seats != NEW.capacity
    ) THEN RAISE(ABORT, 'Room capacity cannot differ from configured physical layout seats. Reconfigure layout first.')
    WHEN EXISTS (
      SELECT 1 FROM (
        SELECT COUNT(*) as cnt FROM cbt_semester_participants WHERE room_id = OLD.id GROUP BY event_id
      ) WHERE cnt > NEW.capacity
    ) THEN RAISE(ABORT, 'Room capacity cannot be reduced below the number of assigned participants.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cbt_rooms_semester_freeze_delete
BEFORE DELETE ON cbt_rooms
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_participants p
      JOIN cbt_events e ON e.id = p.event_id
      WHERE p.room_id = OLD.id AND e.status IN ('ready', 'active', 'completed', 'archived')
    ) THEN RAISE(ABORT, 'Cannot delete a room used by a frozen or active semester event')
    WHEN EXISTS (
      SELECT 1 FROM cbt_semester_invigilator_assignments a
      JOIN cbt_events e ON e.id = a.event_id
      WHERE a.room_id = OLD.id AND e.status IN ('ready', 'active', 'completed', 'archived')
    ) THEN RAISE(ABORT, 'Cannot delete a room with invigilator assignments in a frozen or active semester event')
  END;
END;
