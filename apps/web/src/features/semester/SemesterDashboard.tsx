'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET } from '@/lib/api';
import { Button, Spinner, Badge, EmptyState, useToast } from '@/components/ui';
import { Calendar, Plus, Users, ArrowRight, RefreshCw, GraduationCap, Filter } from 'lucide-react';
import type { SemesterEvent } from './types';
import { SemesterCreateModal } from './SemesterCreateModal';

export function SemesterDashboard({ onSelectEvent }: { onSelectEvent: (eventId: string) => void }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<SemesterEvent[]>([]);
  const [academicYears, setAcademicYears] = useState<any[]>([]);
  const [selectedAy, setSelectedAy] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchAcademicYears = useCallback(async () => {
    const res = await GET<any[]>('/api/semester/academic-years');
    if (res.success && res.data) {
      setAcademicYears(res.data);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    let url = '/api/semester/events';
    const params = new URLSearchParams();
    if (selectedAy !== 'all') {
      params.append('academic_year_id', selectedAy);
    }
    if (selectedType !== 'all') {
      params.append('activity_type', selectedType);
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const res = await GET<SemesterEvent[]>(url);
    if (res.success && res.data) {
      setEvents(res.data);
    } else {
      toast('error', res.error || 'Gagal memuat daftar event semester');
    }
    setLoading(false);
  }, [selectedAy, selectedType, toast]);

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

  const getActivityTypeLabel = (type: string) => {
    switch (type) {
      case 'pas':
        return 'PAS (Penilaian Akhir Semester)';
      case 'pat':
        return 'PAT (Penilaian Akhir Tahun)';
      case 'sas':
        return 'SAS (Sumatif Akhir Semester)';
      case 'asas':
        return 'ASAS (Asesmen Sumatif Akhir Semester)';
      case 'sumatif':
        return 'Sumatif Bersama';
      default:
        return type.toUpperCase();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-800">
              <GraduationCap className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">Ujian Semester & Akhir Tahun</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Manajemen ujian semester multi-kelas (PAS, PAT, SAS, ASAS, Sumatif) dengan penjadwalan sesi waktu dan pembagian ruangan terpusat.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fetchEvents()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Buat Event Semester
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-lg border border-gray-200 text-xs">
        <span className="font-semibold text-gray-700 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          Tahun Ajaran:
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

        <span className="font-semibold text-gray-700 ml-2">Tipe:</span>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="border border-gray-300 rounded px-2.5 py-1 text-xs focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="all">Semua Tipe</option>
          <option value="pas">PAS (Penilaian Akhir Semester)</option>
          <option value="pat">PAT (Penilaian Akhir Tahun)</option>
          <option value="sas">SAS (Sumatif Akhir Semester)</option>
          <option value="asas">ASAS (Asesmen Sumatif Akhir Semester)</option>
          <option value="sumatif">Sumatif Bersama</option>
          <option value="other">Lainnya</option>
        </select>

        <span className="text-gray-400 ml-auto">{events.length} event ditemukan</span>
      </div>

      {/* Events Grid */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <EmptyState
            title="Belum Ada Event Semester"
            desc="Buat event semester pertama (PAS/PAT/SAS/ASAS) untuk memulai snapshot peserta kelas 10, 11, dan 12 serta penjadwalan ujian."
          />
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Buat Event Semester
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
                <div className="mt-1">
                  <span className="inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                    {getActivityTypeLabel(ev.activity_type)} · Semester {ev.term || '1'}
                  </span>
                </div>
                {ev.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">{ev.description}</p>
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
                    <span>Kelas 10, 11, 12</span>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => onSelectEvent(ev.id)}
                >
                  Buka Workspace Semester
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <SemesterCreateModal
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
