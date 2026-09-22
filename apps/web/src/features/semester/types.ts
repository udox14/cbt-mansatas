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
  };
  blockers: string[];
}
