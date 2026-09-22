// ============================================================
// Phase 6: Semester Foundation Types & Interfaces
// ============================================================

import type { EventStatus, ExamMode } from '../../../types.ts';

export interface SemesterParticipant {
  id: string;
  event_id: string;
  student_id: string;
  nisn: string | null;
  nis_lokal: string | null;
  nama_lengkap: string;
  gender: string | null;
  class_id: string | null;
  class_name: string | null;
  grade: string;
  room_id: string | null;
  nomor_peserta: string | null;
  is_room_locked: number;
  created_at: string;
  updated_at: string;
}

export interface SemesterExamClass {
  id: string;
  event_id: string;
  exam_id: string;
  class_id: string;
  class_name: string;
  grade: string;
  created_at: string;
}

export interface SemesterSlot {
  id: string;
  event_id: string;
  slot_label: string;
  slot_date: string;  // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  sequence_order: number;
  created_at: string;
  updated_at: string;
}

export interface SemesterSchedule {
  id: string;
  event_id: string;
  exam_id: string;
  slot_id: string;
  is_locked: number;
  created_at: string;
  updated_at: string;
  exam_title?: string;
  subject_name?: string;
  target_grade?: string;
  slot_label?: string;
  slot_date?: string;
  start_time?: string;
  end_time?: string;
}

export interface SemesterScheduleAuthResult {
  allowed: boolean;
  error?: string;
  status?: 400 | 403 | 404;
  scheduleContext?: {
    slot_id: string;
    slot_label: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    jadwal_status: 'belum' | 'aktif' | 'selesai';
    remaining_minutes: number;
    latest_start_time: string;
  };
}

export interface SemesterConflict {
  slot_id: string;
  slot_label: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  exam1_id: string;
  exam1_title: string;
  exam2_id: string;
  exam2_title: string;
  conflicting_student_id: string;
  conflicting_student_name: string;
}

export interface SemesterReadinessCategory {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  message: string;
  details?: any;
}

export interface SemesterReadinessResult {
  eligible: boolean;
  event_id: string;
  event_code: string;
  event_name: string;
  current_status: EventStatus;
  categories: {
    event: SemesterReadinessCategory;
    participants: SemesterReadinessCategory;
    exams: SemesterReadinessCategory;
    audience: SemesterReadinessCategory;
    roster: SemesterReadinessCategory;
    rooms: SemesterReadinessCategory;
    schedules: SemesterReadinessCategory;
    tokens: SemesterReadinessCategory;
    seating: SemesterReadinessCategory;
    invigilators: SemesterReadinessCategory;
  };
  blockers: string[];
}

// ============================================================
// Phase 7: Semester Automation & Seating Distribution Types
// ============================================================

export type SemesterGenerationStage = 'room_allocation' | 'seating' | 'timetable' | 'invigilators';

export interface SemesterGenerationControl {
  id: string;
  event_id: string;
  stage: SemesterGenerationStage;
  active_batch_id: string | null;
  status: 'idle' | 'running';
  started_at: string | null;
  actor_id: string | null;
  revision: number;
}

export interface SemesterRoomLayout {
  id: string;
  event_id: string;
  room_id: string;
  layout_type: 'logical_fallback' | 'physical_configured';
  total_seats: number;
  rows_count: number | null;
  cols_count: number | null;
  desk_group_count: number | null;
  is_irregular: number;
  required_invigilators: number;
  created_at: string;
  updated_at: string;
  room_name?: string;
  room_capacity?: number;
}

export interface SemesterSeat {
  id: string;
  event_id: string;
  room_id: string;
  seat_number: number;
  seat_label: string;
  row_num: number;
  col_num: number;
  desk_group: number | null;
  sequence_order: number;
  created_at: string;
}

export interface SemesterSeatAssignment {
  id: string;
  event_id: string;
  participant_id: string;
  room_id: string;
  seat_id: string;
  is_locked: number;
  created_at: string;
  updated_at: string;
  participant_name?: string;
  nomor_peserta?: string;
  class_name?: string;
  grade?: string;
  gender?: string;
  seat_number?: number;
  seat_label?: string;
  row_num?: number;
  col_num?: number;
  desk_group?: number | null;
  room_name?: string;
}

export interface SemesterInvigilatorPoolEntry {
  id: string;
  event_id: string;
  staff_id: string;
  is_eligible: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  staff_name?: string;
  nip?: string | null;
  email?: string | null;
  assigned_count?: number;
}

export interface SemesterStaffBlackout {
  id: string;
  event_id: string;
  staff_id: string;
  slot_id: string | null;
  blackout_date: string | null;
  reason: string | null;
  created_at: string;
  staff_name?: string;
  slot_label?: string;
}

export interface SemesterInvigilatorAssignment {
  id: string;
  event_id: string;
  slot_id: string;
  room_id: string;
  invigilator_order: number;
  staff_id: string;
  staff_name: string;
  mansatas_user_id: string | null;
  is_locked: number;
  created_at: string;
  updated_at: string;
  slot_label?: string;
  slot_date?: string;
  start_time?: string;
  end_time?: string;
  room_name?: string;
}

export interface SemesterGenerationLog {
  id: string;
  event_id: string;
  stage: SemesterGenerationStage;
  actor_id: string;
  seed: number | null;
  configuration: string;
  status: 'success' | 'impossible' | 'failed';
  summary: string;
  created_at: string;
}

export interface RoomAllocationConfig {
  strategy?: 'balanced' | 'fill_first' | 'grade_split';
  gender_strategy?: 'mixed' | 'separate_rooms' | 'separate_grades';
  grade_priority?: string[];
  preserve_locked?: boolean;
}

export interface SeatingDistributionConfig {
  cross_grade_pairing?: boolean;
  gender_strategy?: 'mixed' | 'separate_desks' | 'same_gender_desk';
  seed?: number;
  preserve_locked?: boolean;
}

export interface TimetableSolverConfig {
  max_exams_per_day?: number;
  same_grade_spread_days?: boolean;
  preserve_locked?: boolean;
  seed?: number;
}

export interface InvigilatorAssignmentConfig {
  max_sessions_per_day?: number;
  max_sessions_total?: number;
  avoid_same_subject_teacher?: boolean;
  balance_workload?: boolean;
  preserve_locked?: boolean;
  seed?: number;
}

export interface SemesterProctorContext {
  assignment_id: string;
  event_id: string;
  slot_id: string;
  room_id: string;
  invigilator_order: number;
  staff_id: string;
  staff_name: string;
  slot_label: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  room_name: string;
  is_window_active: boolean;
  window_status: 'early' | 'active' | 'expired';
}
