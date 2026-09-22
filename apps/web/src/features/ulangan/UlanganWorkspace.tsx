'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, useToast, Spinner, Confirm } from '@/components/ui';
import {
  ArrowLeft,
  BookOpen,
  FileQuestion,
  Users,
  Key,
  Activity,
  Award,
  BarChart3,
  Play,
  CheckCircle2,
  Lock,
  Archive,
  Trash2,
  Clock,
  Shuffle,
} from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import { QuestionsView } from '../exam-engine/questions/QuestionsView';
import { TokensView } from '../exam-engine/tokens/TokensView';
import { MonitorView } from '../exam-engine/monitoring/MonitorView';
import { ResultsView } from '../exam-engine/results/ResultsView';
import { AnalyticsView } from '../exam-engine/analytics/AnalyticsView';
import { UlanganRosterTab } from './UlanganRosterTab';
import { UlanganReadinessTab } from './UlanganReadinessTab';
import type { UlanganExam } from './types';

interface Props {
  examId: string;
  onBack: () => void;
  onDeleted?: () => void;
}

type TabKey = 'ringkasan' | 'soal' | 'peserta' | 'token' | 'pantau' | 'hasil' | 'analitik';

export function UlanganWorkspace({ examId, onBack, onDeleted }: Props) {
  const { toast } = useToast();
  const [exam, setExam] = useState<UlanganExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('ringkasan');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchExam = useCallback(async () => {
    setLoading(true);
    try {
      const res = await GET<UlanganExam>(`/api/ulangan/exams/${examId}`);
      if (res.success && res.data) {
        setExam(res.data);
      } else {
        toast('error', res.error || 'Gagal memuat detail ulangan');
      }
    } catch {
      toast('error', 'Gagal memuat detail ulangan');
    } finally {
      setLoading(false);
    }
  }, [examId, toast]);

  useEffect(() => {
    fetchExam();
  }, [fetchExam]);

  const handleStatusTransition = async (targetStatus: string) => {
    setUpdatingStatus(true);
    try {
      const res = await POST(`/api/ulangan/exams/${examId}/status`, { status: targetStatus });
      if (res.success) {
        toast('success', `Status ulangan berhasil diubah menjadi ${targetStatus.toUpperCase()}`);
        fetchExam();
      } else {
        toast('error', res.error || 'Gagal memperbarui status');
      }
    } catch {
      toast('error', 'Terjadi kesalahan sistem');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDeleteExam = async () => {
    setDeleting(true);
    try {
      const res = await DEL(`/api/ulangan/exams/${examId}`);
      if (res.success) {
        toast('success', 'Ulangan harian berhasil dihapus');
        onDeleted ? onDeleted() : onBack();
      } else {
        toast('error', res.error || 'Gagal menghapus ulangan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat menghapus');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Spinner />
        <p className="text-xs text-gray-400 mt-2">Memuat lembar kerja ulangan...</p>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-gray-200">
        <p className="text-sm font-bold text-gray-700">Ulangan tidak ditemukan</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onBack}>
          <ArrowLeft size={13} /> Kembali
        </Button>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'ringkasan', label: 'Ringkasan & Kesiapan', icon: <CheckCircle2 size={13} /> },
    { key: 'soal', label: 'Soal', icon: <FileQuestion size={13} />, badge: exam.question_count },
    { key: 'peserta', label: 'Peserta Kelas', icon: <Users size={13} />, badge: exam.roster_count },
    { key: 'token', label: 'Token', icon: <Key size={13} /> },
    { key: 'pantau', label: 'Pantau Langsung', icon: <Activity size={13} />, badge: exam.active_session_count },
    { key: 'hasil', label: 'Hasil Nilai', icon: <Award size={13} />, badge: exam.submitted_count },
    { key: 'analitik', label: 'Analisis Butir', icon: <BarChart3 size={13} /> },
  ];

  const canDelete = exam.status === 'draft' || exam.status === 'configuration';

  return (
    <div className="space-y-4">
      {/* Workspace Header */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.border}`,
          borderRadius: '12px',
          padding: '16px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <button
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: C.textMid,
                fontSize: '11.5px',
                fontWeight: 700,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                marginBottom: '8px',
                padding: 0,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.green)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.textMid)}
            >
              <ArrowLeft size={13} /> Kembali ke Daftar Ulangan
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: C.text }}>
                {exam.title}
              </h2>
              <StatusBadge status={exam.status} />
              <span
                style={{
                  background: C.greenLight,
                  color: C.green,
                  border: `1px solid ${C.greenBorder}`,
                  fontSize: '10.5px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '999px',
                }}
              >
                {exam.class_name || 'Kelas Terdaftar'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', fontSize: '11.5px', color: C.textMid }}>
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-gray-400" /> {exam.duration_minutes} Menit
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Award size={12} className="text-gray-400" /> KKM {exam.passing_score}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Shuffle size={12} className="text-gray-400" /> Acak Soal ({exam.randomize_questions ? 'Ya' : 'Tidak'})
              </span>
            </div>
          </div>

          {/* Action lifecycle buttons */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {(exam.status === 'draft' || exam.status === 'configuration') && (
              <Button
                size="sm"
                onClick={() => handleStatusTransition('ready')}
                loading={updatingStatus}
              >
                <CheckCircle2 size={13} /> Tandai Siap
              </Button>
            )}

            {exam.status === 'ready' && (
              <Button
                size="sm"
                onClick={() => handleStatusTransition('active')}
                loading={updatingStatus}
                style={{ background: '#15803d' }}
              >
                <Play size={13} /> Buka Ujian Sekarang
              </Button>
            )}

            {exam.status === 'active' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusTransition('completed')}
                loading={updatingStatus}
                style={{ color: '#b45309' }}
              >
                <Lock size={13} /> Selesaikan Ujian
              </Button>
            )}

            {exam.status === 'completed' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusTransition('archived')}
                loading={updatingStatus}
              >
                <Archive size={13} /> Arsipkan
              </Button>
            )}

            {canDelete && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={updatingStatus || deleting}
                style={{ color: '#dc2626' }}
              >
                <Trash2 size={13} /> Hapus
              </Button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            borderTop: `1px solid ${C.borderLight}`,
            marginTop: '14px',
            paddingTop: '10px',
            overflowX: 'auto',
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === tab.key ? C.greenLight : 'transparent',
                color: activeTab === tab.key ? C.green : C.textMid,
                fontSize: '12px',
                fontWeight: activeTab === tab.key ? 800 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  style={{
                    background: activeTab === tab.key ? C.green : '#edf0ed',
                    color: activeTab === tab.key ? C.white : C.textMid,
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: '999px',
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'ringkasan' && (
        <UlanganReadinessTab
          exam={exam}
          onStatusChanged={() => fetchExam()}
        />
      )}

      {activeTab === 'soal' && (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <QuestionsView examId={exam.id} apiPrefix="/api/ulangan" />
        </div>
      )}

      {activeTab === 'peserta' && (
        <UlanganRosterTab
          exam={exam}
          onRosterUpdated={() => fetchExam()}
        />
      )}

      {activeTab === 'token' && (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <TokensView examId={exam.id} apiPrefix="/api/ulangan" />
        </div>
      )}

      {activeTab === 'pantau' && (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <MonitorView examId={exam.id} apiPrefix="/api/ulangan" />
        </div>
      )}

      {activeTab === 'hasil' && (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <ResultsView examId={exam.id} apiPrefix="/api/ulangan" />
        </div>
      )}

      {activeTab === 'analitik' && (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <AnalyticsView examId={exam.id} apiPrefix="/api/ulangan" />
        </div>
      )}

      <Confirm
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteExam}
        title="Hapus Ulangan Harian?"
        message="Ulangan, butir soal, dan token ujian ini akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan."
      />
    </div>
  );
}
