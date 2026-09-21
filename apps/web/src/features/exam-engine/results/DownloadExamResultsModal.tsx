'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { GET } from '@/lib/api';
import { Modal, Spinner, useToast } from '@/components/ui';
import {
  generateExamResultsDocx,
  downloadResultsDocxBlob,
  formatClassName,
  ExamResultDocxItem,
  MapelResultsData,
} from '@/lib/examResultsDocx';
import { FileDown } from 'lucide-react';
import type { CbtEvent, Exam, Room } from '../types';
import { C } from '../components/theme';

export function DownloadExamResultsModal({
  open,
  onClose,
  initialExamId,
  events,
  exams,
  rooms,
}: {
  open: boolean;
  onClose: () => void;
  initialExamId?: string | null;
  events: CbtEvent[];
  exams: Exam[];
  rooms: Room[];
}) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState<string>('');
  const [selectedExamId, setSelectedExamId] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'score' | 'name'>('score');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialExamId) {
        const found = exams.find(e => e.id === initialExamId);
        if (found) {
          setEventId(found.event_id || (events[0]?.id || ''));
          setSelectedExamId(found.id);
          return;
        }
      }
      if (events[0]) {
        setEventId(events[0].id);
        setSelectedExamId('ALL');
      }
    }
  }, [open, initialExamId, events, exams]);

  const filteredExams = useMemo(() => {
    if (!eventId) return exams;
    return exams.filter(e => e.event_id === eventId);
  }, [exams, eventId]);

  const handleDownload = async () => {
    if (!eventId) {
      toast('error', 'Pilih kegiatan terlebih dahulu');
      return;
    }
    const selectedEvent = events.find(e => e.id === eventId);

    const targetExams = selectedExamId === 'ALL'
      ? filteredExams
      : exams.filter(e => e.id === selectedExamId);

    if (targetExams.length === 0) {
      toast('error', 'Tidak ada ujian/mapel yang tersedia');
      return;
    }

    setLoading(true);
    try {
      const mapelsData: MapelResultsData[] = [];

      for (const targetExam of targetExams) {
        const response = await GET<any[]>(`/api/admin/exams/${targetExam.id}/results-export`);
        if (response.success && response.data) {
          let rawData = response.data || [];
          if (selectedRoom !== 'all') {
            rawData = rawData.filter((item: any) =>
              item.room_id === selectedRoom || item.room_name === selectedRoom
            );
          }

          const results: ExamResultDocxItem[] = rawData.map((item: any) => ({
            nisn: item.nisn || item.username || '-',
            full_name: item.full_name || 'Peserta',
            class_name: formatClassName(item.class_name || item.grade, item.room_name),
            total_questions: Number(item.total_questions || 0),
            total_correct: Number(item.total_correct || 0),
            total_wrong: Number(item.total_wrong || 0),
            total_unanswered: Number(item.total_unanswered || 0),
            score: Number(item.score || 0),
            room_name: item.room_name || '-',
            status_pengerjaan: item.status_pengerjaan || 'Selesai',
          }));

          if (results.length > 0) {
            const roomObj = rooms.find(r => r.id === selectedRoom);
            mapelsData.push({
              exam_id: targetExam.id,
              exam_title: targetExam.title,
              subject_name: targetExam.subject_name || targetExam.title,
              room_name: selectedRoom === 'all' ? 'Semua Ruangan / Kelas' : (roomObj?.room_name || selectedRoom),
              results,
            });
          }
        }
      }

      if (mapelsData.length === 0) {
        toast('error', 'Tidak ada data hasil pengerjaan peserta untuk pilihan ini');
        setLoading(false);
        return;
      }

      const blob = await generateExamResultsDocx({
        event_name: selectedEvent?.name || 'CBT MAN 1 TASIKMALAYA',
        sortBy,
        mapels: mapelsData,
      });

      const roomFilterName = selectedRoom !== 'all' ? (rooms.find(r => r.id === selectedRoom)?.room_name || selectedRoom) : '';
      const mapelName = selectedExamId === 'ALL' ? 'Semua_Mapel' : (targetExams[0]?.title || 'Hasil').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `Hasil_${(selectedEvent?.code || 'UJIAN').replace(/[^a-zA-Z0-9_-]/g, '_')}_${mapelName}${roomFilterName ? `_${roomFilterName}` : ''}_${sortBy === 'score' ? 'Peringkat' : 'Nama'}`;

      downloadResultsDocxBlob(blob, fileName);

      toast('success', 'File Word (.docx) hasil ujian berhasil di-download!');
      onClose();
    } catch (err: any) {
      console.error('Error generating exam results docx:', err);
      toast('error', 'Gagal membuat file Word hasil ujian');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Cetak / Download Hasil Ujian Word (.docx)" size="md">
      <div style={{ padding: '4px 0' }}>
        <p style={{ fontSize: '12px', color: C.textMid, lineHeight: 1.5, marginBottom: '14px' }}>
          Format dokumen <strong>A4</strong> hasil pengerjaan ujian, lengkap dengan kolom <strong>Kelas</strong>, <strong>Jawaban Benar</strong>, <strong>Nilai Akhir</strong>, ringkasan statistik, dan footer tanda tangan.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            KEGIATAN
            <select
              value={eventId}
              onChange={e => { setEventId(e.target.value); setSelectedExamId('ALL'); }}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.code} · {ev.name}</option>)}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            MATA PELAJARAN / UJIAN
            <select
              value={selectedExamId}
              onChange={e => setSelectedExamId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="ALL">Semua Mapel (Lembar terpisah per mapel)</option>
              {filteredExams.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.subject_name || ex.title}{ex.subject_name ? ` (${ex.title})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            URUTAN DATA (SORTING)
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'score' | 'name')}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="score">🏆 Urutkan Berdasarkan Nilai Tertinggi (Peringkat / Rank)</option>
              <option value="name">🔤 Urutkan Berdasarkan Nama Peserta (A - Z)</option>
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            RUANGAN / KELAS
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="all">Semua Ruangan / Kelas</option>
              {rooms.map(rm => (
                <option key={rm.id} value={rm.id}>
                  {rm.room_name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '10px 12px', marginTop: '4px' }}>
            <p style={{ fontSize: '11px', color: C.green, fontWeight: 800 }}>📌 Fitur Multi-Mapel Page Break</p>
            <p style={{ fontSize: '11px', color: C.textMid, marginTop: '3px', lineHeight: 1.4 }}>
              Jika memilih <strong>Semua Mapel</strong>, rekap hasil pengerjaan setiap mata pelajaran dalam kegiatan ini akan otomatis dipisahkan di lembar A4 tersendiri.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 15px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Batal
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !eventId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '12px', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <Spinner size={14} /> : <FileDown size={14} />}
            {loading ? 'Memproses Word...' : 'Download Hasil (.docx)'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default DownloadExamResultsModal;
