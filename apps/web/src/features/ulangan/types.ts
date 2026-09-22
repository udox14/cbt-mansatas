export interface TeachingAssignment {
  id: string;
  guru_id: string;
  tahun_ajaran_id: string;
  semester: string;
  mata_pelajaran_id: string;
  kelas_id: string;
  mapel_nama: string;
  mapel_kode: string;
  kelas_nama: string;
  tingkat: string;
}

export interface UlanganExam {
  id: string;
  event_id: string;
  title: string;
  description?: string | null;
  duration_minutes: number;
  passing_score: number;
  randomize_questions: number;
  randomize_options: number;
  show_results: number;
  status: 'draft' | 'configuration' | 'ready' | 'active' | 'completed' | 'archived';
  mode: 'ulangan';
  teaching_assignment_id?: string | null;
  subject_id?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  owner_staff_id?: string | null;
  owner_name?: string | null;
  question_count?: number;
  roster_count?: number;
  active_session_count?: number;
  submitted_count?: number;
  token_code?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReadinessCheckItem {
  key: string;
  ok: boolean;
  message: string;
  blocking: boolean;
  details?: Record<string, unknown> | Array<unknown>;
}

export interface UlanganReadiness {
  ready: boolean;
  checks: ReadinessCheckItem[];
}

export interface UlanganClassStudent {
  source_id: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  gender: string;
  is_active: boolean;
  in_roster?: boolean;
}

export interface UlanganRosterParticipant {
  id: string;
  exam_id: string;
  event_id: string;
  source_key: string;
  source_id: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  room_id?: string | null;
  room_name?: string | null;
  created_at: string;
}
