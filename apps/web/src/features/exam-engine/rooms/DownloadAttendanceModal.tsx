'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { GET } from '@/lib/api';
import { Modal, Spinner, useToast } from '@/components/ui';
import {
  generateAttendanceDocx,
  downloadDocxBlob,
  ParticipantDocxData,
  MapelAttendanceData,
  AttendanceDocxOptions,
} from '@/lib/attendanceDocx';
import { FileDown } from 'lucide-react';
import type { CbtEvent, Exam, Room } from '../types';
import { C, normalizeJenisKelamin } from '../components/theme';

export function DownloadAttendanceModal({
  open,
  onClose,
  initialEventId,
  initialExamId,
  events,
  exams,
  rooms,
}: {
  open: boolean;
  onClose: () => void;
  initialEventId?: string | null;
  initialExamId?: string | null;
  events: CbtEvent[];
  exams: Exam[];
  rooms: Room[];
}) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState<string>('');
  const [examId, setExamId] = useState<string>('ALL');
  const [roomId, setRoomId] = useState<string>('ALL');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) {
      const evId = initialEventId || (events[0]?.id ?? '');
      setEventId(evId);
      setExamId(initialExamId || 'ALL');
      setRoomId('ALL');
    }
  }, [open, initialEventId, initialExamId, events]);

  const selectedEvent = events.find(e => e.id === eventId) || null;
  const filteredExams = useMemo(() => {
    if (!eventId) return [];
    return exams.filter(e => e.event_id === eventId);
  }, [exams, eventId]);

  const handleDownload = async () => {
    if (!eventId) {
      toast('error', 'Pilih kegiatan terlebih dahulu');
      return;
    }
    setDownloading(true);
    try {
      let targetExams: Exam[] = [];
      if (examId !== 'ALL') {
        const found = exams.find(e => e.id === examId);
        if (found) targetExams = [found];
      } else {
        targetExams = filteredExams;
      }

      if (targetExams.length === 0) {
        targetExams = [{
          id: 'default',
          title: selectedEvent?.name || 'Ujian',
          subject_name: selectedEvent?.name || 'Ujian',
          description: null,
          duration_minutes: 60,
          active_status: 'active',
          question_count: 0,
          is_score_visible: 0,
          randomize_questions: 0,
          randomize_options: 0,
          rules_text: null,
          completion_message: '',
          passing_score: 0,
          target_jalur: null,
          cheat_limit: 3,
          cheat_action: 'lock',
          enforce_fullscreen: 0,
        }];
      }

      const selectedRoom = rooms.find(r => r.id === roomId || r.room_name === roomId);
      const roomFilterName = selectedRoom ? selectedRoom.room_name : (roomId !== 'ALL' ? roomId : undefined);

      const mapelsDocx: MapelAttendanceData[] = [];

      for (const ex of targetExams) {
        let roster: any[] = [];
        if (ex.id !== 'default') {
          const res = await GET<any[]>(`/api/admin/exams/${ex.id}/roster`);
          if (res.success && Array.isArray(res.data)) {
            roster = res.data;
          }
        }

        if (roster.length === 0) {
          const eventRes = await GET<any[]>(`/api/admin/roster?event_id=${eventId}`);
          if (eventRes.success && Array.isArray(eventRes.data)) {
            roster = eventRes.data;
          }
        }

        if (roomFilterName) {
          roster = roster.filter((r: any) =>
            r.room_id === roomId ||
            r.room_name === roomFilterName ||
            r.room_id === roomFilterName
          );
        }

        if (roster.length === 0) continue;

        const subjectTitle = ex.subject_name || ex.title || 'Mata Pelajaran';
        const sampleRow = roster[0];
        const tanggalTes = sampleRow?.tanggal_tes || '-';
        const sesiTes = sampleRow?.sesi_tes || '-';
        const roomNameStr = roomFilterName || sampleRow?.room_name || 'Semua Ruangan';

        const participantData: ParticipantDocxData[] = roster.map((p: any, idx: number) => ({
          no: idx + 1,
          nisn: p.nisn || p.username || '-',
          full_name: p.full_name || 'Peserta',
          gender: normalizeJenisKelamin(p.gender) || '-',
          mapel: subjectTitle,
        }));

        mapelsDocx.push({
          exam_id: ex.id,
          subject_name: subjectTitle,
          title: ex.title,
          tanggal_tes: tanggalTes,
          sesi_tes: sesiTes,
          room_name: roomNameStr,
          participants: participantData,
        });
      }

      if (mapelsDocx.length === 0) {
        toast('error', 'Tidak ada data peserta/roster pada filter yang dipilih');
        setDownloading(false);
        return;
      }

      const docxOptions: AttendanceDocxOptions = {
        event_name: selectedEvent?.name || 'UJIAN CBT',
        event_code: selectedEvent?.code || '',
        room_name: roomFilterName,
        mapels: mapelsDocx,
      };

      const blob = await generateAttendanceDocx(docxOptions);
      const filename = `Absensi-${(selectedEvent?.code || 'UJIAN').replace(/[^a-zA-Z0-9_-]/g, '_')}${roomFilterName ? `-${roomFilterName}` : ''}`;
      downloadDocxBlob(blob, filename);

      toast('success', 'Absensi Word (.docx) berhasil diunduh');
      onClose();
    } catch (err: any) {
      console.error('Error generating attendance docx:', err);
      toast('error', err?.message || 'Gagal membuat file absensi Word');
    } finally {
      setDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Cetak / Download Absensi Word (.docx)" size="md">
      <div style={{ padding: '4px 0' }}>
        <p style={{ fontSize: '12px', color: C.textMid, lineHeight: 1.5, marginBottom: '14px' }}>
          Format dokumen <strong>A4</strong> dengan header resmi kegiatan, margin konsisten, serta tabel absensi dengan kolom <strong>Tanda Tangan Side-to-Side (Ganjil-Genap)</strong> 2-baris.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            KEGIATAN
            <select
              value={eventId}
              onChange={e => { setEventId(e.target.value); setExamId('ALL'); }}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.code} · {ev.name}</option>)}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            MATA PELAJARAN / UJIAN
            <select
              value={examId}
              onChange={e => setExamId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="ALL">Semua Mapel (Lembar terpisah per mapel)</option>
              {filteredExams.map(ex => (
                <option key={ex.id} value={ex.id}>{ex.subject_name || ex.title}{ex.subject_name ? ` (${ex.title})` : ''}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            RUANGAN
            <select
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="ALL">Semua Ruangan</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.room_name}</option>
              ))}
            </select>
          </label>

          <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '10px 12px', marginTop: '4px' }}>
            <p style={{ fontSize: '11px', color: C.green, fontWeight: 800 }}>📌 Fitur Multi-Mapel Page Break</p>
            <p style={{ fontSize: '11px', color: C.textMid, marginTop: '3px', lineHeight: 1.4 }}>
              Jika memilih <strong>Semua Mapel</strong>, setiap mata pelajaran dalam kegiatan ini akan otomatis dipisahkan di lembar A4 tersendiri dengan margin dan header yang tetap konsisten.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            disabled={downloading}
            style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 15px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Batal
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || !eventId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '12px', fontWeight: 900, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1 }}
          >
            {downloading ? <Spinner size={14} /> : <FileDown size={14} />}
            {downloading ? 'Memproses Word...' : 'Download Absensi (.docx)'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default DownloadAttendanceModal;
