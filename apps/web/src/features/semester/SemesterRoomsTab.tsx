'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, Badge, Modal, useToast, EmptyState } from '@/components/ui';
import { Home, Users, Plus, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import type { SemesterEvent, SemesterParticipant } from './types';

interface SemesterRoomsTabProps {
  event: SemesterEvent;
}

interface RoomItem {
  id: string;
  room_name: string;
  capacity: number;
  event_id?: string | null;
}

export function SemesterRoomsTab({ event }: SemesterRoomsTabProps) {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [participants, setParticipants] = useState<SemesterParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Room Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [capacity, setCapacity] = useState(40);
  const [isGlobal, setIsGlobal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [roomsRes, partsRes] = await Promise.all([
        GET<RoomItem[]>(`/api/semester/events/${event.id}/rooms`),
        GET<{ participants: SemesterParticipant[]; total: number }>(
          `/api/semester/events/${event.id}/participants?page=1&page_size=2000`
        ),
      ]);

      if (roomsRes.success && roomsRes.data) setRooms(roomsRes.data);
      if (partsRes.success && partsRes.data) {
        setParticipants(partsRes.data.participants || []);
      }
    } catch {
      toast('error', 'Gagal memuat data ruangan');
    } finally {
      setLoading(false);
    }
  }, [event.id, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      toast('error', 'Nama ruangan wajib diisi');
      return;
    }

    setSubmitting(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/rooms`, {
      room_name: roomName.trim(),
      capacity: Number(capacity) || 40,
      is_global: isGlobal,
    });
    setSubmitting(false);

    if (res.success) {
      toast('success', 'Ruangan berhasil ditambahkan');
      setShowAddModal(false);
      setRoomName('');
      setCapacity(40);
      fetchData();
    } else {
      toast('error', res.error || 'Gagal menambahkan ruangan');
    }
  };

  // Group participants by room_id
  const roomParticipantCounts = participants.reduce((acc, p) => {
    if (p.room_id) {
      acc[p.room_id] = (acc[p.room_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const unassignedCount = participants.filter((p) => !p.room_id).length;
  const assignedCount = participants.length - unassignedCount;
  const totalCapacity = rooms.reduce((sum, r) => sum + (r.capacity || 40), 0);

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  return (
    <div className="space-y-4 text-xs">
      {/* Top Header Card */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <Home className="w-4 h-4 text-emerald-600" />
            Manajemen Ruangan Ujian Semester
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Kelola kapasitas ruangan dan pantau kuota alokasi siswa per ruangan secara real-time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isFrozen && (
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Tambah Ruangan
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Total Ruangan</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{rooms.length} Ruang</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Kapasitas Total: {totalCapacity} Kursi</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Siswa Teralokasi</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{assignedCount} Siswa</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Dari total {participants.length} peserta</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Belum Punya Ruangan</p>
          <p className={`text-xl font-bold mt-1 ${unassignedCount > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
            {unassignedCount} Siswa
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">Harus dialokasikan sebelum Ready</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold text-gray-400 uppercase">Kesesuaian Kapasitas</p>
          {rooms.some((r) => (roomParticipantCounts[r.id] || 0) > (r.capacity || 40)) ? (
            <div>
              <p className="text-xl font-bold text-red-600 mt-1">Overcapacity!</p>
              <p className="text-[11px] text-red-500 mt-0.5">Ada ruangan melebihi batas</p>
            </div>
          ) : (
            <div>
              <p className="text-xl font-bold text-emerald-700 mt-1">Aman</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Tidak ada kelebihan kuota</p>
            </div>
          )}
        </div>
      </div>

      {/* Rooms Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 flex justify-center">
            <Spinner size={24} />
          </div>
        ) : rooms.length === 0 ? (
          <div className="p-8 text-center">
            <EmptyState
              title="Belum Ada Ruangan Ujian"
              desc="Tambahkan ruangan ujian terlebih dahulu untuk mengalokasikan tempat duduk siswa."
            />
            {!isFrozen && (
              <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Tambah Ruangan Sekarang
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="p-3">Nama Ruangan</th>
                  <th className="p-3">Kapasitas Maksimal</th>
                  <th className="p-3">Jumlah Siswa Terisi</th>
                  <th className="p-3">Tingkat Keterisian</th>
                  <th className="p-3">Status Kesiapan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {rooms.map((r) => {
                  const assigned = roomParticipantCounts[r.id] || 0;
                  const cap = r.capacity || 40;
                  const isOver = assigned > cap;
                  const percentage = Math.min(100, Math.round((assigned / cap) * 100));

                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="p-3 font-bold text-gray-900 flex items-center gap-2">
                        <Home className="w-4 h-4 text-gray-400" />
                        {r.room_name}
                        {r.event_id == null && (
                          <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">
                            Global
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-medium">{cap} Kursi</td>
                      <td className="p-3 font-bold">
                        <span className={isOver ? 'text-red-600' : 'text-gray-900'}>
                          {assigned} Siswa
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="w-36">
                          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                            <span>{percentage}%</span>
                            <span>{assigned}/{cap}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full ${
                                isOver
                                  ? 'bg-red-500'
                                  : percentage >= 90
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {isOver ? (
                          <span className="inline-flex items-center gap-1 text-red-700 font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded text-[10px]">
                            <ShieldAlert className="w-3 h-3 text-red-600" />
                            Overcapacity (+{assigned - cap})
                          </span>
                        ) : assigned === 0 ? (
                          <span className="text-gray-400 font-medium">Kosong</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Optimal
                          </span>
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

      {/* Add Room Modal */}
      {showAddModal && (
        <Modal open={true} title="Tambah Ruangan Ujian" onClose={() => setShowAddModal(false)} size="sm">
          <form onSubmit={handleAddRoom} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Nama Ruangan <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="misal: Lab Komputer 1 / Ruang 01"
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Kapasitas Maksimal Siswa <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="200"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
                required
              />
              <p className="text-[11px] text-gray-400 mt-0.5">
                Batas maksimal alokasi siswa sebelum memicu validasi overcapacity.
              </p>
            </div>

            <div className="bg-gray-50 p-2.5 rounded border border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={isGlobal}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Jadikan Ruangan Global (dapat dipakai event lain)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} disabled={submitting}>
                Batal
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                Simpan Ruangan
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
