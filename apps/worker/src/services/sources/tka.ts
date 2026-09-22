// ============================================================
// Mansatas TKA Source Adapter
//
// Read-only queries against MANSATAS_DB for:
// - Grade 12 active students (with riwayat_kelas fallback)
// - tka_mapel_pilihan scoped to tahun_ajaran_id
// - mata_pelajaran registry
// - Academic years
// Adheres strictly to MANSATAS-INTEGRATION.md and Phase 5 specs.
// ============================================================

import {
  resolveCanonicalTkaSubject,
  matchMansatasSubjectRow,
  CanonicalTkaSubject,
  MANDATORY_TKA_SUBJECTS,
} from '../domains/tka/canonical-subjects.ts';
import { formatStudentClassName } from './students.ts';
import type { TkaValidationStatus } from '../../types.ts';

export interface MansatasSubjectRow {
  id: string;
  nama_mapel: string;
  kode_mapel?: string | null;
  kelompok?: string | null;
}

export interface RawTkaParticipantRow {
  student_id: string;
  nisn: string | null;
  nis_lokal: string | null;
  nama_lengkap: string;
  jenis_kelamin: string | null;
  kelas_id: string | null;
  tingkat: number | string | null;
  kelompok: string | null;
  nomor_kelas: number | string | null;
  student_status: string;
  pilihan1_raw: string | null;
  pilihan2_raw: string | null;
  tka_choice_updated_at: string | null;
  has_tka_record: boolean;
}

export interface EvaluatedTkaChoice {
  student_id: string;
  nisn: string | null;
  nis_lokal: string | null;
  nama_lengkap: string;
  gender: string | null;
  class_id: string | null;
  class_name: string;
  pilihan1_raw: string | null;
  pilihan2_raw: string | null;
  pilihan1_canonical: CanonicalTkaSubject | null;
  pilihan2_canonical: CanonicalTkaSubject | null;
  pilihan1_subject_id: string | null;
  pilihan2_subject_id: string | null;
  validation_status: TkaValidationStatus;
  validation_notes: string | null;
}

export interface TkaPreviewResult {
  summary: {
    total_grade_12: number;
    eligible_count: number;
    valid_count: number;
    missing_option_count: number;
    duplicate_option_count: number;
    duplicate_mandatory_count: number;
    unresolved_count: number;
    no_choice_record_count: number;
    ineligible_count: number;
  };
  eligible_participants: EvaluatedTkaChoice[];
  data_quality_issues: Array<{
    student_id: string;
    nama_lengkap: string;
    class_name: string;
    issue_type: string;
    details: string;
  }>;
  ineligible_students: Array<{
    student_id: string;
    nama_lengkap: string;
    reason: string;
  }>;
}

/**
 * Fetches all academic years from MANSATAS_DB.
 */
export async function listTkaAcademicYears(mansatasDb: D1Database) {
  const { results } = await mansatasDb
    .prepare(
      `SELECT id, nama, semester, is_active
       FROM tahun_ajaran
       ORDER BY is_active DESC, nama DESC`
    )
    .all<any>();
  return results || [];
}

/**
 * Fetches all mata_pelajaran rows from MANSATAS_DB.
 */
export async function fetchMansatasSubjects(mansatasDb: D1Database): Promise<MansatasSubjectRow[]> {
  const { results } = await mansatasDb
    .prepare(
      `SELECT id, nama_mapel, kode_mapel, kelompok
       FROM mata_pelajaran
       ORDER BY nama_mapel ASC`
    )
    .all<MansatasSubjectRow>();
  return results || [];
}

/**
 * Evaluates the 5-subject entitlement invariant for a single student.
 * 3 Mandatory (MAT, BIN, BIG) + 2 Distinct Electives.
 */
export function evaluateStudentTkaChoices(
  raw: RawTkaParticipantRow,
  mansatasSubjects: MansatasSubjectRow[]
): EvaluatedTkaChoice {
  const className = formatStudentClassName(raw.tingkat, raw.kelompok, raw.nomor_kelas);

  if (!raw.has_tka_record) {
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: null,
      pilihan2_raw: null,
      pilihan1_canonical: null,
      pilihan2_canonical: null,
      pilihan1_subject_id: null,
      pilihan2_subject_id: null,
      validation_status: 'missing_option',
      validation_notes: 'Belum ada data rekaman pilihan TKA untuk tahun ajaran ini',
    };
  }

  const p1 = (raw.pilihan1_raw || '').trim();
  const p2 = (raw.pilihan2_raw || '').trim();

  if (!p1 || !p2) {
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: p1 || null,
      pilihan2_raw: p2 || null,
      pilihan1_canonical: resolveCanonicalTkaSubject(p1),
      pilihan2_canonical: resolveCanonicalTkaSubject(p2),
      pilihan1_subject_id: null,
      pilihan2_subject_id: null,
      validation_status: 'missing_option',
      validation_notes: !p1 && !p2 ? 'Kedua mapel pilihan kosong' : !p1 ? 'Mapel pilihan 1 kosong' : 'Mapel pilihan 2 kosong',
    };
  }

  const canon1 = resolveCanonicalTkaSubject(p1);
  const canon2 = resolveCanonicalTkaSubject(p2);

  if (!canon1 || !canon2) {
    const unres: string[] = [];
    if (!canon1) unres.push(`Pilihan 1 "${p1}"`);
    if (!canon2) unres.push(`Pilihan 2 "${p2}"`);
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: p1,
      pilihan2_raw: p2,
      pilihan1_canonical: canon1,
      pilihan2_canonical: canon2,
      pilihan1_subject_id: null,
      pilihan2_subject_id: null,
      validation_status: 'unresolved',
      validation_notes: `Mata pelajaran tidak terdaftar dalam registri resmi: ${unres.join(', ')}`,
    };
  }

  // Duplicate Choice Check
  if (canon1.canonicalKey === canon2.canonicalKey) {
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: p1,
      pilihan2_raw: p2,
      pilihan1_canonical: canon1,
      pilihan2_canonical: canon2,
      pilihan1_subject_id: null,
      pilihan2_subject_id: null,
      validation_status: 'duplicate_option',
      validation_notes: `Pilihan 1 dan Pilihan 2 memilih mata pelajaran yang sama (${canon1.canonicalName})`,
    };
  }

  // Duplicate Mandatory Check (e.g. selecting general 'Matematika' as elective)
  if (canon1.category === 'wajib' || canon2.category === 'wajib') {
    const dupes: string[] = [];
    if (canon1.category === 'wajib') dupes.push(canon1.canonicalName);
    if (canon2.category === 'wajib') dupes.push(canon2.canonicalName);
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: p1,
      pilihan2_raw: p2,
      pilihan1_canonical: canon1,
      pilihan2_canonical: canon2,
      pilihan1_subject_id: null,
      pilihan2_subject_id: null,
      validation_status: 'duplicate_mandatory',
      validation_notes: `Pilihan menduplikasi mata pelajaran wajib: ${dupes.join(', ')}`,
    };
  }

  // Resolve verified Mansatas mata_pelajaran.id
  const match1 = matchMansatasSubjectRow(canon1, mansatasSubjects);
  const match2 = matchMansatasSubjectRow(canon2, mansatasSubjects);

  if (!match1 || !match2) {
    const unlinked: string[] = [];
    if (!match1) unlinked.push(canon1.canonicalName);
    if (!match2) unlinked.push(canon2.canonicalName);
    return {
      student_id: raw.student_id,
      nisn: raw.nisn,
      nis_lokal: raw.nis_lokal,
      nama_lengkap: raw.nama_lengkap,
      gender: raw.jenis_kelamin,
      class_id: raw.kelas_id,
      class_name: className,
      pilihan1_raw: p1,
      pilihan2_raw: p2,
      pilihan1_canonical: canon1,
      pilihan2_canonical: canon2,
      pilihan1_subject_id: match1 ? match1.id : null,
      pilihan2_subject_id: match2 ? match2.id : null,
      validation_status: 'unresolved',
      validation_notes: `Tidak ditemukan baris mata_pelajaran resmi di database sekolah untuk: ${unlinked.join(', ')}`,
    };
  }

  // Exactly-5 invariant passed!
  return {
    student_id: raw.student_id,
    nisn: raw.nisn,
    nis_lokal: raw.nis_lokal,
    nama_lengkap: raw.nama_lengkap,
    gender: raw.jenis_kelamin,
    class_id: raw.kelas_id,
    class_name: className,
    pilihan1_raw: p1,
    pilihan2_raw: p2,
    pilihan1_canonical: canon1,
    pilihan2_canonical: canon2,
    pilihan1_subject_id: match1.id,
    pilihan2_subject_id: match2.id,
    validation_status: 'valid',
    validation_notes: null,
  };
}

/**
 * Previews Grade 12 students and choices from MANSATAS_DB with rich diagnostics.
 */
export async function previewTkaParticipants(
  mansatasDb: D1Database,
  tahunAjaranId: string
): Promise<TkaPreviewResult> {
  const mansatasSubjects = await fetchMansatasSubjects(mansatasDb);

  // Query Grade 12 students joined with tka_mapel_pilihan for the specific academic year
  // Supports current class AND riwayat_kelas fallback
  const sql = `
    SELECT s.id as student_id, s.nisn, s.nis_lokal, s.nama_lengkap, s.jenis_kelamin, s.status as student_status,
           COALESCE(k.id, rk_k.id) as kelas_id,
           COALESCE(k.tingkat, rk_k.tingkat) as tingkat,
           COALESCE(k.kelompok, rk_k.kelompok) as kelompok,
           COALESCE(k.nomor_kelas, rk_k.nomor_kelas) as nomor_kelas,
           tmp.id IS NOT NULL as has_tka_record,
           tmp.mapel_pilihan1 as pilihan1_raw,
           tmp.mapel_pilihan2 as pilihan2_raw,
           tmp.updated_at as tka_choice_updated_at
    FROM siswa s
    LEFT JOIN kelas k ON s.kelas_id = k.id
    LEFT JOIN riwayat_kelas rk ON s.id = rk.siswa_id AND rk.tahun_ajaran_id = ?
    LEFT JOIN kelas rk_k ON rk.kelas_id = rk_k.id
    LEFT JOIN tka_mapel_pilihan tmp ON s.id = tmp.siswa_id AND tmp.tahun_ajaran_id = ?
    WHERE (LOWER(s.status) = 'aktif' OR LOWER(s.status) = 'active' OR s.status = '1')
      AND (CAST(COALESCE(k.tingkat, rk_k.tingkat) AS INTEGER) = 12)
    ORDER BY COALESCE(k.kelompok, rk_k.kelompok) ASC,
             CAST(COALESCE(k.nomor_kelas, rk_k.nomor_kelas) AS INTEGER) ASC,
             LOWER(s.nama_lengkap) ASC
  `;

  const { results } = await mansatasDb.prepare(sql).bind(tahunAjaranId, tahunAjaranId).all<any>();
  const rawRows: RawTkaParticipantRow[] = (results || []).map((r) => ({
    student_id: String(r.student_id),
    nisn: r.nisn ? String(r.nisn) : null,
    nis_lokal: r.nis_lokal ? String(r.nis_lokal) : null,
    nama_lengkap: String(r.nama_lengkap || ''),
    jenis_kelamin: r.jenis_kelamin ? String(r.jenis_kelamin) : null,
    kelas_id: r.kelas_id ? String(r.kelas_id) : null,
    tingkat: r.tingkat,
    kelompok: r.kelompok ? String(r.kelompok) : null,
    nomor_kelas: r.nomor_kelas,
    student_status: String(r.student_status || ''),
    pilihan1_raw: r.pilihan1_raw ? String(r.pilihan1_raw) : null,
    pilihan2_raw: r.pilihan2_raw ? String(r.pilihan2_raw) : null,
    tka_choice_updated_at: r.tka_choice_updated_at ? String(r.tka_choice_updated_at) : null,
    has_tka_record: Boolean(r.has_tka_record),
  }));

  const evaluated = rawRows.map((row) => evaluateStudentTkaChoices(row, mansatasSubjects));

  let validCount = 0;
  let missingCount = 0;
  let duplicateOptCount = 0;
  let duplicateMandatoryCount = 0;
  let unresolvedCount = 0;
  let noChoiceRecordCount = 0;

  const dataQualityIssues: Array<{
    student_id: string;
    nama_lengkap: string;
    class_name: string;
    issue_type: string;
    details: string;
  }> = [];

  for (const item of evaluated) {
    if (item.validation_status === 'valid') {
      validCount++;
    } else {
      if (item.validation_status === 'missing_option') {
        missingCount++;
        if (!item.pilihan1_raw && !item.pilihan2_raw) noChoiceRecordCount++;
      } else if (item.validation_status === 'duplicate_option') {
        duplicateOptCount++;
      } else if (item.validation_status === 'duplicate_mandatory') {
        duplicateMandatoryCount++;
      } else if (item.validation_status === 'unresolved') {
        unresolvedCount++;
      }

      dataQualityIssues.push({
        student_id: item.student_id,
        nama_lengkap: item.nama_lengkap,
        class_name: item.class_name,
        issue_type: item.validation_status,
        details: item.validation_notes || 'Pilihan tidak valid',
      });
    }
  }

  // Also query any active grade 12 students missing class or non-active students if requested
  return {
    summary: {
      total_grade_12: rawRows.length,
      eligible_count: rawRows.length,
      valid_count: validCount,
      missing_option_count: missingCount,
      duplicate_option_count: duplicateOptCount,
      duplicate_mandatory_count: duplicateMandatoryCount,
      unresolved_count: unresolvedCount,
      no_choice_record_count: noChoiceRecordCount,
      ineligible_count: 0,
    },
    eligible_participants: evaluated,
    data_quality_issues: dataQualityIssues,
    ineligible_students: [],
  };
}
