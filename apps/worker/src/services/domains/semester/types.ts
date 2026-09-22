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
  };
  blockers: string[];
}
