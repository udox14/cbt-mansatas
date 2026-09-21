// ============================================================
// MansatasStaffAuthAdapter — Isolated Staff Auth Boundary
//
// Verifies Mansatas staff credentials against MANSATAS_DB using
// authoritative PBKDF2 Web Crypto implementation (matching Mansatas App).
//
// Rules:
// 1. MANSATAS_DB is strictly READ-ONLY.
// 2. Passwords are NEVER trimmed before verification.
// 3. Password hashes are NEVER stored or copied into CBT DB.
// 4. No fallback default passwords (e.g. 'mansatas2026') are permitted.
// ============================================================

export interface MansatasStaffIdentity {
  id: string; // stable mansatas_user_id
  email: string; // normalized lowercase
  nama_lengkap: string;
  role: string;
  nip: string | null;
  banned: boolean;
}

export interface MansatasAuthResult {
  success: boolean;
  staff?: MansatasStaffIdentity;
  error?: string;
}

/**
 * Derives a PBKDF2 hash using the authoritative Mansatas App format:
 * `pbkdf2:100000:<saltB64>:<hashB64>` (SHA-256, 100,000 iterations).
 * Primary usage: contract testing and test vector verification.
 */
export async function hashMansatasPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `pbkdf2:100000:${saltB64}:${hashB64}`;
}

/**
 * Verifies a raw staff password against a stored Mansatas PBKDF2 hash.
 * Exact match with `udox14/mansatas-app/utils/auth/index.ts`.
 */
export async function verifyMansatasPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (!hash || typeof hash !== 'string') return false;
    const parts = hash.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const [, iterStr, saltB64, hashB64] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;

    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const newHashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return newHashB64 === hashB64;
  } catch {
    return false;
  }
}

/**
 * Authenticates a staff member against MANSATAS_DB.
 * Queries "user" (or users fallback) joined with account (providerId = 'credential').
 *
 * NOTE: `rawPassword` MUST NOT be trimmed!
 */
export async function authenticateMansatasStaff(
  mansatasDb: D1Database | undefined,
  email: string,
  rawPassword: string
): Promise<MansatasAuthResult> {
  if (!mansatasDb) {
    return { success: false, error: 'Koneksi ke MANSATAS_DB belum tersedia' };
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !rawPassword) {
    return { success: false, error: 'Email dan password wajib diisi' };
  }

  try {
    let row: any = null;
    try {
      row = await mansatasDb
        .prepare(
          `SELECT u.id, u.email, COALESCE(u.nama_lengkap, u.name) AS nama_lengkap,
                  u.role, u.nip, u.banned, a.password AS password_hash
           FROM "user" u
           JOIN account a ON a.userId = u.id AND a.providerId = 'credential'
           WHERE LOWER(u.email) = LOWER(?)
           LIMIT 1`
        )
        .bind(normalizedEmail)
        .first<any>();
    } catch {
      // Fallback if table name is users without quotes
      row = await mansatasDb
        .prepare(
          `SELECT u.id, u.email, COALESCE(u.nama_lengkap, u.name) AS nama_lengkap,
                  u.role, u.nip, u.banned, a.password AS password_hash
           FROM users u
           JOIN account a ON a.userId = u.id AND a.providerId = 'credential'
           WHERE LOWER(u.email) = LOWER(?)
           LIMIT 1`
        )
        .bind(normalizedEmail)
        .first<any>();
    }

    if (!row) {
      return { success: false, error: 'Email atau password salah' };
    }

    if (row.banned) {
      return { success: false, error: 'Akun Anda dinonaktifkan / diblokir' };
    }

    if (!row.password_hash) {
      return { success: false, error: 'Kredensial akun tidak valid' };
    }

    // Explicitly verify using rawPassword (no trimming!)
    const isValid = await verifyMansatasPassword(row.password_hash, rawPassword);
    if (!isValid) {
      return { success: false, error: 'Email atau password salah' };
    }

    return {
      success: true,
      staff: {
        id: String(row.id),
        email: String(row.email || normalizedEmail).trim().toLowerCase(),
        nama_lengkap: String(row.nama_lengkap || row.email).trim(),
        role: String(row.role || 'guru'),
        nip: row.nip ? String(row.nip) : null,
        banned: Boolean(row.banned),
      },
    };
  } catch (err: any) {
    console.warn('MansatasStaffAuthAdapter error:', err?.message || err);
    return { success: false, error: 'Gagal memverifikasi kredensial staf Mansatas' };
  }
}

/**
 * Preflight check for collision detection in login handler.
 * Returns true only if credentials strictly match an unbanned Mansatas staff account.
 */
export async function preflightMansatasStaff(
  mansatasDb: D1Database | undefined,
  email: string,
  rawPassword: string
): Promise<boolean> {
  if (!mansatasDb || !email || !rawPassword) return false;
  const res = await authenticateMansatasStaff(mansatasDb, email, rawPassword);
  return Boolean(res.success && res.staff);
}

export const MansatasStaffAuthAdapter = {
  authenticate: async (
    mansatasDb: D1Database | undefined,
    email: string,
    rawPassword: string
  ): Promise<MansatasStaffIdentity | null> => {
    const res = await authenticateMansatasStaff(mansatasDb, email, rawPassword);
    return res.success && res.staff ? res.staff : null;
  },
  preflight: preflightMansatasStaff,
};
