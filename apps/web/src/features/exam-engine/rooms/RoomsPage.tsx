'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Input, Select, Modal, EmptyState, useToast, Confirm, Spinner } from '@/components/ui';
import { Plus, RefreshCw, Trash2, Users, UserPlus, X } from 'lucide-react';
import type { Room, Proctor, Pendaftar, CbtEvent } from '../types';
import { C } from '../components/theme';
import TableHead from '../components/TableHead';

export function RoomsPage({ activeEventId }: { activeEventId?: string | null }) {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [proctors, setProctors] = useState<Proctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [assignModal, setAssignModal] = useState<Room | null>(null);
  const [selectedProctor, setSelectedProctor] = useState('');
  const [roomDetail, setRoomDetail] = useState<Room | null>(null);
  const [roomStudents, setRoomStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentAssignRoom, setStudentAssignRoom] = useState<Room | null>(null);
  const [studentCandidates, setStudentCandidates] = useState<any[]>([]);
  const [selectedRoomParticipants, setSelectedRoomParticipants] = useState<Set<string>>(new Set());
  const [studentCandidateSearch, setStudentCandidateSearch] = useState('');
  const [loadingStudentCandidates, setLoadingStudentCandidates] = useState(false);
  const [savingRoomStudentAssign, setSavingRoomStudentAssign] = useState(false);
  const [roomEvents, setRoomEvents] = useState<CbtEvent[]>([]);
  const [filterRoomEventId, setFilterRoomEventId] = useState<string>(() => activeEventId || 'ALL');

  useEffect(() => {
    setFilterRoomEventId(activeEventId || 'ALL');
  }, [activeEventId]);
  const [filterRoomDate, setFilterRoomDate] = useState('');
  const [filterRoomSession, setFilterRoomSession] = useState('');
  const [roomDateOptions, setRoomDateOptions] = useState<string[]>([]);
  const [roomSessionOptions, setRoomSessionOptions] = useState<string[]>([]);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomForm, setRoomForm] = useState({ room_name: '', capacity: 40, event_id: '' });
  const [savingRoom, setSavingRoom] = useState(false);
  const [confirmDelRoom, setConfirmDelRoom] = useState<Room | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const roomQs = new URLSearchParams();
    if (filterRoomDate) roomQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) roomQs.set('sesi_tes', filterRoomSession);
    if (filterRoomEventId !== 'ALL') roomQs.set('event_id', filterRoomEventId);
    const roomUrl = roomQs.toString() ? `/api/admin/rooms?${roomQs.toString()}` : '/api/admin/rooms';
    const [r, p, pmb, evs] = await Promise.all([
      GET<Room[]>(roomUrl),
      GET<Proctor[]>('/api/admin/proctors'),
      GET<Pendaftar[]>('/api/admin/pendaftar'),
      GET<CbtEvent[]>('/api/admin/events'),
    ]);
    if (r.success) setRooms(r.data || []);
    if (p.success) setProctors(p.data || []);
    if (evs.success) setRoomEvents(evs.data || []);
    if (pmb.success) {
      const pmbData = pmb.data || [];
      setRoomDateOptions(Array.from(new Set(pmbData.map((x: any) => x.tanggal_tes).filter(Boolean))).sort() as string[]);
      const sessionSource = filterRoomDate ? pmbData.filter((x: any) => x.tanggal_tes === filterRoomDate) : pmbData;
      const sessionOptions = Array.from(new Set(sessionSource.map((x: any) => x.sesi_tes).filter(Boolean))).sort() as string[];
      setRoomSessionOptions(sessionOptions);
      if (filterRoomSession && !sessionOptions.includes(filterRoomSession)) setFilterRoomSession('');
    }
    setLoading(false);
  }, [filterRoomDate, filterRoomSession, filterRoomEventId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const changeRoomDate = (value: string) => {
    setFilterRoomDate(value);
    setFilterRoomSession('');
  };
  const syncRooms = async () => { setSyncing(true); const r = await POST('/api/admin/rooms/sync', {}); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); setSyncing(false); fetchData(); };
  const openRoomForm = () => {
    const defaultEv = filterRoomEventId !== 'ALL' ? filterRoomEventId : '';
    setRoomForm({ room_name: '', capacity: 40, event_id: defaultEv });
    setShowRoomForm(true);
  };
  const saveRoom = async () => {
    const roomName = roomForm.room_name.trim();
    if (!roomName) { toast('error', 'Nama ruangan wajib diisi'); return; }
    setSavingRoom(true);
    const r = await POST('/api/admin/rooms', {
      room_name: roomName,
      capacity: roomForm.capacity,
      event_id: roomForm.event_id || null,
    });
    setSavingRoom(false);
    if (r.success) {
      toast('success', r.message || 'Ruangan ditambahkan');
      setShowRoomForm(false);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal menambah ruangan');
    }
  };
  const deleteRoom = async () => {
    if (!confirmDelRoom) return;
    const r = await DEL(`/api/admin/rooms/${confirmDelRoom.id}`);
    if (r.success) {
      toast('success', r.message || 'Ruangan dihapus');
      setConfirmDelRoom(null);
      if (roomDetail?.id === confirmDelRoom.id) setRoomDetail(null);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal menghapus ruangan');
    }
  };
  const assignProctor = async () => {
    if (!assignModal || !selectedProctor) return;
    const r = await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id });
    if (r.success) {
      toast('success', 'Berhasil');
      setAssignModal(null);
      setSelectedProctor('');
      fetchData();
    } else {
      toast('error', r.error || 'Gagal assign proktor');
    }
  };
  const unassignProctor = async (pid: string) => {
    const r = await PUT(`/api/admin/proctors/${pid}/assign`, { room_id: null });
    toast(r.success ? 'success' : 'error', r.success ? 'Proktor dihapus' : r.error || 'Gagal melepas proktor');
    if (r.success) fetchData();
  };
  const unassigned = proctors.filter(p => !p.room_id);
  const roomParticipantKey = useCallback((p: any) => `${p.source}:${p.id}`, []);

  const openRoomDetail = async (room: Room) => {
    setRoomDetail(room);
    setLoadingStudents(true);
    setRoomStudents([]);
    const pmbQs = new URLSearchParams({ ruang_tes: room.room_name });
    if (filterRoomDate) pmbQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) pmbQs.set('sesi_tes', filterRoomSession);

    // Ambil dari tiga sumber: pendaftar PMB + cbt_users manual + cbt_exam_roster
    const [pmb, manual, roster] = await Promise.all([
      GET<any[]>(`/api/admin/pendaftar?${pmbQs.toString()}`),
      GET<any[]>(`/api/admin/users?role=student&room_id=${encodeURIComponent(room.id)}`),
      GET<any[]>(`/api/admin/roster?room_id=${encodeURIComponent(room.id)}`),
    ]);
    const pmbList = (pmb.success ? pmb.data || [] : []).map((p: any) => ({
      nama: p.nama_lengkap,
      nisn: p.nisn,
      ruang_tes: p.ruang_tes || room.room_name,
      sesi: p.sesi_tes,
      tanggal_tes: p.tanggal_tes,
      sumber: 'PMB',
    }));
    const pmbNisn = new Set(pmbList.map((p: any) => p.nisn).filter(Boolean));

    const rosterList = (roster.success ? roster.data || [] : []).map((r: any) => ({
      nama: r.full_name,
      nisn: r.nisn || r.username,
      ruang_tes: r.room_name || room.room_name,
      sesi: r.sesi_tes || '',
      tanggal_tes: r.tanggal_tes || '',
      sumber: (r.source_key || 'Roster').toUpperCase(),
    })).filter((r: any) => !r.nisn || !pmbNisn.has(r.nisn));

    const existingNisn = new Set([...pmbList, ...rosterList].map((x: any) => x.nisn).filter(Boolean));

    const manualList = (manual.success ? manual.data || [] : []).map((u: any) => ({
      nama: u.full_name,
      nisn: u.nisn || u.username,
      ruang_tes: room.room_name,
      sesi: '',
      tanggal_tes: '',
      sumber: 'Manual',
    })).filter((u: any) => !u.nisn || !existingNisn.has(u.nisn));

    setRoomStudents([...pmbList, ...rosterList, ...manualList]);
    setLoadingStudents(false);
  };

  const openStudentAssign = async (room: Room) => {
    setStudentAssignRoom(room);
    setSelectedRoomParticipants(new Set());
    setStudentCandidateSearch('');
    setLoadingStudentCandidates(true);
    const pmbQs = new URLSearchParams();
    if (filterRoomDate) pmbQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) pmbQs.set('sesi_tes', filterRoomSession);
    const [pmb, manual, roomListResp] = await Promise.all([
      GET<any[]>(pmbQs.toString() ? `/api/admin/pendaftar?${pmbQs.toString()}` : '/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    const roomList = roomListResp.success ? roomListResp.data || [] : rooms;
    const pmbList = (pmb.success ? pmb.data || [] : [])
      .filter((p: any) => p.ruang_tes !== room.room_name)
      .map((p: any) => ({
        id: p.id,
        source: 'pmb',
        nama: p.nama_lengkap,
        nisn: p.nisn,
        ruang_tes: p.ruang_tes || '',
        jalur: p.jalur || '',
        sesi_tes: p.sesi_tes || '',
        tanggal_tes: p.tanggal_tes || '',
      }));
    const pmbNisn = new Set((pmb.success ? pmb.data || [] : []).map((p: any) => p.nisn).filter(Boolean));
    const manualList = (manual.success ? manual.data || [] : [])
      .filter((u: any) => u.room_id !== room.id)
      .filter((u: any) => !u.nisn || !pmbNisn.has(u.nisn))
      .map((u: any) => ({
        id: u.id,
        source: 'manual',
        nama: u.full_name,
        nisn: u.nisn || u.username,
        ruang_tes: roomList.find((r: Room) => r.id === u.room_id)?.room_name || '',
        jalur: 'REGULER',
        sesi_tes: '',
        tanggal_tes: '',
      }));
    setStudentCandidates([...pmbList, ...manualList]);
    setLoadingStudentCandidates(false);
  };

  const filteredStudentCandidates = studentCandidates.filter((p: any) => {
    const q = studentCandidateSearch.trim().toLowerCase();
    if (!q) return true;
    return `${p.nama} ${p.nisn} ${p.ruang_tes} ${p.jalur} ${p.sesi_tes || ''} ${p.tanggal_tes || ''}`.toLowerCase().includes(q);
  });
  const visibleRoomCandidateKeys = filteredStudentCandidates.map(roomParticipantKey);
  const allRoomCandidatesSelected = visibleRoomCandidateKeys.length > 0 && visibleRoomCandidateKeys.every(k => selectedRoomParticipants.has(k));
  const toggleRoomCandidate = (p: any) => {
    const key = roomParticipantKey(p);
    setSelectedRoomParticipants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleVisibleRoomCandidates = () => {
    setSelectedRoomParticipants(prev => {
      const next = new Set(prev);
      if (allRoomCandidatesSelected) visibleRoomCandidateKeys.forEach(k => next.delete(k));
      else visibleRoomCandidateKeys.forEach(k => next.add(k));
      return next;
    });
  };
  const saveRoomStudentAssign = async () => {
    if (!studentAssignRoom) return;
    const selectedRows = studentCandidates.filter((p: any) => selectedRoomParticipants.has(roomParticipantKey(p)));
    if (selectedRows.length === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSavingRoomStudentAssign(true);
    const r = await POST('/api/admin/participants/assign-room', {
      ruang_tes: studentAssignRoom.room_name,
      participants: selectedRows.map((p: any) => ({ id: p.id, source: p.source })),
    });
    setSavingRoomStudentAssign(false);
    if (r.success) {
      toast('success', r.message || 'Peserta berhasil di-assign');
      setStudentAssignRoom(null);
      setStudentCandidates([]);
      setSelectedRoomParticipants(new Set());
      fetchData();
      if (roomDetail?.id === studentAssignRoom.id) openRoomDetail(studentAssignRoom);
    } else {
      toast('error', r.error || 'Gagal');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Ruangan & Proktor</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Assign proktor ke ruangan ujian</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={openRoomForm}><Plus size={13} /> Tambah Ruangan</Button>
          <Button size="sm" loading={syncing} onClick={syncRooms}><RefreshCw size={13} /> Sinkronkan</Button>
        </div>
      </div>
      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setFilterRoomEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${filterRoomEventId === 'ALL' ? C.green : C.borderMid}`,
            background: filterRoomEventId === 'ALL' ? C.greenLight : C.white,
            color: filterRoomEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({rooms.length})
        </button>
        {roomEvents.map(ev => {
          const isSelected = filterRoomEventId === ev.id;
          const count = rooms.filter((r: any) => !r.event_id || r.event_id === ev.id).length;
          return (
            <button key={ev.id} type="button" onClick={() => setFilterRoomEventId(ev.id)}
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
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={filterRoomDate}
            onChange={e => changeRoomDate(e.target.value)}
            options={[{ value: '', label: 'Semua Tanggal' }, ...roomDateOptions.map(t => ({ value: t, label: t }))]}
          />
          <Select
            value={filterRoomSession}
            onChange={e => setFilterRoomSession(e.target.value)}
            options={[{ value: '', label: 'Semua Sesi' }, ...roomSessionOptions.map(s => ({ value: s, label: s }))]}
          />
          {(filterRoomSession || filterRoomDate || filterRoomEventId !== 'ALL') && (
            <Button variant="secondary" size="sm" onClick={() => { setFilterRoomSession(''); setFilterRoomDate(''); setFilterRoomEventId('ALL'); }}>
              Reset Filter
            </Button>
          )}
        </div>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : rooms.length === 0 ? <EmptyState title="Belum ada ruangan" desc="Tambah ruangan manual atau klik Sinkronkan dari PMB" />
            : (
              <>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: '#' }, { label: 'Ruangan' }, { label: 'Kegiatan' }, { label: 'Peserta', center: true }, { label: 'Proktor' }, { label: 'Aksi', center: true }]} />
                    <tbody>
                      {rooms.map((r, i) => {
                        const rp = proctors.filter(p => p.room_id === r.id);
                        return (
                          <tr key={r.id} style={{ borderBottom: i < rooms.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                            <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <button onClick={() => openRoomDetail(r)}
                                style={{ color: C.green, fontWeight: 800, fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                                {r.room_name}
                              </button>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              {r.event_code ? (
                                <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>
                                  {r.event_code}
                                </span>
                              ) : (
                                <span style={{ color: C.textFaint, fontSize: '11px', fontStyle: 'italic' }}>Universal</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}><span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{r.jumlah_peserta || 0}</span></td>
                            <td style={{ padding: '10px 14px' }}>
                              {rp.length === 0 ? <span style={{ color: C.borderMid }}>Belum ada</span>
                                : <div className="space-y-1">{rp.map(p => <div key={p.id} className="flex items-center gap-1.5 text-xs" style={{ color: C.textMid }}><span>{p.full_name}</span><button onClick={() => unassignProctor(p.id)} style={{ color: C.borderMid, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}><X size={11} /></button></div>)}</div>}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <button onClick={() => openStudentAssign(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#1a5fa8', fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <Users size={12} /> Peserta
                                </button>
                                <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <UserPlus size={12} /> Proktor
                                </button>
                                <button onClick={() => setConfirmDelRoom(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <Trash2 size={12} /> Hapus
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE: cards */}
                <div className="md:hidden flex flex-col gap-2">
                  {rooms.map(r => {
                    const rp = proctors.filter(p => p.room_id === r.id);
                    return (
                      <div key={r.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <button onClick={() => openRoomDetail(r)}
                            style={{ color: C.green, fontSize: '13.5px', fontWeight: 800, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                            {r.room_name}
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {r.event_code && (
                              <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, fontSize: '9.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px' }}>
                                {r.event_code}
                              </span>
                            )}
                            <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>{r.jumlah_peserta || 0} peserta</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            {rp.length === 0
                              ? <p style={{ color: C.textFaint, fontSize: '11.5px' }}>Belum ada proktor</p>
                              : rp.map(p => <p key={p.id} style={{ color: C.textMid, fontSize: '11.5px', fontWeight: 600 }}>{p.full_name}</p>)}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button onClick={() => openStudentAssign(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#1a5fa8', fontSize: '11.5px', fontWeight: 700, background: '#e0f0ff', border: '1.5px solid #b8ddff', borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <Users size={12} /> Peserta
                            </button>
                            <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11.5px', fontWeight: 700, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <UserPlus size={12} /> Proktor
                            </button>
                            <button onClick={() => setConfirmDelRoom(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '11.5px', fontWeight: 700, background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <Trash2 size={12} /> Hapus
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
      </div>

      <Modal open={showRoomForm} onClose={() => setShowRoomForm(false)} title="Tambah Ruangan" size="sm">
        <div className="space-y-3">
          <Input
            label="Nama Ruangan"
            placeholder="Contoh: Ruang 1"
            value={roomForm.room_name}
            onChange={e => setRoomForm(prev => ({ ...prev, room_name: e.target.value }))}
          />
          <Input
            label="Kapasitas"
            type="number"
            min={1}
            value={roomForm.capacity}
            onChange={e => setRoomForm(prev => ({ ...prev, capacity: Number(e.target.value) || 1 }))}
          />
          <Select
            label="Kegiatan / Event (Opsional)"
            value={roomForm.event_id}
            onChange={e => setRoomForm(prev => ({ ...prev, event_id: e.target.value }))}
            options={[
              { value: '', label: '— Universal / Semua Kegiatan —' },
              ...roomEvents.map(ev => ({ value: ev.id, label: `${ev.code} · ${ev.name}` })),
            ]}
          />
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowRoomForm(false)}>Batal</Button>
            <Button size="sm" loading={savingRoom} onClick={saveRoom}>Simpan</Button>
          </div>
        </div>
      </Modal>

      <Confirm
        open={!!confirmDelRoom}
        onClose={() => setConfirmDelRoom(null)}
        onConfirm={deleteRoom}
        title="Hapus Ruangan?"
        confirmText="Ya, Hapus"
        message={`Hapus ${confirmDelRoom?.room_name || 'ruangan ini'}? Proktor dan peserta yang masih terhubung ke ruangan ini akan dilepas. Ruangan yang sudah memiliki sesi ujian tidak bisa dihapus.`}
      />

      {/* Modal detail siswa per ruangan */}
      <Modal open={!!roomDetail} onClose={() => setRoomDetail(null)} title={`Siswa — ${roomDetail?.room_name}`} size="md">
        {roomDetail && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <Button size="sm" onClick={() => openStudentAssign(roomDetail)}><Users size={13} /> Tambah Peserta</Button>
          </div>
        )}
        {loadingStudents
          ? <div className="py-8 text-center"><Spinner /></div>
          : roomStudents.length === 0
            ? <EmptyState title="Belum ada siswa di ruangan ini" />
            : (
              <div>
                <p style={{ color: C.textMuted, fontSize: '11.5px', marginBottom: '12px' }}>{roomStudents.length} siswa terdaftar</p>
                <div style={{ background: C.bg, borderRadius: '12px', overflow: 'hidden', border: `1.5px solid ${C.borderMid}` }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>#</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Nama</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>NISN</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sesi</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tgl Tes</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sumber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomStudents.map((s, i) => (
                        <tr key={i} style={{ borderBottom: i < roomStudents.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: C.white }}>
                          <td style={{ padding: '9px 14px', color: C.textMuted }}>{i + 1}</td>
                          <td style={{ padding: '9px 14px', color: C.text, fontWeight: 700 }}>{s.nama}</td>
                          <td style={{ padding: '9px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{s.nisn}</td>
                          <td style={{ padding: '9px 14px', color: C.textMuted }}>{s.sesi || '—'}</td>
                          <td style={{ padding: '9px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{s.tanggal_tes || '—'}</td>
                          <td style={{ padding: '9px 14px' }}>
                            {s.sumber === 'Manual'
                              ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                              : <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
      </Modal>

      <Modal open={!!studentAssignRoom} onClose={() => setStudentAssignRoom(null)} title={`Tambah Peserta — ${studentAssignRoom?.room_name}`} size="lg">
        <div className="space-y-3">
          <Input
            placeholder="Cari nama, NISN, ruangan, jalur, sesi, tanggal..."
            value={studentCandidateSearch}
            onChange={e => setStudentCandidateSearch(e.target.value)}
          />
          {loadingStudentCandidates
            ? <div className="py-8 text-center"><Spinner /></div>
            : studentCandidates.length === 0
              ? <EmptyState title="Tidak ada kandidat peserta" desc="Semua peserta sudah berada di ruangan ini" />
              : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={toggleVisibleRoomCandidates}
                      style={{ fontSize: '11.5px', fontWeight: 700, color: allRoomCandidatesSelected ? '#dc2626' : C.green, background: allRoomCandidatesSelected ? '#fef2f2' : C.greenLight, border: `1.5px solid ${allRoomCandidatesSelected ? '#fecaca' : C.greenBorder}`, borderRadius: '9px', padding: '7px 11px', cursor: 'pointer' }}>
                      {allRoomCandidatesSelected ? 'Batal pilih hasil' : 'Pilih semua hasil'}
                    </button>
                    <span style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                      {selectedRoomParticipants.size} dipilih · {filteredStudentCandidates.length} kandidat
                    </span>
                  </div>
                  <div style={{ maxHeight: '360px', overflowY: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', background: C.bg }}>
                    {filteredStudentCandidates.length === 0
                      ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>Tidak ada hasil</p>
                      : filteredStudentCandidates.map((p: any, i: number) => (
                        <label key={roomParticipantKey(p)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: i < filteredStudentCandidates.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: C.white, cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedRoomParticipants.has(roomParticipantKey(p))} onChange={() => toggleRoomCandidate(p)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ color: C.text, fontSize: '12.5px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nama}</p>
                            <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '2px' }}>
                              {[
                                p.nisn || 'Tanpa NISN',
                                p.ruang_tes || 'Belum ada ruangan',
                                p.sesi_tes || null,
                                p.tanggal_tes || null,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span style={{ background: p.source === 'manual' ? '#fffbeb' : '#e2ebe3', color: p.source === 'manual' ? '#b45309' : '#2d6644', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', flexShrink: 0 }}>
                            {p.source === 'manual' ? 'Manual' : 'PMB'}
                          </span>
                        </label>
                      ))}
                  </div>
                </>
              )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setStudentAssignRoom(null)}>Batal</Button>
            <Button size="sm" loading={savingRoomStudentAssign} disabled={selectedRoomParticipants.size === 0} onClick={saveRoomStudentAssign}>
              Assign {selectedRoomParticipants.size} Peserta
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign Proktor — ${assignModal?.room_name}`} size="sm">
        {unassigned.length === 0
          ? <p style={{ color: C.textMuted, fontSize: '13px' }}>Semua proktor sudah di-assign.</p>
          : <div className="space-y-3">
            <Select label="Pilih Proktor" value={selectedProctor} onChange={e => setSelectedProctor(e.target.value)}
              options={[{ value: '', label: '— Pilih —' }, ...unassigned.map(p => ({ value: p.id, label: `${p.full_name} (${p.username})` }))]} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setAssignModal(null)}>Batal</Button>
              <Button size="sm" disabled={!selectedProctor} onClick={assignProctor}>Assign</Button>
            </div>
          </div>}
      </Modal>
    </div>
  );
}

export default RoomsPage;
