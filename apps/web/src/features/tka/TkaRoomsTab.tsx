'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, Badge, EmptyState, useToast } from '@/components/ui';
import { Home, Users, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import type { TkaRoomItem, TkaParticipantItem, TkaEvent } from './types';

export function TkaRoomsTab({ event }: { event: TkaEvent }) {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<TkaRoomItem[]>([]);
  const [participants, setParticipants] = useState<TkaParticipantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [roomsRes, partsRes] = await Promise.all([
      GET<TkaRoomItem[]>(`/api/tka/events/${event.id}/rooms`),
      GET<TkaParticipantItem[]>(`/api/tka/events/${event.id}/participants`),
    ]);

    if (roomsRes.success && roomsRes.data) setRooms(roomsRes.data);
    if (partsRes.success && partsRes.data) setParticipants(partsRes.data);
    setLoading(false);
  }, [event.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAssignSingle = async (studentId: string, roomId: string | null) => {
    setSavingId(studentId);
    const res = await POST<any>(`/api/tka/events/${event.id}/rooms/assign`, {
      student_id: studentId,
      room_id: roomId || null,
    });
    setSavingId(null);

    if (res.success) {
      toast('success', 'Ruangan berhasil dialokasikan');
      fetchData();
    } else {
      toast('error', res.error || 'Gagal mengalokasikan ruangan');
    }
  };

  const handleBulkAssign = async () => {
    if (rooms.length === 0) {
      toast('error', 'Belum ada data ruangan');
      return;
    }

    setBulkAssigning(true);
    // Simple round-robin or sequential fill across available rooms
    const unassigned = participants.filter((p) => !p.room_id);
    const assignments: Array<{ student_id: string; room_id: string }> = [];

    let roomIdx = 0;
    for (const student of unassigned) {
      const room = rooms[roomIdx % rooms.length];
      assignments.push({ student_id: student.student_id, room_id: room.id });
      roomIdx++;
    }

    const res = await POST<any>(`/api/tka/events/${event.id}/rooms/bulk-assign`, { assignments });
    setBulkAssigning(false);

    if (res.success) {
      toast('success', res.message || 'Alokasi ruangan massal berhasil');
      fetchData();
    } else {
      toast('error', res.error || 'Gagal alokasi ruangan massal');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  const unassignedCount = participants.filter((p) => !p.room_id).length;
  const assignedCount = participants.length - unassignedCount;

  return (
    <div className="space-y-6 text-xs">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Home className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-[11px] uppercase tracking-wider">Ruangan Tersedia</span>
          </div>
          <div className="text-xl font-bold text-gray-900">{rooms.length} Ruang</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-[11px] uppercase tracking-wider">Siswa Teralokasi</span>
          </div>
          <div className="text-xl font-bold text-emerald-700">{assignedCount} Siswa</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-[11px] uppercase tracking-wider">Belum Ada Ruang</span>
          </div>
          <div className="text-xl font-bold text-amber-600">{unassignedCount} Siswa</div>
        </div>
      </div>

      {/* Bulk Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200">
        <div>
          <h3 className="font-bold text-gray-900 text-xs">Alokasi Ruangan Peserta TKA</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Setiap peserta wajib memiliki ruangan sebelum event dapat ditandai Siap. Mengubah ruangan peserta akan memperbarui seluruh 5 roster ujiannya.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unassignedCount > 0 && !isFrozen && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleBulkAssign}
              disabled={bulkAssigning || rooms.length === 0}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              {bulkAssigning ? 'Mengalokasikan...' : `Alokasikan ${unassignedCount} Siswa ke Ruangan`}
            </Button>
          )}
        </div>
      </div>

      {/* Participants Room Table */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : participants.length === 0 ? (
        <EmptyState
          title="Belum Ada Peserta"
          desc="Ambil snapshot peserta terlebih dahulu pada tab Peserta."
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">No</th>
                  <th className="py-2.5 px-3">Nama Siswa & NISN</th>
                  <th className="py-2.5 px-3">Kelas</th>
                  <th className="py-2.5 px-3">Ruangan Ujian Saat Ini</th>
                  <th className="py-2.5 px-3">Ubah Ruangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {participants.map((p, idx) => {
                  const currentRoom = rooms.find((r) => r.id === p.room_id);
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-2.5 px-3 text-gray-400">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-gray-900">{p.nama_lengkap}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{p.nisn || '-'}</div>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-gray-700">{p.class_name || '-'}</td>
                      <td className="py-2.5 px-3">
                        {currentRoom ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            {currentRoom.room_name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            Belum Ada Ruang
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={p.room_id || ''}
                          onChange={(e) => handleAssignSingle(p.student_id, e.target.value || null)}
                          disabled={savingId === p.student_id || isFrozen}
                          className="border border-gray-300 rounded px-2.5 py-1 text-xs focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="">-- Pilih Ruang --</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.room_name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
