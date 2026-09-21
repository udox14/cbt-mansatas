// ============================================================
// PMB Mansatas Source Adapter
//
// Encapsulates all read queries and normalization for PMB
// participants against MANSATAS_DB (pmb_pendaftar table).
// Isolates external database schema and query construction.
// ============================================================

import type { NormalizedParticipant, ParticipantFilters } from '../participants.ts';

export const PMB_TABLE_DEFAULT = 'pmb_pendaftar';
export const PMB_EXCLUDE_PRESTASI = "UPPER(COALESCE(jalur, '')) NOT LIKE '%PRESTASI%'";

export type PmbParticipantFilters = ParticipantFilters & {
  jalur?: string;
  room_name?: string;
  tanggal_tes?: string;
  sesi_tes?: string;
};

/**
 * Normalizes a raw pmb_pendaftar row from MANSATAS_DB into the canonical
 * NormalizedParticipant shape required by CBT.
 */
export function normalizePmbParticipant(row: any): NormalizedParticipant {
  return {
    source_key: 'pmb',
    source_id: String(row.source_id ?? row.id ?? ''),
    username: String(row.username || row.nisn || ''),
    nisn: String(row.nisn || ''),
    full_name: String(row.full_name || row.nama_lengkap || ''),
    class_name: '',
    grade: '',
    gender: String(row.gender || row.jenis_kelamin || ''),
    is_active: true,
    room_name: row.room_name || row.ruang_tes || null,
    tanggal_tes: row.tanggal_tes || null,
    sesi_tes: row.sesi_tes || null,
    metadata: {
      source: 'pmb',
      no_pendaftaran: row.no_pendaftaran || null,
      jalur: row.jalur || null,
      asal_sekolah: row.asal_sekolah || null,
    },
  };
}

/**
 * Lists PMB applicants from MANSATAS_DB with filtering, search, and pagination.
 */
export async function listPmbSourceParticipants(
  db: D1Database,
  filters: PmbParticipantFilters = {},
  ids?: string[],
  tableName: string = PMB_TABLE_DEFAULT,
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  if (filters.is_active === false) {
    return { items: [], total: 0 };
  }

  const where: string[] = [PMB_EXCLUDE_PRESTASI];
  const params: (string | number)[] = [];

  if (ids) {
    if (!ids.length) return { items: [], total: 0 };
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  if (filters.q) {
    where.push('(LOWER(COALESCE(nama_lengkap, \'\')) LIKE ? OR LOWER(COALESCE(nisn, \'\')) LIKE ?)');
    const q = `%${filters.q.toLowerCase()}%`;
    params.push(q, q);
  }

  if (filters.gender) {
    where.push('LOWER(COALESCE(jenis_kelamin, \'\')) = ?');
    params.push(filters.gender.toLowerCase());
  }

  if (filters.jalur) {
    where.push('LOWER(COALESCE(jalur, \'\')) = ?');
    params.push(filters.jalur.toLowerCase());
  }

  if (filters.room_name) {
    where.push('ruang_tes = ?');
    params.push(filters.room_name);
  }

  if (filters.tanggal_tes) {
    where.push('tanggal_tes = ?');
    params.push(filters.tanggal_tes);
  }

  if (filters.sesi_tes) {
    where.push('sesi_tes = ?');
    params.push(filters.sesi_tes);
  }

  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const page = Math.max(Number(filters.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size || 50), 1), 5000);

  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT id AS source_id, nisn AS username, nisn, nama_lengkap AS full_name,
              jenis_kelamin AS gender, ruang_tes AS room_name, tanggal_tes, sesi_tes,
              no_pendaftaran, jalur, asal_sekolah
       FROM ${tableName}${whereSql}
       ORDER BY LOWER(COALESCE(nama_lengkap, '')), nisn
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all(),
    db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}${whereSql}`).bind(...params).first<{ total: number }>(),
  ]);

  return {
    items: ((rows.results as any[]) || []).map(normalizePmbParticipant),
    total: Number(count?.total || 0),
  };
}

/**
 * Retrieves a single PMB applicant by ID from MANSATAS_DB.
 */
export async function getPmbSourceParticipantById(
  db: D1Database,
  id: string,
  tableName: string = PMB_TABLE_DEFAULT,
): Promise<NormalizedParticipant | null> {
  const row = await db.prepare(
    `SELECT id AS source_id, nisn AS username, nisn, nama_lengkap AS full_name,
            jenis_kelamin AS gender, ruang_tes AS room_name, tanggal_tes, sesi_tes,
            no_pendaftaran, jalur, asal_sekolah
     FROM ${tableName}
     WHERE id = ? AND ${PMB_EXCLUDE_PRESTASI}`
  ).bind(id).first<any>();

  return row ? normalizePmbParticipant(row) : null;
}
