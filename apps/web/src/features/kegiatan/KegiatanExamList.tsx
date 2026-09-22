'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, Modal, useToast } from '@/components/ui';
import { Plus, ChevronLeft, HelpCircle, Key, Activity, Award, BarChart2, Trash2 } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { Exam } from '../exam-engine/types';
import StatusBadge from '../exam-engine/components/StatusBadge';
import { QuestionsView } from '../exam-engine/questions/QuestionsView';
import { TokensView } from '../exam-engine/tokens/TokensView';
import { MonitorView } from '../exam-engine/monitoring/MonitorView';
import { ResultsView } from '../exam-engine/results/ResultsView';
import { AnalyticsView } from '../exam-engine/analytics/AnalyticsView';

interface Props {
  eventId: string;
  onExamsUpdated?: () => void;
}

type ActiveViewTab = 'soal' | 'tokens' | 'monitoring' | 'results' | 'analytics';

export function KegiatanExamList({ eventId, onExamsUpdated }: Props) {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  // Focus on specific exam
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveViewTab>('soal');

  // Create exam modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [passingScore, setPassingScore] = useState(0);
  const [randomizeQuestions, setRandomizeQuestions] = useState(false);
  const [randomizeOptions, setRandomizeOptions] = useState(false);
  const [enforceFullscreen, setEnforceFullscreen] = useState(false);
  const [subjectName, setSubjectName] = useState('');

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await GET<Exam[]>(`/api/kegiatan/events/${eventId}/exams`);
      if (res.success && res.data) {
        setExams(res.data);
        if (activeExam) {
          const updated = res.data.find((e) => e.id === activeExam.id);
          if (updated) setActiveExam(updated);
        }
      }
    } catch {
      toast('error', 'Gagal memuat daftar ujian kegiatan');
    } finally {
      setLoading(false);
    }
  }, [eventId, activeExam, toast]);

  useEffect(() => {
    fetchExams();
  }, [eventId]);

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast('error', 'Judul ujian wajib diisi');
      return;
    }

    setCreating(true);
    try {
      const res = await POST<{ id: string }>(`/api/kegiatan/events/${eventId}/exams`, {
        title: title.trim(),
        subject_name: subjectName.trim() || null,
        duration_minutes: Number(durationMinutes) || 60,
        passing_score: Number(passingScore) || 0,
        randomize_questions: randomizeQuestions ? 1 : 0,
        randomize_options: randomizeOptions ? 1 : 0,
        enforce_fullscreen: enforceFullscreen ? 1 : 0,
        cheat_action: 'lock',
        cheat_limit: 3,
      });

      if (res.success && res.data) {
        toast('success', 'Ujian kegiatan berhasil dibuat');
        setShowCreateModal(false);
        setTitle('');
        setSubjectName('');
        setDurationMinutes(60);
        setPassingScore(0);
        fetchExams();
        if (onExamsUpdated) onExamsUpdated();
      } else {
        toast('error', res.error || 'Gagal membuat ujian');
      }
    } catch {
      toast('error', 'Terjadi kesalahan jaringan');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm('Yakin ingin menghapus ujian ini beserta seluruh soal dan data terkait?')) return;
    try {
      const res = await DEL(`/api/admin/exams/${examId}`);
      if (res.success) {
        toast('success', 'Ujian berhasil dihapus');
        if (activeExam?.id === examId) setActiveExam(null);
        fetchExams();
        if (onExamsUpdated) onExamsUpdated();
      } else {
        toast('error', res.error || 'Gagal menghapus ujian');
      }
    } catch {
      toast('error', 'Terjadi kesalahan');
    }
  };

  // If focused on an exam, render the focused exam workspace composing shared views
  if (activeExam) {
    return (
      <div className="space-y-4">
        {/* Top return bar */}
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => { setActiveExam(null); fetchExams(); }}
              style={{ background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', color: C.textMid }}
            >
              <ChevronLeft size={14} />
              Daftar Ujian Kegiatan
            </button>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: C.text }}>{activeExam.title}</h3>
              <p style={{ fontSize: '11px', color: C.textFaint }}>Durasi: {activeExam.duration_minutes} Menit · {activeExam.question_count || 0} Soal</p>
            </div>
          </div>

          {/* Sub Tab Switcher for Exam */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { key: 'soal', label: 'Bank Soal', icon: HelpCircle },
              { key: 'tokens', label: 'Token Ruangan', icon: Key },
              { key: 'monitoring', label: 'Live Monitoring', icon: Activity },
              { key: 'results', label: 'Nilai & Hasil', icon: Award },
              { key: 'analytics', label: 'Analisis Soal', icon: BarChart2 },
            ].map((t) => {
              const Icon = t.icon;
              const isSel = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key as ActiveViewTab)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '11.5px',
                    fontWeight: isSel ? 800 : 600,
                    background: isSel ? C.greenLight : C.white,
                    color: isSel ? C.green : C.textMid,
                    border: `1.5px solid ${isSel ? C.greenBorder : C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Render composed shared examination engine views */}
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '18px' }}>
          {activeTab === 'soal' && <QuestionsView examId={activeExam.id} />}
          {activeTab === 'tokens' && <TokensView examId={activeExam.id} />}
          {activeTab === 'monitoring' && <MonitorView examId={activeExam.id} />}
          {activeTab === 'results' && <ResultsView examId={activeExam.id} />}
          {activeTab === 'analytics' && <AnalyticsView examId={activeExam.id} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: C.text }}>Ujian pada Kegiatan Ini</h3>
          <p style={{ fontSize: '11.5px', color: C.textMid }}>Setiap kegiatan dapat memiliki satu atau lebih ujian/mata pelajaran dengan bank soal tersendiri.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus size={14} />
          Tambah Ujian Baru
        </Button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: C.textMuted }}>Memuat daftar ujian kegiatan...</div>
      ) : exams.length === 0 ? (
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '40px', textAlign: 'center' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>Belum Ada Ujian Terdaftar</p>
          <p style={{ fontSize: '11.5px', color: C.textMuted, marginTop: '4px' }}>Tambahkan mata pelajaran atau cabang ujian untuk kegiatan ini.</p>
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus size={13} /> Buat Ujian Pertama
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
          {exams.map((ex) => (
            <div
              key={ex.id}
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <StatusBadge status={ex.active_status} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: C.textMid }}>
                    {ex.duration_minutes} Menit
                  </span>
                </div>

                <h4 style={{ fontSize: '14px', fontWeight: 800, color: C.text, marginTop: '8px' }}>
                  {ex.title}
                </h4>
                {ex.subject_name && (
                  <p style={{ fontSize: '11px', color: '#1a5fa8', fontWeight: 700, marginTop: '2px' }}>
                    Mapel: {ex.subject_name}
                  </p>
                )}
                <p style={{ fontSize: '11.5px', color: C.textMid, marginTop: '4px' }}>
                  {ex.question_count || 0} Butir Soal Terdaftar
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${C.borderLight}` }}>
                <button
                  onClick={() => handleDeleteExam(ex.id)}
                  title="Hapus Ujian"
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px' }}
                >
                  <Trash2 size={14} />
                </button>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => { setActiveExam(ex); setActiveTab('soal'); }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '7px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: C.greenLight,
                      color: C.green,
                      border: `1px solid ${C.greenBorder}`,
                      cursor: 'pointer',
                    }}
                  >
                    Kelola Soal
                  </button>
                  <button
                    onClick={() => { setActiveExam(ex); setActiveTab('tokens'); }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '7px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: '#f1f5f9',
                      color: '#334155',
                      border: `1px solid #cbd5e1`,
                      cursor: 'pointer',
                    }}
                  >
                    Token
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Create Exam */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Tambah Ujian Baru pada Kegiatan" size="md">
        <form onSubmit={handleCreateExam} className="space-y-3">
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
              Judul Ujian <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Seleksi OSN Matematika Tahap 1"
              style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12.5px', marginTop: '4px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
                Mata Pelajaran (Opsional)
              </label>
              <input
                type="text"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="Contoh: Matematika"
                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12.5px', marginTop: '4px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
                Durasi (Menit)
              </label>
              <input
                type="number"
                min={1}
                max={600}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12.5px', marginTop: '4px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', paddingTop: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={randomizeQuestions}
                onChange={(e) => setRandomizeQuestions(e.target.checked)}
              />
              Acak Soal
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={randomizeOptions}
                onChange={(e) => setRandomizeOptions(e.target.checked)}
              />
              Acak Opsi Pilihan
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enforceFullscreen}
                onChange={(e) => setEnforceFullscreen(e.target.checked)}
              />
              Paksa Fullscreen
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: `1px solid ${C.border}` }}>
            <Button variant="secondary" size="sm" onClick={() => setShowCreateModal(false)} disabled={creating}>
              Batal
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={creating}>
              {creating ? 'Membuat...' : 'Buat Ujian'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
