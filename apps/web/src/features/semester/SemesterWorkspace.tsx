'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
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
  Clock,
  GraduationCap,
  LayoutGrid,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import type { SemesterEvent, SemesterExam } from './types';
import { SemesterParticipantsTab } from './SemesterParticipantsTab';
import { SemesterExamsTab } from './SemesterExamsTab';
import { SemesterAudienceTab } from './SemesterAudienceTab';
import { SemesterRoomsTab } from './SemesterRoomsTab';
import { SemesterSeatingTab } from './SemesterSeatingTab';
import { SemesterSchedulingTab } from './SemesterSchedulingTab';
import { SemesterInvigilatorsTab } from './SemesterInvigilatorsTab';
import { SemesterReadinessTab } from './SemesterReadinessTab';
import { QuestionsView } from '../exam-engine/questions/QuestionsView';
import { TokensView } from '../exam-engine/tokens/TokensView';
import { MonitorView } from '../exam-engine/monitoring/MonitorView';
import { ResultsView } from '../exam-engine/results/ResultsView';
import { AnalyticsView } from '../exam-engine/analytics/AnalyticsView';

interface SemesterWorkspaceProps {
  eventId: string;
  onBack: () => void;
}

type WorkspaceTab =
  | 'ringkasan'
  | 'peserta'
  | 'ujian'
  | 'audiens'
  | 'ruang'
  | 'seating'
  | 'jadwal'
  | 'invigilators'
  | 'readiness'
  | 'soal'
  | 'token'
  | 'monitoring'
  | 'hasil'
  | 'analisis';

export function SemesterWorkspace({ eventId, onBack }: SemesterWorkspaceProps) {
  const { toast } = useToast();
  const [event, setEvent] = useState<SemesterEvent | null>(null);
  const [exams, setExams] = useState<SemesterExam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('ringkasan');
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  const fetchEventData = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, exRes] = await Promise.all([
        GET<SemesterEvent>(`/api/semester/events/${eventId}`),
        GET<SemesterExam[]>(`/api/semester/events/${eventId}/exams`),
      ]);

      if (evRes.success && evRes.data) {
        setEvent(evRes.data);
      } else {
        toast('error', evRes.error || 'Gagal memuat event semester');
      }

      if (exRes.success && exRes.data) {
        setExams(exRes.data);
        if (exRes.data.length > 0 && !selectedExamId) {
          setSelectedExamId(exRes.data[0].id);
        }
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat memuat data semester');
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
      const res = await POST<{ status: string }>(`/api/semester/events/${eventId}/status`, {
        status: targetStatus,
      });
      if (res.success) {
        toast('success', `Status event semester diubah menjadi ${targetStatus}`);
        fetchEventData();
      } else {
        toast('error', res.error || 'Gagal mengubah status event');
        if (targetStatus === 'ready') {
          setActiveTab('readiness');
        }
      }
    } catch {
      toast('error', 'Terjadi kesalahan sistem');
    } finally {
      setTransitioning(false);
    }
  };

  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[0];

  if (loading && !event) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: C.textMuted }}>
        <Spinner size={24} />
        <p className="mt-3 text-sm">Memuat ruang kerja semester...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontWeight: 700 }}>Event Semester tidak ditemukan.</p>
        <Button variant="secondary" size="sm" onClick={onBack} className="mt-3">
          Kembali ke Daftar Semester
        </Button>
      </div>
    );
  }

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
    <div className="space-y-4">
      {/* Top Header Card */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.border}`,
          borderRadius: '12px',
          padding: '16px 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
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
              <ChevronLeft size={14} /> Kembali ke Daftar Semester
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: '6px',
                flexWrap: 'wrap',
              }}
            >
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
              {event.description ||
                `${getActivityTypeLabel(event.activity_type)} · Semester ${event.term || '1'} · T.A. ${
                  event.academic_year_name || event.academic_year_id
                }`}
            </p>
          </div>

          {/* Lifecycle Action Buttons */}
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
                <Play size={13} className="mr-1" /> Aktifkan Event Semester
              </Button>
            )}

            {event.status === 'active' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTransition('completed')}
                disabled={transitioning}
              >
                <CheckCheck size={13} className="mr-1" /> Selesaikan Event
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
        <div
          style={{
            display: 'flex',
            gap: '6px',
            borderTop: `1px solid ${C.borderLight}`,
            marginTop: '16px',
            paddingTop: '12px',
            overflowX: 'auto',
          }}
        >
          {[
            { key: 'ringkasan', label: 'Ringkasan', icon: Layers },
            { key: 'peserta', label: 'Peserta & Ruang', icon: Users },
            { key: 'ujian', label: `Mata Pelajaran (${exams.length})`, icon: BookOpen },
            { key: 'audiens', label: 'Audiens & Roster', icon: Users },
            { key: 'ruang', label: 'Ruangan Ujian', icon: Home },
            { key: 'seating', label: 'Denah & Kursi', icon: LayoutGrid },
            { key: 'jadwal', label: 'Sesi Waktu', icon: Clock },
            { key: 'invigilators', label: 'Pengawas Ruangan', icon: ShieldCheck },
            { key: 'readiness', label: 'Kesiapan (Ready)', icon: ShieldCheck },
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
            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '10px',
                padding: '14px',
              }}
            >
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                Tahun Ajaran & Semester
              </p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: C.text, marginTop: '4px' }}>
                {event.academic_year_name || event.academic_year_id}
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>
                Semester {event.term || '1'} ({getActivityTypeLabel(event.activity_type)})
              </p>
            </div>

            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '10px',
                padding: '14px',
              }}
            >
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                Sasaran Tingkat
              </p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: C.green, marginTop: '4px' }}>
                Kelas 10, 11, 12
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>
                Multi-Grade Semester Architecture
              </p>
            </div>

            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '10px',
                padding: '14px',
              }}
            >
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                Ujian Terdaftar
              </p>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1a5fa8', marginTop: '4px' }}>
                {exams.length} Ujian Mapel
              </h3>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '2px' }}>
                Mapel resmi terverifikasi Mansatas
              </p>
            </div>

            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '10px',
                padding: '14px',
              }}
            >
              <p style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                Status Pelaksanaan
              </p>
              <div style={{ marginTop: '6px' }}>
                <StatusBadge status={event.status} />
              </div>
              <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '4px' }}>
                Engine Shared CBT MANSATAS
              </p>
            </div>
          </div>

          {/* Step-by-Step Institutional Guidance */}
          <div
            style={{
              background: '#f8fafc',
              border: `1.5px solid #cbd5e1`,
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
              Alur Pelaksanaan Ujian Semester CBT MANSATAS:
            </h4>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-700">
              <li>
                <strong>Snapshot Peserta (Multi-Grade):</strong> Buka tab <em>Peserta & Ruang</em>, klik "Tarik / Resync Siswa" untuk menarik siswa Kelas 10, 11, dan 12 dari database sekolah.
              </li>
              <li>
                <strong>Generate Nomor Peserta & Ruangan:</strong> Alokasikan peserta ke ruangan ujian dan generate nomor peserta secara berurutan.
              </li>
              <li>
                <strong>Buat Ujian Mapel:</strong> Buka tab <em>Mata Pelajaran</em>, tambahkan ujian dengan memilih mata pelajaran resmi dari Mansatas dan menentukan target tingkat (10, 11, atau 12).
              </li>
              <li>
                <strong>Petakan Audiens & Materialize Roster:</strong> Buka tab <em>Audiens & Roster</em>, pilih kelas-kelas yang mengikuti setiap ujian lalu klik "Generate Roster Semua Ujian".
              </li>
              <li>
                <strong>Atur Sesi Waktu (Time Slots):</strong> Buka tab <em>Sesi Waktu</em>, buat slot waktu pelaksanaan dan jadwalkan ujian tanpa benturan jadwal siswa.
              </li>
              <li>
                <strong>Bank Soal & Token:</strong> Isi butir soal dan generate token ruangan per mata pelajaran.
              </li>
              <li>
                <strong>Evaluasi Kesiapan:</strong> Buka tab <em>Kesiapan (Ready)</em> untuk memvalidasi 8 gate server-authoritative sebelum mengunci konfigurasi dan mengaktifkan ujian.
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* Tab: Peserta */}
      {activeTab === 'peserta' && <SemesterParticipantsTab event={event} />}

      {/* Tab: Ujian */}
      {activeTab === 'ujian' && (
        <SemesterExamsTab
          event={event}
          onSelectExam={(examId, targetTab) => {
            setSelectedExamId(examId);
            setActiveTab(targetTab as WorkspaceTab);
          }}
        />
      )}

      {/* Tab: Audiens */}
      {activeTab === 'audiens' && (
        <SemesterAudienceTab
          event={event}
          selectedExamId={selectedExamId}
          onSelectExam={setSelectedExamId}
        />
      )}

      {/* Tab: Ruang */}
      {activeTab === 'ruang' && <SemesterRoomsTab event={event} />}

      {/* Tab: Denah & Kursi */}
      {activeTab === 'seating' && <SemesterSeatingTab event={event} />}

      {/* Tab: Jadwal */}
      {activeTab === 'jadwal' && <SemesterSchedulingTab event={event} />}

      {/* Tab: Pengawas Ruangan */}
      {activeTab === 'invigilators' && <SemesterInvigilatorsTab event={event} />}

      {/* Tab: Readiness */}
      {activeTab === 'readiness' && (
        <SemesterReadinessTab event={event} onStatusChanged={fetchEventData} />
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
              <label
                style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: C.textMid,
                  textTransform: 'uppercase',
                }}
              >
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
                      [Kls {ex.target_grade}] {ex.title} ({ex.subject_name}) · {ex.question_count || 0} Soal · {ex.roster_count || 0} Siswa
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 700 }}>
                  Belum ada ujian semester yang dibuat. Silakan buat ujian di tab "Mata Pelajaran" terlebih dahulu.
                </span>
              )}
            </div>

            {selectedExam && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: C.textMid }}>
                  Tingkat: <strong>Kelas {selectedExam.target_grade}</strong>
                </span>
                <span style={{ fontSize: '11px', color: C.textMid }}>·</span>
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

          {/* Render Active Shared View */}
          {selectedExam ? (
            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '12px',
                padding: '18px',
              }}
            >
              {activeTab === 'soal' && (
                <QuestionsView examId={selectedExam.id} apiPrefix="/api/semester" />
              )}
              {activeTab === 'token' && (
                <TokensView examId={selectedExam.id} apiPrefix="/api/semester" />
              )}
              {activeTab === 'monitoring' && (
                <MonitorView examId={selectedExam.id} apiPrefix="/api/semester" />
              )}
              {activeTab === 'hasil' && (
                <ResultsView examId={selectedExam.id} apiPrefix="/api/semester" />
              )}
              {activeTab === 'analisis' && (
                <AnalyticsView examId={selectedExam.id} apiPrefix="/api/semester" />
              )}
            </div>
          ) : (
            <div
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '12px',
                padding: '40px',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
                Tidak Ada Ujian yang Dipilih
              </p>
              <p style={{ fontSize: '12px', color: C.textMuted, marginTop: '4px' }}>
                Silakan buat ujian mapel terlebih dahulu pada tab "Mata Pelajaran".
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab('ujian')}
                className="mt-3"
              >
                Buka Tab Mata Pelajaran
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
