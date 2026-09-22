'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Spinner, Badge, Modal, useToast, EmptyState, Confirm } from '@/components/ui';
import { BookOpen, Plus, Calendar, Users, HelpCircle, Edit2, Trash2, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import type { SemesterEvent, SemesterExam } from './types';

interface SemesterExamsTabProps {
  event: SemesterEvent;
  onSelectExam: (examId: string, targetTab: string) => void;
}

export function SemesterExamsTab({ event, onSelectExam }: SemesterExamsTabProps) {
  const { toast } = useToast();
  const [exams, setExams] = useState<SemesterExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  // Subjects from Mansatas
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [targetGrade, setTargetGrade] = useState<'10' | '11' | '12'>('10');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [passingScore, setPassingScore] = useState(75);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Edit Modal
  const [editExam, setEditExam] = useState<SemesterExam | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDuration, setEditDuration] = useState(90);
  const [editPassingScore, setEditPassingScore] = useState(75);
  const [editRandomQuestions, setEditRandomQuestions] = useState(true);
  const [editRandomOptions, setEditRandomOptions] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Delete Confirm
  const [delTarget, setDelTarget] = useState<SemesterExam | null>(null);

  const fetchExams = useCallback(async () => {
    setLoading(true);
    const res = await GET<SemesterExam[]>(`/api/semester/events/${event.id}/exams`);
    if (res.success && res.data) {
      setExams(res.data);
    } else {
      toast('error', res.error || 'Gagal memuat ujian semester');
    }
    setLoading(false);
  }, [event.id, toast]);

  const fetchSubjects = useCallback(async (grade?: string) => {
    setLoadingSubjects(true);
    let url = '/api/semester/subjects';
    if (grade) url += `?grade=${grade}`;
    const res = await GET<any[]>(url);
    if (res.success && res.data) {
      setSubjects(res.data);
      if (res.data.length > 0 && !selectedSubjectId) {
        setSelectedSubjectId(res.data[0].id);
        setExamTitle(`${res.data[0].nama_mapel} Kelas ${targetGrade}`);
      }
    }
    setLoadingSubjects(false);
  }, [selectedSubjectId, targetGrade]);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  useEffect(() => {
    if (showCreateModal) {
      fetchSubjects(targetGrade);
    }
  }, [showCreateModal, targetGrade, fetchSubjects]);

  const handleSubjectChange = (subjId: string) => {
    setSelectedSubjectId(subjId);
    const subj = subjects.find((s) => s.id === subjId);
    if (subj) {
      setExamTitle(`${subj.nama_mapel} Kelas ${targetGrade}`);
    }
  };

  const handleGradeChange = (grade: '10' | '11' | '12') => {
    setTargetGrade(grade);
    const subj = subjects.find((s) => s.id === selectedSubjectId);
    if (subj) {
      setExamTitle(`${subj.nama_mapel} Kelas ${grade}`);
    }
    fetchSubjects(grade);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId) {
      toast('error', 'Pilih mata pelajaran');
      return;
    }
    setSubmitting(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/exams`, {
      title: examTitle.trim(),
      subject_id: selectedSubjectId,
      target_grade: targetGrade,
      duration_minutes: Number(durationMinutes),
      passing_score: Number(passingScore),
      randomize_questions: randomizeQuestions,
      randomize_options: randomizeOptions,
    });
    setSubmitting(false);

    if (res.success) {
      toast('success', 'Ujian semester berhasil dibuat');
      setShowCreateModal(false);
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal membuat ujian semester');
    }
  };

  const handleOpenEdit = (exam: SemesterExam) => {
    setEditExam(exam);
    setEditTitle(exam.title);
    setEditDuration(exam.duration_minutes);
    setEditPassingScore(exam.passing_score || 0);
    setEditRandomQuestions(exam.randomize_questions === 1);
    setEditRandomOptions(exam.randomize_options === 1);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExam) return;
    setUpdating(true);
    const res = await PUT<any>(`/api/semester/events/${event.id}/exams/${editExam.id}`, {
      title: editTitle.trim(),
      duration_minutes: Number(editDuration),
      passing_score: Number(editPassingScore),
      randomize_questions: editRandomQuestions,
      randomize_options: editRandomOptions,
    });
    setUpdating(false);

    if (res.success) {
      toast('success', 'Ujian semester berhasil diperbarui');
      setEditExam(null);
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal memperbarui ujian');
    }
  };

  const handleDelete = async () => {
    if (!delTarget) return;
    const res = await DEL<any>(`/api/semester/events/${event.id}/exams/${delTarget.id}`);
    setDelTarget(null);
    if (res.success) {
      toast('success', 'Ujian semester berhasil dihapus');
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal menghapus ujian');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  const filteredExams = gradeFilter === 'all' ? exams : exams.filter((e) => e.target_grade === gradeFilter);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            Mata Pelajaran & Ujian Semester ({exams.length} Ujian)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Daftar ujian per tingkat kelas (10, 11, 12) dengan mata pelajaran terverifikasi dari master Mansatas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isFrozen && (
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Buat Ujian Semester
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white px-4 py-2.5 rounded-lg border border-gray-200 flex items-center gap-3 text-xs">
        <span className="font-semibold text-gray-600">Filter Tingkat:</span>
        <div className="flex items-center gap-1.5">
          {['all', '10', '11', '12'].map((g) => {
            const isSel = gradeFilter === g;
            return (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  isSel
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {g === 'all' ? 'Semua Tingkat' : `Kelas ${g}`}
              </button>
            );
          })}
        </div>
        <span className="text-gray-400 ml-auto">{filteredExams.length} ujian ditampilkan</span>
      </div>

      {/* Exam Grid */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : filteredExams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <EmptyState
            title="Belum Ada Ujian Semester"
            desc="Tambahkan ujian semester dengan memilih mata pelajaran resmi dari Mansatas dan tingkat kelas yang dituju."
          />
          {!isFrozen && (
            <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Buat Ujian Pertama
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredExams.map((ex) => (
            <div
              key={ex.id}
              className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">
                    Kelas {ex.target_grade}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-gray-400" />
                    {ex.duration_minutes} Menit
                  </span>
                </div>

                <h4 className="font-bold text-gray-900 text-sm leading-snug">{ex.title}</h4>
                <p className="text-xs text-gray-500 mt-0.5">{ex.subject_name}</p>

                {/* Status Badges & Metrics */}
                <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-gray-100 text-center text-xs">
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <p className="text-[10px] text-gray-400 uppercase font-bold">Soal</p>
                    <p className="font-bold text-gray-800 mt-0.5">{ex.question_count || 0}</p>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <p className="text-[10px] text-gray-400 uppercase font-bold">Audiens</p>
                    <p className="font-bold text-emerald-700 mt-0.5">{ex.assigned_class_count || 0} Kelas</p>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <p className="text-[10px] text-gray-400 uppercase font-bold">Roster</p>
                    <p className="font-bold text-blue-700 mt-0.5">{ex.roster_count || 0} Siswa</p>
                  </div>
                </div>

                {/* Schedule Info */}
                <div className="mt-3 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] flex items-center justify-between">
                  <span className="text-gray-500">Jadwal Sesi:</span>
                  {ex.slot_label ? (
                    <span className="font-bold text-emerald-800">
                      {ex.slot_label} ({ex.slot_date} {ex.start_time})
                    </span>
                  ) : (
                    <span className="text-amber-600 font-medium">Belum Dijadwalkan</span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1 justify-center"
                    onClick={() => onSelectExam(ex.id, 'soal')}
                  >
                    <HelpCircle className="w-3 h-3 mr-1" />
                    Bank Soal
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 justify-center"
                    onClick={() => onSelectExam(ex.id, 'audiens')}
                  >
                    <Users className="w-3 h-3 mr-1" />
                    Audiens
                  </Button>
                </div>

                {!isFrozen && (
                  <div className="flex items-center justify-end gap-1 pt-1">
                    <button
                      onClick={() => handleOpenEdit(ex)}
                      className="p-1.5 text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100"
                      title="Edit Pengaturan Ujian"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDelTarget(ex)}
                      className="p-1.5 text-red-500 hover:text-red-700 rounded hover:bg-red-50"
                      title="Hapus Ujian"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Exam Modal */}
      {showCreateModal && (
        <Modal open={true} title="Buat Ujian Semester Baru" onClose={() => setShowCreateModal(false)} size="md">
          <form onSubmit={handleCreate} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Target Tingkat Kelas <span className="text-red-500">*</span>
                </label>
                <select
                  value={targetGrade}
                  onChange={(e) => handleGradeChange(e.target.value as '10' | '11' | '12')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  required
                >
                  <option value="10">Kelas 10 (Fase E)</option>
                  <option value="11">Kelas 11 (Fase F)</option>
                  <option value="12">Kelas 12 (Fase F Lanjutan)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Mata Pelajaran Mansatas <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  disabled={loadingSubjects}
                  required
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama_mapel} {s.kode_mapel ? `(${s.kode_mapel})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Judul Ujian <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={examTitle}
                onChange={(e) => setExamTitle(e.target.value)}
                placeholder="misal: Matematika Kelas 10"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Durasi (Menit)</label>
                <input
                  type="number"
                  min="1"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">KKM / Nilai Kelulusan</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={passingScore}
                  onChange={(e) => setPassingScore(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={randomizeQuestions}
                  onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Acak Urutan Soal untuk Setiap Siswa
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={randomizeOptions}
                  onChange={(e) => setRandomizeOptions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Acak Urutan Pilihan Ganda (A, B, C, D, E)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)} disabled={submitting}>
                Batal
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                Buat Ujian
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Exam Modal */}
      {editExam && (
        <Modal open={true} title={`Edit Ujian: ${editExam.title}`} onClose={() => setEditExam(null)} size="md">
          <form onSubmit={handleUpdate} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Judul Ujian</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Durasi (Menit)</label>
                <input
                  type="number"
                  min="1"
                  value={editDuration}
                  onChange={(e) => setEditDuration(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">KKM / Nilai Kelulusan</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editPassingScore}
                  onChange={(e) => setEditPassingScore(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={editRandomQuestions}
                  onChange={(e) => setEditRandomQuestions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Acak Urutan Soal
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={editRandomOptions}
                  onChange={(e) => setEditRandomOptions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Acak Urutan Pilihan Ganda
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setEditExam(null)} disabled={updating}>
                Batal
              </Button>
              <Button type="submit" variant="primary" loading={updating}>
                Simpan Perubahan
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirm */}
      {delTarget && (
        <Confirm
          open={true}
          title="Hapus Ujian Semester"
          message={`Yakin ingin menghapus ujian "${delTarget.title}"? Seluruh kelas audiens dan jadwal sesi untuk ujian ini akan dibatalkan.`}
          confirmText="Hapus Ujian"
          danger={true}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}
    </div>
  );
}
