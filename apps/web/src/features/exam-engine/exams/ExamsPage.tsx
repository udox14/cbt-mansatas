'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { EmptyState, useToast, Confirm, Spinner } from '@/components/ui';
import {
  Plus, FileDown, Pencil, Trash2, ChevronLeft, ArrowRight,
} from 'lucide-react';
import type { Exam, CbtEvent, Room, ExamTab } from '../types';
import { DEFAULT_RULES_TEMPLATE, DEFAULT_COMPLETION_MESSAGE, EXAM_TABS } from '../types';
import { C } from '../components/theme';
import StatusBadge from '../components/StatusBadge';
import ExamEditModal from './ExamEditModal';
import QuestionsView from '../questions/QuestionsView';
import TokensView from '../tokens/TokensView';
import AssignmentsView from '../assignments/AssignmentsView';
import MonitorView from '../monitoring/MonitorView';
import ResultsView from '../results/ResultsView';
import AnalyticsView from '../analytics/AnalyticsView';
import DownloadAttendanceModal from '../rooms/DownloadAttendanceModal';
import DownloadExamResultsModal from '../results/DownloadExamResultsModal';

export function ExamsPage({ activeEventId }: { activeEventId?: string | null }) {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [activeTab, setActiveTab] = useState<ExamTab>('soal');
  const [confirmDel, setConfirmDel] = useState<Exam | null>(null);
  const [jalurList, setJalurList] = useState<string[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(() => activeEventId || 'ALL');
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);
  const [attendanceExamId, setAttendanceExamId] = useState<string | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [resultsExamId, setResultsExamId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    setSelectedEventId(activeEventId || 'ALL');
  }, [activeEventId]);

  const filteredExams = useMemo(() => {
    if (selectedEventId === 'ALL') return exams;
    if (selectedEventId === 'NO_EVENT') return exams.filter(e => !e.event_id);
    return exams.filter(e => e.event_id === selectedEventId);
  }, [exams, selectedEventId]);

  const fetchExams = useCallback(async () => {
    const [r, j, e, rm] = await Promise.all([
      GET<Exam[]>('/api/admin/exams'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
      GET<CbtEvent[]>('/api/admin/events'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    if (r.success) setExams(r.data || []);
    if (j.success) setJalurList(j.data || []);
    if (e.success) setEvents(e.data || []);
    if (rm.success) setRooms(rm.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetchExams(); }, [fetchExams]);

  const saveExam = async () => {
    if (!editExam?.title) { toast('error', 'Judul wajib'); return; }
    if (!editExam.event_id) { toast('error', 'Pilih kegiatan terlebih dahulu'); return; }
    setSaving(true);
    const payload = {
      ...editExam,
      event_id: editExam.event_id,
      subject_name: editExam.subject_name || null,
      sequence_order: Number(editExam.sequence_order || 0),
      cheat_action: 'lock',
    };
    const r = editExam.id ? await PUT(`/api/admin/exams/${editExam.id}`, payload) : await POST('/api/admin/exams', payload);
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditExam(null); fetchExams(); } else toast('error', r.error || 'Gagal');
  };
  const deleteExam = async () => {
    if (!confirmDel) return;
    await DEL(`/api/admin/exams/${confirmDel.id}`);
    toast('success', 'Ujian dihapus');
    setConfirmDel(null);
    if (selectedExam?.id === confirmDel.id) setSelectedExam(null);
    fetchExams();
  };
  const openDetail = (exam: Exam) => { setSelectedExam(exam); setActiveTab('soal'); };
  const openNewExam = () => {
    const defaultEvId = (selectedEventId !== 'ALL' && selectedEventId !== 'NO_EVENT')
      ? selectedEventId
      : (events.find(e => e.id === 'event-pmb')?.id || events[0]?.id || '');

    setEditExam({
      duration_minutes: 60,
      active_status: 'draft',
      event_id: defaultEvId,
      subject_name: '',
      sequence_order: 1,
      rules_text: DEFAULT_RULES_TEMPLATE,
      completion_message: DEFAULT_COMPLETION_MESSAGE,
    });
  };

  if (selectedExam) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <button onClick={() => setSelectedExam(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7c6e', fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} strokeWidth={2.5} /> Daftar Ujian
          </button>
          <span style={{ color: C.borderMid }}>›</span>
          <span style={{ color: C.text, fontSize: '12px', fontWeight: 700 }}>{selectedExam.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{ color: C.text, fontSize: '16px', fontWeight: 900, letterSpacing: '-0.3px' }}>{selectedExam.title}</span>
              <StatusBadge status={selectedExam.active_status} />
            </div>
            <p style={{ color: C.green, fontSize: '11px', fontWeight: 800, marginBottom: '4px' }}>
              {selectedExam.event_code || 'KEGIATAN'} · {selectedExam.event_name || 'Belum terhubung'}
              {selectedExam.subject_name ? ` · Mapel: ${selectedExam.subject_name}` : ''}
              {selectedExam.sequence_order ? ` · Urutan ${selectedExam.sequence_order}` : ''}
            </p>
            <p style={{ color: C.textMuted, fontSize: '11.5px' }}>
              {selectedExam.duration_minutes} menit · {selectedExam.question_count} soal
              {selectedExam.randomize_questions ? ' · Acak soal' : ''}
              {selectedExam.randomize_options ? ' · Acak opsi' : ''}
              {selectedExam.is_score_visible ? ' · Skor tampil' : ''}
              {selectedExam.target_jalur ? ` · Target: ${selectedExam.target_jalur}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => { setAttendanceEventId(selectedExam.event_id || null); setAttendanceExamId(selectedExam.id); setShowAttendanceModal(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '11.5px', fontWeight: 800, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
              <FileDown size={13} strokeWidth={2} /> Cetak Absensi (.docx)
            </button>
            <button onClick={() => { setResultsExamId(selectedExam.id); setShowResultsModal(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '11.5px', fontWeight: 800, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
              <FileDown size={13} strokeWidth={2} /> Cetak Hasil (.docx)
            </button>
            <button onClick={() => setEditExam(selectedExam)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.bg, color: C.textMid, fontSize: '11.5px', fontWeight: 700, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.borderMid}`, cursor: 'pointer' }}>
              <Pencil size={12} strokeWidth={2} /> Edit
            </button>
            <button onClick={() => setConfirmDel(selectedExam)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fef2f2', color: '#dc2626', fontSize: '11.5px', fontWeight: 700, padding: '7px 13px', borderRadius: '10px', border: '1.5px solid #fecaca', cursor: 'pointer' }}>
              <Trash2 size={12} strokeWidth={2} /> Hapus
            </button>
          </div>
        </div>
      </div>

      {/* flat tabs */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', display: 'flex' }}>
        {EXAM_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              padding: '11px 18px 10px', fontSize: '12.5px',
              fontWeight: activeTab === t.key ? 800 : 600,
              color: activeTab === t.key ? C.green : C.textMuted,
              background: 'none', border: 'none',
              borderBottom: `2.5px solid ${activeTab === t.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {activeTab === 'soal' && <QuestionsView examId={selectedExam.id} />}
        {activeTab === 'token' && <TokensView examId={selectedExam.id} />}
        {activeTab === 'peserta' && <AssignmentsView examId={selectedExam.id} eventId={selectedExam.event_id} />}
        {activeTab === 'monitor' && <MonitorView examId={selectedExam.id} />}
        {activeTab === 'hasil' && <ResultsView examId={selectedExam.id} />}
        {activeTab === 'analitik' && <AnalyticsView examId={selectedExam.id} />}
      </div>

      <ExamEditModal
        open={!!editExam}
        onClose={() => setEditExam(null)}
        editExam={editExam}
        setEditExam={setEditExam}
        events={events}
        jalurList={jalurList}
        saving={saving}
        saveExam={saveExam}
      />
      <Confirm open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={deleteExam}
        title="Hapus Ujian?" message={`Ujian "${confirmDel?.title}" beserta semua soal dan hasil akan dihapus permanen.`} />
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>Daftar Ujian</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>
            {filteredExams.length} dari {exams.length} ujian terdaftar
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setAttendanceEventId(selectedEventId !== 'ALL' && selectedEventId !== 'NO_EVENT' ? selectedEventId : null); setAttendanceExamId('ALL'); setShowAttendanceModal(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '12px', fontWeight: 800, padding: '8px 14px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
            <FileDown size={13} strokeWidth={2.5} /> Cetak Absensi (.docx)
          </button>
          <button onClick={() => { setResultsExamId(null); setShowResultsModal(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '12px', fontWeight: 800, padding: '8px 14px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
            <FileDown size={13} strokeWidth={2.5} /> Cetak Hasil (.docx)
          </button>
          <button onClick={openNewExam}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Buat Ujian
          </button>
        </div>
      </div>

      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setSelectedEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${selectedEventId === 'ALL' ? C.green : C.borderMid}`,
            background: selectedEventId === 'ALL' ? C.greenLight : C.white,
            color: selectedEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({exams.length})
        </button>
        {events.map(ev => {
          const count = exams.filter(x => x.event_id === ev.id).length;
          const isSelected = selectedEventId === ev.id;
          return (
            <button key={ev.id} type="button" onClick={() => setSelectedEventId(ev.id)}
              style={{
                padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1.5px solid ${isSelected ? C.green : C.borderMid}`,
                background: isSelected ? C.greenLight : C.white,
                color: isSelected ? C.green : C.textMuted,
                transition: 'all 0.12s',
              }}>
              {ev.code} · {ev.name} ({count})
            </button>
          );
        })}
        {exams.some(x => !x.event_id) && (
          <button type="button" onClick={() => setSelectedEventId('NO_EVENT')}
            style={{
              padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1.5px solid ${selectedEventId === 'NO_EVENT' ? C.green : C.borderMid}`,
              background: selectedEventId === 'NO_EVENT' ? C.greenLight : C.white,
              color: selectedEventId === 'NO_EVENT' ? C.green : C.textMuted,
              transition: 'all 0.12s',
            }}>
            Tanpa Kegiatan ({exams.filter(x => !x.event_id).length})
          </button>
        )}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filteredExams.length === 0 ? (
            <div className="py-10 text-center space-y-3 bg-white rounded-2xl border border-gray-200 p-6">
              <EmptyState title="Belum ada ujian pada kegiatan ini" desc="Klik tombol di bawah untuk membuat ujian baru." />
              <button onClick={openNewExam}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
                <Plus size={13} strokeWidth={2.5} /> Buat Ujian Baru
              </button>
            </div>
          ) : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '16px', overflow: 'hidden' }}>
              {filteredExams.map((exam, i) => (
                <div key={exam.id} onClick={() => openDetail(exam)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '13px 18px',
                    borderBottom: i < filteredExams.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                    cursor: 'pointer', opacity: exam.active_status === 'finished' ? 0.65 : 1,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9fbf9')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                      <span style={{ color: exam.active_status === 'finished' ? '#6b7c6e' : C.text, fontSize: '13.5px', fontWeight: 800 }}>{exam.title}</span>
                      <StatusBadge status={exam.active_status} />
                    </div>
                    <p style={{ color: C.green, fontSize: '10.5px', fontWeight: 800, marginBottom: '3px' }}>
                      {exam.event_code || 'KEGIATAN'} · {exam.event_name || 'Belum terhubung'}
                      {exam.subject_name ? ` · Mapel: ${exam.subject_name}` : ''}
                      {exam.sequence_order ? ` · #${exam.sequence_order}` : ''}
                    </p>
                    <p style={{ color: exam.active_status === 'finished' ? C.textFaint : C.textMuted, fontSize: '11.5px' }}>
                      {exam.duration_minutes} menit · {exam.question_count} soal
                      {exam.randomize_questions ? ' · Acak soal' : ''}
                      {exam.randomize_options ? ' · Acak opsi' : ''}
                      {exam.is_score_visible ? ' · Skor tampil' : ''}
                      {exam.target_jalur ? ` · ${exam.target_jalur}` : ''}
                    </p>
                  </div>
                  <ArrowRight size={15} strokeWidth={2} color={C.borderMid} />
                </div>
              ))}
            </div>
          )}
      </div>

      <ExamEditModal
        open={!!editExam}
        onClose={() => setEditExam(null)}
        editExam={editExam}
        setEditExam={setEditExam}
        events={events}
        jalurList={jalurList}
        saving={saving}
        saveExam={saveExam}
      />

      <DownloadAttendanceModal
        open={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
        initialEventId={attendanceEventId}
        initialExamId={attendanceExamId}
        events={events}
        exams={exams}
        rooms={rooms}
      />

      <DownloadExamResultsModal
        open={showResultsModal}
        onClose={() => setShowResultsModal(false)}
        initialExamId={resultsExamId}
        events={events}
        exams={exams}
        rooms={rooms}
      />
    </div>
  );
}

export default ExamsPage;
