// ============================================================
// TKA Domain — 10-Point Deterministic Readiness Gate Service
//
// Evaluates all mandatory readiness requirements before a TKA event
// can transition from 'configuration' to 'ready'.
// Strictly server-authoritative, structured, and actionable.
// ============================================================

import { assertTkaEvent } from './events.ts';
import { getTkaSubjectCoverage } from './exams.ts';

export interface ReadinessCheckItem {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  severity: 'blocking' | 'warning';
  details?: any;
}

export interface TkaReadinessReport {
  ready: boolean;
  event_id: string;
  checks: ReadinessCheckItem[];
  blockers: string[];
}

/**
 * Checks deterministic 10-point readiness for a TKA event.
 */
export async function checkTkaEventReadiness(
  db: D1Database,
  eventId: string,
  mansatasDb?: D1Database
): Promise<TkaReadinessReport> {
  const event = await assertTkaEvent(db, eventId);
  const checks: ReadinessCheckItem[] = [];
  const blockers: string[] = [];

  // Gate 1: Event Identity & Mode
  checks.push({
    id: 'event_identity',
    name: 'Identitas & Mode Event',
    passed: event.mode === 'tka',
    message: event.mode === 'tka' ? 'Event valid sebagai domain TKA' : 'Mode event bukan TKA',
    severity: 'blocking',
  });

  // Gate 2: Academic Year Anchor Verified in Mansatas
  let hasAcademicYear = Boolean(event.academic_year_id);
  if (hasAcademicYear && mansatasDb) {
    const taRow = await mansatasDb
      .prepare('SELECT id, nama FROM tahun_ajaran WHERE id = ?')
      .bind(event.academic_year_id)
      .first<any>();
    if (!taRow) {
      hasAcademicYear = false;
      blockers.push(`Tahun ajaran '${event.academic_year_id}' tidak valid atau tidak ditemukan di database sekolah`);
    }
  } else if (!hasAcademicYear) {
    blockers.push('Tahun ajaran belum ditentukan untuk event ini');
  }

  checks.push({
    id: 'academic_year',
    name: 'Konteks Tahun Ajaran Terverifikasi',
    passed: hasAcademicYear,
    message: hasAcademicYear
      ? `Tahun ajaran terverifikasi: ${event.academic_year_name || event.academic_year_id}`
      : 'Tahun ajaran belum diatur atau tidak terverifikasi di database sekolah',
    severity: 'blocking',
  });

  // Gate 3: Participant Snapshot Population
  const partCountRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_tka_participants WHERE event_id = ?')
    .bind(eventId)
    .first<any>();
  const totalParticipants = Number(partCountRow?.cnt || 0);
  const hasParticipants = totalParticipants > 0;
  if (!hasParticipants) blockers.push('Belum ada siswa kelas 12 yang di-snapshot ke event TKA ini');
  checks.push({
    id: 'participants_population',
    name: 'Populasi Peserta Ter-snapshot',
    passed: hasParticipants,
    message: hasParticipants
      ? `${totalParticipants} peserta terdaftar dalam snapshot TKA`
      : 'Belum ada peserta yang disnapshot dari Mansatas',
    severity: 'blocking',
  });

  // Gate 4: 100% Exactly-5 Invariant Validation
  const invalidRows = await db
    .prepare(
      `SELECT validation_status, COUNT(*) as cnt
       FROM cbt_tka_participants
       WHERE event_id = ? AND validation_status != 'valid'
       GROUP BY validation_status`
    )
    .bind(eventId)
    .all<any>();

  let totalInvalid = 0;
  const invalidBreakdown: Record<string, number> = {};
  for (const r of invalidRows.results || []) {
    const c = Number(r.cnt || 0);
    totalInvalid += c;
    invalidBreakdown[r.validation_status] = c;
  }

  const allParticipantsValid = hasParticipants && totalInvalid === 0;
  if (!allParticipantsValid && hasParticipants) {
    blockers.push(
      `Terdapat ${totalInvalid} siswa yang belum memenuhi syarat validitas 5 mapel (pilihan belum lengkap/duplikat/unresolved)`
    );
  }
  checks.push({
    id: 'participants_validation',
    name: 'Invarian Validitas Pilihan Mapel (5/5)',
    passed: allParticipantsValid,
    message: allParticipantsValid
      ? `100% peserta (${totalParticipants} siswa) memiliki pilihan 5 mapel valid`
      : `${totalInvalid} peserta memiliki pilihan tidak valid`,
    severity: 'blocking',
    details: invalidBreakdown,
  });

  // Fetch subject exams under this event
  const { results: exams } = await db
    .prepare(
      `SELECT e.*,
              COUNT(DISTINCT q.id) as question_count,
              SUM(q.points) as total_points
       FROM cbt_exams e
       LEFT JOIN cbt_questions q ON e.id = q.exam_id
       WHERE e.event_id = ? AND e.mode = 'tka'
       GROUP BY e.id`
    )
    .bind(eventId)
    .all<any>();

  const examList = exams || [];
  const examBySubjectName = new Map<string, any>();
  for (const x of examList) {
    examBySubjectName.set((x.subject_name || '').toLowerCase(), x);
  }

  // Gate 5: Mandatory Subject Exams Exist (MAT, BIN, BIG)
  const mathExam = examBySubjectName.get('matematika');
  const binExam = examBySubjectName.get('bahasa indonesia');
  const bigExam = examBySubjectName.get('bahasa inggris');
  const mandatoryExist = Boolean(mathExam && binExam && bigExam);

  if (!mandatoryExist) {
    const missing: string[] = [];
    if (!mathExam) missing.push('Matematika');
    if (!binExam) missing.push('Bahasa Indonesia');
    if (!bigExam) missing.push('Bahasa Inggris');
    blockers.push(`Ujian mapel wajib belum lengkap: ${missing.join(', ')}`);
  }
  checks.push({
    id: 'mandatory_exams',
    name: 'Ujian 3 Mapel Wajib',
    passed: mandatoryExist,
    message: mandatoryExist
      ? 'Ketiga ujian mapel wajib (Matematika, B. Indonesia, B. Inggris) telah dibuat'
      : 'Ujian mapel wajib belum lengkap',
    severity: 'blocking',
  });

  // Gate 6: Required Elective Subject Exams Exist (Exact Coverage)
  let exactElectiveCoverage = true;
  const missingElectiveExams: string[] = [];
  if (hasParticipants && mansatasDb) {
    const coverage = await getTkaSubjectCoverage(db, mansatasDb, eventId);
    for (const item of coverage) {
      if (item.category === 'pilihan' && item.participant_count > 0 && !item.has_exam) {
        exactElectiveCoverage = false;
        missingElectiveExams.push(`${item.subject_name} (${item.participant_count} peserta)`);
      }
    }
  }

  if (!exactElectiveCoverage) {
    blockers.push(`Ujian mapel pilihan belum dibuat untuk: ${missingElectiveExams.join(', ')}`);
  }
  checks.push({
    id: 'elective_exams_coverage',
    name: 'Cakupan Ujian Mapel Pilihan',
    passed: exactElectiveCoverage,
    message: exactElectiveCoverage
      ? 'Seluruh mapel pilihan yang dipilih peserta telah memiliki ujian'
      : `Ujian belum dibuat untuk: ${missingElectiveExams.join(', ')}`,
    severity: 'blocking',
  });

  // Gate 7: Question Content & Keys
  let allExamsHaveQuestions = examList.length > 0;
  const unreadyExams: string[] = [];

  for (const x of examList) {
    const qCount = Number(x.question_count || 0);
    const pts = Number(x.total_points || 0);
    if (qCount === 0 || pts === 0) {
      allExamsHaveQuestions = false;
      unreadyExams.push(`${x.title || x.subject_name} (${qCount} soal)`);
    }
  }

  if (!allExamsHaveQuestions) {
    blockers.push(`Soal ujian belum siap pada: ${unreadyExams.join(', ')}`);
  }
  checks.push({
    id: 'question_readiness',
    name: 'Kesiapan Butir Soal Ujian',
    passed: allExamsHaveQuestions,
    message: allExamsHaveQuestions
      ? `Seluruh ujian (${examList.length} mapel) memiliki butir soal & poin`
      : `Ujian belum memiliki butir soal: ${unreadyExams.join(', ')}`,
    severity: 'blocking',
  });

  // Gate 8: 5-Subject Roster Assignment
  const { results: rosterPerStudent } = await db
    .prepare(
      `SELECT source_id, COUNT(DISTINCT exam_id) as exam_count
       FROM cbt_exam_roster
       WHERE event_id = ? AND source_key = 'mansatas'
       GROUP BY source_id`
    )
    .bind(eventId)
    .all<any>();

  const totalValid = totalParticipants - totalInvalid;
  let studentsWithExact5 = 0;
  let studentsWithMismatchedRoster = 0;
  for (const r of rosterPerStudent || []) {
    if (Number(r.exam_count) === 5) studentsWithExact5++;
    else studentsWithMismatchedRoster++;
  }

  const allValidHave5Rosters =
    hasParticipants &&
    totalValid > 0 &&
    studentsWithExact5 === totalValid &&
    studentsWithMismatchedRoster === 0;

  if (!allValidHave5Rosters && hasParticipants) {
    blockers.push(
      `Penugasan roster ujian belum sinkron (hanya ${studentsWithExact5} dari ${totalValid} siswa valid yang memiliki tepat 5 ujian)`
    );
  }
  checks.push({
    id: 'roster_assignment',
    name: 'Penugasan Roster 5 Mapel Peserta',
    passed: allValidHave5Rosters,
    message: allValidHave5Rosters
      ? `Seluruh peserta valid (${studentsWithExact5} siswa) telah terdaftar pada tepat 5 ujian`
      : 'Penugasan roster belum lengkap untuk seluruh peserta valid',
    severity: 'blocking',
  });

  // Gate 9: Room Assignment
  const unassignedRoomsRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM cbt_exam_roster
       WHERE event_id = ? AND source_key = 'mansatas' AND (room_id IS NULL OR room_id = '')`
    )
    .bind(eventId)
    .first<any>();
  const unassignedRoomCount = Number(unassignedRoomsRow?.cnt || 0);
  const allRoomsAssigned = hasParticipants && unassignedRoomCount === 0;

  if (!allRoomsAssigned && hasParticipants) {
    blockers.push(`Terdapat ${unassignedRoomCount} entri roster yang belum mendapatkan penugasan ruangan ujian`);
  }
  checks.push({
    id: 'room_assignment',
    name: 'Penugasan Ruangan Ujian Peserta',
    passed: allRoomsAssigned,
    message: allRoomsAssigned
      ? 'Seluruh peserta telah teralokasikan ke ruangan ujian'
      : `${unassignedRoomCount} entri roster belum memiliki ruangan`,
    severity: 'blocking',
  });

  // Gate 10: Roster-Driven Exam-Room Scoped Token Policy
  // Every distinct (exam_id, room_id) with enrolled roster participants must have an active token in cbt_exam_tokens
  const { results: rosterExamRooms } = await db
    .prepare(
      `SELECT DISTINCT r.exam_id, r.room_id, e.title as exam_title, e.subject_name, COALESCE(rm.room_name, 'Ruang') as room_name
       FROM cbt_exam_roster r
       JOIN cbt_exams e ON r.exam_id = e.id
       LEFT JOIN cbt_rooms rm ON r.room_id = rm.id
       WHERE r.event_id = ? AND r.source_key = 'mansatas' AND r.room_id IS NOT NULL`
    )
    .bind(eventId)
    .all<any>();

  let allTokensActive = Boolean(rosterExamRooms && rosterExamRooms.length > 0);
  const missingTokensList: string[] = [];

  if (!rosterExamRooms || rosterExamRooms.length === 0) {
    if (examList.length > 0 && hasParticipants) {
      allTokensActive = false;
      blockers.push('Token ruangan belum dapat divalidasi karena peserta belum memiliki penugasan ruangan di roster');
    }
  } else {
    for (const item of rosterExamRooms) {
      const activeTok = await db
        .prepare(
          `SELECT id FROM cbt_exam_tokens
           WHERE exam_id = ? AND room_id = ? AND is_active = 1`
        )
        .bind(item.exam_id, item.room_id)
        .first();

      if (!activeTok) {
        allTokensActive = false;
        missingTokensList.push(`${item.exam_title || item.subject_name} (${item.room_name})`);
      }
    }
  }

  if (!allTokensActive && missingTokensList.length > 0) {
    blockers.push(`Token aktif belum dibuat untuk: ${missingTokensList.slice(0, 5).join(', ')}${missingTokensList.length > 5 ? '...' : ''}`);
  }
  checks.push({
    id: 'tokens_active',
    name: 'Token Ujian per Ruangan (Roster-Driven Policy)',
    passed: allTokensActive,
    message: allTokensActive
      ? 'Seluruh ujian dan ruangan yang terdaftar pada roster telah memiliki token aktif'
      : missingTokensList.length > 0
      ? `Token aktif belum dibuat untuk: ${missingTokensList.slice(0, 3).join(', ')}`
      : 'Token ruangan belum divalidasi (roster ruangan kosong)',
    severity: 'blocking',
  });

  const ready = checks.every((c) => c.passed);

  return {
    ready,
    event_id: eventId,
    checks,
    blockers,
  };
}
