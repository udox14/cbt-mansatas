export interface KegiatanEvent {
  id: string;
  code: string;
  name: string;
  mode: 'kegiatan';
  status: 'draft' | 'configuration' | 'ready' | 'active' | 'completed' | 'archived';
  participant_source: 'mansatas' | 'pmb' | 'cbt_user';
  academic_year_id?: string | null;
  academic_year_name?: string | null;
  term?: string | null;
  proctor_access_before_minutes: number;
  proctor_access_after_minutes: number;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  exam_count: number;
  roster_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReadinessCheckItem {
  key: 'event_config' | 'exams' | 'questions' | 'participants' | 'tokens';
  ok: boolean;
  message: string;
  blocking: boolean;
  details?: Record<string, unknown> | Array<unknown>;
}

export interface EventReadinessResult {
  ready: boolean;
  checks: ReadinessCheckItem[];
}

export interface MansatasStudent {
  source_id: string;
  source_key: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  grade: string;
  gender: string;
  is_active: boolean;
}

export interface ClassOption {
  id: string;
  name: string;
  grade: string;
}

export interface KegiatanRosterRow {
  id: string;
  exam_id: string;
  event_id: string;
  source_key: string;
  source_id: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  grade: string;
  gender: string;
  room_id?: string | null;
  room_name?: string | null;
  exam_title?: string | null;
  tanggal_tes?: string | null;
  sesi_tes?: string | null;
  created_at: string;
}
