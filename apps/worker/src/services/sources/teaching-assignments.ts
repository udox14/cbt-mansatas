// ============================================================
// Mansatas Teaching Assignment Source Adapter
//
// Authoritative read-only queries against MANSATAS_DB for
// penugasan_mengajar, mata_pelajaran, kelas, tahun_ajaran, and siswa.
// Adheres strictly to the contracts in MANSATAS-INTEGRATION.md.
// ============================================================

import type { NormalizedParticipant } from '../participants.ts';
import { formatStudentClassName, normalizeStudentParticipant } from './students.ts';

export interface TeachingAssignment {
  id: string; // penugasan_mengajar.id
  guru_id: string; // user.id
  mapel_id: string; // mata_pelajaran.id
  nama_mapel: string;
  kode_mapel: string | null;
  mapel_kelompok: string | null;
  kelas_id: string; // kelas.id
  tingkat: string;
  kelompok: string;
  nomor_kelas: string;
  class_name: string; // e.g. "XII MIPA 1"
  tahun_ajaran_id: string;
  tahun_ajaran_nama: string; // e.g. "2024/2025"
  tahun_ajaran_semester: string; // "ganjil" | "genap"
  tahun_ajaran_is_active: boolean;
}

export interface ActiveAcademicYear {
  id: string;
  nama: string;
  semester: string;
  is_active: boolean;
}

/**
 * Resolves the school's currently active academic year from MANSATAS_DB.
 */
export async function getActiveAcademicYear(
  mansatasDb: D1Database
): Promise<ActiveAcademicYear | null> {
  const row = await mansatasDb
    .prepare(
      `SELECT id, nama, semester, is_active
       FROM tahun_ajaran
       WHERE is_active = 1
       LIMIT 1`
    )
    .first<any>();

  if (!row) return null;
  return {
    id: String(row.id),
    nama: String(row.nama || ''),
    semester: String(row.semester || ''),
    is_active: Boolean(row.is_active),
  };
}

/**
 * Lists teaching assignments for a specific Mansatas guru (user.id).
 * Orders active school years first, then by subject name and class.
 */
export async function listTeacherAssignments(
  mansatasDb: D1Database,
  guruId: string,
  options: { tahun_ajaran_id?: string; active_year_only?: boolean } = {}
): Promise<TeachingAssignment[]> {
  if (!guruId) return [];

  let sql = `
    SELECT pm.id, pm.guru_id, pm.mapel_id, pm.kelas_id, pm.tahun_ajaran_id,
           mp.nama_mapel, mp.kode_mapel, mp.kelompok AS mapel_kelompok,
           k.tingkat, k.kelompok AS kelas_kelompok, k.nomor_kelas,
           ta.nama AS tahun_ajaran_nama, ta.semester AS tahun_ajaran_semester, ta.is_active AS tahun_ajaran_is_active
    FROM penugasan_mengajar pm
    JOIN mata_pelajaran mp ON pm.mapel_id = mp.id
    JOIN kelas k ON pm.kelas_id = k.id
    JOIN tahun_ajaran ta ON pm.tahun_ajaran_id = ta.id
    WHERE pm.guru_id = ?
  `;

  const params: any[] = [guruId];

  if (options.tahun_ajaran_id) {
    sql += ' AND pm.tahun_ajaran_id = ?';
    params.push(options.tahun_ajaran_id);
  } else if (options.active_year_only) {
    sql += ' AND ta.is_active = 1';
  }

  sql += `
    ORDER BY ta.is_active DESC, ta.nama DESC, mp.nama_mapel ASC,
             CAST(k.tingkat AS INTEGER) ASC, k.kelompok ASC, CAST(k.nomor_kelas AS INTEGER) ASC
  `;

  const { results } = await mansatasDb.prepare(sql).bind(...params).all<any>();
  const rows = results || [];

  return rows.map((r) => ({
    id: String(r.id),
    guru_id: String(r.guru_id),
    mapel_id: String(r.mapel_id),
    nama_mapel: String(r.nama_mapel),
    kode_mapel: r.kode_mapel ? String(r.kode_mapel) : null,
    mapel_kelompok: r.mapel_kelompok ? String(r.mapel_kelompok) : null,
    kelas_id: String(r.kelas_id),
    tingkat: String(r.tingkat ?? ''),
    kelompok: String(r.kelas_kelompok ?? ''),
    nomor_kelas: String(r.nomor_kelas ?? ''),
    class_name: formatStudentClassName(r.tingkat, r.kelas_kelompok, r.nomor_kelas),
    tahun_ajaran_id: String(r.tahun_ajaran_id),
    tahun_ajaran_nama: String(r.tahun_ajaran_nama || ''),
    tahun_ajaran_semester: String(r.tahun_ajaran_semester || ''),
    tahun_ajaran_is_active: Boolean(r.tahun_ajaran_is_active),
  }));
}

/**
 * Retrieves a single canonical teaching assignment by ID from MANSATAS_DB.
 * Optionally verifies that it belongs to the given guruId.
 */
export async function getTeachingAssignmentById(
  mansatasDb: D1Database,
  assignmentId: string,
  guruId?: string
): Promise<TeachingAssignment | null> {
  let sql = `
    SELECT pm.id, pm.guru_id, pm.mapel_id, pm.kelas_id, pm.tahun_ajaran_id,
           mp.nama_mapel, mp.kode_mapel, mp.kelompok AS mapel_kelompok,
           k.tingkat, k.kelompok AS kelas_kelompok, k.nomor_kelas,
           ta.nama AS tahun_ajaran_nama, ta.semester AS tahun_ajaran_semester, ta.is_active AS tahun_ajaran_is_active
    FROM penugasan_mengajar pm
    JOIN mata_pelajaran mp ON pm.mapel_id = mp.id
    JOIN kelas k ON pm.kelas_id = k.id
    JOIN tahun_ajaran ta ON pm.tahun_ajaran_id = ta.id
    WHERE pm.id = ?
  `;
  const params: any[] = [assignmentId];

  if (guruId) {
    sql += ' AND pm.guru_id = ?';
    params.push(guruId);
  }

  const r = await mansatasDb.prepare(sql).bind(...params).first<any>();
  if (!r) return null;

  return {
    id: String(r.id),
    guru_id: String(r.guru_id),
    mapel_id: String(r.mapel_id),
    nama_mapel: String(r.nama_mapel),
    kode_mapel: r.kode_mapel ? String(r.kode_mapel) : null,
    mapel_kelompok: r.mapel_kelompok ? String(r.mapel_kelompok) : null,
    kelas_id: String(r.kelas_id),
    tingkat: String(r.tingkat ?? ''),
    kelompok: String(r.kelas_kelompok ?? ''),
    nomor_kelas: String(r.nomor_kelas ?? ''),
    class_name: formatStudentClassName(r.tingkat, r.kelas_kelompok, r.nomor_kelas),
    tahun_ajaran_id: String(r.tahun_ajaran_id),
    tahun_ajaran_nama: String(r.tahun_ajaran_nama || ''),
    tahun_ajaran_semester: String(r.tahun_ajaran_semester || ''),
    tahun_ajaran_is_active: Boolean(r.tahun_ajaran_is_active),
  };
}

/**
 * Loads all current active students in a specific class for whole-class snapshotting.
 */
export async function listActiveStudentsInClass(
  mansatasDb: D1Database,
  classId: string
): Promise<NormalizedParticipant[]> {
  const { results } = await mansatasDb
    .prepare(
      `SELECT s.id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin, s.kelas_id, s.status, s.foto_url,
              k.tingkat, k.kelompok, k.nomor_kelas
       FROM siswa s
       LEFT JOIN kelas k ON s.kelas_id = k.id
       WHERE s.kelas_id = ? AND (LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')
       ORDER BY LOWER(s.nama_lengkap) ASC`
    )
    .bind(classId)
    .all<any>();

  const rows = results || [];
  return rows.map(normalizeStudentParticipant);
}
