'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, PUT } from '@/lib/api';
import { Button, useToast, Spinner, Badge } from '@/components/ui';
import {
  ChevronLeft,
  Calendar,
  Layers,
  Users,
  CheckCircle2,
  Home,
  HelpCircle,
  Key,
  Activity,
  Award,
  BarChart2,
  Lock,
  Play,
  CheckCheck,
  Archive,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import type { TkaEvent, TkaExamItem } from './types';
import { TkaParticipantsTab } from './TkaParticipantsTab';
import { TkaSubjectsTab } from './TkaSubjectsTab';
import { TkaRoomsTab } from './TkaRoomsTab';
import { TkaReadinessTab } from './TkaReadinessTab';
import { QuestionsView } from '../exam-engine/questions/QuestionsView';
import { TokensView } from '../exam-engine/tokens/TokensView';
import { MonitorView } from '../exam-engine/monitoring/MonitorView';
import { ResultsView } from '../exam-engine/results/ResultsView';
import { AnalyticsView } from '../exam-engine/analytics/AnalyticsView';

interface TkaWorkspaceProps {
  eventId: string;
  onBack: () => void;
}

type WorkspaceTab =
  | 'ringkasan'
  | 'peserta'
  | 'mapel'
  | 'ruang'
  | 'readiness'
  | 'soal'
  | 'token'
  | 'monitoring'
  | 'hasil'
  | 'analisis';

export function TkaWorkspace({ eventId, onBack }: TkaWorkspaceProps) {
  const { toast } = useToast();
  const [event, setEvent] = useState<TkaEvent | null>(null);
  const [exams, setExams] = useState<TkaExamItem[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('ringkasan');
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  const fetchEventData = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, exRes] = await Promise.all([
        GET<TkaEvent>(`/api/tka/events/${eventId}`),
        GET<TkaExamItem[]>(`/api/tka/events/${eventId}/exams`),
      ]);

      if (evRes.success && evRes.data) {
        setEvent(evRes.data);
      } else {
        toast('error', evRes.error || 'Gagal memuat event TKA');
      }

      if (exRes.success && exRes.data) {
        setExams(exRes.data);
        if (exRes.data.length > 0 && !selectedExamId) {
          setSelectedExamId(exRes.data[0].id);
        }
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat memuat data TKA');
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedExamId, toast]);

  useEffect(() => {
    fetchEventData();
  }, [fetchEventData]);

  const handleTransition = async (targetStatus: string) => {
    setTransitioning(true);
    try {
      const res = await PUT<{ status: string }>(`/api/tka/events/${eventId}/status`, { status: targetStatus });
      if (res.success) {
        toast('success', `Status event TKA diubah menjadi ${targetStatus}`);
        fetchEventData();
      } else {
        toast('error', res.error || 'Gagal mengubah status event');
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

  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[0];

  if (loading && !event) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: C.textMuted }}>
        <Spinner size={24} />
        <p className="mt-3 text-sm">Memuat ruang kerja TKA...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontWeight: 700 }}>Event TKA tidak ditemukan.</p>
        <Button variant="secondary" size="sm" onClick={onBack} className="mt-3">
          Kembali ke Daftar TKA
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
              style={{
                background: 'none',
                border: 'none',
                color: '#1a5fa8',
                fontSize: '11.5px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <ChevronLeft size={14} /> Kembali ke Daftar TKA
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#f0fdf4',
                  color: C.green,
                  border: `1.5px solid ${C.greenBorder}`,
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '2px 9px',
                  borderRadius: '999px',
                }}
              >
                {event.code}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: C.text }}>
                {event.name}
              </h2>
              <StatusBadge status={event.status} />
            </div>
            <p style={{ fontSize: '12px', color: C.textMid, marginTop: '4px' }}>
              {event.description || `Tes Kemampuan Akademik Kelas 12 · T.A. ${event.academic_year_name || event.academic_year_id}`}
            </p>
          </div>

          {/* Lifecycle Transitions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                <Lock size={13} className="mr-1" /> Periksa Kesiapan & Kunci (Ready)
              </Button>
            )}

            {event.status === 'ready' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleTransition('active')}
                disabled={transitioning}
              >
                <Play size={13} className="mr-1" /> Aktifkan Event TKA
              </Button>
            )}

            {event.status === 'active' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTransition('completed')}
                disabled={transitioning}
              >
                <CheckCheck size={13} className="mr-1" /> Selesaikan Event TKA
              </Button>
            )}

            {event.status === 'completed' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTransition('archived')}
                disabled={transitioning}
              >
                <Archive size={13} className="mr-1" /> Arsipkan Event
              </Button>
            )}
          </div>
        </div>

        {/* Workspace Sub Navigation Tabs */}
        <div style={{ display: 'flex', gap: '6px', borderTop: `1px solid ${C.borderLight}`, marginTop: '16px', paddingTop: '12px', overflowX: 'auto' }}>
          {[
            { key: 'ringkasan', label: 'Ringkasan', icon: Layers },
            { key: 'peserta', label: 'Peserta & Pilihan', icon: Users },
            { key: 'mapel', label: `Mapel & Ujian (${exams.length})`, icon: BookOpen },
            { key: 'ruang', label: 'Ruangan Ujian', icon: Home },
            { key: 'readiness', label: 'Kesiapan Pelaksanaan', icon: ShieldCheck },
            { key: 'soal', label: 'Bank Soal', icon: HelpCircle },
            { key: 'token', label: 'Token Ruangan', icon: Key },
            { key: 'monitoring', label: 'Live Monitoring', icon: Activity },
            { key: 'hasil', label: 'Nilai & Hasil', icon: Award },
            { key: 'analisis', label: 'Analisis Butir', icon: BarChart2 },
          ].map((t) => {
            const Icon = t.icon;
            const isSel = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key as WorkspaceTab)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: isSel ? 800 : 600,
                  background: isSel ? C.greenLight : 'transparent',
                  color: isSel ? C.green : C.textMid,
                  border: `1.5px solid ${isSel ? C.greenBorder : 'transparent'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab: Ringkasan */}
      {activeTab === 'ringkasan' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '10px', padding: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Tahun Ajaran</p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: C.text, marginTop: '4px' }}>
                {event.academic_year_name || event.academic_year_id}
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>Khusus Siswa Aktif Kelas 12</p>
            </div>

            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '10px', padding: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Mata Pelajaran Wajib</p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: C.green, marginTop: '4px' }}>
                3 Mata Pelajaran
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>Matematika, B. Indo, B. Inggris</p>
            </div>

            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '10px', padding: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Mata Pelajaran Pilihan</p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1a5fa8', marginTop: '4px' }}>
                2 Mapel / Siswa
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>Dari Data Mansatas TKA</p>
            </div>

            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '10px', padding: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Ujian Terdaftar</p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: C.text, marginTop: '4px' }}>
                {exams.length} Ujian Mapel
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>1 Ujian per Mata Pelajaran</p>
            </div>
          </div>

          {/* Quick Guidance Card */}
          <div style={{ background: '#f8fafc', border: `1.5px solid #cbd5e1`, borderRadius: '12px', padding: '16px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
              Alur Pelaksanaan TKA CBT MANSATAS:
            </h4>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-700">
              <li>
                <strong>Snapshot Peserta:</strong> Buka tab <em>Peserta & Pilihan</em>, klik "Tarik & Sinkronkan Data Siswa Kelas 12" dari Mansatas.
              </li>
              <li>
                <strong>Generate Ujian & Roster:</strong> Buka tab <em>Mapel & Ujian</em>, klik "Buat Semua Ujian yang Dibutuhkan" lalu "Generate Roster Siswa".
              </li>
              <li>
                <strong>Ruangan:</strong> Atur pembagian ruangan siswa di tab <em>Ruangan Ujian</em>.
              </li>
              <li>
                <strong>Soal & Token:</strong> Isi bank soal setiap mapel dan generate token ruangan per mapel.
              </li>
              <li>
                <strong>Kesiapan:</strong> Buka tab <em>Kesiapan Pelaksanaan</em> untuk validasi 10 gate sebelum mengaktifkan event ke status <code>ready</code> dan <code>active</code>.
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* Tab: Peserta */}
      {activeTab === 'peserta' && <TkaParticipantsTab event={event} />}

      {/* Tab: Mapel & Ujian */}
      {activeTab === 'mapel' && (
        <TkaSubjectsTab
          event={event}
          onSelectExam={(examId, targetTab) => {
            setSelectedExamId(examId);
            setActiveTab(targetTab as WorkspaceTab);
          }}
        />
      )}

      {/* Tab: Ruang */}
      {activeTab === 'ruang' && <TkaRoomsTab event={event} />}

      {/* Tab: Readiness */}
      {activeTab === 'readiness' && (
        <TkaReadinessTab event={event} onStatusChanged={fetchEventData} />
      )}

      {/* Exam-Specific Shared Views (Soal, Token, Monitoring, Hasil, Analisis) */}
      {['soal', 'token', 'monitoring', 'hasil', 'analisis'].includes(activeTab) && (
        <div className="space-y-4">
          {/* Exam Selector Dropdown */}
          <div
            style={{
              background: C.white,
              border: `1.5px solid ${C.border}`,
              borderRadius: '10px',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
                Pilih Ujian Mapel:
              </label>
              {exams.length > 0 ? (
                <select
                  value={selectedExam?.id || ''}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: `1.5px solid ${C.border}`,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    color: C.text,
                    background: C.white,
                  }}
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title} ({ex.subject_name}) · {ex.question_count || 0} Soal · {ex.roster_count || 0} Peserta
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 700 }}>
                  Belum ada ujian yang dibuat untuk event ini. Buat ujian di tab "Mapel & Ujian" terlebih dahulu.
                </span>
              )}
            </div>

            {selectedExam && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: C.textMid }}>
                  Durasi: <strong>{selectedExam.duration_minutes} Menit</strong>
                </span>
                <span style={{ fontSize: '11px', color: C.textMid }}>·</span>
                <span style={{ fontSize: '11px', color: C.textMid }}>
                  Soal: <strong>{selectedExam.question_count || 0}</strong>
                </span>
                <span style={{ fontSize: '11px', color: C.textMid }}>·</span>
                <StatusBadge status={selectedExam.active_status} />
              </div>
            )}
          </div>

          {/* Render Active Exam Engine Shared View */}
          {selectedExam ? (
            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '18px' }}>
              {activeTab === 'soal' && (
                <QuestionsView examId={selectedExam.id} apiPrefix="/api/tka" />
              )}
              {activeTab === 'token' && (
                <TokensView examId={selectedExam.id} apiPrefix="/api/tka" />
              )}
              {activeTab === 'monitoring' && (
                <MonitorView examId={selectedExam.id} apiPrefix="/api/tka" />
              )}
              {activeTab === 'hasil' && (
                <ResultsView examId={selectedExam.id} apiPrefix="/api/tka" />
              )}
              {activeTab === 'analisis' && (
                <AnalyticsView examId={selectedExam.id} apiPrefix="/api/tka" />
              )}
            </div>
          ) : (
            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '40px', textAlign: 'center' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>Tidak Ada Ujian yang Dipilih</p>
              <p style={{ fontSize: '12px', color: C.textMuted, marginTop: '4px' }}>
                Silakan buat ujian mapel terlebih dahulu pada tab "Mapel & Ujian".
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab('mapel')}
                className="mt-3"
              >
                Buka Tab Mapel & Ujian
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
