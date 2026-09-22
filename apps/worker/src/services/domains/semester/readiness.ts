// ============================================================
// Semester Domain — Deterministic 8-Point Readiness Gate
//
// Evaluates readiness of a Semester event before transition to 'ready':
// 1. Event: Valid status, mode, academic year
// 2. Participants: Non-empty snapshot, valid grades
// 3. Exams: Valid target grades, verified subjects, questions configured, duration fits slot
// 4. Audience: Every exam has assigned classes
// 5. Roster: All eligible students enrolled, zero ineligible students
// 6. Rooms & Capacity: Every participant assigned, assigned <= room capacity (hard blocker)
// 7. Schedules: Every exam scheduled, non-overlapping, zero participant collisions
// 8. Tokens: Complete token coverage for all distinct (exam, room, tanggal, sesi)
// ============================================================

import type { SemesterReadinessResult } from './types.ts';
import { assertSemesterEvent } from './events.ts';
import { detectSemesterParticipantConflicts } from './scheduling.ts';

export async function checkSemesterEventReadiness(
  db: D1Database,
  eventId: string
): Promise<SemesterReadinessResult> {
  const event = await assertSemesterEvent(db, eventId);
  const blockers: string[] = [];

  // 1. Event Category
  const eventCategory = {
    name: 'Event & Konteks Akademik',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: 'Konteks event dan tahun ajaran valid.',
    details: {} as any,
  };

  if (!event.academic_year_id) {
    eventCategory.status = 'failed';
    eventCategory.message = 'Tahun ajaran event belum ditentukan.';
    blockers.push('Tahun ajaran event semester wajib diisi');
  }

  // 2. Participants Category
  const participantsCategory = {
    name: 'Partisipan (Snapshot Peserta)',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const participantStats = await db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN grade = '10' THEN 1 ELSE 0 END) as grade_10,
         SUM(CASE WHEN grade = '11' THEN 1 ELSE 0 END) as grade_11,
         SUM(CASE WHEN grade = '12' THEN 1 ELSE 0 END) as grade_12,
         SUM(CASE WHEN room_id IS NULL THEN 1 ELSE 0 END) as unassigned_rooms
       FROM cbt_semester_participants
       WHERE event_id = ?`
    )
    .bind(eventId)
    .first<{
      total: number;
      grade_10: number;
      grade_11: number;
      grade_12: number;
      unassigned_rooms: number;
    }>();

  const totalParticipants = participantStats?.total || 0;
  participantsCategory.details = participantStats;

  if (totalParticipants === 0) {
    participantsCategory.status = 'failed';
    participantsCategory.message = 'Belum ada data partisipan yang di-snapshot untuk event ini.';
    blockers.push('Snapshot peserta semester masih kosong');
  } else {
    participantsCategory.message = `Snapshot memuat ${totalParticipants} siswa (Kelas 10: ${participantStats?.grade_10 || 0}, Kelas 11: ${participantStats?.grade_11 || 0}, Kelas 12: ${participantStats?.grade_12 || 0}).`;
  }

  // 3. Exams Category
  const examsCategory = {
    name: 'Struktur & Butir Soal Ujian',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const { results: exams } = await db
    .prepare(
      `SELECT id, title, target_grade, subject_id, duration_minutes
       FROM cbt_exams
       WHERE event_id = ? AND mode = 'semester'`
    )
    .bind(eventId)
    .all<{
      id: string;
      title: string;
      target_grade: string | null;
      subject_id: string | null;
      duration_minutes: number;
    }>();

  const examList = exams || [];
  if (examList.length === 0) {
    examsCategory.status = 'failed';
    examsCategory.message = 'Belum ada ujian yang dibuat untuk event semester ini.';
    blockers.push('Event semester belum memiliki daftar ujian');
  } else {
    const invalidExams: string[] = [];
    const emptyQuestionExams: string[] = [];
    const durationExceededExams: string[] = [];

    for (const ex of examList) {
      if (!ex.target_grade || !['10', '11', '12'].includes(ex.target_grade) || !ex.subject_id) {
        invalidExams.push(ex.title);
      }

      // Check question count
      const qCount = await db
        .prepare('SELECT COUNT(*) as count FROM cbt_questions WHERE exam_id = ?')
        .bind(ex.id)
        .first<{ count: number }>();
      if (!qCount || qCount.count === 0) {
        emptyQuestionExams.push(ex.title);
      }

      // Check duration fits slot
      const boundSlot = await db
        .prepare(
          `SELECT sl.start_time, sl.end_time
           FROM cbt_semester_schedules sch
           JOIN cbt_semester_slots sl ON sch.slot_id = sl.id
           WHERE sch.exam_id = ?`
        )
        .bind(ex.id)
        .first<{ start_time: string; end_time: string }>();

      if (boundSlot) {
        const [sH, sM] = boundSlot.start_time.split(':').map(Number);
        const [eH, eM] = boundSlot.end_time.split(':').map(Number);
        const slotMinutes = (eH * 60 + eM) - (sH * 60 + sM);
        if (ex.duration_minutes > slotMinutes) {
          durationExceededExams.push(
            `${ex.title} (durasi ujian: ${ex.duration_minutes}m > durasi sesi: ${slotMinutes}m)`
          );
        }
      }
    }

    if (invalidExams.length > 0) {
      examsCategory.status = 'failed';
      blockers.push(`Terdapat ujian dengan tingkat atau mata pelajaran tidak valid: ${invalidExams.join(', ')}`);
    }
    if (emptyQuestionExams.length > 0) {
      examsCategory.status = 'failed';
      blockers.push(`Terdapat ujian yang belum memiliki butir soal: ${emptyQuestionExams.join(', ')}`);
    }
    if (durationExceededExams.length > 0) {
      examsCategory.status = 'failed';
      blockers.push(`Durasi ujian melebihi durasi sesi: ${durationExceededExams.join(', ')}`);
    }

    if (examsCategory.status === 'passed') {
      examsCategory.message = `Terdapat ${examList.length} ujian terkonfigurasi dengan butir soal dan durasi valid.`;
    }
  }

  // 4. Academic Audience Category
  const audienceCategory = {
    name: 'Cakupan Kelas (Academic Audience)',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const examsWithoutAudience: string[] = [];
  for (const ex of examList) {
    const classCount = await db
      .prepare('SELECT COUNT(*) as count FROM cbt_semester_exam_classes WHERE exam_id = ?')
      .bind(ex.id)
      .first<{ count: number }>();
    if (!classCount || classCount.count === 0) {
      examsWithoutAudience.push(ex.title);
    }
  }

  if (examsWithoutAudience.length > 0) {
    audienceCategory.status = 'failed';
    audienceCategory.message = `Terdapat ujian yang belum memiliki penetapan cakupan kelas: ${examsWithoutAudience.join(', ')}.`;
    blockers.push(`Setiap ujian semester wajib memiliki cakupan kelas (cbt_semester_exam_classes)`);
  } else {
    audienceCategory.message = 'Seluruh ujian telah memiliki cakupan kelas yang valid.';
  }

  // 5. Roster Category
  const rosterCategory = {
    name: 'Roster Peserta Ujian',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  // Check missing eligible students
  const missingEligible = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM cbt_semester_exam_classes sec
       JOIN cbt_exams e ON e.id = sec.exam_id
       JOIN cbt_semester_participants sp
         ON sp.event_id = sec.event_id AND sp.class_id = sec.class_id AND sp.grade = e.target_grade
       LEFT JOIN cbt_exam_roster r
         ON r.exam_id = sec.exam_id AND r.source_id = sp.student_id
       WHERE sec.event_id = ? AND r.id IS NULL`
    )
    .bind(eventId)
    .first<{ count: number }>();

  // Check ineligible students present
  const ineligiblePresent = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM cbt_exam_roster r
       JOIN cbt_exams e ON e.id = r.exam_id AND e.mode = 'semester'
       LEFT JOIN cbt_semester_participants sp
         ON sp.event_id = r.event_id AND sp.student_id = r.source_id
       LEFT JOIN cbt_semester_exam_classes sec
         ON sec.exam_id = r.exam_id AND sec.class_id = sp.class_id
       WHERE r.event_id = ? AND (sp.id IS NULL OR sec.id IS NULL OR sp.grade != e.target_grade)`
    )
    .bind(eventId)
    .first<{ count: number }>();

  if (missingEligible && missingEligible.count > 0) {
    rosterCategory.status = 'failed';
    blockers.push(`Terdapat ${missingEligible.count} siswa yang berhak namun belum masuk ke roster ujian. Generate ulang roster.`);
  }
  if (ineligiblePresent && ineligiblePresent.count > 0) {
    rosterCategory.status = 'failed';
    blockers.push(`Terdapat ${ineligiblePresent.count} siswa tidak berhak yang masuk ke roster ujian.`);
  }

  if (rosterCategory.status === 'passed') {
    rosterCategory.message = 'Roster peserta ujian telah lengkap dan selaras dengan cakupan kelas.';
  }

  // 6. Rooms & Capacity Category
  const roomsCategory = {
    name: 'Ruangan & Kapasitas',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  if (participantStats && participantStats.unassigned_rooms > 0) {
    roomsCategory.status = 'failed';
    blockers.push(`Terdapat ${participantStats.unassigned_rooms} siswa yang belum memiliki penetapan ruangan`);
  }

  // Hard Blocker: Assigned participants > room capacity
  const { results: overCapacityRooms } = await db
    .prepare(
      `SELECT r.id, r.room_name, r.capacity, COUNT(p.id) as assigned_count
       FROM cbt_rooms r
       JOIN cbt_semester_participants p ON p.room_id = r.id AND p.event_id = ?
       GROUP BY r.id
       HAVING assigned_count > r.capacity`
    )
    .bind(eventId)
    .all<{ id: string; room_name: string; capacity: number; assigned_count: number }>();

  if (overCapacityRooms && overCapacityRooms.length > 0) {
    roomsCategory.status = 'failed';
    const roomDetails = overCapacityRooms
      .map((r) => `${r.room_name} (terisi ${r.assigned_count}/${r.capacity})`)
      .join(', ');
    blockers.push(`Kapasitas ruangan terlampaui: ${roomDetails}`);
  }

  if (roomsCategory.status === 'passed') {
    roomsCategory.message = 'Seluruh peserta telah memiliki ruangan dan kapasitas ruangan mencukupi.';
  }

  // 7. Schedules & Conflicts Category
  const schedulesCategory = {
    name: 'Jadwal, Sesi & Bebas Tabrakan',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const { results: unscheduledExams } = await db
    .prepare(
      `SELECT e.title
       FROM cbt_exams e
       LEFT JOIN cbt_semester_schedules sch ON sch.exam_id = e.id
       WHERE e.event_id = ? AND e.mode = 'semester' AND sch.id IS NULL`
    )
    .bind(eventId)
    .all<{ title: string }>();

  if (unscheduledExams && unscheduledExams.length > 0) {
    schedulesCategory.status = 'failed';
    blockers.push(`Terdapat ujian yang belum dijadwalkan ke sesi: ${unscheduledExams.map((e) => e.title).join(', ')}`);
  }

  // Check conflicts
  const conflicts = await detectSemesterParticipantConflicts(db, eventId);
  if (conflicts.length > 0) {
    schedulesCategory.status = 'failed';
    blockers.push(
      `Ditemukan ${conflicts.length} tabrakan jadwal peserta (contoh: '${conflicts[0].conflicting_student_name}' terdaftar pada '${conflicts[0].exam1_title}' dan '${conflicts[0].exam2_title}' di sesi yang sama).`
    );
  }

  if (schedulesCategory.status === 'passed') {
    schedulesCategory.message = 'Seluruh ujian telah terjadwal ke sesi waktu dan bebas dari tabrakan jadwal peserta.';
  }

  // 8. Tokens Category
  const tokensCategory = {
    name: 'Cakupan Token Ujian',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  // Distinct runtime targets from cbt_exam_roster
  const { results: targetsWithoutTokens } = await db
    .prepare(
      `SELECT DISTINCT r.exam_id, r.room_id, r.tanggal_tes, r.sesi_tes, e.title as exam_title, rm.room_name
       FROM cbt_exam_roster r
       JOIN cbt_exams e ON e.id = r.exam_id
       LEFT JOIN cbt_rooms rm ON rm.id = r.room_id
       LEFT JOIN cbt_exam_tokens t
         ON t.exam_id = r.exam_id
        AND t.room_id = r.room_id
        AND t.tanggal_tes = r.tanggal_tes
        AND t.sesi_tes = r.sesi_tes
        AND t.is_active = 1
       WHERE r.event_id = ? AND t.id IS NULL`
    )
    .bind(eventId)
    .all<{ exam_id: string; room_id: string; tanggal_tes: string; sesi_tes: string; exam_title: string; room_name: string }>();

  if (targetsWithoutTokens && targetsWithoutTokens.length > 0) {
    tokensCategory.status = 'failed';
    blockers.push(
      `Terdapat ${targetsWithoutTokens.length} kombinasi ujian-ruangan-sesi yang belum memiliki token aktif (contoh: ${targetsWithoutTokens[0].exam_title} di ${targetsWithoutTokens[0].room_name || 'Ruangan'}). Generate token terlebih dahulu.`
    );
  } else {
    tokensCategory.message = 'Seluruh target ujian-ruangan-sesi telah memiliki token aktif.';
  }

  // 9. Seating Category
  const seatingCategory = {
    name: 'Distribusi Tempat Duduk / Nomor Kursi',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const unseatedStats = await db
    .prepare(
      `SELECT COUNT(*) as unseated
       FROM cbt_semester_participants p
       WHERE p.event_id = ? AND p.room_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cbt_semester_seat_assignments sa
           WHERE sa.participant_id = p.id AND sa.event_id = p.event_id
         )`
    )
    .bind(eventId)
    .first<{ unseated: number }>();

  const unseatedCount = unseatedStats?.unseated || 0;
  seatingCategory.details = { unseated: unseatedCount };

  if (unseatedCount > 0) {
    seatingCategory.status = 'failed';
    seatingCategory.message = `Terdapat ${unseatedCount} peserta dengan ruangan yang belum memiliki penetapan nomor kursi.`;
    blockers.push(`Terdapat ${unseatedCount} peserta yang belum memiliki penetapan tempat duduk (seating).`);
  } else {
    seatingCategory.message = 'Seluruh peserta beruangan telah memperoleh alokasi tempat duduk.';
  }

  // 10. Invigilators Category
  const invigilatorsCategory = {
    name: 'Penugasan Pengawas Ruangan',
    status: 'passed' as 'passed' | 'failed' | 'warning',
    message: '',
    details: {} as any,
  };

  const { results: missingInvigilators } = await db
    .prepare(
      `SELECT
         s.slot_id,
         p.room_id,
         sl.slot_label,
         r.room_name,
         COALESCE(rl.required_invigilators, 1) as required_count,
         COUNT(a.id) as assigned_count
       FROM cbt_semester_schedules s
       JOIN cbt_semester_slots sl ON sl.id = s.slot_id
       JOIN cbt_semester_exam_classes sec ON sec.exam_id = s.exam_id
       JOIN cbt_semester_participants p ON p.class_id = sec.class_id AND p.event_id = s.event_id
       JOIN cbt_rooms r ON r.id = p.room_id
       LEFT JOIN cbt_semester_room_layouts rl ON rl.room_id = p.room_id AND rl.event_id = s.event_id
       LEFT JOIN cbt_semester_invigilator_assignments a
         ON a.event_id = s.event_id AND a.slot_id = s.slot_id AND a.room_id = p.room_id
       WHERE s.event_id = ? AND p.room_id IS NOT NULL
       GROUP BY s.slot_id, p.room_id
       HAVING assigned_count < required_count`
    )
    .bind(eventId)
    .all<{
      slot_id: string;
      room_id: string;
      slot_label: string;
      room_name: string;
      required_count: number;
      assigned_count: number;
    }>();

  if (missingInvigilators && missingInvigilators.length > 0) {
    invigilatorsCategory.status = 'failed';
    invigilatorsCategory.message = `Terdapat ${missingInvigilators.length} ruangan-sesi yang kekurangan pengawas (contoh: ${missingInvigilators[0].room_name} pada ${missingInvigilators[0].slot_label}).`;
    invigilatorsCategory.details = missingInvigilators;
    blockers.push(`Terdapat ${missingInvigilators.length} jadwal ruangan-sesi yang belum memiliki pengawas lengkap.`);
  } else {
    invigilatorsCategory.message = 'Seluruh ruangan operasional pada setiap sesi telah memiliki pengawas lengkap.';
  }

  const eligible = blockers.length === 0;

  return {
    eligible,
    event_id: eventId,
    event_code: event.code,
    event_name: event.name,
    current_status: event.status,
    categories: {
      event: eventCategory,
      participants: participantsCategory,
      exams: examsCategory,
      audience: audienceCategory,
      roster: rosterCategory,
      rooms: roomsCategory,
      schedules: schedulesCategory,
      tokens: tokensCategory,
      seating: seatingCategory,
      invigilators: invigilatorsCategory,
    },
    blockers,
  };
}
