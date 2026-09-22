'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, useToast, Spinner, Badge } from '@/components/ui';
import {
  Grid,
  Users,
  Lock,
  Unlock,
  Wand2,
  Settings2,
  RefreshCw,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Search,
  UserCheck,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type {
  SemesterEvent,
  SemesterRoomLayout,
  SemesterSeat,
  SemesterSeatAssignment,
  SemesterParticipant,
} from './types';
import { SemesterRoomLayoutModal } from './SemesterRoomLayoutModal';

interface SemesterSeatingTabProps {
  event: SemesterEvent;
}

interface RoomOption {
  id: string;
  room_name: string;
  capacity: number;
}

export function SemesterSeatingTab({ event }: SemesterSeatingTabProps) {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [layout, setLayout] = useState<SemesterRoomLayout | null>(null);
  const [seats, setSeats] = useState<SemesterSeat[]>([]);
  const [assignments, setAssignments] = useState<SemesterSeatAssignment[]>([]);
  const [roomParticipants, setRoomParticipants] = useState<SemesterParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoDistributing, setAutoDistributing] = useState(false);
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [crossGradePairing, setCrossGradePairing] = useState(true);
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // Manual assign/swap state
  const [selectedSeatForSwap, setSelectedSeatForSwap] = useState<SemesterSeat | null>(null);
  const [swapTargetParticipantId, setSwapTargetParticipantId] = useState<string>('');
  const [allowSwap, setAllowSwap] = useState(true);
  const [assigningSeat, setAssigningSeat] = useState(false);

  // 1. Fetch available rooms
  const fetchRooms = useCallback(async () => {
    try {
      const res = await GET<RoomOption[]>(`/api/semester/events/${event.id}/rooms`);
      if (res.success && res.data) {
        setRooms(res.data);
        if (res.data.length > 0 && !selectedRoomId) {
          setSelectedRoomId(res.data[0].id);
        }
      }
    } catch {
      toast('error', 'Gagal memuat daftar ruangan');
    }
  }, [event.id, selectedRoomId, toast]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // 2. Fetch layout, seats, assignments for selected room
  const fetchRoomSeatingData = useCallback(async () => {
    if (!selectedRoomId) return;
    setLoading(true);
    try {
      const [layoutRes, seatsRes, assignRes, partRes] = await Promise.all([
        GET<SemesterRoomLayout>(`/api/semester/events/${event.id}/rooms/${selectedRoomId}/layout`),
        GET<SemesterSeat[]>(`/api/semester/events/${event.id}/rooms/${selectedRoomId}/seats`),
        GET<SemesterSeatAssignment[]>(`/api/semester/events/${event.id}/rooms/${selectedRoomId}/seating`),
        GET<{ items: SemesterParticipant[] }>(
          `/api/semester/events/${event.id}/participants?room_id=${selectedRoomId}&page_size=200`
        ),
      ]);

      if (layoutRes.success && layoutRes.data) setLayout(layoutRes.data);
      if (seatsRes.success && seatsRes.data) setSeats(seatsRes.data);
      if (assignRes.success && assignRes.data) setAssignments(assignRes.data);
      if (partRes.success && partRes.data?.items) setRoomParticipants(partRes.data.items);
    } catch {
      toast('error', 'Gagal memuat data tempat duduk ruangan');
    } finally {
      setLoading(false);
    }
  }, [event.id, selectedRoomId, toast]);

  useEffect(() => {
    fetchRoomSeatingData();
  }, [fetchRoomSeatingData]);

  // Auto Distribute Seats
  async function handleAutoDistribute() {
    setAutoDistributing(true);
    try {
      const res = await POST<{ message: string; totalAssigned: number; preservedLockedCount: number }>(
        `/api/semester/events/${event.id}/automation/seating`,
        {
          cross_grade_pairing: crossGradePairing,
          seed: seed ? Number(seed) : undefined,
          preserve_locked: true,
        }
      );

      if (res.success) {
        toast('success', res.data?.message || 'Distribusi kursi otomatis berhasil diselesaikan.');
        setAutoModalOpen(false);
        fetchRoomSeatingData();
      } else {
        toast('error', res.error || 'Gagal menjalankan distribusi kursi otomatis');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat otomasi tempat duduk');
    } finally {
      setAutoDistributing(false);
    }
  }

  // Toggle seat assignment lock
  async function handleToggleLock(assignmentId: string, currentLocked: number) {
    try {
      const nextLocked = currentLocked === 1 ? 0 : 1;
      const res = await POST<{ is_locked: number }>(
        `/api/semester/events/${event.id}/seating/${assignmentId}/lock`,
        { is_locked: nextLocked }
      );

      if (res.success) {
        toast('success', nextLocked === 1 ? 'Penetapan kursi dikunci.' : 'Kunci penetapan kursi dibuka.');
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignmentId ? { ...a, is_locked: nextLocked } : a))
        );
      } else {
        toast('error', res.error || 'Gagal mengubah kunci penetapan kursi');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat mengubah kunci');
    }
  }

  // Manual Assign / Swap Seat
  async function handleManualSeatSubmit() {
    if (!selectedSeatForSwap || !swapTargetParticipantId) return;

    setAssigningSeat(true);
    try {
      const res = await POST(`/api/semester/events/${event.id}/participants/${swapTargetParticipantId}/seat`, {
        seat_id: selectedSeatForSwap.id,
        swap: allowSwap,
      });

      if (res.success) {
        toast('success', 'Penetapan nomor kursi berhasil diperbarui.');
        setSelectedSeatForSwap(null);
        setSwapTargetParticipantId('');
        fetchRoomSeatingData();
      } else {
        toast('error', res.error || 'Gagal mengubah penetapan kursi');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat menyimpan perubahan kursi');
    } finally {
      setAssigningSeat(false);
    }
  }

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);
  const isDraft = event.status === 'draft' || event.status === 'configuration';
  const assignmentBySeatId = new Map<string, SemesterSeatAssignment>();
  for (const a of assignments) {
    assignmentBySeatId.set(a.seat_id, a);
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Grid className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Distribusi Denah & Nomor Kursi</h2>
            <p className="text-xs text-gray-500">
              Pengaturan tata letak fisik, penetapan tempat duduk silang-jenjang anti-menyontek, dan penguncian kursi.
            </p>
          </div>
        </div>

        {isDraft && (
          <div className="flex items-center gap-2.5 flex-wrap">
            {selectedRoom && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLayoutModalOpen(true)}
                className="flex items-center gap-1.5"
              >
                <Settings2 className="w-4 h-4 text-gray-500" />
                <span>Geometri Ruangan</span>
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              onClick={() => setAutoModalOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Wand2 className="w-4 h-4" />
              <span>Otomasi Distribusi Kursi</span>
            </Button>
          </div>
        )}
      </div>

      {/* Room Selector Strip */}
      {rooms.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-500 text-xs">
          Belum ada ruangan yang ditugaskan ke event semester ini. Tambahkan ruangan di tab Ruang terlebih dahulu.
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {rooms.map((room) => {
            const isSelected = room.id === selectedRoomId;
            return (
              <button
                key={room.id}
                onClick={() => setSelectedRoomId(room.id)}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>{room.room_name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {room.capacity} Kursi
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Room Seating Detail Panel */}
      {selectedRoom && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          {/* Subheader */}
          <div className="p-4 bg-gray-50/50 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-gray-800 text-sm">{selectedRoom.room_name}</span>
              <span className="text-gray-400">&bull;</span>
              <span className="text-gray-600">
                Kapasitas: <strong>{selectedRoom.capacity} Kursi</strong>
              </span>
              <span className="text-gray-400">&bull;</span>
              <span className="text-gray-600">
                Siswa di Ruangan: <strong>{roomParticipants.length} Siswa</strong>
              </span>
              <span className="text-gray-400">&bull;</span>
              <span className="text-gray-600">
                Terisi Kursi: <strong>{assignments.length} Siswa</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Badge color={layout?.layout_type === 'physical_configured' ? 'green' : 'yellow'}>
                {layout?.layout_type === 'physical_configured'
                  ? 'Geometri Fisik Terkonfigurasi'
                  : 'Fallback Logis (Otomatis)'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRoomSeatingData}
                disabled={loading}
                className="p-1.5"
                title="Muat Ulang"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Grid Area */}
          <div className="p-6">
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-500">
                <Spinner size={24} />
                <p className="text-xs">Memuat denah dan tempat duduk ruangan...</p>
              </div>
            ) : seats.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs">
                Belum ada kursi yang terdefinisi untuk ruangan ini. Klik Konfigurasi Geometri Ruangan untuk membuatnya.
              </div>
            ) : (
              <div className="flex flex-col items-center">
                {/* Visual Header */}
                {layout?.layout_type === 'physical_configured' ? (
                  <div className="w-full max-w-2xl h-8 bg-gray-200 border border-gray-300 rounded-lg mb-8 flex items-center justify-center text-xs font-semibold text-gray-600 uppercase tracking-widest shadow-2xs">
                    Papan Tulis / Meja Pengawas (Denah Fisik Terkonfigurasi)
                  </div>
                ) : (
                  <div className="w-full max-w-2xl p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg mb-6 flex items-center justify-center text-xs text-blue-700 font-medium">
                    Denah Logis Sekuensial (Tanpa Asumsi Kedekatan / Pasangan Meja Fisik)
                  </div>
                )}

                {/* Seat Cards Grid */}
                <div
                  className="grid gap-3 w-full overflow-x-auto p-2"
                  style={{
                    gridTemplateColumns:
                      layout?.layout_type === 'physical_configured'
                        ? `repeat(${layout?.cols_count || 4}, minmax(140px, 1fr))`
                        : 'repeat(auto-fill, minmax(140px, 1fr))',
                  }}
                >
                  {seats.map((seat) => {
                    const assignment = assignmentBySeatId.get(seat.id);
                    const isOccupied = !!assignment;
                    const isLocked = assignment?.is_locked === 1;

                    return (
                      <div
                        key={seat.id}
                        className={`min-h-[105px] p-3 rounded-lg border transition-all flex flex-col justify-between ${
                          isOccupied
                            ? isLocked
                              ? 'bg-amber-50/60 border-amber-300 shadow-2xs'
                              : 'bg-white border-gray-300 hover:border-emerald-400 shadow-2xs'
                            : 'bg-gray-50/70 border-dashed border-gray-300 text-gray-400'
                        }`}
                      >
                        {/* Card Top */}
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-gray-700">
                              {seat.seat_label}
                            </span>
                            {layout?.layout_type === 'physical_configured' && seat.desk_group && (
                              <span className="text-[9px] px-1 py-0.2 bg-gray-100 rounded text-gray-500 font-mono">
                                M-{seat.desk_group}
                              </span>
                            )}
                          </div>

                          {isOccupied && (
                            <button
                              onClick={() => handleToggleLock(assignment.id, assignment.is_locked)}
                              title={isLocked ? 'Buka Kunci Kursi' : 'Kunci Kursi (Tidak dapat diubah otomasi)'}
                              className={`p-1 rounded hover:bg-gray-200/60 transition-colors ${
                                isLocked ? 'text-amber-700' : 'text-gray-400 hover:text-gray-600'
                              }`}
                            >
                              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>

                        {/* Card Middle: Student Info */}
                        {isOccupied ? (
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-gray-900 line-clamp-1" title={assignment.participant_name}>
                              {assignment.participant_name}
                            </p>
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                              <span className="font-mono">{assignment.nomor_peserta || 'No-Num'}</span>
                              <span>&bull;</span>
                              <span
                                className={`px-1 py-0.2 rounded font-semibold text-[9px] ${
                                  assignment.grade === '10'
                                    ? 'bg-blue-100 text-blue-800'
                                    : assignment.grade === '11'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-purple-100 text-purple-800'
                                }`}
                              >
                                Kls {assignment.grade}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="py-2 text-center text-[10px] text-gray-400 italic">Kosong</div>
                        )}

                        {/* Card Bottom: Swap Action */}
                        {isDraft && (
                          <div className="mt-2 pt-1 border-t border-gray-100 flex items-center justify-end">
                            <button
                              onClick={() => {
                                setSelectedSeatForSwap(seat);
                                setSwapTargetParticipantId(assignment ? assignment.participant_id : '');
                              }}
                              className="text-[10px] text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1"
                            >
                              <ArrowLeftRight className="w-2.5 h-2.5" />
                              <span>{isOccupied ? 'Tukar / Pindah' : 'Tetapkan'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auto Seating Modal */}
      {autoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Wand2 className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Otomasi Distribusi Tempat Duduk</h3>
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
                Algoritma akan mendistribusikan seluruh siswa yang telah ditempatkan di ruangan ke nomor kursi
                secara optimal.
              </p>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={crossGradePairing}
                  onChange={(e) => setCrossGradePairing(e.target.checked)}
                  className="mt-0.5 accent-emerald-600"
                />
                <div>
                  <p className="font-semibold text-gray-800">Pasangan Silang Jenjang (Anti-Menyontek)</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Menempatkan siswa dari jenjang berbeda (misal: Kelas 10 &amp; Kelas 11/12) bersebelahan pada meja yang sama.
                  </p>
                </div>
              </label>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Seed Pengacakan (Opsional / Deterministik)
                </label>
                <input
                  type="number"
                  placeholder="Contoh: 12345 (kosongkan untuk acak baru)"
                  value={seed || ''}
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Kursi yang telah dikunci secara manual tidak akan diubah atau digeser oleh otomasi.</span>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2.5 bg-gray-50/50">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAutoModalOpen(false)}
                disabled={autoDistributing}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAutoDistribute}
                disabled={autoDistributing}
              >
                {autoDistributing ? <Spinner size={14} /> : 'Mulai Distribusi'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Assign / Swap Modal */}
      {selectedSeatForSwap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <ArrowLeftRight className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Tetapkan / Tukar Tempat Duduk</h3>
                  <p className="text-[11px] text-gray-500">
                    Kursi: <strong>{selectedSeatForSwap.seat_label}</strong> (Meja {selectedSeatForSwap.desk_group || '-'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSeatForSwap(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1.5">
                  Pilih Siswa di Ruangan Ini
                </label>
                <select
                  value={swapTargetParticipantId}
                  onChange={(e) => setSwapTargetParticipantId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                >
                  <option value="">-- Pilih Siswa --</option>
                  {roomParticipants.map((p) => {
                    const curAssign = assignments.find((a) => a.participant_id === p.id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.nama_lengkap} (Kelas {p.grade} - {p.class_name}){' '}
                        {curAssign ? `[Saat ini: ${curAssign.seat_label}]` : '[Belum ada kursi]'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSwap}
                  onChange={(e) => setAllowSwap(e.target.checked)}
                  className="accent-emerald-600"
                />
                <span className="text-gray-700 font-medium">
                  Tukar posisi otomatis jika kursi tujuan sudah terisi siswa lain
                </span>
              </label>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-[11px]">
                Penetapan kursi manual akan secara otomatis mengunci ruangan peserta agar tidak tergeser oleh otomasi.
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2.5 bg-gray-50/50">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedSeatForSwap(null)}
                disabled={assigningSeat}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleManualSeatSubmit}
                disabled={assigningSeat || !swapTargetParticipantId}
              >
                {assigningSeat ? <Spinner size={14} /> : 'Simpan Penempatan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Room Layout Configuration Modal */}
      {layoutModalOpen && selectedRoom && (
        <SemesterRoomLayoutModal
          eventId={event.id}
          room={selectedRoom}
          onClose={() => setLayoutModalOpen(false)}
          onSuccess={fetchRoomSeatingData}
        />
      )}
    </div>
  );
}
