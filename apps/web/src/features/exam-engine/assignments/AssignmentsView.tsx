'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Input, Modal, EmptyState, useToast, Spinner } from '@/components/ui';
import { Plus, Trash2, Pencil } from 'lucide-react';
import type { CbtEvent, Room } from '../types';
import { C } from '../components/theme';

export function AssignmentsView({ examId, eventId }: { examId: string; eventId?: string | null }) {
  const { toast } = useToast();
  const [roster, setRoster] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Data pendukung
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Modal tambah peserta (sumber = kegiatan/event)
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [addRoom, setAddRoom] = useState('');
  const [addTanggal, setAddTanggal] = useState('');
  const [addSesi, setAddSesi] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal edit roster per-peserta
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editRoom, setEditRoom] = useState('');
  const [editTanggal, setEditTanggal] = useState('');
  const [editSesi, setEditSesi] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const event = events.find(e => e.id === eventId) || null;

  const fetchRoster = useCallback(async () => {
    const r = await GET(`/api/admin/exams/${examId}/roster`);
    if (r.success) setRoster(r.data || []);
    else toast('error', r.error || 'Roster tidak dapat dimuat');
    setLoading(false);
  }, [examId, toast]);
  useEffect(() => { fetchRoster(); }, [fetchRoster]);

  useEffect(() => {
    GET<CbtEvent[]>('/api/admin/events').then(r => { if (r.success) setEvents(r.data || []); });
    GET<Room[]>('/api/admin/rooms').then(r => { if (r.success) setRooms(r.data || []); });
  }, []);

  const visibleRoster = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((row: any) => {
      if (filterRoom && row.room_id !== filterRoom && (row.room_name || '') !== filterRoom) return false;
      if (!query) return true;
      return [row.full_name, row.nisn, row.username, row.class_name].some((v: any) =>
        String(v || '').toLowerCase().includes(query));
    });
  }, [roster, q, filterRoom]);

  const roomFilterOptions = Array.from(new Map(roster.map((row: any) => {
    const key = row.room_id || row.room_name || '';
    return [key, { key, label: row.room_name || key || 'Tanpa ruang' }];
  })).values()).sort((a: any, b: any) => a.label.localeCompare(b.label));

  const Chk = ({ size, check }: { size?: number; check: boolean }) => (
    <div style={{ width: size || 18, height: size || 18, borderRadius: '5px', border: `2px solid ${check ? C.green : C.borderMid}`, background: check ? C.green : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {check && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
  );

  const SourceBadge = ({ sourceKey }: { sourceKey: string }) => {
    const m: Record<string, { bg: string; color: string; label: string }> = {
      pmb:      { bg: '#e2ebe3', color: '#2d6644', label: 'PMB' },
      mansatas: { bg: '#e0f0ff', color: '#1a5fa8', label: 'Mansatas' },
      cbt_user: { bg: '#fffbeb', color: '#b45309', label: 'Manual' },
    };
    const s = m[sourceKey] || m.cbt_user;
    return <span style={{ background: s.bg, color: s.color, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{s.label}</span>;
  };

  const allVisibleSelected = visibleRoster.length > 0 && visibleRoster.every((row: any) => selectedIds.includes(row.id));
  const toggleAllVisible = () => {
    const ids = visibleRoster.map((row: any) => row.id);
    setSelectedIds(prev => allVisibleSelected ? prev.filter(id => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
  };
  const toggleSelect = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const deleteRoster = async (row: any) => {
    if (!row.id || !window.confirm(`Hapus ${row.full_name} dari roster?`)) return;
    const r = await DEL(`/api/admin/exams/${examId}/roster/${row.id}`);
    if (r.success) { toast('success', 'Roster dihapus'); fetchRoster(); }
    else toast('error', r.error || 'Roster tidak dapat dihapus');
  };

  const deleteSelected = async () => {
    const ids = visibleRoster.filter((row: any) => selectedIds.includes(row.id)).map((row: any) => row.id);
    if (!ids.length) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setDeleting(true);
    const results = await Promise.all(ids.map(id => DEL(`/api/admin/exams/${examId}/roster/${id}`)));
    setDeleting(false);
    const failed = results.filter(r => !r.success).length;
    if (failed) toast('error', `${results.length - failed} dihapus, ${failed} gagal (mungkin sudah punya sesi)`);
    else toast('success', `${ids.length} peserta dihapus dari roster`);
    setSelectedIds([]);
    fetchRoster();
  };

  // ── Tambah peserta dari sumber kegiatan ──
  const openAdd = async () => {
    if (!eventId) { toast('error', 'Ujian belum terhubung ke kegiatan. Pilih kegiatan di menu Ujian → Edit.'); return; }
    setShowAdd(true); setSearch(''); setSelected(new Set()); setSelectAllMode(false);
    setAddRoom(''); setAddTanggal(''); setAddSesi('');
  };

  useEffect(() => {
    if (!showAdd || !eventId) return;
    let cancelled = false;
    setCandidateLoading(true);
    const params = new URLSearchParams({ page_size: '100' });
    if (search.trim()) params.set('q', search.trim());
    GET<{ items: any[]; pagination: { total: number } }>(`/api/admin/events/${eventId}/participants?${params.toString()}`)
      .then(r => {
        if (cancelled || !r.success) return;
        const used = new Set(roster.map((row: any) => `${row.source_key}:${row.source_id}`));
        setCandidates((r.data?.items || []).filter((c: any) => !used.has(`${c.source_key}:${c.source_id}`)));
        setCandidateTotal(r.data?.pagination?.total || 0);
      })
      .catch(() => { if (!cancelled) toast('error', 'Peserta sumber tidak dapat dimuat'); })
      .finally(() => { if (!cancelled) setCandidateLoading(false); });
    return () => { cancelled = true; };
  }, [showAdd, eventId, search, roster, toast]);

  const candidateKey = (c: any) => `${c.source_key}:${c.source_id}`;
  const toggleCandidate = (key: string) => {
    if (selectAllMode) { setSelectAllMode(false); setSelected(new Set([key])); return; }
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const allCandidatesSelected = candidates.length > 0 && candidates.every(c => selected.has(candidateKey(c)));
  const toggleAllCandidates = () => {
    if (selectAllMode) { setSelectAllMode(false); setSelected(new Set()); return; }
    setSelected(prev => {
      const n = new Set(prev);
      candidates.forEach(c => allCandidatesSelected ? n.delete(candidateKey(c)) : n.add(candidateKey(c)));
      return n;
    });
  };

  const saveRoster = async () => {
    if (!eventId) { toast('error', 'Ujian belum terhubung ke kegiatan'); return; }
    if (!selectAllMode && selected.size === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSaving(true);
    const participantIds = Array.from(selected).map(k => k.split(':').slice(1).join(':'));
    const r = await POST(`/api/admin/exams/${examId}/roster/batch`, {
      event_id: eventId,
      select_all: selectAllMode,
      participant_ids: selectAllMode ? [] : participantIds,
      filters: { q: selectAllMode ? (search.trim() || undefined) : undefined },
      room_id: addRoom || null,
      tanggal_tes: addTanggal,
      sesi_tes: addSesi,
    });
    setSaving(false);
    if (!r.success) { toast('error', r.error || 'Assignment gagal'); return; }
    toast('success', `Matched ${r.data?.matched || 0}, ditambahkan ${r.data?.added || 0}, dilewati ${r.data?.skipped || 0}`);
    setShowAdd(false);
    fetchRoster();
  };

  // ── Edit roster per-peserta ──
  const openEdit = (row: any) => {
    setEditTarget(row);
    setEditRoom(row.room_id || '');
    setEditTanggal(row.tanggal_tes || '');
    setEditSesi(row.sesi_tes || '');
  };
  const saveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    const r = await PUT(`/api/admin/exams/${examId}/roster/${editTarget.id}`, {
      room_id: editRoom || null,
      tanggal_tes: editTanggal,
      sesi_tes: editSesi,
    });
    setSavingEdit(false);
    if (!r.success) { toast('error', r.error || 'Gagal memperbarui roster'); return; }
    toast('success', 'Roster diperbarui');
    setEditTarget(null);
    fetchRoster();
  };

  if (loading) return <div className="py-12 text-center"><Spinner /></div>;

  return (
    <div className="space-y-3">
      {/* Banner info kegiatan */}
      <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px' }}>
        <p style={{ color: C.green, fontSize: '11px', fontWeight: 900 }}>
          Sinkron dengan menu Kegiatan & Roster{event ? ` · ${event.code} · ${event.name}` : ''}
        </p>
        <p style={{ color: C.textMid, fontSize: '11px', lineHeight: 1.5, marginTop: '3px' }}>
          Peserta di tab ini adalah roster yang disimpan dari sumber kegiatan ({event?.participant_source || '-'}).
          Perubahan di sini langsung tersinkron dengan Kegiatan & Roster.
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Input placeholder="Cari nama, NISN, kelas..." value={q} onChange={e => setQ(e.target.value)} style={{ width: '220px' }} />
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} style={{ padding: '10px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '10px', fontSize: '12px', background: C.white, color: C.text }}>
            <option value="">Semua ruangan</option>
            {roomFilterOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ color: C.textMuted, fontSize: '11px' }}>{visibleRoster.length} peserta · {selectedIds.length} dipilih</span>
          {selectedIds.length > 0 && (
            <button onClick={deleteSelected} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 12px', borderRadius: '10px', border: 'none', cursor: 'pointer', opacity: deleting ? 0.65 : 1 }}>
              {deleting ? <Spinner size={13} /> : <Trash2 size={13} strokeWidth={2.5} />} Hapus {selectedIds.length}
            </button>
          )}
          <button onClick={openAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Tambah Peserta
          </button>
        </div>
      </div>

      {/* Tabel roster */}
      {visibleRoster.length === 0 ? <EmptyState title={roster.length === 0 ? 'Belum ada peserta di roster' : 'Tidak ada hasil filter'} desc={roster.length === 0 ? 'Gunakan tombol Tambah Peserta untuk menyimpan peserta dari Kegiatan & Roster.' : undefined} /> : (
        <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '860px' }}>
            <thead>
              <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                <th style={{ width: '46px', padding: '9px 12px', textAlign: 'center' }}>
                  <button type="button" onClick={toggleAllVisible} style={{ display: 'inline-flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><Chk size={17} check={allVisibleSelected} /></button>
                </th>
                {['Nama', 'NISN', 'Kelas', 'JK', 'Ruangan', 'Tanggal', 'Sesi', 'Sumber', 'Aksi'].map(label => (
                  <th key={label} style={{ textAlign: label === 'JK' || label === 'Aksi' ? 'center' : 'left', padding: '9px 14px', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRoster.map((row: any, i: number) => (
                <tr key={row.id} style={{ borderBottom: i < visibleRoster.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: selectedIds.includes(row.id) ? '#f7fbf8' : C.white }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <button type="button" onClick={() => toggleSelect(row.id)} style={{ display: 'inline-flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><Chk size={17} check={selectedIds.includes(row.id)} /></button>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{row.full_name || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{row.nisn || row.username || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.class_name || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted }}>{row.gender || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.room_name || row.room_id || 'Tanpa ruang'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{row.tanggal_tes || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.sesi_tes || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><SourceBadge sourceKey={row.source_key} /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(row)} title="Atur ruangan/jadwal" style={{ color: '#1a5fa8', background: 'none', border: 'none', cursor: 'pointer', marginRight: '6px' }}><Pencil size={13} /></button>
                    <button onClick={() => deleteRoster(row)} title="Hapus roster" style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal tambah peserta */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={event ? `Tambah Peserta · ${event.code}` : 'Tambah Peserta'} size="lg">
        <div className="space-y-3">
          <Input placeholder="Cari nama / NISN..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ color: C.textMuted, fontSize: '11px' }}>
              {candidateLoading ? 'Memuat...' : selectAllMode ? `${candidateTotal} peserta cocok dengan filter` : `${candidates.length} tersedia · ${selected.size} dipilih`}
            </p>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => { setSelectAllMode(v => { const next = !v; if (next) setSelected(new Set()); return next; }); }}
                style={{ background: selectAllMode ? C.greenLight : '#e0f0ff', color: selectAllMode ? C.green : '#1a5fa8', border: `1.5px solid ${selectAllMode ? C.greenBorder : '#b7d6f5'}`, borderRadius: '999px', padding: '6px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>
                {selectAllMode ? 'Batal pilih semua' : '✓ Pilih semua hasil'}
              </button>
              <button onClick={toggleAllCandidates} style={{ color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                {!selectAllMode && candidates.length > 0 && allCandidatesSelected ? 'Batal Semua' : 'Pilih Semua'}
              </button>
            </div>
          </div>
          <div style={{ maxHeight: '280px', overflow: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px' }}>
            {candidateLoading ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>Memuat peserta...</p>
              : candidates.length === 0 ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>{search ? 'Tidak ada peserta cocok' : 'Semua peserta sumber sudah masuk roster'}</p>
              : candidates.map(c => { const key = candidateKey(c); const chk = selectAllMode || selected.has(key); return (
                <div key={key} onClick={() => toggleCandidate(key)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.borderLight}`, background: chk ? C.greenLight : 'transparent' }}>
                  <Chk check={chk} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: C.text, fontSize: '12px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</p>
                    <p style={{ color: C.textFaint, fontSize: '10px', fontFamily: 'monospace' }}>{c.nisn || c.username}</p>
                  </div>
                  {c.class_name && <span style={{ color: C.textMuted, fontSize: '10px', flexShrink: 0 }}>{c.class_name}</span>}
                  <SourceBadge sourceKey={c.source_key} />
                </div>
              ); })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>RUANGAN<select value={addRoom} onChange={e => setAddRoom(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Tanpa ruang</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TANGGAL<input type="date" value={addTanggal} onChange={e => setAddTanggal(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SESI<input value={addSesi} onChange={e => setAddSesi(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button size="sm" loading={saving} onClick={saveRoster}>
              Simpan {selectAllMode ? `${candidateTotal} peserta` : `${selected.size} peserta`} ke roster
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal edit roster */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={editTarget ? `Atur Roster · ${editTarget.full_name}` : 'Atur Roster'} size="md">
        <div className="space-y-3">
          <p style={{ color: C.textMuted, fontSize: '11px' }}>Ruangan & jadwal ini dipakai untuk validasi token dan tampilan di modul Monitor.</p>
          <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>RUANGAN<select value={editRoom} onChange={e => setEditRoom(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Tanpa ruang</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TANGGAL<input type="date" value={editTanggal} onChange={e => setEditTanggal(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SESI<input value={editSesi} onChange={e => setEditSesi(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button size="sm" loading={savingEdit} onClick={saveEdit}>Simpan</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AssignmentsView;
