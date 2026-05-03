// ============================================================
// Type Definitions — ID = TEXT (sesuai database PMB existing)
// ============================================================

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
}

export type Role = 'admin' | 'proctor' | 'student';
export type UserSource = 'admins' | 'pendaftar' | 'cbt_user';

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
