'use client';

import React, { useState, useEffect } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Modal, useToast, Spinner } from '@/components/ui';
import { BookOpen, Users, Clock, Award, Shuffle } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { TeachingAssignment, UlanganExam } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (newExam: UlanganExam) => void;
}

export function UlanganCreateModal({ open, onClose, onCreated }: Props) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(45);
  const [passingScore, setPassingScore] = useState(75);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoadingAssignments(true);
    GET<TeachingAssignment[]>('/api/ulangan/teaching-assignments')
      .then((res) => {
        if (res.success && res.data) {
          setAssignments(res.data);
          if (res.data.length > 0 && !selectedAssignmentId) {
            const first = res.data[0];
            setSelectedAssignmentId(first.id);
            setTitle(`Ulangan Harian ${first.mapel_nama} - ${first.kelas_nama}`);
          }
        } else {
          toast('error', res.error || 'Gagal memuat penugasan mengajar');
        }
      })
      .catch(() => {
        toast('error', 'Gagal memuat penugasan mengajar');
      })
      .finally(() => {
        setLoadingAssignments(false);
      });
  }, [open]);

  const handleAssignmentChange = (id: string) => {
    setSelectedAssignmentId(id);
    const found = assignments.find((a) => a.id === id);
    if (found) {
      setTitle(`Ulangan Harian ${found.mapel_nama} - ${found.kelas_nama}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentId) {
      toast('error', 'Pilih penugasan kelas & mata pelajaran terlebih dahulu');
      return;
    }
    if (!title.trim()) {
      toast('error', 'Judul ulangan wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const res = await POST<UlanganExam>('/api/ulangan/exams', {
        teaching_assignment_id: selectedAssignmentId,
        title: title.trim(),
        description: description.trim() || undefined,
        duration_minutes: Number(duration),
        passing_score: Number(passingScore),
        randomize_questions: randomizeQuestions ? 1 : 0,
        randomize_options: randomizeOptions ? 1 : 0,
      });

      if (res.success && res.data) {
        toast('success', 'Ulangan harian berhasil dibuat');
        onCreated(res.data);
      } else {
        toast('error', res.error || 'Gagal membuat ulangan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan sistem');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Buat Ulangan Harian Baru" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {loadingAssignments ? (
          <div className="py-8 text-center">
            <Spinner />
            <p className="text-xs text-gray-500 mt-2">Memeriksa penugasan mengajar dari Mansatas...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
            <p className="font-bold">Tidak ada penugasan mengajar aktif ditemukan</p>
            <p>
              Akun Anda belum terdaftar pada jadwal <code>penugasan_mengajar</code> semester aktif di sistem Mansatas.
              Hanya guru dengan penugasan kelas yang dapat membuat Ulangan Harian.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1.5">
                <BookOpen size={13} className="text-emerald-700" />
                Penugasan Mengajar (Kelas & Mata Pelajaran) *
              </label>
              <select
                value={selectedAssignmentId}
                onChange={(e) => handleAssignmentChange(e.target.value)}
                className="w-full px-3 py-2 text-xs font-semibold border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                required
              >
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.mapel_nama} ({a.mapel_kode}) — {a.kelas_nama} [Smt {a.semester}]
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Ulangan harian terikat langsung pada kelas dan mata pelajaran yang Anda ampu.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                Judul Ulangan / Kuis *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Ulangan Harian Bab 1 Eksponen"
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-medium"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                Deskripsi / Petunjuk Singkat
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Petunjuk pengerjaan atau materi yang diujikan..."
                rows={2}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-500" />
                  Durasi (Menit) *
                </label>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(5, parseInt(e.target.value) || 5))}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-semibold"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1.5">
                  <Award size={13} className="text-gray-500" />
                  KKM / Nilai Minimal *
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passingScore}
                  onChange={(e) => setPassingScore(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-semibold"
                  required
                />
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-2">
              <p className="text-[11px] font-bold text-gray-600 flex items-center gap-1">
                <Shuffle size={12} className="text-gray-500" /> Pengacakan
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={randomizeQuestions}
                  onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-xs text-gray-700">Acak urutan butir soal untuk setiap siswa</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={randomizeOptions}
                  onChange={(e) => setRandomizeOptions(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-xs text-gray-700">Acak urutan opsi pilihan ganda</span>
              </label>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" type="button" onClick={onClose}>
                Batal
              </Button>
              <Button size="sm" type="submit" loading={saving} disabled={assignments.length === 0}>
                Buat Ulangan
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
