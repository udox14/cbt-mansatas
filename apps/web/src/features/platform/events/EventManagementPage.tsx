'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { LoadingScreen, useToast } from '@/components/ui';
import { Plus, FileDown, Trash2 } from 'lucide-react';
import type { CbtEvent, Exam, Room, RosterParticipant } from '../../exam-engine/types';
import { C } from '../../exam-engine/components/theme';
import DownloadAttendanceModal from '../../exam-engine/rooms/DownloadAttendanceModal';

export function EventManagementPage({
  activeEventId,
  setActiveEventId,
}: {
  activeEventId?: string | null;
  setActiveEventId?: (id: string | null) => void;
}) {
  const { toast } = useToast();
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [eventId, setEventId] = useState(() => activeEventId || '');

  useEffect(() => {
    if (activeEventId) setEventId(activeEventId);
  }, [activeEventId]);
  const [examId, setExamId] = useState('');
  const [participants, setParticipants] = useState<RosterParticipant[]>([]);
  const [roster, setRoster] = useState<RosterParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantLoading, setParticipantLoading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [q, setQ] = useState('');
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState('');
  const [gender, setGender] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [roomId, setRoomId] = useState('');
  const [tanggalTes, setTanggalTes] = useState('');
  const [sesiTes, setSesiTes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [newEvent, setNewEvent] = useState({ code: '', name: '', activity_type: 'other', participant_source: 'mansatas' });

  const selectedEvent = events.find(e => e.id === eventId);
  const eventExams = useMemo(() => exams.filter(exam => exam.event_id === eventId), [exams, eventId]);
  const selectedExam = eventExams.find(exam => exam.id === examId);
  const pageSize = 50;

  const loadBase = useCallback(async () => {
    const [eventResponse, examResponse, roomResponse] = await Promise.all([
      GET<CbtEvent[]>('/api/admin/events'),
      GET<Exam[]>('/api/admin/exams'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    if (eventResponse.success) {
      const next = eventResponse.data || [];
      setEvents(next);
      if (!eventId && next[0]) setEventId(next[0].id);
    }
    if (examResponse.success) {
      setExams(examResponse.data || []);
    }
    if (roomResponse.success) setRooms(roomResponse.data || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { loadBase(); }, [loadBase]);

  useEffect(() => {
    if (!eventId) return;
    if (!eventExams.some(exam => exam.id === examId)) setExamId(eventExams[0]?.id || '');
  }, [eventId, eventExams, examId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setParticipantLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q.trim()) params.set('q', q.trim());
    if (className) params.set('class_name', className);
    if (grade) params.set('grade', grade);
    if (gender) params.set('gender', gender);
    if (activeFilter !== 'all') params.set('is_active', activeFilter);
    GET<{ items: RosterParticipant[]; pagination: { total: number } }>(`/api/admin/events/${eventId}/participants?${params.toString()}`)
      .then(response => {
        if (cancelled) return;
        if (response.success) {
          setParticipants(response.data?.items || []);
          setTotal(response.data?.pagination?.total || 0);
        } else toast('error', response.error || 'Peserta tidak dapat dimuat');
      })
      .finally(() => { if (!cancelled) setParticipantLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, page, q, className, grade, gender, activeFilter, toast]);

  const loadRoster = useCallback(async () => {
    if (!examId) { setRoster([]); return; }
    setRosterLoading(true);
    const response = await GET<RosterParticipant[]>(`/api/admin/exams/${examId}/roster`);
    if (response.success) setRoster(response.data || []);
    else toast('error', response.error || 'Roster tidak dapat dimuat');
    setRosterLoading(false);
  }, [examId, toast]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  const resetSelection = () => { setSelectedIds([]); setSelectAll(false); };
  const resetFilters = () => {
    setQ(''); setClassName(''); setGrade(''); setGender(''); setActiveFilter('all'); setPage(1); resetSelection();
  };
  const toggleParticipant = (id: string) => {
    setSelectAll(false);
    setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };
  const togglePage = () => {
    setSelectAll(false);
    const ids = participants.map(p => p.source_id);
    setSelectedIds(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : Array.from(new Set([...current, ...ids])));
  };

  const assignRoster = async () => {
    if (!eventId || !examId || !selectedExam) { toast('error', 'Pilih kegiatan dan mapel yang sesuai'); return; }
    if (!selectAll && selectedIds.length === 0) { toast('error', 'Pilih peserta atau semua hasil filter'); return; }
    setSaving(true);
    const response = await POST(`/api/admin/exams/${examId}/roster/batch`, {
      event_id: eventId,
      select_all: selectAll,
      participant_ids: selectAll ? [] : selectedIds,
      filters: { q, class_name: className, grade, gender, is_active: activeFilter === 'all' ? undefined : activeFilter === 'true' },
      room_id: roomId || null,
      tanggal_tes: tanggalTes,
      sesi_tes: sesiTes,
    });
    setSaving(false);
    if (!response.success) { toast('error', response.error || 'Assignment gagal'); return; }
    toast('success', `Matched ${response.data?.matched || 0}, ditambahkan ${response.data?.added || 0}, dilewati ${response.data?.skipped || 0}`);
    resetSelection();
    loadRoster();
  };

  const createEvent = async () => {
    if (!newEvent.code.trim() || !newEvent.name.trim()) { toast('error', 'Kode dan nama kegiatan wajib diisi'); return; }
    const response = await POST('/api/admin/events', newEvent);
    if (!response.success) { toast('error', response.error || 'Kegiatan gagal dibuat'); return; }
    toast('success', 'Kegiatan dibuat');
    setShowCreate(false);
    setNewEvent({ code: '', name: '', activity_type: 'other', participant_source: 'mansatas' });
    await loadBase();
    if (response.data?.id) setEventId(response.data.id);
  };

  const removeRoster = async (row: RosterParticipant & { id?: string }) => {
    if (!row.id || !examId || !window.confirm(`Hapus ${row.full_name} dari roster?`)) return;
    const response = await DEL(`/api/admin/exams/${examId}/roster/${row.id}`);
    if (response.success) { toast('success', 'Roster dihapus'); loadRoster(); }
    else toast('error', response.error || 'Roster tidak dapat dihapus');
  };

  if (loading) return <LoadingScreen />;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allPageSelected = participants.length > 0 && participants.every(p => selectedIds.includes(p.source_id));

  return (
    <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
      <div style={{ maxWidth: '1450px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ color: C.text, fontSize: '19px', fontWeight: 900, letterSpacing: '-0.3px' }}>Kegiatan & roster</h1>
            <p style={{ color: C.textMuted, fontSize: '12px', marginTop: '3px' }}>Pilih peserta berdasarkan filter lalu simpan snapshot roster per ujian.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowAttendanceModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.white, color: C.green, border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '9px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              <FileDown size={14} /> Cetak Absensi (.docx)
            </button>
            <button onClick={() => setShowCreate(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              <Plus size={14} /> Kegiatan baru
            </button>
          </div>
        </div>

        {showCreate && (
          <div style={{ background: C.white, border: `1.5px solid ${C.greenBorder}`, borderRadius: '14px', padding: '14px', marginBottom: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(180px, 1fr) 150px 160px auto', gap: '8px', alignItems: 'end' }}>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KODE<input value={newEvent.code} onChange={e => setNewEvent({ ...newEvent, code: e.target.value.toUpperCase() })} placeholder="OSN" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>NAMA KEGIATAN<input value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })} placeholder="Olimpiade Sains Nasional" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>JENIS<input value={newEvent.activity_type} onChange={e => setNewEvent({ ...newEvent, activity_type: e.target.value })} placeholder="olimpiade" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SUMBER<select value={newEvent.participant_source} onChange={e => setNewEvent({ ...newEvent, participant_source: e.target.value })} style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="mansatas">mansatas-db</option><option value="pmb">PMB</option><option value="cbt_user">Manual CBT</option></select></label>
              <button onClick={createEvent} style={{ background: '#1a5fa8', color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>Simpan</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 1.2fr) 110px', gap: '10px', marginBottom: '14px' }}>
          <label style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px', fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KEGIATAN
            <select value={eventId} onChange={e => { setEventId(e.target.value); setPage(1); resetSelection(); }} style={{ width: '100%', border: 'none', outline: 'none', marginTop: '5px', color: C.text, fontWeight: 700, fontSize: '13px', background: C.white }}>{events.map(e => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select>
          </label>
          <label style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px', fontSize: '10px', color: C.textMid, fontWeight: 800 }}>UJIAN / MAPEL
            <select value={examId} onChange={e => setExamId(e.target.value)} style={{ width: '100%', border: 'none', outline: 'none', marginTop: '5px', color: C.text, fontWeight: 700, fontSize: '13px', background: C.white }}>
              {!eventExams.length && <option value="">Belum ada ujian untuk kegiatan ini</option>}
              {eventExams.map(e => <option key={e.id} value={e.id}>{e.subject_name || e.title}{e.subject_name ? ` · ${e.title}` : ''}</option>)}
            </select>
          </label>
          <div style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px' }}><p style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SUMBER</p><p style={{ marginTop: '5px', fontSize: '13px', fontWeight: 900, color: C.green }}>{selectedEvent?.participant_source || '-'}</p></div>
        </div>

        <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px', marginBottom: '14px' }}>
          <p style={{ color: C.green, fontSize: '11px', fontWeight: 900 }}>Roster per mapel</p>
          <p style={{ color: C.textMid, fontSize: '11px', lineHeight: 1.5, marginTop: '3px' }}>
            {selectedExam
              ? <>Peserta yang dipilih akan masuk ke <strong>{selectedExam.subject_name || selectedExam.title}</strong> saja. Siswa yang sama boleh dipilih lagi pada mapel lain.</>
              : 'Buat ujian/mapel terlebih dahulu dari menu Ujian, lalu pilih mapel tersebut di sini.'}
          </p>
        </div>

        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', padding: '14px', marginBottom: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.5fr) repeat(4, minmax(100px, 1fr)) auto', gap: '8px', alignItems: 'end' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>CARI NAMA / NISN<input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Ketik pencarian..." style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KELAS<input value={className} onChange={e => { setClassName(e.target.value); setPage(1); }} placeholder="Semua" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TINGKAT<input value={grade} onChange={e => { setGrade(e.target.value); setPage(1); }} placeholder="Semua" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>JENIS KELAMIN<select value={gender} onChange={e => { setGender(e.target.value); setPage(1); }} style={{ width: '100%', marginTop: '5px', padding: '9px 7px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="">Semua</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>STATUS<select value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setPage(1); }} style={{ width: '100%', marginTop: '5px', padding: '9px 7px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="all">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
            <button onClick={resetFilters} style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>Reset</button>
          </div>
          {selectedEvent?.participant_source === 'pmb' && <p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '9px' }}>Filter kelas/tingkat belum tersedia pada sumber PMB legacy; jalur, ruang, tanggal, dan sesi tetap dipertahankan pada API lama.</p>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 0.9fr)', gap: '14px', alignItems: 'start' }}>
          <section style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1.5px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div><p style={{ color: C.text, fontSize: '13px', fontWeight: 900 }}>Peserta sumber</p><p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '2px' }}>{total.toLocaleString('id-ID')} hasil · halaman {page}/{totalPages}</p></div>
              <button onClick={() => { setSelectAll(true); setSelectedIds([]); }} disabled={participantLoading || total === 0} style={{ background: selectAll ? C.greenLight : '#e0f0ff', color: selectAll ? C.green : '#1a5fa8', border: `1.5px solid ${selectAll ? C.greenBorder : '#b7d6f5'}`, borderRadius: '9px', padding: '8px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>✓ Pilih semua hasil filter</button>
            </div>
            {selectAll && <div style={{ padding: '8px 14px', background: '#f0fdf4', color: C.green, fontSize: '11px', fontWeight: 700 }}>Semua {total.toLocaleString('id-ID')} hasil filter akan diproses di server.</div>}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                <thead><tr style={{ background: C.bg }}>{['', 'Nama', 'NISN / Username', 'Kelas', 'Tingkat', 'JK', 'Status'].map((label, i) => <th key={label || 'check'} style={{ textAlign: i === 0 ? 'center' : 'left', padding: '9px 10px', color: C.textMid, fontSize: '10px', fontWeight: 800 }}>{i === 0 ? <input type="checkbox" checked={allPageSelected} onChange={togglePage} /> : label}</th>)}</tr></thead>
                <tbody>{participantLoading ? <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '12px' }}>Memuat peserta...</td></tr> : participants.length === 0 ? <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '12px' }}>Tidak ada peserta sesuai filter.</td></tr> : participants.map(p => { const checked = selectAll || selectedIds.includes(p.source_id); return <tr key={p.source_id} style={{ borderTop: `1px solid ${C.borderLight}`, background: checked ? '#f7fbf8' : C.white }}><td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={checked} onChange={() => toggleParticipant(p.source_id)} /></td><td style={{ padding: '8px 10px', color: C.text, fontSize: '12px', fontWeight: 700 }}>{p.full_name}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px', fontFamily: 'monospace' }}>{p.nisn || p.username}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.class_name || '-'}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.grade || '-'}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.gender || '-'}</td><td style={{ padding: '8px 10px', color: p.is_active ? C.green : '#dc2626', fontSize: '11px', fontWeight: 700 }}>{p.is_active ? 'Aktif' : 'Nonaktif'}</td></tr>; })}</tbody>
              </table>
            </div>
            <div style={{ padding: '10px 14px', borderTop: `1.5px solid ${C.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: C.textMuted, fontSize: '11px' }}>{selectAll ? `${total} terpilih` : `${selectedIds.length} terpilih`}</span><div style={{ display: 'flex', gap: '5px' }}><button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '5px 9px', borderRadius: '7px', border: `1px solid ${C.borderMid}`, background: C.white, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>‹</button><button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '5px 9px', borderRadius: '7px', border: `1px solid ${C.borderMid}`, background: C.white, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>›</button></div></div>
          </section>

          <aside style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', padding: '14px', position: 'sticky', top: '14px' }}>
            <p style={{ color: C.text, fontSize: '13px', fontWeight: 900 }}>Assignment roster</p>
            <p style={{ color: C.textMuted, fontSize: '10.5px', lineHeight: 1.5, margin: '3px 0 12px' }}>Snapshot nama, NISN, kelas, tingkat, dan status disimpan di CBT. Data sumber tidak diubah.</p>
            <label style={{ display: 'block', color: C.textMid, fontSize: '10px', fontWeight: 800 }}>RUANGAN<select value={roomId} onChange={e => setRoomId(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Pilih ruangan</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '9px' }}><label style={{ color: C.textMid, fontSize: '10px', fontWeight: 800 }}>TANGGAL<input type="date" value={tanggalTes} onChange={e => setTanggalTes(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label><label style={{ color: C.textMid, fontSize: '10px', fontWeight: 800 }}>SESI<input value={sesiTes} onChange={e => setSesiTes(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label></div>
            <button onClick={assignRoster} disabled={saving || !selectedExam || (!selectAll && selectedIds.length === 0)} style={{ width: '100%', marginTop: '12px', background: C.green, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px', fontSize: '12px', fontWeight: 900, cursor: 'pointer', opacity: saving || !selectedExam || (!selectAll && selectedIds.length === 0) ? 0.5 : 1 }}>{saving ? 'Memproses...' : 'Simpan roster'}</button>
            <div style={{ height: '1px', background: C.borderLight, margin: '16px 0 12px' }} />
            <p style={{ color: C.text, fontSize: '12px', fontWeight: 900, marginBottom: '7px' }}>Roster tersimpan {rosterLoading ? '...' : `(${roster.length})`}</p>
            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>{roster.map((r: any) => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', borderBottom: `1px solid ${C.borderLight}`, padding: '8px 0' }}><div style={{ minWidth: 0 }}><p style={{ color: C.text, fontSize: '11px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.full_name}</p><p style={{ color: C.textMuted, fontSize: '10px', marginTop: '2px' }}>{r.nisn || r.username} · {r.room_name || 'Tanpa ruang'}</p></div><button onClick={() => removeRoster(r)} title="Hapus roster" style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px' }}><Trash2 size={13} /></button></div>)}</div>
          </aside>
        </div>
      </div>

      <DownloadAttendanceModal
        open={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
        initialEventId={eventId}
        initialExamId={examId}
        events={events}
        exams={exams}
        rooms={rooms}
      />
    </div>
  );
}

export const KegiatanPage = EventManagementPage;
export default EventManagementPage;
