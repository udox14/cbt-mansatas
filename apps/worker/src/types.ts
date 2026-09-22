// ============================================================
// Type Definitions — ID = TEXT (sesuai database PMB existing)
// ============================================================

export interface Env {
  DB: D1Database;
  /**
   * Optional until the owner supplies the real mansatas-db binding and schema
   * mapping. Keeping it optional preserves the existing PMB deployment while
   * allowing the same Worker to be deployed with a second D1 binding.
   */
  MANSATAS_DB?: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  RATE_LIMIT: KVNamespace;

  // These are intentionally explicit: the Worker must never guess source
  // table/column names from a school database it does not own.
  MANSATAS_DB_TABLE?: string;
  MANSATAS_DB_ID_COLUMN?: string;
  MANSATAS_DB_NISN_COLUMN?: string;
  MANSATAS_DB_NAME_COLUMN?: string;
  MANSATAS_DB_CLASS_COLUMN?: string;
  MANSATAS_DB_GRADE_COLUMN?: string;
  MANSATAS_DB_GENDER_COLUMN?: string;
  MANSATAS_DB_ACTIVE_COLUMN?: string;
  MANSATAS_DB_ACTIVE_VALUE?: string;
  // Optional relation mapping when class/grade live in a separate table.
  MANSATAS_DB_CLASS_TABLE?: string;
  MANSATAS_DB_CLASS_ID_COLUMN?: string;
  MANSATAS_DB_CLASS_FOREIGN_KEY_COLUMN?: string;
  MANSATAS_DB_CLASS_GRADE_COLUMN?: string;
  MANSATAS_DB_CLASS_NUMBER_COLUMN?: string;
  MANSATAS_DB_CLASS_GROUP_COLUMN?: string;
}

export type Role = 'admin' | 'proctor' | 'student' | 'teacher';
export type UserSource = 'admins' | 'pendaftar' | 'cbt_user' | 'mansatas' | 'mansatas_gtk' | 'mansatas_staff';

export const EXAM_MODES = ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'] as const;
export type ExamMode = (typeof EXAM_MODES)[number];

export const EVENT_STATUSES = [
  'draft',
  'configuration',
  'ready',
  'active',
  'completed',
  'archived',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface CbtEvent {
  id: string;
  code: string;
  name: string;
  mode: ExamMode;
  activity_type: string;
  participant_source: 'pmb' | 'mansatas' | 'cbt_user';
  status: EventStatus;
  academic_year_id?: string | null;
  academic_year_name?: string | null;
  term?: string | null;
  proctor_access_before_minutes: number;
  proctor_access_after_minutes: number;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CbtExam {
  id: string;
  title: string;
  description?: string | null;
  duration_minutes: number;
  rules_text?: string | null;
  completion_message?: string | null;
  is_score_visible: number;
  randomize_questions: number;
  randomize_options: number;
  active_status: 'draft' | 'configuration' | 'ready' | 'active' | 'completed' | 'archived' | 'finished';
  passing_score: number;
  target_jalur?: string | null;
  event_id?: string | null;
  subject_name?: string | null;
  sequence_order: number;
  cheat_limit: number;
  cheat_action: string;
  enforce_fullscreen: number;
  mode?: ExamMode | null;
  owner_staff_id?: string | null;
  version_label?: string | null;
  is_frozen: number;
  teaching_assignment_id?: string | null;
  subject_id?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  target_grade?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type ScopeType = 'global' | 'mode' | 'event' | 'subject' | 'own' | 'room_slot';

export interface StaffProfile {
  id: string;                 // local cbt staff profile ID
  mansatas_user_id: string;   // external identity from Mansatas
  email: string;              // canonical normalized lowercase
  nama_lengkap: string;
  nip: string | null;
  is_active: number;
  synced_at: string;
}

export interface RoleAssignment {
  id: string;
  staff_id: string;
  role: 'admin' | 'teacher' | 'proctor';
  created_at: string;
}

export interface PermissionGrant {
  id: string;
  staff_id: string;
  permission: string;
  scope_type: ScopeType;
  scope_value: string;        // normalized non-null: '*' for global
  created_at: string;
}

export interface JWTPayload {
  sub: string;                // user id or staff_id (TEXT)
  username: string;
  role: Role;
  room_id: string | null;
  full_name: string;
  source: UserSource;         // dari tabel mana
  staff_id?: string;          // local cbt_staff_profiles.id if staff
  mansatas_user_id?: string;  // external mansatas user id if staff
  roles?: string[];           // all assigned base roles
  permissions?: string[];     // granted permission keys
  allowed_modes?: string[];   // list of authorized exam modes
  iat: number;
  exp: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export type TkaValidationStatus =
  | 'valid'
  | 'missing_option'
  | 'duplicate_option'
  | 'duplicate_mandatory'
  | 'unresolved'
  | 'pending';

export interface TkaParticipant {
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
  updated_at: string;
}
