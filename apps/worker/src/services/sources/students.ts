// ============================================================
// Mansatas Student Source Adapter
//
// Encapsulates authoritative read-only queries and normalization
// for active students and classes from MANSATAS_DB.
// Strictly adheres to the schema contracts in MANSATAS-INTEGRATION.md.
// ============================================================

import type { NormalizedParticipant } from '../participants.ts';

export interface MansatasStudentFilters {
  q?: string;
  class_id?: string;
  grade?: string;
  gender?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface MansatasClassOption {
  id: string;
  name: string;
  grade: string;
}

/**
 * Normalizes class display from canonical components: tingkat + kelompok + nomor_kelas.
 */
export function formatStudentClassName(
  tingkat: unknown,
  kelompok: unknown,
  nomor_kelas: unknown
): string {
  const t = tingkat != null ? String(tingkat).trim() : '';
  const k = kelompok != null ? String(kelompok).trim() : '';
  const n = nomor_kelas != null ? String(nomor_kelas).trim() : '';
  const parts = [t, k, n].filter(Boolean);
  return parts.join(' ');
}

/**
 * Normalizes a raw siswa row joined with kelas into the canonical NormalizedParticipant.
 */
export function normalizeStudentParticipant(row: any): NormalizedParticipant {
  const className = formatStudentClassName(row.tingkat, row.kelompok, row.nomor_kelas);
  const rawStatus = String(row.status || '').toLowerCase().trim();
  const isActive = rawStatus === 'aktif' || rawStatus === 'active' || rawStatus === '1';

  return {
    source_key: 'mansatas',
    source_id: String(row.id ?? ''),
    username: String(row.nisn || row.id || ''),
    nisn: String(row.nisn || ''),
    full_name: String(row.nama_lengkap || ''),
    class_name: className,
    grade: String(row.tingkat ?? ''),
    gender: String(row.jenis_kelamin || ''),
    is_active: isActive,
    metadata: {
      source: 'mansatas',
      nis_lokal: row.nis_lokal || null,
      kelas_id: row.kelas_id || null,
      foto_url: row.foto_url || null,
    },
  };
}

/**
 * Queries active students from MANSATAS_DB with filtering, search, and pagination.
 */
export async function listStudentsFromMansatas(
  db: D1Database,
  filters: MansatasStudentFilters = {},
  ids?: string[]
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  if (ids && ids.length === 0) {
    return { items: [], total: 0 };
  }

  // If specific IDs are provided, chunk them deterministically to stay well below D1's 100 bound-parameter limit
  if (ids && ids.length > 0) {
    const ID_CHUNK_SIZE = 50;
    const allItems: NormalizedParticipant[] = [];

    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
      const chunkIds = ids.slice(i, i + ID_CHUNK_SIZE);
      const where: string[] = [];
      const params: (string | number)[] = [];

      if (filters.is_active === false) {
        where.push("(s.status != 'aktif' AND s.status != 'active' AND s.status != '1')");
      } else if (filters.is_active === true || filters.is_active === undefined) {
        where.push("(LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')");
      }

      where.push(`s.id IN (${chunkIds.map(() => '?').join(',')})`);
      params.push(...chunkIds);

      if (filters.q?.trim()) {
        const q = `%${filters.q.trim().toLowerCase()}%`;
        where.push(
          '(LOWER(s.nama_lengkap) LIKE ? OR LOWER(s.nisn) LIKE ? OR LOWER(COALESCE(s.nis_lokal, \'\')) LIKE ?)'
        );
        params.push(q, q, q);
      }

      if (filters.class_id?.trim()) {
        where.push('s.kelas_id = ?');
        params.push(filters.class_id.trim());
      }

      if (filters.grade?.trim()) {
        where.push('CAST(k.tingkat AS TEXT) = ?');
        params.push(filters.grade.trim());
      }

      if (filters.gender?.trim()) {
        where.push('LOWER(s.jenis_kelamin) = ?');
        params.push(filters.gender.trim().toLowerCase());
      }

      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

      const rowsResult = await db
        .prepare(
          `SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin, s.kelas_id, s.status, s.foto_url,
                  k.tingkat, k.kelompok, k.nomor_kelas
           FROM siswa s
           LEFT JOIN kelas k ON s.kelas_id = k.id
           ${whereSql}
           ORDER BY CAST(k.tingkat AS INTEGER), k.kelompok, CAST(k.nomor_kelas AS INTEGER), LOWER(s.nama_lengkap)`
        )
        .bind(...params)
        .all<any>();

      const rows = rowsResult.results || [];
      allItems.push(...rows.map(normalizeStudentParticipant));
    }

    return {
      items: allItems,
      total: allItems.length,
    };
  }

  const where: string[] = [];
  const params: (string | number)[] = [];

  // Default active status filter unless explicitly set to false or all
  if (filters.is_active === false) {
    where.push("(s.status != 'aktif' AND s.status != 'active' AND s.status != '1')");
  } else if (filters.is_active === true || filters.is_active === undefined) {
    where.push("(LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')");
  }

  if (filters.q?.trim()) {
    const q = `%${filters.q.trim().toLowerCase()}%`;
    where.push(
      '(LOWER(s.nama_lengkap) LIKE ? OR LOWER(s.nisn) LIKE ? OR LOWER(COALESCE(s.nis_lokal, \'\')) LIKE ?)'
    );
    params.push(q, q, q);
  }

  if (filters.class_id?.trim()) {
    where.push('s.kelas_id = ?');
    params.push(filters.class_id.trim());
  }

  if (filters.grade?.trim()) {
    where.push('CAST(k.tingkat AS TEXT) = ?');
    params.push(filters.grade.trim());
  }

  if (filters.gender?.trim()) {
    where.push('LOWER(s.jenis_kelamin) = ?');
    params.push(filters.gender.trim().toLowerCase());
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(Number(filters.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size || 50), 1), 1000);

  const [rowsResult, countResult] = await Promise.all([
    db
      .prepare(
        `SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin, s.kelas_id, s.status, s.foto_url,
                k.tingkat, k.kelompok, k.nomor_kelas
         FROM siswa s
         LEFT JOIN kelas k ON s.kelas_id = k.id
         ${whereSql}
         ORDER BY CAST(k.tingkat AS INTEGER), k.kelompok, CAST(k.nomor_kelas AS INTEGER), LOWER(s.nama_lengkap)
         LIMIT ? OFFSET ?`
      )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<any>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM siswa s
         LEFT JOIN kelas k ON s.kelas_id = k.id
         ${whereSql}`
      )
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  const rows = rowsResult.results || [];
  return {
    items: rows.map(normalizeStudentParticipant),
    total: Number(countResult?.total || 0),
  };
}

/**
 * Retrieves a single student by ID from MANSATAS_DB.
 */
export async function getStudentFromMansatasById(
  db: D1Database,
  id: string
): Promise<NormalizedParticipant | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin, s.kelas_id, s.status, s.foto_url,
              k.tingkat, k.kelompok, k.nomor_kelas
       FROM siswa s
       LEFT JOIN kelas k ON s.kelas_id = k.id
       WHERE s.id = ?`
    )
    .bind(id)
    .first<any>();

  return row ? normalizeStudentParticipant(row) : null;
}

/**
 * Lists available classes from MANSATAS_DB for UI dropdowns.
 */
export async function listClassesFromMansatas(db: D1Database): Promise<MansatasClassOption[]> {
  const { results } = await db
    .prepare(
      `SELECT id, tingkat, kelompok, nomor_kelas
       FROM kelas
       ORDER BY CAST(tingkat AS INTEGER), kelompok, CAST(nomor_kelas AS INTEGER)`
    )
    .bind()
    .all<any>();

  return (results || []).map((row) => ({
    id: String(row.id),
    name: formatStudentClassName(row.tingkat, row.kelompok, row.nomor_kelas),
    grade: String(row.tingkat ?? ''),
  }));
}
