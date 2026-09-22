'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET } from '@/lib/api';
import { Button, useToast } from '@/components/ui';
import { Plus, Search, Layers, Users, Calendar, ArrowRight, ShieldCheck } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import type { KegiatanEvent } from './types';
import { KegiatanEventForm } from './KegiatanEventForm';

interface Props {
  onSelectEvent: (eventId: string) => void;
}

export function KegiatanDashboard({ onSelectEvent }: Props) {
  const { toast } = useToast();
  const [events, setEvents] = useState<KegiatanEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter !== 'all'
        ? `/api/kegiatan/events?status=${statusFilter}`
        : '/api/kegiatan/events';
      const res = await GET<KegiatanEvent[]>(url);
      if (res.success && res.data) {
        setEvents(res.data);
      }
    } catch {
      toast('error', 'Gagal memuat daftar kegiatan');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const filteredEvents = events.filter((e) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.code.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const totalEvents = events.length;
  const configCount = events.filter((e) => e.status === 'configuration').length;
  const readyActiveCount = events.filter((e) => e.status === 'ready' || e.status === 'active').length;
  const totalParticipants = events.reduce((sum, e) => sum + (e.roster_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Institutional Header Banner */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.border}`,
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                background: C.greenLight,
                color: C.green,
                border: `1.5px solid ${C.greenBorder}`,
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '999px',
                letterSpacing: '0.05em',
              }}
            >
              DOMAIN OPERASIONAL
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: C.textMid }}>MAN 1 TASIKMALAYA</span>
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: C.text, marginTop: '6px' }}>
            Kegiatan & Lomba Kesiswaan
          </h2>
          <p style={{ fontSize: '12.5px', color: C.textMid, marginTop: '2px', maxWidth: '650px' }}>
            Pengelolaan asesmen seleksi kesiswaan, olimpiade madrasah (OSN/OMI), tryout, dan lomba akademik khusus berbasis Shared CBT Engine.
          </p>
        </div>

        <Button variant="primary" size="md" onClick={() => setShowCreateModal(true)}>
          <Plus size={15} /> Buat Kegiatan Baru
        </Button>
      </div>

      {/* KPI Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '14px 18px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: C.textFaint }}>Total Kegiatan</p>
          <p style={{ fontSize: '24px', fontWeight: 800, color: C.text, marginTop: '4px' }}>{totalEvents}</p>
        </div>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '14px 18px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: C.textFaint }}>Sedang Konfigurasi</p>
          <p style={{ fontSize: '24px', fontWeight: 800, color: '#d48806', marginTop: '4px' }}>{configCount}</p>
        </div>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '14px 18px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: C.textFaint }}>Siap / Aktif</p>
          <p style={{ fontSize: '24px', fontWeight: 800, color: C.green, marginTop: '4px' }}>{readyActiveCount}</p>
        </div>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '14px 18px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: C.textFaint }}>Total Peserta Roster</p>
          <p style={{ fontSize: '24px', fontWeight: 800, color: '#1a5fa8', marginTop: '4px' }}>{totalParticipants}</p>
        </div>
      </div>

      {/* Filters & Search */}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ position: 'relative', minWidth: '240px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: C.textFaint }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode atau nama kegiatan..."
            style={{ width: '100%', padding: '7px 10px 7px 32px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12.5px' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: C.textMid }}>Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12.5px', background: C.white }}
          >
            <option value="all">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="configuration">Konfigurasi</option>
            <option value="ready">Siap (Ready)</option>
            <option value="active">Aktif</option>
            <option value="completed">Selesai</option>
            <option value="archived">Arsip</option>
          </select>
        </div>
      </div>

      {/* Event List Table */}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: '#fafbfa', borderBottom: `1.5px solid ${C.border}`, textAlign: 'left', color: C.textMid, fontSize: '11px', textTransform: 'uppercase' }}>
              <th style={{ padding: '12px 16px', width: '110px' }}>Kode</th>
              <th style={{ padding: '12px 16px' }}>Nama Kegiatan</th>
              <th style={{ padding: '12px 16px', width: '130px' }}>Status</th>
              <th style={{ padding: '12px 16px', width: '100px', textAlign: 'center' }}>Ujian</th>
              <th style={{ padding: '12px 16px', width: '130px', textAlign: 'center' }}>Peserta Roster</th>
              <th style={{ padding: '12px 16px', width: '110px', textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: C.textMuted }}>
                  Memuat daftar kegiatan...
                </td>
              </tr>
            ) : filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: C.textMuted }}>
                  Belum ada kegiatan yang sesuai.
                </td>
              </tr>
            ) : (
              filteredEvents.map((ev) => (
                <tr
                  key={ev.id}
                  onClick={() => onSelectEvent(ev.id)}
                  style={{ borderBottom: `1px solid ${C.borderLight}`, cursor: 'pointer' }}
                  className="hover:bg-[#f8faf8] transition-colors"
                >
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 800 }}>
                      {ev.code}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <p style={{ fontWeight: 800, color: C.text, fontSize: '13px' }}>{ev.name}</p>
                    {ev.description && (
                      <p style={{ fontSize: '11px', color: C.textFaint, marginTop: '2px' }}>{ev.description}</p>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <StatusBadge status={ev.status} />
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: C.text }}>
                    {ev.exam_count} Ujian
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#1a5fa8' }}>
                    {ev.roster_count} Siswa
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onSelectEvent(ev.id); }}>
                      Kelola <ArrowRight size={12} />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      <KegiatanEventForm
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(id) => {
          fetchEvents();
          if (id) onSelectEvent(id);
        }}
      />
    </div>
  );
}
