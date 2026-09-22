// ============================================================
// Semester Domain — Frontend Types
// ============================================================

export type EventStatus =
  | 'draft'
  | 'configuration'
  | 'ready'
  | 'active'
  | 'completed'
  | 'archived';

export interface SemesterEvent {
  id: string;
  code: string;
  name: string;
  mode: 'semester';
  activity_type: string;
  status: EventStatus;
  academic_year_id: string;
  academic_year_name?: string | null;
  term?: string | null;
  proctor_access_before_minutes?: number;
  proctor_access_after_minutes?: number;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SemesterParticipant {
  id: string;
  event_id: string;
  student_id: string;
  nisn: string | null;
  nis_lokal: string | null;
  nama_lengkap: string;
  grade: '10' | '11' | '12';
  class_id: string;
  class_name: string;
  gender: string | null;
  room_id: string | null;
  room_name?: string | null;
  nomor_peserta: string | null;
  is_room_locked?: number;
  created_at: string;
  updated_at: string;
}

export interface SemesterExam {
  id: string;
  title: string;
  description?: string | null;
  duration_minutes: number;
  target_grade: '10' | '11' | '12';
  subject_id: string;
  subject_name: string;
  active_status: string;
  passing_score: number;
  randomize_questions?: number;
  randomize_options?: number;
  question_count: number;
  roster_count: number;
  assigned_class_count?: number;
  slot_id?: string | null;
  slot_label?: string | null;
  slot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  created_at: string;
}

export interface SemesterExamClass {
  id: string;
  exam_id: string;
  event_id: string;
  subject_id: string;
  kelas_id: string;
  class_name?: string;
  tingkat?: number;
  kelompok?: string;
  nomor_kelas?: number;
  created_at: string;
}

export interface SemesterSlot {
  id: string;
  event_id: string;
  slot_label: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  sequence_order: number;
  exam_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SemesterSchedule {
  id: string;
  event_id: string;
  exam_id: string;
  slot_id: string;
  is_locked?: number;
  slot_label?: string;
  slot_date?: string;
  start_time?: string;
  end_time?: string;
  exam_title?: string;
  created_at: string;
}

export interface ReadinessCategoryItem {
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
    event: ReadinessCategoryItem;
    participants: ReadinessCategoryItem;
    exams: ReadinessCategoryItem;
    audience: ReadinessCategoryItem;
    roster: ReadinessCategoryItem;
    rooms: ReadinessCategoryItem;
    schedules: ReadinessCategoryItem;
    tokens: ReadinessCategoryItem;
    seating: ReadinessCategoryItem;
    invigilators: ReadinessCategoryItem;
  };
  blockers: string[];
}

// ============================================================
// Phase 7 Automation & Distribution Types
// ============================================================

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
}

export interface SemesterSeatAssignment {
  id: string;
  event_id: string;
  participant_id: string;
  room_id: string;
  seat_id: string;
  is_locked: number;
  created_at: string;
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
}

export interface SemesterInvigilatorPoolEntry {
  id: string;
  event_id: string;
  staff_id: string;
  is_eligible: number;
  notes: string | null;
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
  is_locked: number;
  slot_label?: string;
  slot_date?: string;
  start_time?: string;
  end_time?: string;
  room_name?: string;
}

export interface SemesterGenerationLog {
  id: string;
  event_id: string;
  stage: string;
  actor_id: string;
  seed: number | null;
  configuration: string;
  status: 'success' | 'impossible' | 'failed';
  summary: string;
  created_at: string;
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
