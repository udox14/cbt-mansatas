'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, Badge, Confirm, useToast, EmptyState } from '@/components/ui';
import { Users, RefreshCw, AlertTriangle, CheckCircle2, Search, Filter } from 'lucide-react';
import type { TkaParticipantItem, TkaEvent } from './types';

export function TkaParticipantsTab({ event }: { event: TkaEvent }) {
  const { toast } = useToast();
  const [participants, setParticipants] = useState<TkaParticipantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchParticipants = useCallback(async () => {
    setLoading(true);
    let url = `/api/tka/events/${event.id}/participants`;
    if (filterStatus !== 'all') {
      url += `?status=${encodeURIComponent(filterStatus)}`;
    }
    const res = await GET<TkaParticipantItem[]>(url);
    if (res.success && res.data) {
      setParticipants(res.data);
    } else {
      toast('error', res.error || 'Gagal memuat daftar peserta');
    }
    setLoading(false);
  }, [event.id, filterStatus, toast]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  const handleSync = async () => {
    setSyncing(true);
    const res = await POST<any>(`/api/tka/events/${event.id}/participants/sync`, {});
    setSyncing(false);
    setShowSyncConfirm(false);

    if (res.success) {
      toast('success', res.message || 'Sinkronisasi berhasil');
      fetchParticipants();
    } else {
      toast('error', res.error || 'Gagal sinkronisasi peserta');
    }
  };

  const handleInitialSnapshot = async () => {
    setSyncing(true);
    const res = await POST<any>(`/api/tka/events/${event.id}/participants/snapshot`, {});
    setSyncing(false);

    if (res.success) {
      toast('success', res.message || 'Snapshot peserta berhasil diambil');
      fetchParticipants();
    } else {
      toast('error', res.error || 'Gagal snapshot peserta');
    }
  };

  const isFrozen = ['ready', 'active', 'completed', 'archived'].includes(event.status);

  // Status badge styling
  const renderValidationBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            5/5 Valid
          </span>
        );
      case 'missing_option':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
            <AlertTriangle className="w-3 h-3" />
            Pilihan Belum Lengkap
          </span>
        );
      case 'duplicate_option':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Pilihan Duplikat
          </span>
        );
      case 'duplicate_mandatory':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Duplikasi Wajib
          </span>
        );
      case 'unresolved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="w-3 h-3" />
            Mapel Tidak Terdaftar
          </span>
        );
      default:
        return <Badge color="gray">{status}</Badge>;
    }
  };

  const filtered = participants.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.nama_lengkap.toLowerCase().includes(q) ||
      (p.nisn && p.nisn.toLowerCase().includes(q)) ||
      (p.class_name && p.class_name.toLowerCase().includes(q))
    );
  });

  const validCount = participants.filter((p) => p.validation_status === 'valid').length;
  const invalidCount = participants.length - validCount;

  return (
    <div className="space-y-4 text-xs">
      {/* Action and Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
            <span className="text-gray-500 font-medium">Total Ter-snapshot:</span>
            <span className="font-bold text-gray-900">{participants.length} Siswa</span>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
            <span className="text-emerald-700 font-medium">Valid (5/5):</span>
            <span className="font-bold text-emerald-800">{validCount}</span>
          </div>
          {invalidCount > 0 && (
            <div className="flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
              <span className="text-red-700 font-medium">Perlu Perbaikan:</span>
              <span className="font-bold text-red-800">{invalidCount}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {participants.length === 0 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInitialSnapshot}
              disabled={syncing || isFrozen}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
              Ambil Snapshot Siswa dari Mansatas
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSyncConfirm(true)}
              disabled={syncing || isFrozen}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
              Sinkronkan Ulang dari Mansatas
            </Button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-4 py-2.5 rounded-lg border border-gray-200">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari siswa atau NISN..."
            className="w-full border-0 p-0 text-xs focus:ring-0 text-gray-900 placeholder-gray-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-gray-500 font-medium">Status Validasi:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded px-2.5 py-1 text-xs focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="all">Semua Status</option>
            <option value="valid">Valid (5/5)</option>
            <option value="missing_option">Pilihan Belum Lengkap</option>
            <option value="duplicate_option">Pilihan Duplikat</option>
            <option value="duplicate_mandatory">Duplikasi Wajib</option>
            <option value="unresolved">Mapel Tidak Terdaftar</option>
          </select>
        </div>
      </div>

      {/* Table Content */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Tidak Ada Siswa"
          desc={
            participants.length === 0
              ? 'Belum ada data siswa yang disnapshot ke event ini.'
              : 'Tidak ada siswa yang sesuai dengan filter pencarian.'
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">No</th>
                  <th className="py-2.5 px-3">Nama Lengkap & NISN</th>
                  <th className="py-2.5 px-3">Kelas</th>
                  <th className="py-2.5 px-3">Pilihan 1 (Mansatas)</th>
                  <th className="py-2.5 px-3">Pilihan 2 (Mansatas)</th>
                  <th className="py-2.5 px-3">Status Invarian</th>
                  <th className="py-2.5 px-3">Catatan / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {filtered.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-2.5 px-3 text-gray-400">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-gray-900">{p.nama_lengkap}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{p.nisn || '-'}</div>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-gray-700">{p.class_name || '-'}</td>
                    <td className="py-2.5 px-3">
                      {p.mapel_pilihan1_raw ? (
                        <span className="font-medium text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                          {p.mapel_pilihan1_raw}
                        </span>
                      ) : (
                        <span className="text-red-500 italic">Belum memilih</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {p.mapel_pilihan2_raw ? (
                        <span className="font-medium text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                          {p.mapel_pilihan2_raw}
                        </span>
                      ) : (
                        <span className="text-red-500 italic">Belum memilih</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">{renderValidationBadge(p.validation_status)}</td>
                    <td className="py-2.5 px-3 text-gray-500 text-[11px]">
                      {p.validation_notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync Confirm Modal */}
      {showSyncConfirm && (
        <Confirm
          open={showSyncConfirm}
          title="Sinkronkan Ulang Peserta dari Mansatas?"
          message="Sistem akan memeriksa perubahan pilihan mapel siswa kelas 12 di Mansatas. Roster ujian akan disesuaikan secara otomatis. Penugasan ruangan siswa yang sudah ada akan tetap dipertahankan."
          confirmText={syncing ? 'Menyinkronkan...' : 'Ya, Sinkronkan'}
          onConfirm={handleSync}
          onClose={() => setShowSyncConfirm(false)}
          danger={false}
        />
      )}
    </div>
  );
}
