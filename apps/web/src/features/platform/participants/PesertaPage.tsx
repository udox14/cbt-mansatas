'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Input, Select, Modal, EmptyState, useToast, Spinner } from '@/components/ui';
import BulkImport from '@/components/admin/BulkImport';
import { Plus, Upload, Trash2, UserPlus, Search, X } from 'lucide-react';
import type { Pendaftar, Room, CbtEvent } from '../../exam-engine/types';
import { JALUR_TES } from '../../exam-engine/types';
import { C, normalizeJenisKelamin } from '../../exam-engine/components/theme';
import TableHead from '../../exam-engine/components/TableHead';

export function PesertaPage({ activeEventId }: { activeEventId?: string | null }) {
  const { toast } = useToast();
  const [data, setData] = useState<Pendaftar[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRoom, setFilterRoom] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [editPeserta, setEditPeserta] = useState<any | null>(null);
  const [savingPeserta, setSavingPeserta] = useState(false);
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [assignRoom, setAssignRoom] = useState('');
  const [assignJalur, setAssignJalur] = useState('');
  const [savingAssign, setSavingAssign] = useState(false);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [allJalur, setAllJalur] = useState<string[]>([]);
  const [confirmDelPeserta, setConfirmDelPeserta] = useState<any | null>(null);
  const [deletingPeserta, setDeletingPeserta] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [batchRoom, setBatchRoom] = useState('');
  const [savingBatchAssign, setSavingBatchAssign] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterEventId, setFilterEventId] = useState(() => activeEventId || 'ALL');
  const [allEvents, setAllEvents] = useState<CbtEvent[]>([]);
  const [rosterMap, setRosterMap] = useState<{ event_id: string; source_key: string; source_id: string; nisn?: string }[]>([]);

  useEffect(() => {
    setFilterEventId(activeEventId || 'ALL');
  }, [activeEventId]);

  const savePeserta = async () => {
    if (!editPeserta?.nisn || !editPeserta?.nama_lengkap) { toast('error', 'NISN dan nama wajib diisi'); return; }
    setSavingPeserta(true);
    const r = await POST('/api/admin/users', {
      username: editPeserta.nisn,
      full_name: editPeserta.nama_lengkap,
      password: editPeserta.tanggal_lahir
        ? (() => { const [y, m, d] = editPeserta.tanggal_lahir.split('-'); return `${d}${m}${y}`; })()
        : editPeserta.nisn,
      role: 'student',
      nisn: editPeserta.nisn,
    });
    setSavingPeserta(false);
    if (r.success) { toast('success', 'Peserta berhasil ditambahkan'); setEditPeserta(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal');
  };

  const saveAssignRoom = async () => {
    if (!assignTarget) return;
    setSavingAssign(true);
    const sumber = (assignTarget as any)._sumber;
    let r;
    if (sumber === 'manual') {
      r = await PUT(`/api/admin/users/${assignTarget.id}`, {
        full_name: assignTarget.nama_lengkap,
        role: 'student',
        room_id: (allRooms.find(r => r.room_name === assignRoom))?.id || null,
      });
    } else {
      const [r1, r2] = await Promise.all([
        PUT(`/api/admin/pendaftar/${assignTarget.id}/ruang`, { ruang_tes: assignRoom || null }),
        assignJalur !== (assignTarget.jalur || '')
          ? PUT(`/api/admin/pendaftar/${assignTarget.id}/jalur`, { jalur: assignJalur })
          : Promise.resolve({ success: true } as any),
      ]);
      r = r1.success && r2.success ? r1 : { success: false, error: r1.error || r2.error };
    }
    setSavingAssign(false);
    if (r.success) { toast('success', 'Data berhasil diubah'); setAssignTarget(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal');
  };

  const deletePeserta = async () => {
    if (!confirmDelPeserta) return;
    if (confirmDelPeserta._sumber !== 'manual') {
      toast('error', 'Peserta PMB tidak bisa dihapus dari aplikasi CBT');
      setConfirmDelPeserta(null);
      return;
    }
    setDeletingPeserta(true);
    const sumber = confirmDelPeserta._sumber;
    let r;
    if (sumber === 'manual') {
      r = await DEL(`/api/admin/users/${confirmDelPeserta.id}`);
    } else {
      r = await DEL(`/api/admin/pendaftar/${confirmDelPeserta.id}`);
    }
    setDeletingPeserta(false);
    if (r.success) { toast('success', 'Peserta berhasil dihapus'); setConfirmDelPeserta(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal menghapus');
  };

  const participantKey = useCallback((p: any) => `${p._sumber || 'pmb'}:${p.id}`, []);
  const selectedParticipantRows = data.filter((p: any) => selectedParticipants.has(participantKey(p)));
  const saveBatchAssignRoom = async () => {
    if (selectedParticipantRows.length === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSavingBatchAssign(true);
    const r = await POST('/api/admin/participants/assign-room', {
      ruang_tes: batchRoom || null,
      participants: selectedParticipantRows.map((p: any) => ({ id: p.id, source: p._sumber === 'manual' ? 'manual' : 'pmb' })),
    });
    setSavingBatchAssign(false);
    if (r.success) {
      toast('success', r.message || 'Peserta berhasil di-assign');
      setSelectedParticipants(new Set());
      setBatchRoom('');
      fetchPeserta();
    } else {
      toast('error', r.error || 'Gagal');
    }
  };

  const fetchPeserta = useCallback(async () => {
    const [pmb, manual, rooms, jalur, events, rosterMapResp, fullRosterResp] = await Promise.all([
      GET<Pendaftar[]>('/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
      GET<Room[]>('/api/admin/rooms'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
      GET<CbtEvent[]>('/api/admin/events'),
      GET<any[]>('/api/admin/events/roster-map'),
      GET<any[]>('/api/admin/roster'),
    ]);
    const pmbData: Pendaftar[] = pmb.success ? (pmb.data || []) : [];
    const roomList = rooms.success ? (rooms.data || []) : [];
    if (rooms.success) setAllRooms(roomList);
    if (jalur.success) setAllJalur(jalur.data || []);
    if (events.success) setAllEvents(events.data || []);
    if (rosterMapResp.success) setRosterMap(rosterMapResp.data || []);

    const fullRosterData: Pendaftar[] = (fullRosterResp.success ? (fullRosterResp.data || []) : []).map((r: any) => ({
      id: r.id, nisn: r.nisn || r.username, nama_lengkap: r.full_name,
      no_pendaftaran: '—', ruang_tes: r.room_name || r.room_id || '',
      jalur: r.class_name ? `Kelas ${r.class_name}` : 'ROSTER', asal_sekolah: '', jenis_kelamin: r.gender || '',
      tanggal_lahir: '', tanggal_tes: r.tanggal_tes || '', sesi_tes: r.sesi_tes || '',
      _sumber: (r.source_key || 'roster') as any,
    }));

    const manualData: Pendaftar[] = (manual.success ? (manual.data || []) : []).map((u: any) => ({
      id: u.id, nisn: u.nisn || u.username, nama_lengkap: u.full_name,
      no_pendaftaran: '—', ruang_tes: roomList.find((r: Room) => r.id === u.room_id)?.room_name || '',
      jalur: 'REGULER', asal_sekolah: '', jenis_kelamin: '',
      tanggal_lahir: '', tanggal_tes: '', sesi_tes: '',
      _sumber: 'manual' as const,
    }));

    const taggedPmb = pmbData.map(p => ({ ...p, _sumber: 'pmb' as const }));

    const pmbNisns = new Set(taggedPmb.map(p => p.nisn).filter(Boolean));
    const uniqueRoster = fullRosterData.filter(p => !p.nisn || !pmbNisns.has(p.nisn));

    const existingNisns = new Set([...pmbNisns, ...uniqueRoster.map(p => p.nisn).filter(Boolean)]);
    const uniqueManual = manualData.filter(p => !p.nisn || !existingNisns.has(p.nisn));

    setData([...taggedPmb, ...uniqueRoster, ...uniqueManual] as any);
    setLoading(false);
  }, []);
  useEffect(() => { fetchPeserta(); }, [fetchPeserta]);

  const isParticipantInEvent = useCallback((p: any, ev: CbtEvent) => {
    const inRoster = rosterMap.some(r => r.event_id === ev.id && (
      (r.source_id && r.source_id === p.id) ||
      (r.nisn && p.nisn && r.nisn === p.nisn)
    ));
    if (inRoster) return true;
    if (ev.id === 'event-pmb' || ev.code === 'PMB') {
      return p._sumber === 'pmb';
    }
    return false;
  }, [rosterMap]);

  const roomOpts = Array.from(new Set(data.map((p: any) => p.ruang_tes).filter(Boolean))).sort() as string[];
  const sesiOpts = Array.from(new Set(data.map((p: any) => p.sesi_tes).filter(Boolean))).sort() as string[];
  const tglOpts = Array.from(new Set(data.map((p: any) => p.tanggal_tes).filter(Boolean))).sort() as string[];
  const [filterSesi, setFilterSesi] = useState('');
  const [filterSumber, setFilterSumber] = useState('');
  const [filterTgl, setFilterTgl] = useState('');
  const [filterJk, setFilterJk] = useState('');
  const [filterJalur, setFilterJalur] = useState('');
  const [pageSize, setPageSize] = useState<'20' | '50' | '100' | 'all'>('20');
  const [page, setPage] = useState(1);
  const jalurOpts = Array.from(new Set(data.map((p: any) => p.jalur).filter(Boolean))).sort() as string[];

  const filtered = data.filter((p: any) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = (p.nama_lengkap || '').toLowerCase().includes(q);
      const matchNisn = (p.nisn || '').toLowerCase().includes(q);
      const matchNo = (p.no_pendaftaran || '').toLowerCase().includes(q);
      const matchAsal = (p.asal_sekolah || '').toLowerCase().includes(q);
      if (!matchName && !matchNisn && !matchNo && !matchAsal) return false;
    }
    if (filterEventId !== 'ALL') {
      const ev = allEvents.find(e => e.id === filterEventId);
      if (ev && !isParticipantInEvent(p, ev)) return false;
    }
    if (filterRoom === '__NONE__') {
      if (p.ruang_tes) return false;
    } else if (filterRoom && p.ruang_tes !== filterRoom) {
      return false;
    }
    if (filterSesi && p.sesi_tes !== filterSesi) return false;
    if (filterSumber && p._sumber !== filterSumber) return false;
    if (filterTgl && p.tanggal_tes !== filterTgl) return false;
    if (filterJk && normalizeJenisKelamin(p.jenis_kelamin) !== filterJk) return false;
    if (filterJalur && (p.jalur || '').toUpperCase() !== filterJalur.toUpperCase()) return false;
    return true;
  });
  const perPage = pageSize === 'all' ? filtered.length || 1 : Number(pageSize);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * perPage;
  const pagedParticipants = pageSize === 'all' ? filtered : filtered.slice(pageStart, pageStart + perPage);
  const pageEnd = pageSize === 'all' ? filtered.length : Math.min(filtered.length, pageStart + pagedParticipants.length);
  const pageParticipantKeys = pagedParticipants.map((p: any) => participantKey(p));
  const allPageSelected = pageParticipantKeys.length > 0 && pageParticipantKeys.every(k => selectedParticipants.has(k));
  const toggleParticipant = (p: any) => {
    const key = participantKey(p);
    setSelectedParticipants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const togglePageParticipants = () => {
    setSelectedParticipants(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageParticipantKeys.forEach(k => next.delete(k));
      else pageParticipantKeys.forEach(k => next.add(k));
      return next;
    });
  };

  useEffect(() => {
    setPage(1);
  }, [filterRoom, filterSesi, filterTgl, filterSumber, filterJk, filterJalur, searchQuery, filterEventId, pageSize]);
  useEffect(() => {
    const valid = new Set(data.map((p: any) => participantKey(p)));
    setSelectedParticipants(prev => new Set(Array.from(prev).filter(k => valid.has(k))));
  }, [data, participantKey]);

  const resetAllFilters = () => {
    setFilterRoom('');
    setFilterSesi('');
    setFilterTgl('');
    setFilterSumber('');
    setFilterJk('');
    setFilterJalur('');
    setSearchQuery('');
    setFilterEventId('ALL');
  };

  const selStyle = (val: string): React.CSSProperties => ({
    padding: '7px 11px', fontSize: '12px', fontWeight: 600,
    background: C.white, border: `1.5px solid ${val ? C.green : C.borderMid}`,
    borderRadius: '10px', outline: 'none', color: val ? C.text : C.textMuted,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>Peserta Tes</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{filtered.length} dari {data.length} peserta</p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setShowImport(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.bg, color: C.textMid, fontSize: '12px', fontWeight: 700, padding: '8px 13px', borderRadius: '10px', border: `1.5px solid ${C.borderMid}`, cursor: 'pointer' }}>
            <Upload size={13} /> Import
          </button>
          <button onClick={() => setEditPeserta({ jalur: JALUR_TES })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 13px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Tambah
          </button>
        </div>
      </div>

      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setFilterEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${filterEventId === 'ALL' ? C.green : C.borderMid}`,
            background: filterEventId === 'ALL' ? C.greenLight : C.white,
            color: filterEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({data.length})
        </button>
        {allEvents.map(ev => {
          const isSelected = filterEventId === ev.id;
          const count = data.filter((p: any) => isParticipantInEvent(p, ev)).length;
          return (
            <button key={ev.id} type="button" onClick={() => setFilterEventId(ev.id)}
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
        {/* FILTER BAR & SEARCH */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', minWidth: '220px', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari Nama, NISN, No. Daftar..."
              style={{
                width: '100%', padding: '7px 11px 7px 30px', fontSize: '12px', fontWeight: 600,
                background: C.white, border: `1.5px solid ${searchQuery ? C.green : C.borderMid}`,
                borderRadius: '10px', outline: 'none', color: C.text, fontFamily: 'inherit',
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} style={selStyle(filterRoom)}>
            <option value="">Semua Ruangan</option>
            <option value="__NONE__">⚠️ Belum Ada Ruangan</option>
            {roomOpts.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterSesi} onChange={e => setFilterSesi(e.target.value)} style={selStyle(filterSesi)}>
            <option value="">Semua Sesi</option>
            {sesiOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterTgl} onChange={e => setFilterTgl(e.target.value)} style={selStyle(filterTgl)}>
            <option value="">Semua Tanggal</option>
            {tglOpts.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterSumber} onChange={e => setFilterSumber(e.target.value)} style={selStyle(filterSumber)}>
            <option value="">Semua Sumber</option>
            <option value="pmb">PMB</option>
            <option value="manual">Manual</option>
          </select>
          <select value={filterJk} onChange={e => setFilterJk(e.target.value)} style={selStyle(filterJk)}>
            <option value="">Semua JK</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
          <select value={filterJalur} onChange={e => setFilterJalur(e.target.value)} style={selStyle(filterJalur)}>
            <option value="">Semua Jalur</option>
            {jalurOpts.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
          <select value={pageSize} onChange={e => setPageSize(e.target.value as '20' | '50' | '100' | 'all')} style={selStyle(pageSize)}>
            <option value="20">20 / halaman</option>
            <option value="50">50 / halaman</option>
            <option value="100">100 / halaman</option>
            <option value="all">Semua</option>
          </select>
          {(filterRoom || filterSesi || filterTgl || filterSumber || filterJk || filterJalur || searchQuery || filterEventId !== 'ALL') && (
            <button onClick={resetAllFilters}
              style={{ fontSize: '11.5px', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '10px', padding: '7px 12px', cursor: 'pointer' }}>
              Reset
            </button>
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', background: C.white, border: `1.5px solid ${selectedParticipants.size ? C.greenBorder : C.borderMid}`, borderRadius: '12px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={togglePageParticipants}
                style={{ fontSize: '11.5px', fontWeight: 700, color: allPageSelected ? '#dc2626' : C.green, background: allPageSelected ? '#fef2f2' : C.greenLight, border: `1.5px solid ${allPageSelected ? '#fecaca' : C.greenBorder}`, borderRadius: '9px', padding: '7px 11px', cursor: 'pointer' }}>
                {allPageSelected ? 'Batal pilih halaman' : 'Pilih halaman ini'}
              </button>
              <span style={{ color: selectedParticipants.size ? C.text : C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                {selectedParticipants.size} peserta dipilih
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={batchRoom} onChange={e => setBatchRoom(e.target.value)} style={selStyle(batchRoom)}>
                <option value="">Tanpa Ruangan</option>
                {allRooms.map(r => <option key={r.id} value={r.room_name}>{r.room_name}</option>)}
              </select>
              <Button size="sm" loading={savingBatchAssign} disabled={selectedParticipants.size === 0} onClick={saveBatchAssignRoom}>
                Assign Terpilih
              </Button>
            </div>
          </div>
        )}

        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filtered.length === 0 ? <EmptyState title="Belum ada peserta" desc="Hanya peserta jalur Reguler Murni yang ditampilkan" />
            : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 600 }}>
                    Menampilkan {pageStart + 1}-{pageEnd} dari {filtered.length} peserta
                  </p>
                  {pageSize !== 'all' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                        style={{ padding: '6px 10px', fontSize: '11.5px', fontWeight: 700, color: currentPage <= 1 ? C.textFaint : C.textMid, background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}>
                        Sebelumnya
                      </button>
                      <span style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                        {currentPage} / {totalPages}
                      </span>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                        style={{ padding: '6px 10px', fontSize: '11.5px', fontWeight: 700, color: currentPage >= totalPages ? C.textFaint : C.textMid, background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}>
                        Berikutnya
                      </button>
                    </div>
                  )}
                </div>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: 'Pilih', center: true }, { label: '#' }, { label: 'Nama' }, { label: 'NISN' }, { label: 'JK', center: true }, { label: 'Jalur' }, { label: 'Ruang' }, { label: 'Sesi' }, { label: 'Tgl Tes' }, { label: 'Sumber' }, { label: 'Aksi', center: true }, { label: '', center: true }]} />
                    <tbody>
                      {pagedParticipants.map((p, i) => (
                        <tr key={p.id} style={{ borderBottom: i < pagedParticipants.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <input type="checkbox" checked={selectedParticipants.has(participantKey(p))} onChange={() => toggleParticipant(p)} />
                          </td>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{pageStart + i + 1}</td>
                          <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.nama_lengkap}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.nisn}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>{normalizeJenisKelamin(p.jenis_kelamin) || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {p.jalur
                              ? <span style={{ background: '#f0e6ff', color: '#6d28d9', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.jalur}</span>
                              : <span style={{ color: C.borderMid }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {p.ruang_tes
                              ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.ruang_tes}</span>
                              : <span style={{ color: C.borderMid }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{p.sesi_tes || '—'}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{p.tanggal_tes || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {(p as any)._sumber === 'manual'
                              ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                              : <span style={{ background: '#e2ebe3', color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <button onClick={() => { setAssignTarget(p); setAssignRoom((p as any).ruang_tes || ''); setAssignJalur((p as any).jalur || ''); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                              <UserPlus size={12} /> {p.ruang_tes ? 'Pindah' : 'Assign'}
                            </button>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            {(p as any)._sumber === 'manual' && (
                              <button onClick={() => setConfirmDelPeserta(p)}
                                style={{ width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE: cards */}
                <div className="md:hidden flex flex-col gap-2">
                  {(pagedParticipants as any[]).map((p: any) => (
                    <div key={p.id} style={{ background: C.white, border: `1.5px solid ${p.ruang_tes ? C.borderMid : C.borderMid}`, borderRadius: '14px', padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                        <input type="checkbox" checked={selectedParticipants.has(participantKey(p))} onChange={() => toggleParticipant(p)} style={{ flexShrink: 0 }} />
                        <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800, lineHeight: 1.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nama_lengkap}</p>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {p.ruang_tes
                            ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{p.ruang_tes}</span>
                            : <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>Belum ada ruangan</span>}
                          {p._sumber === 'manual'
                            ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>Manual</span>
                            : <span style={{ background: '#e2ebe3', color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>PMB</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {p.sesi_tes && <span style={{ color: C.textMuted, fontSize: '11px' }}>{p.sesi_tes}</span>}
                        {p.tanggal_tes && <span style={{ color: C.textMuted, fontSize: '11px' }}>{p.tanggal_tes}</span>}
                        {p.jenis_kelamin && <span style={{ color: C.textMuted, fontSize: '11px' }}>{normalizeJenisKelamin(p.jenis_kelamin)}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => { setAssignTarget(p); setAssignRoom(p.ruang_tes || ''); setAssignJalur((p as any).jalur || ''); }}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', color: C.green, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '9px', padding: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                          <UserPlus size={13} /> {p.ruang_tes ? 'Pindah Ruangan' : 'Assign Ruangan'}
                        </button>
                        {p._sumber === 'manual' && (
                          <button onClick={() => setConfirmDelPeserta(p)}
                            style={{ width: '36px', height: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
      </div>

      {/* Modal tambah peserta manual */}
      <Modal open={!!editPeserta} onClose={() => setEditPeserta(null)} title="Tambah Peserta" size="sm">
        {editPeserta && (
          <div className="space-y-3">
            <Input label="NISN" value={editPeserta.nisn || ''} onChange={e => setEditPeserta({ ...editPeserta, nisn: e.target.value })} placeholder="0012345678" />
            <Input label="Nama Lengkap" value={editPeserta.nama_lengkap || ''} onChange={e => setEditPeserta({ ...editPeserta, nama_lengkap: e.target.value })} />
            <Input label="Tanggal Lahir" type="date" value={editPeserta.tanggal_lahir || ''} onChange={e => setEditPeserta({ ...editPeserta, tanggal_lahir: e.target.value })} />
            <Select label="Jenis Kelamin" value={editPeserta.jenis_kelamin || ''} onChange={e => setEditPeserta({ ...editPeserta, jenis_kelamin: e.target.value })}
              options={[{ value: '', label: '— Pilih —' }, { value: 'L', label: 'Laki-laki' }, { value: 'P', label: 'Perempuan' }]} />
            <p style={{ color: C.textFaint, fontSize: '11px' }}>Password otomatis: tanggal lahir format DDMMYYYY.</p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setEditPeserta(null)}>Batal</Button>
              <Button size="sm" loading={savingPeserta} onClick={savePeserta}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal assign ruangan + jalur */}
      <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title={`Edit Peserta — ${assignTarget?.nama_lengkap}`} size="sm">
        {assignTarget && (
          <div className="space-y-3">
            <Select label="Ruangan" value={assignRoom} onChange={e => setAssignRoom(e.target.value)}
              options={[
                { value: '', label: '— Tanpa Ruangan —' },
                ...allRooms.map(r => ({ value: r.room_name, label: r.room_name })),
              ]} />
            {(assignTarget as any)._sumber !== 'manual' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>Jalur / Tag</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {allJalur.map(j => (
                    <button key={j} type="button" onClick={() => setAssignJalur(j)}
                      style={{
                        padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer',
                        border: `1.5px solid ${assignJalur === j ? '#1a5fa8' : C.borderMid}`,
                        background: assignJalur === j ? '#e0f0ff' : C.white,
                        color: assignJalur === j ? '#1a5fa8' : C.textMuted
                      }}>
                      {j}
                    </button>
                  ))}
                  <Input value={assignJalur} onChange={e => setAssignJalur(e.target.value)} className="!py-1 !px-2 !text-xs" style={{ maxWidth: '140px' }} />
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setAssignTarget(null)}>Batal</Button>
              <Button size="sm" loading={savingAssign} onClick={saveAssignRoom}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm hapus peserta */}
      <Modal open={!!confirmDelPeserta} onClose={() => setConfirmDelPeserta(null)} title="Hapus Peserta?" size="sm">
        {confirmDelPeserta && (
          <div>
            <div style={{ background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
              <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800, marginBottom: '2px' }}>{confirmDelPeserta.nama_lengkap}</p>
              <p style={{ color: C.textMuted, fontSize: '11.5px', fontFamily: 'monospace' }}>{confirmDelPeserta.nisn}</p>
              <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {confirmDelPeserta.ruang_tes && <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{confirmDelPeserta.ruang_tes}</span>}
                {confirmDelPeserta._sumber === 'manual'
                  ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                  : <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
              </div>
            </div>
            <p style={{ color: '#dc2626', fontSize: '12.5px', fontWeight: 600, marginBottom: '18px', lineHeight: 1.5 }}>
              {confirmDelPeserta._sumber === 'manual'
                ? 'Akun peserta ini akan dihapus permanen dan tidak dapat dikembalikan.'
                : 'Peserta PMB tidak bisa dihapus dari CBT. Untuk mengeluarkan dari ruang/ujian, kosongkan ruang atau hapus assignment ujian.'}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelPeserta(null)}
                style={{ padding: '9px 18px', fontSize: '12.5px', fontWeight: 700, color: C.textMid, background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '10px', cursor: 'pointer' }}>
                Batal
              </button>
              <button onClick={deletePeserta} disabled={deletingPeserta}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontSize: '12.5px', fontWeight: 700, color: '#fff', background: '#dc2626', border: 'none', borderRadius: '10px', cursor: 'pointer', opacity: deletingPeserta ? 0.6 : 1 }}>
                {deletingPeserta ? <><Spinner size={13} /> Menghapus...</> : <><Trash2 size={13} /> Ya, Hapus</>}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Excel peserta */}
      <BulkImport type="users" open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetchPeserta(); }} />
    </div>
  );
}

export default PesertaPage;
