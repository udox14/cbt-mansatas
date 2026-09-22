export interface Room {
  id: string;
  room_name: string;
  capacity: number;
  jumlah_peserta?: number;
  event_id?: string | null;
  event_code?: string;
  event_name?: string;
}

export interface Proctor {
  id: string;
  username: string;
  full_name: string;
  role: string;
  room_id: string | null;
  room_name?: string;
}

export interface Pendaftar {
  id: string;
  nisn: string;
  nama_lengkap: string;
  no_pendaftaran: string;
  ruang_tes: string;
  jalur: string;
  asal_sekolah: string;
  jenis_kelamin: string;
  tanggal_lahir: string;
  tanggal_tes: string;
  sesi_tes: string;
}

export interface Exam {
  id: string;
  title: string;
  subject_name?: string | null;
  sequence_order?: number;
  description: string | null;
  duration_minutes: number;
  active_status: string;
  question_count: number;
  is_score_visible: number;
  randomize_questions: number;
  randomize_options: number;
  rules_text: string | null;
  completion_message: string;
  passing_score: number;
  target_jalur: string | null;
  cheat_limit: number;
  cheat_action: string;
  enforce_fullscreen: number;
  event_id?: string | null;
  event_name?: string | null;
  event_code?: string | null;
}

export interface CbtEvent {
  id: string;
  code: string;
  name: string;
  activity_type: string;
  participant_source: 'pmb' | 'mansatas' | 'cbt_user';
  status: string;
  exam_count?: number;
  roster_count?: number;
}

export interface RosterParticipant {
  source_id: string;
  source_key: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  grade: string;
  gender: string;
  is_active: number | boolean;
  room_name?: string | null;
  tanggal_tes?: string | null;
  sesi_tes?: string | null;
}

export interface Question {
  id: string;
  question_text: string;
  question_type: string;
  question_order: number;
  image_url: string | null;
  audio_url: string | null;
  options: QOption[];
}

export interface QOption {
  id?: string;
  option_label: string;
  option_text: string;
  image_url: string | null;
  is_correct: number;
}

export interface AiDraftOption {
  option_label: string;
  option_text: string;
  is_correct: number;
}

export interface AiDraft {
  id: string;
  run_id: string;
  exam_id: string;
  question_order: number;
  question_text: string;
  options: AiDraftOption[];
  correct_index: number;
  explanation?: string | null;
  difficulty: 'easy' | 'balanced' | 'hard';
  content_hash: string;
  validation_status: 'valid' | 'invalid' | 'duplicate';
  validation_errors?: string[];
  status: 'draft' | 'accepted' | 'rejected';
  canonical_question_id?: string | null;
}

export type Page = 'exams' | 'kegiatan' | 'peserta' | 'rooms' | 'pelaksana' | 'settings';
export type ExamTab = 'soal' | 'token' | 'monitor' | 'hasil' | 'peserta' | 'analitik';

export const DEFAULT_RULES_TEMPLATE = `<ol>
  <li>Berdoa sebelum memulai pengerjaan soal.</li>
  <li>Kerjakan soal secara mandiri, jujur, dan tidak bekerja sama dengan peserta lain.</li>
  <li>Dilarang membuka tab lain, berpindah aplikasi, atau mematikan mode layar penuh (fullscreen).</li>
  <li>Perhatikan sisa waktu pengerjaan yang tertera pada layar.</li>
  <li>Jika terjadi kendala teknis, segera hubungi pengawas atau proktor ujian.</li>
</ol>`;

export const DEFAULT_COMPLETION_MESSAGE = `Terima kasih telah menyelesaikan ujian ini dengan jujur dan tertib.

• Jawaban Anda telah tersimpan secara otomatis di sistem.
• Harap tetap tenang dan duduk di tempat Anda.
• Tunggu instruksi lebih lanjut dari pengawas sebelum meninggalkan ruangan.

Semoga mendapatkan hasil yang terbaik!`;

export const JALUR_TES = 'REGULER';

export const EXAM_TABS: { key: ExamTab; label: string }[] = [
  { key: 'soal', label: 'Soal' },
  { key: 'token', label: 'Token' },
  { key: 'peserta', label: 'Peserta' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'hasil', label: 'Hasil' },
  { key: 'analitik', label: 'Analitik' },
];
