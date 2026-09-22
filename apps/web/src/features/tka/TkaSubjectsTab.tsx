'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, Spinner, Badge, EmptyState, useToast, Confirm } from '@/components/ui';
import { BookOpen, Plus, Sparkles, CheckCircle2, AlertCircle, FileText, Trash2 } from 'lucide-react';
import type { TkaSubjectCoverageItem, TkaEvent } from './types';

interface TkaSubjectsTabProps {
  event: TkaEvent;
  onSelectExam: (examId: string, tab: string) => void;
}

export function TkaSubjectsTab({ event, onSelectExam }: TkaSubjectsTabProps) {
  const { toast } = useToast();
  const [coverage, setCoverage] = useState<TkaSubjectCoverageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [generatingRoster, setGeneratingRoster] = useState(false);
  const [delTarget, setDelTarget] = useState<TkaSubjectCoverageItem | null>(null);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    const res = await GET<TkaSubjectCoverageItem[]>(`/api/tka/events/${event.id}/subject-coverage`);
    if (res.success && res.data) {
      setCoverage(res.data);
    } else {
      toast('error', res.error || 'Gagal memuat cakupan mapel TKA');
    }
    setLoading(false);
  }, [event.id, toast]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  const handleBatchCreate = async () => {
    setCreatingBatch(true);
    const res = await POST<any>(`/api/tka/events/${event.id}/exams/batch-create`, {});
    setCreatingBatch(false);

    if (res.success) {
      toast('success', res.message || 'Ujian mapel berhasil dibuat');
      fetchCoverage();
    } else {
      toast('error', res.error || 'Gagal membuat ujian mapel');
    }
  };

  const handleCreateSingle = async (item: TkaSubjectCoverageItem) => {
    const res = await POST<any>(`/api/tka/events/${event.id}/exams`, {
      subject_id: item.subject_id,
      title: `TKA ${item.subject_name}`,
      duration_minutes: 60,
    });

    if (res.success) {
      toast('success', `Ujian ${item.subject_name} berhasil dibuat`);
      fetchCoverage();
    } else {
      toast('error', res.error || 'Gagal membuat ujian');
    }
  };

  const handleDeleteExam = async () => {
    if (!delTarget || !delTarget.exam_id) return;
    const res = await DEL<any>(`/api/tka/events/${event.id}/exams/${delTarget.exam_id}`);
    setDelTarget(null);

    if (res.success) {
      toast('success', 'Ujian mapel berhasil dihapus');
      fetchCoverage();
    } else {
      toast('error', res.error || 'Gagal menghapus ujian mapel');
    }
  };

  const handleGenerateRoster = async () => {
    setGeneratingRoster(true);
    const res = await POST<any>(`/api/tka/events/${event.id}/roster/generate`, {});
    setGeneratingRoster(false);

    if (res.success) {
      toast('success', res.message || 'Roster 5 mapel berhasil dibuat');
      fetchCoverage();
    } else {
      toast('error', res.error || 'Gagal membuat roster 5 mapel');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  const mandatoryList = coverage.filter((c) => c.category === 'wajib');
  const electiveList = coverage.filter((c) => c.category === 'pilihan');
  const uncreatedCount = coverage.filter((c) => !c.has_exam).length;

  return (
    <div className="space-y-6 text-xs">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="font-bold text-gray-900 text-sm">Cakupan Mata Pelajaran & Ujian TKA</h2>
          <p className="text-gray-500 text-[11px] mt-0.5">
            Setiap mapel yang dipilih siswa harus memiliki tepat 1 ujian. Satu mapel hanya boleh memiliki 1 ujian.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {uncreatedCount > 0 && !isFrozen && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleBatchCreate}
              disabled={creatingBatch || isFrozen}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Buat Semua Ujian yang Dibutuhkan ({uncreatedCount})
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateRoster}
            disabled={generatingRoster || isFrozen}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            Sinkronkan Penugasan Roster 5 Mapel
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : coverage.length === 0 ? (
        <EmptyState
          title="Belum Ada Data Cakupan Mapel"
          desc="Ambil snapshot peserta terlebih dahulu pada tab Peserta untuk menghitung cakupan mapel."
        />
      ) : (
        <div className="space-y-6">
          {/* Section 1: Mapel Wajib (3 Mapel) */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-emerald-50/70 px-4 py-3 border-b border-emerald-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                <h3 className="font-bold text-emerald-900 text-xs">
                  Mata Pelajaran Wajib (3 Mapel) — Diikuti Seluruh Siswa Valid
                </h3>
              </div>
              <span className="text-[11px] font-semibold text-emerald-800">
                {mandatoryList.filter((m) => m.has_exam).length} / 3 Ujian Dibuat
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {mandatoryList.map((item) => (
                <div
                  key={item.subject_id}
                  className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-gray-100 text-gray-700 font-bold text-xs">
                      {item.subject_name.slice(0, 3).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-bold text-gray-900 text-xs">{item.subject_name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                        <span>{item.participant_count} Peserta Terdaftar</span>
                        <span>•</span>
                        <span>{item.question_count} Butir Soal</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.has_exam ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          Ujian Dibuat
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectExam(item.exam_id!, 'soal')}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          Kelola Soal
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleCreateSingle(item)}
                        disabled={isFrozen}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Buat Ujian
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Mapel Pilihan */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                <h3 className="font-bold text-gray-900 text-xs">
                  Mata Pelajaran Pilihan — Berdasarkan Pilihan Nyata Peserta
                </h3>
              </div>
              <span className="text-[11px] text-gray-500">
                {electiveList.filter((e) => e.has_exam).length} dari {electiveList.length} Ujian Pilihan Dibuat
              </span>
            </div>

            {electiveList.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                Belum ada mapel pilihan yang terdata dari peserta.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {electiveList.map((item) => (
                  <div
                    key={item.subject_id}
                    className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="p-2 rounded-lg bg-blue-50 text-blue-700 font-bold text-xs">
                        {item.subject_name.slice(0, 3).toUpperCase()}
                      </span>
                      <div>
                        <div className="font-bold text-gray-900 text-xs">{item.subject_name}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                          <span className="font-semibold text-gray-700">
                            {item.participant_count} Peserta Memilih
                          </span>
                          <span>•</span>
                          <span>{item.question_count} Butir Soal</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.has_exam ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Ujian Dibuat
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onSelectExam(item.exam_id!, 'soal')}
                          >
                            <FileText className="w-3.5 h-3.5 mr-1" />
                            Kelola Soal
                          </Button>
                          {!isFrozen && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setDelTarget(item)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCreateSingle(item)}
                          disabled={isFrozen}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Buat Ujian
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Exam Confirm Modal */}
      {delTarget && (
        <Confirm
          open={!!delTarget}
          title="Hapus Ujian Mata Pelajaran?"
          message={`Apakah Anda yakin ingin menghapus ujian ${delTarget.subject_name}? Seluruh butir soal dan penugasan roster pada ujian ini akan dihapus.`}
          confirmText="Ya, Hapus Ujian"
          onConfirm={handleDeleteExam}
          onClose={() => setDelTarget(null)}
          danger={true}
        />
      )}
    </div>
  );
}
