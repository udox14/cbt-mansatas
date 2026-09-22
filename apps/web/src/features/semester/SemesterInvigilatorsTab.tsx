'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL, PUT } from '@/lib/api';
import { Button, useToast, Spinner, Badge } from '@/components/ui';
import {
  Shield,
  Users,
  Calendar,
  Lock,
  Unlock,
  Wand2,
  RefreshCw,
  Plus,
  Trash2,
  AlertTriangle,
  Clock,
  UserCheck,
  Ban,
  CheckCircle2,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type {
  SemesterEvent,
  SemesterInvigilatorPoolEntry,
  SemesterStaffBlackout,
  SemesterInvigilatorAssignment,
  SemesterSlot,
} from './types';

interface SemesterInvigilatorsTabProps {
  event: SemesterEvent;
}

type InvigilatorSubTab = 'roster' | 'pool' | 'blackouts';

export function SemesterInvigilatorsTab({ event }: SemesterInvigilatorsTabProps) {
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<InvigilatorSubTab>('roster');
  const [loading, setLoading] = useState(true);

  // Data states
  const [pool, setPool] = useState<SemesterInvigilatorPoolEntry[]>([]);
  const [blackouts, setBlackouts] = useState<SemesterStaffBlackout[]>([]);
  const [assignments, setAssignments] = useState<SemesterInvigilatorAssignment[]>([]);
  const [slots, setSlots] = useState<SemesterSlot[]>([]);

  // Action states
  const [syncingPool, setSyncingPool] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [blackoutModalOpen, setBlackoutModalOpen] = useState(false);

  // Auto assign configuration
  const [maxSessionsPerDay, setMaxSessionsPerDay] = useState(3);
  const [balanceWorkload, setBalanceWorkload] = useState(true);

  // Blackout form
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [blackoutDate, setBlackoutDate] = useState('');
  const [blackoutReason, setBlackoutReason] = useState('');
  const [addingBlackout, setAddingBlackout] = useState(false);

  const isDraft = event.status === 'draft' || event.status === 'configuration';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poolRes, blackoutsRes, assignRes, slotsRes] = await Promise.all([
        GET<SemesterInvigilatorPoolEntry[]>(`/api/semester/events/${event.id}/invigilators/pool`),
        GET<SemesterStaffBlackout[]>(`/api/semester/events/${event.id}/invigilators/blackouts`),
        GET<SemesterInvigilatorAssignment[]>(`/api/semester/events/${event.id}/invigilators/assignments`),
        GET<SemesterSlot[]>(`/api/semester/events/${event.id}/slots`),
      ]);

      if (poolRes.success && poolRes.data) setPool(poolRes.data);
      if (blackoutsRes.success && blackoutsRes.data) setBlackouts(blackoutsRes.data);
      if (assignRes.success && assignRes.data) setAssignments(assignRes.data);
      if (slotsRes.success && slotsRes.data) setSlots(slotsRes.data);
    } catch {
      toast('error', 'Gagal memuat data pengawas');
    } finally {
      setLoading(false);
    }
  }, [event.id, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync staff pool
  async function handleSyncPool() {
    setSyncingPool(true);
    try {
      const res = await POST<{ addedCount: number }>(
        `/api/semester/events/${event.id}/invigilators/pool/sync`,
        {}
      );
      if (res.success) {
        toast('success', res.message || 'Sinkronisasi pool pengawas selesai.');
        fetchData();
      } else {
        toast('error', res.error || 'Gagal sinkronisasi pool staf');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat sinkronisasi pool');
    } finally {
      setSyncingPool(false);
    }
  }

  // Toggle staff eligibility
  async function handleToggleEligibility(staffId: string, currentEligible: number) {
    try {
      const nextEligible = currentEligible === 1 ? false : true;
      const res = await PUT(`/api/semester/events/${event.id}/invigilators/pool/${staffId}`, {
        is_eligible: nextEligible,
      });

      if (res.success) {
        toast('success', nextEligible ? 'Staf diaktifkan sebagai pengawas.' : 'Staf dinonaktifkan dari pengawasan.');
        setPool((prev) =>
          prev.map((p) => (p.staff_id === staffId ? { ...p, is_eligible: nextEligible ? 1 : 0 } : p))
        );
      } else {
        toast('error', res.error || 'Gagal mengubah status kelayakan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat mengubah status kelayakan');
    }
  }

  // Toggle assignment lock
  async function handleToggleAssignmentLock(assignmentId: string, currentLocked: number) {
    try {
      const nextLocked = currentLocked === 1 ? 0 : 1;
      const res = await POST<{ is_locked: number }>(
        `/api/semester/events/${event.id}/invigilators/assignments/${assignmentId}/lock`,
        { is_locked: nextLocked }
      );

      if (res.success) {
        toast('success', nextLocked === 1 ? 'Penugasan pengawas dikunci.' : 'Kunci penugasan dibuka.');
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignmentId ? { ...a, is_locked: nextLocked } : a))
        );
      } else {
        toast('error', res.error || 'Gagal mengubah kunci penugasan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat mengubah kunci penugasan');
    }
  }

  // Auto assign invigilators
  async function handleAutoAssign() {
    setAutoAssigning(true);
    try {
      const res = await POST<{ message: string; totalAssigned: number }>(
        `/api/semester/events/${event.id}/automation/invigilators`,
        {
          max_sessions_per_day: maxSessionsPerDay,
          balance_workload: balanceWorkload,
          preserve_locked: true,
        }
      );

      if (res.success) {
        toast('success', res.data?.message || 'Penugasan pengawas otomatis berhasil.');
        setAutoModalOpen(false);
        fetchData();
      } else {
        toast('error', res.error || 'Gagal menjalankan penugasan pengawas otomatis');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat penugasan otomatis');
    } finally {
      setAutoAssigning(false);
    }
  }

  // Add staff blackout
  async function handleAddBlackout() {
    if (!selectedStaffId) {
      toast('error', 'Pilih staf terlebih dahulu.');
      return;
    }
    if (!selectedSlotId && !blackoutDate) {
      toast('error', 'Pilih sesi waktu spesifik ATAU masukkan tanggal blackout.');
      return;
    }

    setAddingBlackout(true);
    try {
      const res = await POST(`/api/semester/events/${event.id}/invigilators/blackouts`, {
        staff_id: selectedStaffId,
        slot_id: selectedSlotId || null,
        blackout_date: blackoutDate || null,
        reason: blackoutReason || null,
      });

      if (res.success) {
        toast('success', 'Batasan blackout berhasil ditambahkan.');
        setBlackoutModalOpen(false);
        setSelectedStaffId('');
        setSelectedSlotId('');
        setBlackoutDate('');
        setBlackoutReason('');
        fetchData();
      } else {
        toast('error', res.error || 'Gagal menambahkan blackout');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat menyimpan blackout');
    } finally {
      setAddingBlackout(false);
    }
  }

  // Remove staff blackout
  async function handleRemoveBlackout(blackoutId: string) {
    if (!confirm('Hapus batasan blackout ini?')) return;
    try {
      const res = await DEL(`/api/semester/events/${event.id}/invigilators/blackouts/${blackoutId}`);
      if (res.success) {
        toast('success', 'Batasan blackout dihapus.');
        setBlackouts((prev) => prev.filter((b) => b.id !== blackoutId));
      } else {
        toast('error', res.error || 'Gagal menghapus blackout');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat menghapus blackout');
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Manajemen & Penugasan Pengawas Ruangan</h2>
            <p className="text-xs text-gray-500">
              Pengelolaan pool pengawas, batasan berhalangan (blackout), penyeimbangan beban kerja, dan penetapan jadwal bertugas.
            </p>
          </div>
        </div>

        {isDraft && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSyncPool}
              disabled={syncingPool}
              className="flex items-center gap-1.5"
            >
              {syncingPool ? <Spinner size={14} /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Sinkron Staf</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBlackoutModalOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Blackout</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setAutoModalOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Wand2 className="w-4 h-4" />
              <span>Otomasi Penugasan</span>
            </Button>
          </div>
        )}
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setActiveSubTab('roster')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
            activeSubTab === 'roster'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Jadwal Penugasan ({assignments.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('pool')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
            activeSubTab === 'pool'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Pool Staf Pengawas ({pool.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('blackouts')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
            activeSubTab === 'blackouts'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Ban className="w-4 h-4" />
          <span>Batasan Blackout ({blackouts.length})</span>
        </button>
      </div>

      {/* Tab Contents */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-gray-500">
          <Spinner size={24} />
          <p className="text-xs">Memuat data pengawas...</p>
        </div>
      ) : activeSubTab === 'roster' ? (
        /* Roster View */
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          {assignments.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-xs">
              Belum ada pengawas yang ditugaskan ke jadwal ujian. Klik tombol Otomasi Penugasan untuk menugaskan pengawas ke seluruh ruangan operasional.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-600 font-semibold">
                    <th className="py-3 px-4">Tanggal &amp; Sesi</th>
                    <th className="py-3 px-4">Ruangan</th>
                    <th className="py-3 px-4">Urutan</th>
                    <th className="py-3 px-4">Nama Pengawas</th>
                    <th className="py-3 px-4 text-center">Kunci</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignments.map((asgn) => {
                    const isLocked = asgn.is_locked === 1;
                    return (
                      <tr key={asgn.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-gray-900">{asgn.slot_label}</p>
                          <p className="text-[11px] text-gray-400">
                            {asgn.slot_date} &bull; {asgn.start_time} - {asgn.end_time} WIB
                          </p>
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-800">{asgn.room_name}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              asgn.invigilator_order === 1
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-purple-50 text-purple-700'
                            }`}
                          >
                            Pengawas {asgn.invigilator_order}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-900">{asgn.staff_name}</td>
                        <td className="py-3 px-4 text-center">
                          {isDraft && (
                            <button
                              onClick={() => handleToggleAssignmentLock(asgn.id, asgn.is_locked)}
                              title={isLocked ? 'Buka Kunci Penugasan' : 'Kunci Penugasan (Tidak akan diubah otomasi)'}
                              className={`p-1.5 rounded-lg border transition-all ${
                                isLocked
                                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                                  : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'
                              }`}
                            >
                              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeSubTab === 'pool' ? (
        /* Pool View */
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          {pool.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-xs">
              Pool pengawas kosong. Klik tombol Sinkron Staf untuk mendaftarkan staf aktif ke pool pengawas event ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-600 font-semibold">
                    <th className="py-3 px-4">Nama Staf</th>
                    <th className="py-3 px-4">NIP / Identitas</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4 text-center">Total Sesi Bertugas</th>
                    <th className="py-3 px-4 text-center">Status Kelayakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pool.map((entry) => {
                    const isEligible = entry.is_eligible === 1;
                    return (
                      <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-semibold text-gray-900">{entry.staff_name}</td>
                        <td className="py-3 px-4 font-mono text-gray-500">{entry.nip || '-'}</td>
                        <td className="py-3 px-4 text-gray-500">{entry.email || '-'}</td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono font-bold text-gray-800">
                            {entry.assigned_count || 0} Sesi
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isDraft ? (
                            <button
                              onClick={() => handleToggleEligibility(entry.staff_id, entry.is_eligible)}
                              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                                isEligible
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {isEligible ? 'Layak Bertugas' : 'Dikecualikan'}
                            </button>
                          ) : (
                            <Badge color={isEligible ? 'green' : 'yellow'}>
                              {isEligible ? 'Layak' : 'Dikecualikan'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Blackouts View */
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          {blackouts.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-xs">
              Belum ada batasan blackout staf yang dicatat.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-600 font-semibold">
                    <th className="py-3 px-4">Nama Staf</th>
                    <th className="py-3 px-4">Sesi Waktu</th>
                    <th className="py-3 px-4">Tanggal Blackout</th>
                    <th className="py-3 px-4">Alasan</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {blackouts.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-gray-900">{b.staff_name}</td>
                      <td className="py-3 px-4 font-mono text-gray-700">{b.slot_label || 'Semua Sesi Hari Tersebut'}</td>
                      <td className="py-3 px-4 font-mono text-gray-700">{b.blackout_date || '-'}</td>
                      <td className="py-3 px-4 text-gray-500">{b.reason || '-'}</td>
                      <td className="py-3 px-4 text-right">
                        {isDraft && (
                          <button
                            onClick={() => handleRemoveBlackout(b.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="Hapus Batasan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Auto Assign Modal */}
      {autoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Wand2 className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Otomasi Penugasan Pengawas</h3>
              </div>
              <button
                onClick={() => setAutoModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-gray-600 leading-relaxed">
                Algoritma solver akan menugaskan pengawas dari pool staf aktif ke setiap ruangan dan sesi yang operasional.
              </p>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Maksimal Sesi Bertugas per Hari per Staf
                </label>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={maxSessionsPerDay}
                  onChange={(e) => setMaxSessionsPerDay(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                />
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={balanceWorkload}
                  onChange={(e) => setBalanceWorkload(e.target.checked)}
                  className="mt-0.5 accent-emerald-600"
                />
                <div>
                  <p className="font-semibold text-gray-800">Penyeimbangan Beban Kerja (Load Balancing)</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Mendistribusikan total sesi penugasan secara merata di antara staf yang memenuhi syarat.
                  </p>
                </div>
              </label>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] space-y-1">
                <p className="font-semibold">Aturan Keras yang Selalu Diterapkan:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Batasan blackout staf (tanggal/sesi) tidak akan pernah dilanggar.</li>
                  <li>Satu pengawas tidak dapat ditugaskan ke dua ruangan pada sesi yang sama.</li>
                  <li>Penugasan yang berstatus terkunci (locked) akan tetap dipertahankan.</li>
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2.5 bg-gray-50/50">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAutoModalOpen(false)}
                disabled={autoAssigning}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAutoAssign}
                disabled={autoAssigning}
              >
                {autoAssigning ? <Spinner size={14} /> : 'Mulai Penugasan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Blackout Modal */}
      {blackoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-50 text-red-700 flex items-center justify-center">
                  <Ban className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Tambah Batasan Berhalangan (Blackout)</h3>
              </div>
              <button
                onClick={() => setBlackoutModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Pilih Staf Pengawas
                </label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                >
                  <option value="">-- Pilih Staf --</option>
                  {pool.map((p) => (
                    <option key={p.staff_id} value={p.staff_id}>
                      {p.staff_name} {p.nip ? `(${p.nip})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Sesi Waktu Tertentu (Opsional)
                </label>
                <select
                  value={selectedSlotId}
                  onChange={(e) => {
                    setSelectedSlotId(e.target.value);
                    if (e.target.value) setBlackoutDate('');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                >
                  <option value="">-- Tidak Spesifik ke Sesi (Pilih Tanggal di Bawah) --</option>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.slot_label} &bull; {s.slot_date} ({s.start_time} - {s.end_time} WIB)
                    </option>
                  ))}
                </select>
              </div>

              {!selectedSlotId && (
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Atau Tanggal Penuh Berhalangan (YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    value={blackoutDate}
                    onChange={(e) => setBlackoutDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Alasan Berhalangan (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Tugas Dinas Luar / Cuti Sakit"
                  value={blackoutReason}
                  onChange={(e) => setBlackoutReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2.5 bg-gray-50/50">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setBlackoutModalOpen(false)}
                disabled={addingBlackout}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddBlackout}
                disabled={addingBlackout || !selectedStaffId || (!selectedSlotId && !blackoutDate)}
              >
                {addingBlackout ? <Spinner size={14} /> : 'Simpan Batasan'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
