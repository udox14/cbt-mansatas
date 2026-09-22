'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, Spinner, Badge, Modal, useToast, EmptyState, Confirm } from '@/components/ui';
import { Calendar, Clock, Plus, Trash2, AlertTriangle, ShieldCheck, CheckCircle2, ChevronRight, Lock, Unlock, Sparkles } from 'lucide-react';
import type { SemesterEvent, SemesterSlot, SemesterSchedule, SemesterExam } from './types';

interface SemesterSchedulingTabProps {
  event: SemesterEvent;
}

export function SemesterSchedulingTab({ event }: SemesterSchedulingTabProps) {
  const { toast } = useToast();
  const [slots, setSlots] = useState<SemesterSlot[]>([]);
  const [schedules, setSchedules] = useState<SemesterSchedule[]>([]);
  const [exams, setExams] = useState<SemesterExam[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Timetable Solver Modal
  const [showSolverModal, setShowSolverModal] = useState(false);
  const [solverMaxPerDay, setSolverMaxPerDay] = useState(2);
  const [solverClearExisting, setSolverClearExisting] = useState(false);
  const [runningSolver, setRunningSolver] = useState(false);

  // Add Slot Modal
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotLabel, setSlotLabel] = useState('Sesi 1');
  const [slotDate, setSlotDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('07:30');
  const [endTime, setEndTime] = useState('09:30');
  const [submittingSlot, setSubmittingSlot] = useState(false);

  // Assign Exam Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [targetSlotId, setTargetSlotId] = useState('');
  const [targetExamId, setTargetExamId] = useState('');
  const [submittingAssign, setSubmittingAssign] = useState(false);

  // Delete Confirmations
  const [delSlotTarget, setDelSlotTarget] = useState<SemesterSlot | null>(null);
  const [delScheduleTarget, setDelScheduleTarget] = useState<SemesterSchedule | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [slotsRes, schedRes, examsRes, confRes] = await Promise.all([
        GET<SemesterSlot[]>(`/api/semester/events/${event.id}/slots`),
        GET<SemesterSchedule[]>(`/api/semester/events/${event.id}/schedules`),
        GET<SemesterExam[]>(`/api/semester/events/${event.id}/exams`),
        GET<{ hasConflicts: boolean; totalConflicts: number; conflicts: any[] }>(
          `/api/semester/events/${event.id}/conflicts`
        ),
      ]);

      if (slotsRes.success && slotsRes.data) setSlots(slotsRes.data);
      if (schedRes.success && schedRes.data) setSchedules(schedRes.data);
      if (examsRes.success && examsRes.data) setExams(examsRes.data);
      if (confRes.success && confRes.data) setConflicts(confRes.data.conflicts || []);
    } catch {
      toast('error', 'Gagal memuat data jadwal');
    } finally {
      setLoading(false);
    }
  }, [event.id, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endTime <= startTime) {
      toast('error', 'Waktu selesai harus lebih besar dari waktu mulai');
      return;
    }

    setSubmittingSlot(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/slots`, {
      slot_label: slotLabel.trim(),
      slot_date: slotDate,
      start_time: startTime,
      end_time: endTime,
    });
    setSubmittingSlot(false);

    if (res.success) {
      toast('success', 'Sesi waktu berhasil dibuat');
      setShowSlotModal(false);
      fetchData();
    } else {
      toast('error', res.error || 'Gagal membuat sesi waktu');
    }
  };

  const handleAssignExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetSlotId || !targetExamId) {
      toast('error', 'Pilih sesi dan ujian yang akan dijadwalkan');
      return;
    }

    setSubmittingAssign(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/schedules`, {
      slot_id: targetSlotId,
      exam_id: targetExamId,
    });
    setSubmittingAssign(false);

    if (res.success) {
      toast('success', 'Ujian berhasil dijadwalkan');
      setShowAssignModal(false);
      setTargetExamId('');
      fetchData();
    } else {
      toast('error', res.error || 'Konflik jadwal terdeteksi! Gagal menjadwalkan.');
    }
  };

  const handleRunSolver = async () => {
    setRunningSolver(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/automation/timetable`, {
      max_exams_per_day: Number(solverMaxPerDay) || 2,
      clear_existing: solverClearExisting,
    });
    setRunningSolver(false);
    if (res.success) {
      toast(
        'success',
        `Solver selesai: ${res.data?.assigned_count || 0} ujian dijadwalkan, ${res.data?.skipped_count || 0} dilewati/terkunci.`
      );
      setShowSolverModal(false);
      fetchData();
    } else {
      toast('error', res.error || 'Gagal menjalankan solver penjadwalan');
    }
  };

  const handleToggleLockSchedule = async (schedule: SemesterSchedule) => {
    const nextLocked = !(schedule.is_locked === 1);
    const res = await POST<any>(`/api/semester/events/${event.id}/schedules/${schedule.id}/lock`, {
      is_locked: nextLocked,
    });
    if (res.success) {
      toast('success', nextLocked ? 'Jadwal ujian dikunci (pin)' : 'Kunci jadwal ujian dilepas');
      fetchData();
    } else {
      toast('error', res.error || 'Gagal mengubah status kunci jadwal');
    }
  };

  const handleDeleteSlot = async () => {
    if (!delSlotTarget) return;
    const res = await DEL<any>(`/api/semester/events/${event.id}/slots/${delSlotTarget.id}`);
    setDelSlotTarget(null);
    if (res.success) {
      toast('success', 'Sesi waktu berhasil dihapus');
      fetchData();
    } else {
      toast('error', res.error || 'Gagal menghapus sesi');
    }
  };

  const handleDeleteSchedule = async () => {
    if (!delScheduleTarget) return;
    const res = await DEL<any>(`/api/semester/events/${event.id}/schedules/${delScheduleTarget.id}`);
    setDelScheduleTarget(null);
    if (res.success) {
      toast('success', 'Jadwal ujian berhasil dilepaskan dari sesi');
      fetchData();
    } else {
      toast('error', res.error || 'Gagal melepaskan jadwal ujian');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  // Group schedules by slot_id
  const schedulesBySlot = schedules.reduce((acc, s) => {
    acc[s.slot_id] = acc[s.slot_id] || [];
    acc[s.slot_id].push(s);
    return acc;
  }, {} as Record<string, SemesterSchedule[]>);

  // Unscheduled exams
  const scheduledExamIds = new Set(schedules.map((s) => s.exam_id));
  const unscheduledExams = exams.filter((e) => !scheduledExamIds.has(e.id));

  return (
    <div className="space-y-4 text-xs">
      {/* Header Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            Penjadwalan Sesi Waktu (Time Slots)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Atur sesi pelaksanaan ujian semester dan pastikan tidak terjadi benturan jadwal siswa di slot yang sama.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isFrozen && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSolverModal(true)}
                disabled={slots.length === 0 || exams.length === 0}
                className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                Otomasi Penjadwalan
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAssignModal(true)}
                disabled={slots.length === 0 || unscheduledExams.length === 0}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Jadwalkan Manual
              </Button>

              <Button variant="primary" size="sm" onClick={() => setShowSlotModal(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Tambah Sesi Waktu
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Conflict Warning Alert */}
      {conflicts.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-rose-900 text-sm">
              Terdeteksi {conflicts.length} Konflik Jadwal Siswa!
            </h4>
            <p className="text-rose-700 mt-1">
              Beberapa siswa terdaftar pada lebih dari satu ujian di sesi waktu yang bersamaan. Ini merupakan hard blocker kesiapan (Readiness Gate).
            </p>
            <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto bg-white p-2.5 rounded border border-rose-200">
              {conflicts.map((c, idx) => (
                <div key={idx} className="text-[11px] text-gray-700 flex items-center justify-between">
                  <span>
                    <strong>{c.student_name}</strong> ({c.class_name}) · Ujian:{' '}
                    <code>{c.exam_1_title}</code> vs <code>{c.exam_2_title}</code>
                  </span>
                  <span className="font-bold text-rose-700">
                    {c.slot_label} ({c.slot_date} {c.time_window})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Status Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Sesi Terdaftar</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{slots.length} Sesi</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Ujian Terjadwal</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">
            {schedules.length} dari {exams.length} Ujian
          </p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Belum Dijadwalkan</p>
          <p className={`text-xl font-bold mt-1 ${unscheduledExams.length > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
            {unscheduledExams.length} Ujian
          </p>
        </div>
      </div>

      {/* Slots and Scheduled Exams */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : slots.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <EmptyState
            title="Belum Ada Sesi Waktu"
            desc="Buat sesi waktu pertama (misal: Tanggal pelaksanaan, Sesi 1 07:30 - 09:30) untuk mulai menjadwalkan ujian."
          />
          {!isFrozen && (
            <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowSlotModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Buat Sesi Waktu Sekarang
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {slots.map((slot) => {
            const slotSchedules = schedulesBySlot[slot.id] || [];
            return (
              <div
                key={slot.id}
                className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                  <div className="flex items-center gap-3">
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded">
                      {slot.slot_label}
                    </span>
                    <div>
                      <span className="font-bold text-gray-900 text-sm mr-2">{slot.slot_date}</span>
                      <span className="text-gray-500 font-mono text-xs">
                        {slot.start_time} - {slot.end_time} WIB
                      </span>
                    </div>
                  </div>

                  {!isFrozen && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTargetSlotId(slot.id);
                          setShowAssignModal(true);
                        }}
                        disabled={unscheduledExams.length === 0}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Tambah Ujian ke Sesi Ini
                      </Button>

                      <button
                        onClick={() => setDelSlotTarget(slot)}
                        className="p-1.5 text-red-500 hover:text-red-700 rounded hover:bg-red-50"
                        title="Hapus Sesi Waktu"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Exams inside this slot */}
                {slotSchedules.length === 0 ? (
                  <p className="text-gray-400 italic py-2">Belum ada ujian yang dijadwalkan pada sesi ini.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {slotSchedules.map((sc) => {
                      const examObj = exams.find((e) => e.id === sc.exam_id);
                      return (
                        <div
                          key={sc.id}
                          className={`border rounded-lg p-3 flex items-start justify-between gap-2 transition-colors ${
                            sc.is_locked ? 'bg-amber-50/60 border-amber-200' : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {examObj && (
                                <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-1.5 py-0.2 rounded">
                                  Kelas {examObj.target_grade}
                                </span>
                              )}
                              {sc.is_locked === 1 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                  <Lock className="w-2.5 h-2.5" /> Terkunci
                                </span>
                              )}
                            </div>
                            <h5 className="font-bold text-gray-900 text-xs mt-1">
                              {sc.exam_title || examObj?.title || 'Ujian'}
                            </h5>
                            {examObj && (
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                {examObj.subject_name} · {examObj.duration_minutes}m · {examObj.roster_count || 0} Siswa
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {!isFrozen && (
                              <button
                                onClick={() => handleToggleLockSchedule(sc)}
                                className={`p-1 rounded transition-colors ${
                                  sc.is_locked
                                    ? 'text-amber-700 hover:bg-amber-100'
                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                                }`}
                                title={
                                  sc.is_locked
                                    ? 'Jadwal terkunci (Pin) - Solver tidak akan memindahkan. Klik untuk membuka'
                                    : 'Kunci Jadwal (Pin) - Klik untuk mengunci'
                                }
                              >
                                {sc.is_locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                              </button>
                            )}

                            {!isFrozen && (
                              <button
                                onClick={() => setDelScheduleTarget(sc)}
                                className={`p-1 rounded transition-colors ${
                                  sc.is_locked
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                }`}
                                title={sc.is_locked ? 'Lepaskan kunci terlebih dahulu untuk menghapus' : 'Lepaskan Ujian dari Sesi'}
                                disabled={Boolean(sc.is_locked)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Slot Modal */}
      {showSlotModal && (
        <Modal open={true} title="Tambah Sesi Waktu (Time Slot)" onClose={() => setShowSlotModal(false)} size="sm">
          <form onSubmit={handleCreateSlot} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Label Sesi <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={slotLabel}
                onChange={(e) => setSlotLabel(e.target.value)}
                placeholder="misal: Sesi 1 / Sesi Pagi"
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Tanggal Pelaksanaan <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Waktu Mulai <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Waktu Selesai <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setShowSlotModal(false)} disabled={submittingSlot}>
                Batal
              </Button>
              <Button type="submit" variant="primary" loading={submittingSlot}>
                Simpan Sesi
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Assign Exam Modal */}
      {showAssignModal && (
        <Modal open={true} title="Jadwalkan Ujian ke Sesi Waktu" onClose={() => setShowAssignModal(false)} size="sm">
          <form onSubmit={handleAssignExam} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Pilih Sesi Waktu <span className="text-red-500">*</span>
              </label>
              <select
                value={targetSlotId}
                onChange={(e) => setTargetSlotId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              >
                <option value="">-- Pilih Sesi --</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.slot_label} ({s.slot_date} {s.start_time} - {s.end_time})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Pilih Ujian <span className="text-red-500">*</span>
              </label>
              <select
                value={targetExamId}
                onChange={(e) => setTargetExamId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              >
                <option value="">-- Pilih Ujian --</option>
                {unscheduledExams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    [Kelas {ex.target_grade}] {ex.title} ({ex.subject_name})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Sistem akan memvalidasi apakah siswa di kelas audiens ujian ini bertabrakan dengan ujian lain di sesi yang sama.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setShowAssignModal(false)} disabled={submittingAssign}>
                Batal
              </Button>
              <Button type="submit" variant="primary" loading={submittingAssign} disabled={!targetSlotId || !targetExamId}>
                Jadwalkan Sekarang
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Timetable Solver Modal */}
      {showSolverModal && (
        <Modal open={true} title="Otomasi Penjadwalan Ujian (Greedy MRV Solver)" onClose={() => setShowSolverModal(false)} size="md">
          <div className="space-y-4 text-xs">
            <p className="text-gray-600">
              Solver otomatis akan memetakan seluruh ujian ke slot waktu yang tersedia menggunakan algoritma <em>Greedy Minimum Remaining Values (MRV)</em> dengan pemenuhan constraint ketat:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-gray-500 text-[11px]">
              <li>Tidak ada siswa dalam rombel/kelas audiens yang bentrok waktu di slot yang sama.</li>
              <li>Beban ujian siswa per hari dibatasi sesuai batas maksimum.</li>
              <li>Jadwal yang <strong>terkunci (pinned)</strong> tidak akan dipindahkan oleh solver.</li>
            </ul>

            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[11px] text-amber-800">
              <strong>Peringatan Reschedule:</strong> Ujian yang dijadwalkan ulang oleh solver akan membatalkan (purge) token ujian yang belum terpakai demi keamanan sesi.
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Maksimal Ujian per Hari per Siswa
              </label>
              <input
                type="number"
                min="1"
                max="5"
                value={solverMaxPerDay}
                onChange={(e) => setSolverMaxPerDay(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="clearExisting"
                checked={solverClearExisting}
                onChange={(e) => setSolverClearExisting(e.target.checked)}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <label htmlFor="clearExisting" className="text-gray-700 font-medium">
                Bersihkan & susun ulang jadwal yang belum terkunci
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setShowSolverModal(false)} disabled={runningSolver}>
                Batal
              </Button>
              <Button type="button" variant="primary" loading={runningSolver} onClick={handleRunSolver}>
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                Jalankan Solver
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Slot Confirm */}
      {delSlotTarget && (
        <Confirm
          open={true}
          title="Hapus Sesi Waktu"
          message={`Yakin ingin menghapus sesi "${delSlotTarget.slot_label}"? Seluruh ujian yang dijadwalkan pada sesi ini akan dilepaskan.`}
          confirmText="Hapus Sesi"
          danger={true}
          onConfirm={handleDeleteSlot}
          onClose={() => setDelSlotTarget(null)}
        />
      )}

      {/* Delete Schedule Confirm */}
      {delScheduleTarget && (
        <Confirm
          open={true}
          title="Lepaskan Jadwal Ujian"
          message={`Yakin ingin melepaskan ujian "${delScheduleTarget.exam_title || 'Ujian'}" dari sesi ini?`}
          confirmText="Lepaskan Jadwal"
          danger={true}
          onConfirm={handleDeleteSchedule}
          onClose={() => setDelScheduleTarget(null)}
        />
      )}
    </div>
  );
}
