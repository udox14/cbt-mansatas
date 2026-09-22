'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, PUT } from '@/lib/api';
import { Button, useToast } from '@/components/ui';
import {
  ChevronLeft,
  Calendar,
  Layers,
  Users,
  CheckCircle,
  School,
  Lock,
  Play,
  CheckCheck,
  Archive,
  Pencil,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import type { KegiatanEvent } from './types';
import type { Exam } from '../exam-engine/types';
import { KegiatanEventForm } from './KegiatanEventForm';
import { KegiatanExamList } from './KegiatanExamList';
import { KegiatanParticipants } from './KegiatanParticipants';
import { KegiatanReadiness } from './KegiatanReadiness';
import { RoomsPage } from '../exam-engine/rooms/RoomsPage';

interface Props {
  eventId: string;
  onBack: () => void;
}

type WorkspaceTab = 'ringkasan' | 'exams' | 'peserta' | 'readiness' | 'rooms';

export function KegiatanEventWorkspace({ eventId, onBack }: Props) {
  const { toast } = useToast();
  const [event, setEvent] = useState<KegiatanEvent | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('exams');
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const fetchEventData = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, exRes] = await Promise.all([
        GET<KegiatanEvent>(`/api/kegiatan/events/${eventId}`),
        GET<Exam[]>(`/api/kegiatan/events/${eventId}/exams`),
      ]);
      if (evRes.success && evRes.data) {
        setEvent(evRes.data);
      } else {
        toast('error', evRes.error || 'Gagal memuat kegiatan');
      }
      if (exRes.success && exRes.data) {
        setExams(exRes.data);
      }
    } catch {
      toast('error', 'Gagal memuat detail kegiatan');
    } finally {
      setLoading(false);
    }
  }, [eventId, toast]);

  useEffect(() => {
    fetchEventData();
  }, [fetchEventData]);

  // Lifecycle status transitions
  const handleTransition = async (targetStatus: string) => {
    setTransitioning(true);
    try {
      const res = await PUT<{ status: string }>(`/api/kegiatan/events/${eventId}/status`, { status: targetStatus });
      if (res.success) {
        toast('success', `Status kegiatan diubah menjadi ${targetStatus}`);
        fetchEventData();
      } else {
        toast('error', res.error || 'Gagal mengubah status kegiatan');
        if (targetStatus === 'ready') {
          setActiveTab('readiness');
        }
      }
    } catch {
      toast('error', 'Terjadi kesalahan');
    } finally {
      setTransitioning(false);
    }
  };

  if (loading && !event) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: C.textMuted }}>
        Memuat data kegiatan...
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontWeight: 700 }}>Kegiatan tidak ditemukan atau bukan domain Kegiatan.</p>
        <Button variant="secondary" size="sm" onClick={onBack} className="mt-3">
          Kembali ke Daftar Kegiatan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Workspace Header & Context */}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <button
              onClick={onBack}
              style={{ background: 'none', border: 'none', color: '#1a5fa8', fontSize: '11.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', padding: 0 }}
            >
              <ChevronLeft size={14} /> Kembali ke Daftar Kegiatan
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span style={{ background: '#f0fdf4', color: C.green, border: `1.5px solid ${C.greenBorder}`, fontSize: '11px', fontWeight: 800, padding: '2px 9px', borderRadius: '999px' }}>
                {event.code}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: C.text }}>
                {event.name}
              </h2>
              <StatusBadge status={event.status} />
            </div>
            <p style={{ fontSize: '12px', color: C.textMid, marginTop: '4px' }}>
              {event.description || 'Kegiatan asesmen / seleksi kesiswaan MAN 1 Tasikmalaya.'}
            </p>
          </div>

          {/* Quick Actions & Lifecycle Transitions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={() => setShowEditModal(true)}>
              <Pencil size={12} /> Edit Info
            </Button>

            {event.status === 'draft' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleTransition('configuration')}
                disabled={transitioning}
              >
                Mulai Konfigurasi
              </Button>
            )}

            {event.status === 'configuration' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab('readiness')}
              >
                <Lock size={13} /> Kesiapan & Kunci (Ready)
              </Button>
            )}

            {event.status === 'ready' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleTransition('active')}
                disabled={transitioning}
              >
                <Play size={13} /> Aktifkan Kegiatan
              </Button>
            )}

            {event.status === 'active' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTransition('completed')}
                disabled={transitioning}
              >
                <CheckCheck size={13} /> Selesaikan Kegiatan
              </Button>
            )}

            {event.status === 'completed' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTransition('archived')}
                disabled={transitioning}
              >
                <Archive size={13} /> Arsipkan
              </Button>
            )}
          </div>
        </div>

        {/* Workspace Sub Navigation Tabs */}
        <div style={{ display: 'flex', gap: '6px', borderTop: `1px solid ${C.borderLight}`, marginTop: '16px', paddingTop: '12px', overflowX: 'auto' }}>
          {[
            { key: 'exams', label: `Daftar Ujian (${exams.length})`, icon: Layers },
            { key: 'peserta', label: `Peserta Roster (${event.roster_count})`, icon: Users },
            { key: 'readiness', label: 'Kesiapan Pelaksanaan', icon: CheckCircle },
            { key: 'rooms', label: 'Ruangan Ujian', icon: School },
          ].map((t) => {
            const Icon = t.icon;
            const isSel = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key as WorkspaceTab)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '9px',
                  fontSize: '12.5px',
                  fontWeight: isSel ? 800 : 600,
                  background: isSel ? C.greenLight : 'transparent',
                  color: isSel ? C.green : C.textMid,
                  border: `1.5px solid ${isSel ? C.greenBorder : 'transparent'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'exams' && (
        <KegiatanExamList eventId={eventId} onExamsUpdated={fetchEventData} />
      )}

      {activeTab === 'peserta' && (
        <KegiatanParticipants eventId={eventId} exams={exams} />
      )}

      {activeTab === 'readiness' && (
        <KegiatanReadiness
          eventId={eventId}
          currentStatus={event.status}
          onStatusChange={fetchEventData}
        />
      )}

      {activeTab === 'rooms' && (
        <RoomsPage activeEventId={eventId} />
      )}

      {/* Edit modal */}
      <KegiatanEventForm
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        event={event}
        onSuccess={fetchEventData}
      />
    </div>
  );
}
