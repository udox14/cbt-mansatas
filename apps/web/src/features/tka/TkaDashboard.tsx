'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET } from '@/lib/api';
import { Button, Spinner, Badge, EmptyState, useToast } from '@/components/ui';
import { BookOpen, Plus, Calendar, Users, ArrowRight, RefreshCw } from 'lucide-react';
import type { TkaEvent } from './types';
import { TkaCreateModal } from './TkaCreateModal';

export function TkaDashboard({ onSelectEvent }: { onSelectEvent: (eventId: string) => void }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<TkaEvent[]>([]);
  const [academicYears, setAcademicYears] = useState<any[]>([]);
  const [selectedAy, setSelectedAy] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchAcademicYears = useCallback(async () => {
    const res = await GET<any[]>('/api/tka/academic-years');
    if (res.success && res.data) {
      setAcademicYears(res.data);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    let url = '/api/tka/events';
    if (selectedAy !== 'all') {
      url += `?academic_year_id=${encodeURIComponent(selectedAy)}`;
    }
    const res = await GET<TkaEvent[]>(url);
    if (res.success && res.data) {
      setEvents(res.data);
    } else {
      toast('error', res.error || 'Gagal memuat daftar event TKA');
    }
    setLoading(false);
  }, [selectedAy, toast]);

  useEffect(() => {
    fetchAcademicYears();
  }, [fetchAcademicYears]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge color="green">Sedang Berjalan</Badge>;
      case 'ready':
        return <Badge color="blue">Siap Pelaksanaan</Badge>;
      case 'configuration':
        return <Badge color="yellow">Konfigurasi</Badge>;
      case 'completed':
        return <Badge color="gray">Selesai</Badge>;
      case 'archived':
        return <Badge color="gray">Diarsipkan</Badge>;
      default:
        return <Badge color="gray">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-800">
              <BookOpen className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">Tes Kemampuan Akademik (TKA)</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Asesmen akademik siswa Kelas 12 dengan 3 mapel wajib dan 2 mapel pilihan terintegrasi Mansatas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fetchEvents()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Buat Event TKA
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-lg border border-gray-200 text-xs">
        <span className="font-semibold text-gray-700 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-gray-500" />
          Filter Tahun Ajaran:
        </span>
        <select
          value={selectedAy}
          onChange={(e) => setSelectedAy(e.target.value)}
          className="border border-gray-300 rounded px-2.5 py-1 text-xs focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="all">Semua Tahun Ajaran</option>
          {academicYears.map((ay) => (
            <option key={ay.id} value={ay.id}>
              {ay.nama} {ay.is_active ? '(Aktif)' : ''}
            </option>
          ))}
        </select>
        <span className="text-gray-400 ml-auto">{events.length} event ditemukan</span>
      </div>

      {/* Events Grid / Table */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <EmptyState
            title="Belum Ada Event TKA"
            desc="Buat event TKA pertama untuk memulai pendataan pilihan mapel kelas 12 dan pembuatan ujian."
          />
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Buat Event TKA
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-gray-100 text-gray-700 uppercase">
                    {ev.code}
                  </span>
                  {getStatusBadge(ev.status)}
                </div>
                <h3 className="font-bold text-gray-900 text-base leading-snug">{ev.name}</h3>
                {ev.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ev.description}</p>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span>{ev.academic_year_name || 'Tahun Ajaran'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Kelas 12</span>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => onSelectEvent(ev.id)}
                >
                  Buka Workspace TKA
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <TkaCreateModal
          academicYears={academicYears}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(eventId) => {
            setShowCreateModal(false);
            onSelectEvent(eventId);
          }}
        />
      )}
    </div>
  );
}
