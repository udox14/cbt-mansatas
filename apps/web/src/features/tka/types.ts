// ============================================================
// TKA Domain — Frontend Types
// ============================================================

export type EventStatus = 'draft' | 'configuration' | 'ready' | 'active' | 'completed' | 'archived';

export interface TkaEvent {
  id: string;
  code: string;
  name: string;
  mode: 'tka';
  status: EventStatus;
  academic_year_id: string;
  academic_year_name?: string | null;
  description?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type TkaValidationStatus =
  | 'valid'
  | 'missing_option'
  | 'duplicate_option'
  | 'duplicate_mandatory'
  | 'unresolved'
  | 'pending';

export interface TkaParticipantItem {
  id: string;
  event_id: string;
  student_id: string;
  nisn: string | null;
  nama_lengkap: string;
  class_id: string | null;
  class_name: string | null;
  gender: string | null;
  mapel_pilihan1_raw: string | null;
  mapel_pilihan2_raw: string | null;
  mapel_pilihan1_subject_id: string | null;
  mapel_pilihan2_subject_id: string | null;
  validation_status: TkaValidationStatus;
  validation_notes: string | null;
  room_id: string | null;
  created_at: string;
}

export interface TkaSubjectCoverageItem {
  subject_id: string;
  subject_name: string;
  category: 'wajib' | 'pilihan';
  participant_count: number;
  exam_id: string | null;
  exam_title: string | null;
  exam_status: string | null;
  question_count: number;
  has_exam: boolean;
}

export interface TkaExamItem {
  id: string;
  title: string;
  subject_id: string;
  subject_name: string;
  duration_minutes: number;
  passing_score: number;
  active_status: string;
  question_count: number;
  roster_count: number;
  created_at: string;
}

export interface ReadinessCheckItem {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  severity: 'blocking' | 'warning';
  details?: any;
}

export interface TkaReadinessReport {
  ready: boolean;
  event_id: string;
  checks: ReadinessCheckItem[];
  blockers: string[];
}

export interface TkaRoomItem {
  id: string;
  room_name: string;
  capacity?: number;
  participant_count: number;
}
