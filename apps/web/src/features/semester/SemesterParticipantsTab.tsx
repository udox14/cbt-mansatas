'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, Badge, Modal, useToast, EmptyState } from '@/components/ui';
import { Users, RefreshCw, Search, Filter, Hash, Home, CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SemesterEvent, SemesterParticipant } from './types';

interface SemesterParticipantsTabProps {
  event: SemesterEvent;
}

export function SemesterParticipantsTab({ event }: SemesterParticipantsTabProps) {
  const { toast } = useToast();
  const [participants, setParticipants] = useState<SemesterParticipant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [rooms, setRooms] = useState<any[]>([]);

  // Modals
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [selectedGrades, setSelectedGrades] = useState<string[]>(['10', '11', '12']);
  const [showNumberModal, setShowNumberModal] = useState(false);
  const [prefixNumber, setPrefixNumber] = useState('SEM');
  const [generatingNumbers, setGeneratingNumbers] = useState(false);

  // Selection for bulk room assignment
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkRoomModal, setShowBulkRoomModal] = useState(false);
  const [targetRoomId, setTargetRoomId] = useState<string>('');
  const [assigningRooms, setAssigningRooms] = useState(false);

  const fetchRooms = useCallback(async () => {
    const res = await GET<any[]>(`/api/semester/events/${event.id}/rooms`);
    if (res.success && res.data) {
      setRooms(res.data);
    }
  }, [event.id]);

  const fetchParticipants = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('page_size', pageSize.toString());
    if (gradeFilter !== 'all') params.append('grade', gradeFilter);
    if (roomFilter !== 'all') params.append('room_id', roomFilter);
    if (searchQuery.trim()) params.append('q', searchQuery.trim());

    const res = await GET<{
      participants: SemesterParticipant[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/api/semester/events/${event.id}/participants?${params.toString()}`);

    if (res.success && res.data) {
      setParticipants(res.data.participants || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.totalPages || 1);
    } else {
      toast('error', res.error || 'Gagal memuat peserta semester');
    }
    setLoading(false);
  }, [event.id, gradeFilter, roomFilter, searchQuery, page, pageSize, toast]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  const handleSnapshot = async () => {
    if (selectedGrades.length === 0) {
      toast('error', 'Pilih minimal satu tingkat kelas untuk snapshot');
      return;
    }
    setSyncing(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/participants/snapshot`, {
      grades: selectedGrades,
    });
    setSyncing(false);
    setShowSnapshotModal(false);

    if (res.success) {
      toast(
        'success',
        `Snapshot berhasil: ${res.data?.added || 0} baru, ${res.data?.updated || 0} diperbarui, total ${res.data?.total || 0} peserta.`
      );
      setPage(1);
      fetchParticipants();
    } else {
      toast('error', res.error || 'Gagal melakukan snapshot peserta dari Mansatas');
    }
  };

  const handleGenerateNumbers = async () => {
    setGeneratingNumbers(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/participants/generate-numbers`, {
      prefix: prefixNumber.trim().toUpperCase() || 'SEM',
    });
    setGeneratingNumbers(false);
    setShowNumberModal(false);

    if (res.success) {
      toast('success', `Berhasil meng-generate ${res.data?.totalNumbered || 0} nomor peserta`);
      fetchParticipants();
    } else {
      toast('error', res.error || 'Gagal meng-generate nomor peserta');
    }
  };

  const handleBulkRoomAssign = async () => {
    if (selectedIds.length === 0) return;
    setAssigningRooms(true);
    const assignments = selectedIds.map((id) => ({
      participant_id: id,
      room_id: targetRoomId === 'none' || !targetRoomId ? null : targetRoomId,
    }));

    const res = await POST<any>(`/api/semester/events/${event.id}/participants/rooms`, {
      assignments,
    });
    setAssigningRooms(false);
    setShowBulkRoomModal(false);

    if (res.success) {
      toast('success', `${res.data?.updatedCount || 0} peserta berhasil diperbarui ruangannya`);
      setSelectedIds([]);
      fetchParticipants();
    } else {
      toast('error', res.error || 'Gagal menetapkan ruangan peserta');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === participants.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(participants.map((p) => p.id));
    }
  };

  const toggleSelectId = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  return (
    <div className="space-y-4">
      {/* Action Header Card */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            Daftar Peserta Semester (Total: {total} Siswa)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Data peserta tersinkronisasi dari master Mansatas (Kelas 10, 11, dan 12).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isFrozen && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowNumberModal(true)}
                disabled={participants.length === 0}
              >
                <Hash className="w-3.5 h-3.5 mr-1" />
                Generate No. Peserta
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowBulkRoomModal(true)}
                disabled={selectedIds.length === 0}
              >
                <Home className="w-3.5 h-3.5 mr-1" />
                Tetapkan Ruangan ({selectedIds.length})
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowSnapshotModal(true)}
                disabled={syncing}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                Tarik / Resync Siswa
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Cari Nama, NISN, atau No. Peserta..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full border-none p-0 text-xs focus:ring-0 text-gray-800 placeholder-gray-400"
          />
        </div>

        <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <span className="font-semibold text-gray-600">Tingkat:</span>
          <select
            value={gradeFilter}
            onChange={(e) => {
              setGradeFilter(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value="all">Semua Tingkat</option>
            <option value="10">Kelas 10</option>
            <option value="11">Kelas 11</option>
            <option value="12">Kelas 12</option>
          </select>
        </div>

        <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
          <span className="font-semibold text-gray-600">Ruangan:</span>
          <select
            value={roomFilter}
            onChange={(e) => {
              setRoomFilter(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value="all">Semua Ruangan</option>
            <option value="unassigned">Belum Ditentukan</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.room_name}
              </option>
            ))}
          </select>
        </div>

        <Button variant="secondary" size="sm" onClick={() => fetchParticipants()} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Participants Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 flex justify-center">
            <Spinner size={24} />
          </div>
        ) : participants.length === 0 ? (
          <div className="p-8 text-center">
            <EmptyState
              title="Belum Ada Data Peserta"
              desc="Lakukan penarikan data peserta dari Mansatas untuk kelas 10, 11, dan 12."
            />
            {!isFrozen && (
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => setShowSnapshotModal(true)}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Tarik Siswa Sekarang
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px] font-bold tracking-wider">
                  <tr>
                    <th className="p-3 w-8 text-center">
                      <button onClick={toggleSelectAll} className="text-gray-500 hover:text-gray-700">
                        {selectedIds.length === participants.length && participants.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="p-3">No. Peserta</th>
                    <th className="p-3">Nama Lengkap</th>
                    <th className="p-3">NISN / NIS</th>
                    <th className="p-3">Tingkat & Kelas</th>
                    <th className="p-3">Ruangan Ujian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {participants.map((p) => {
                    const isSelected = selectedIds.includes(p.id);
                    return (
                      <tr key={p.id} className={`hover:bg-gray-50 ${isSelected ? 'bg-emerald-50/40' : ''}`}>
                        <td className="p-3 text-center">
                          <button onClick={() => toggleSelectId(p.id)} className="text-gray-500 hover:text-gray-700">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="p-3 font-mono font-bold text-gray-900">
                          {p.nomor_peserta ? (
                            <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-[11px]">
                              {p.nomor_peserta}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic text-[11px]">-</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-gray-900">{p.nama_lengkap}</td>
                        <td className="p-3 text-gray-500 font-mono">
                          {p.nisn || p.nis_lokal || '-'}
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1">
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                              Kls {p.grade}
                            </span>
                            <span className="text-gray-700 font-medium">{p.class_name}</span>
                          </span>
                        </td>
                        <td className="p-3">
                          {p.room_name ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                              <Home className="w-3 h-3" />
                              {p.room_name}
                            </span>
                          ) : (
                            <span className="text-amber-600 font-medium bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px]">
                              Belum Ditetapkan
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
              <div>
                Halaman {page} dari {totalPages} ({total} total siswa)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                  Sebelumnya
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Selanjutnya
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Snapshot Modal */}
      {showSnapshotModal && (
        <Modal open={true} title="Tarik & Sinkronkan Siswa dari Mansatas" onClose={() => setShowSnapshotModal(false)} size="sm">
          <div className="space-y-3 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Pilih tingkat kelas yang akan diambil dari database Mansatas untuk Tahun Ajaran{' '}
              <strong>{event.academic_year_name || event.academic_year_id}</strong>:
            </p>

            <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
              {['10', '11', '12'].map((g) => {
                const checked = selectedGrades.includes(g);
                return (
                  <label key={g} className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        if (checked) {
                          setSelectedGrades(selectedGrades.filter((item) => item !== g));
                        } else {
                          setSelectedGrades([...selectedGrades, g]);
                        }
                      }}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    Tingkat Kelas {g}
                  </label>
                );
              })}
            </div>

            <p className="text-[11px] text-gray-400">
              * Penarikan ulang bersifat diff-resync: nomor peserta dan pembagian ruangan yang sudah ditetapkan tidak akan terhapus.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setShowSnapshotModal(false)} disabled={syncing}>
                Batal
              </Button>
              <Button variant="primary" onClick={handleSnapshot} loading={syncing}>
                Mulai Tarik Data
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Generate Number Modal */}
      {showNumberModal && (
        <Modal open={true} title="Generate Nomor Peserta Semester" onClose={() => setShowNumberModal(false)} size="sm">
          <div className="space-y-3 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Nomor peserta akan digenerate secara deterministik berurutan berdasarkan Ruangan, Kelas, dan Nama Siswa.
            </p>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Prefix Nomor</label>
              <input
                type="text"
                value={prefixNumber}
                onChange={(e) => setPrefixNumber(e.target.value.toUpperCase())}
                placeholder="misal: SEM / PAS / PAT"
                className="w-full border border-gray-300 rounded px-3 py-2 font-mono uppercase text-xs"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Format akhir: <code>{prefixNumber || 'SEM'}-0001</code>, <code>{prefixNumber || 'SEM'}-0002</code>, dst.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setShowNumberModal(false)} disabled={generatingNumbers}>
                Batal
              </Button>
              <Button variant="primary" onClick={handleGenerateNumbers} loading={generatingNumbers}>
                Generate Sekarang
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk Room Assign Modal */}
      {showBulkRoomModal && (
        <Modal open={true} title={`Tetapkan Ruangan (${selectedIds.length} Siswa)`} onClose={() => setShowBulkRoomModal(false)} size="sm">
          <div className="space-y-3 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Pilih ruangan ujian untuk {selectedIds.length} peserta terpilih:
            </p>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Ruangan Ujian</label>
              <select
                value={targetRoomId}
                onChange={(e) => setTargetRoomId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs"
              >
                <option value="">-- Pilih Ruangan --</option>
                <option value="none">Lepaskan Ruangan (Kosongkan)</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_name} (Kapasitas: {r.capacity || 40})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setShowBulkRoomModal(false)} disabled={assigningRooms}>
                Batal
              </Button>
              <Button variant="primary" onClick={handleBulkRoomAssign} loading={assigningRooms} disabled={!targetRoomId}>
                Simpan Penugasan
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
