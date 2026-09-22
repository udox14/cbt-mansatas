'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, Badge, Modal, useToast, EmptyState } from '@/components/ui';
import { Users, Sparkles, CheckCircle2, AlertTriangle, RefreshCw, CheckSquare, Square, Layers, BookOpen } from 'lucide-react';
import type { SemesterEvent, SemesterExam, SemesterExamClass } from './types';

interface SemesterAudienceTabProps {
  event: SemesterEvent;
  selectedExamId?: string | null;
  onSelectExam?: (examId: string) => void;
}

export function SemesterAudienceTab({ event, selectedExamId, onSelectExam }: SemesterAudienceTabProps) {
  const { toast } = useToast();
  const [exams, setExams] = useState<SemesterExam[]>([]);
  const [currentExamId, setCurrentExamId] = useState<string>(selectedExamId || '');
  const [loadingExams, setLoadingExams] = useState(true);

  // Available and assigned classes
  const [availableClasses, setAvailableClasses] = useState<any[]>([]);
  const [assignedClassIds, setAssignedClassIds] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [savingClasses, setSavingClasses] = useState(false);
  const [materializingRoster, setMaterializingRoster] = useState(false);
  const [materializingAll, setMaterializingAll] = useState(false);

  const fetchExams = useCallback(async () => {
    setLoadingExams(true);
    const res = await GET<SemesterExam[]>(`/api/semester/events/${event.id}/exams`);
    if (res.success && res.data) {
      setExams(res.data);
      if (res.data.length > 0 && !currentExamId) {
        const initialId = selectedExamId || res.data[0].id;
        setCurrentExamId(initialId);
      }
    } else {
      toast('error', res.error || 'Gagal memuat ujian');
    }
    setLoadingExams(false);
  }, [event.id, currentExamId, selectedExamId, toast]);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  useEffect(() => {
    if (selectedExamId) {
      setCurrentExamId(selectedExamId);
    }
  }, [selectedExamId]);

  const activeExam = exams.find((e) => e.id === currentExamId) || exams[0];

  const fetchExamClasses = useCallback(async (exam: SemesterExam) => {
    setLoadingClasses(true);
    try {
      const [availRes, assignRes] = await Promise.all([
        GET<any[]>(
          `/api/semester/events/${event.id}/classes/discover?grade=${exam.target_grade}&subject_id=${exam.subject_id}`
        ),
        GET<SemesterExamClass[]>(`/api/semester/events/${event.id}/exams/${exam.id}/classes`),
      ]);

      if (availRes.success && availRes.data) {
        setAvailableClasses(availRes.data);
      }
      if (assignRes.success && assignRes.data) {
        setAssignedClassIds(assignRes.data.map((c) => c.kelas_id));
      } else {
        setAssignedClassIds([]);
      }
    } catch {
      toast('error', 'Gagal memuat daftar kelas audiens');
    } finally {
      setLoadingClasses(false);
    }
  }, [event.id, toast]);

  useEffect(() => {
    if (activeExam) {
      fetchExamClasses(activeExam);
    }
  }, [activeExam, fetchExamClasses]);

  const handleSelectExamChange = (newExamId: string) => {
    setCurrentExamId(newExamId);
    if (onSelectExam) onSelectExam(newExamId);
  };

  const toggleClass = (classId: string) => {
    if (assignedClassIds.includes(classId)) {
      setAssignedClassIds(assignedClassIds.filter((id) => id !== classId));
    } else {
      setAssignedClassIds([...assignedClassIds, classId]);
    }
  };

  const handleSelectAll = () => {
    setAssignedClassIds(availableClasses.map((c) => c.id));
  };

  const handleClearAll = () => {
    setAssignedClassIds([]);
  };

  const handleSaveClasses = async () => {
    if (!activeExam) return;
    setSavingClasses(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/exams/${activeExam.id}/classes`, {
      class_ids: assignedClassIds,
    });
    setSavingClasses(false);

    if (res.success) {
      toast('success', `${assignedClassIds.length} kelas berhasil disimpan untuk ujian ini`);
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal menyimpan cakupan kelas');
    }
  };

  const handleMaterializeRoster = async () => {
    if (!activeExam) return;
    setMaterializingRoster(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/exams/${activeExam.id}/materialize-roster`, {});
    setMaterializingRoster(false);

    if (res.success) {
      toast('success', res.message || 'Roster ujian berhasil disinkronkan');
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal sinkronisasi roster ujian');
    }
  };

  const handleMaterializeAll = async () => {
    setMaterializingAll(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/generate-rosters`, {});
    setMaterializingAll(false);

    if (res.success) {
      toast('success', res.message || 'Seluruh roster ujian semester berhasil digenerate');
      fetchExams();
    } else {
      toast('error', res.error || 'Gagal generate semua roster');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  if (loadingExams) {
    return (
      <div className="py-20 flex justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (exams.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <EmptyState
          title="Belum Ada Ujian Semester"
          desc="Buat ujian mapel terlebih dahulu pada tab 'Mapel & Ujian' sebelum mengatur kelas audiens."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Top Header Card */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            Cakupan Audiens Kelas & Roster Ujian
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Petakan kelas mana saja yang mengikuti setiap ujian semester dan bentuk entri roster siswa secara deterministik.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isFrozen && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleMaterializeAll}
              disabled={materializingAll}
            >
              <Sparkles className={`w-3.5 h-3.5 mr-1.5 ${materializingAll ? 'animate-spin' : ''}`} />
              Generate Roster Semua Ujian
            </Button>
          )}
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Exam List Selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm space-y-2">
          <p className="font-bold text-gray-700 text-xs uppercase px-1">Pilih Ujian Mapel:</p>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {exams.map((ex) => {
              const isSel = ex.id === activeExam?.id;
              return (
                <button
                  key={ex.id}
                  onClick={() => handleSelectExamChange(ex.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all text-xs ${
                    isSel
                      ? 'border-emerald-500 bg-emerald-50/60 font-semibold'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="bg-gray-100 text-gray-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      Kelas {ex.target_grade}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {ex.roster_count || 0} Siswa
                    </span>
                  </div>
                  <p className="font-bold text-gray-900 leading-snug">{ex.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{ex.subject_name}</p>
                  <div className="mt-2 text-[10px] text-emerald-700 font-medium">
                    {ex.assigned_class_count || 0} Kelas Terdaftar
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Class Audience Mapping for Active Exam */}
        {activeExam && (
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            {/* Active Exam Overview */}
            <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-600 text-white font-bold px-2 py-0.5 rounded text-[10px]">
                    Kelas {activeExam.target_grade}
                  </span>
                  <h4 className="font-bold text-gray-900 text-sm">{activeExam.title}</h4>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Mata Pelajaran: <strong>{activeExam.subject_name}</strong> · Durasi:{' '}
                  <strong>{activeExam.duration_minutes} Menit</strong>
                </p>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold">Roster Siswa</p>
                  <p className="text-base font-bold text-emerald-800">{activeExam.roster_count || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold">Kelas Audiens</p>
                  <p className="text-base font-bold text-gray-900">{assignedClassIds.length}</p>
                </div>
              </div>
            </div>

            {/* Class Selection Header & Quick Actions */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="font-bold text-gray-800">
                Pilih Kelas Audiens (Tingkat {activeExam.target_grade}):
              </span>
              {!isFrozen && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAll}
                    className="text-emerald-700 hover:text-emerald-800 font-semibold text-xs"
                  >
                    Pilih Semua ({availableClasses.length})
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={handleClearAll}
                    className="text-gray-500 hover:text-gray-700 text-xs"
                  >
                    Kosongkan
                  </button>
                </div>
              )}
            </div>

            {/* Classes Grid */}
            {loadingClasses ? (
              <div className="py-12 flex justify-center">
                <Spinner size={20} />
              </div>
            ) : availableClasses.length === 0 ? (
              <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-lg">
                Tidak ada data kelas tingkat {activeExam.target_grade} yang ditemukan di master Mansatas.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {availableClasses.map((cls) => {
                  const isChecked = assignedClassIds.includes(cls.id);
                  return (
                    <label
                      key={cls.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isChecked
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold'
                          : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleClass(cls.id)}
                        disabled={isFrozen}
                        className="rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>{cls.nama || cls.name || `Kelas ${cls.id}`}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Action Bar */}
            {!isFrozen && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleMaterializeRoster}
                  disabled={materializingRoster || assignedClassIds.length === 0}
                >
                  <Sparkles className={`w-3.5 h-3.5 mr-1.5 ${materializingRoster ? 'animate-spin' : ''}`} />
                  Sinkronkan Roster Ujian Ini
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveClasses}
                  loading={savingClasses}
                >
                  Simpan Cakupan Kelas ({assignedClassIds.length})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
