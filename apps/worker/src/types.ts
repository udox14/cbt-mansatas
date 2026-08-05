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

export type Role = 'admin' | 'proctor' | 'student';
export type UserSource = 'admins' | 'pendaftar' | 'cbt_user' | 'mansatas' | 'mansatas_gtk';

export interface JWTPayload {
  sub: string;         // user id (TEXT)
  username: string;
  role: Role;
  room_id: string | null;
  full_name: string;
  source: UserSource;  // dari tabel mana
  iat: number;
  exp: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
