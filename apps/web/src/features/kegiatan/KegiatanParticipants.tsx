'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, useToast } from '@/components/ui';
import { Search, UserCheck, Users, Trash2, Filter, ArrowRight } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { Exam, Room } from '../exam-engine/types';
import type { MansatasStudent, ClassOption, KegiatanRosterRow } from './types';

interface Props {
  eventId: string;
  exams: Exam[];
}

export function KegiatanParticipants({ eventId, exams }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'roster' | 'mansatas'>('roster');

  // ── Roster state ──
  const [roster, setRoster] = useState<KegiatanRosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [filterRosterExam, setFilterRosterExam] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Mansatas directory state ──
  const [students, setStudents] = useState<MansatasStudent[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [q, setQ] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedGender, setSelectedGender] = useState('');
  const [page, setPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);

  // ── Selection & Snapshot state ──
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetExamId, setTargetExamId] = useState<string>(exams[0]?.id || '');
  const [snapshotting, setSnapshotting] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [targetRoomId, setTargetRoomId] = useState('');
  const [tanggalTes, setTanggalTes] = useState('');
  const [sesiTes, setSesiTes] = useState('');

  // 1. Fetch current roster
  const fetchRoster = useCallback(async () => {
    setRosterLoading(true);
    try {
      const url = filterRosterExam !== 'all'
        ? `/api/kegiatan/events/${eventId}/roster?exam_id=${filterRosterExam}`
        : `/api/kegiatan/events/${eventId}/roster`;
      const res = await GET<KegiatanRosterRow[]>(url);
      if (res.success && res.data) {
        setRoster(res.data);
      }
    } catch {
      toast('error', 'Gagal memuat roster peserta kegiatan');
    } finally {
      setRosterLoading(false);
    }
  }, [eventId, filterRosterExam, toast]);

  // 2. Fetch Mansatas classes & rooms
  useEffect(() => {
    GET<ClassOption[]>('/api/kegiatan/classes').then((res) => {
      if (res.success && res.data) setClasses(res.data);
    });
    GET<Room[]>('/api/admin/rooms').then((res) => {
      if (res.success && res.data) setRooms(res.data);
    });
  }, []);

  // 3. Fetch Mansatas students
  const fetchStudents = useCallback(async () => {
    setDirLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (selectedClassId) params.set('class_id', selectedClassId);
      if (selectedGrade) params.set('grade', selectedGrade);
      if (selectedGender) params.set('gender', selectedGender);
      params.set('page', String(page));
      params.set('page_size', '50');

      const res = await GET<{ items: MansatasStudent[]; pagination: { total: number } }>(
        `/api/kegiatan/events/${eventId}/participants?${params.toString()}`
      );
      if (res.success && res.data) {
        setStudents(res.data.items);
        setTotalStudents(res.data.pagination.total);
      }
    } catch {
      toast('error', 'Gagal memuat direktori siswa dari database Mansatas');
    } finally {
      setDirLoading(false);
    }
  }, [eventId, q, selectedClassId, selectedGrade, selectedGender, page, toast]);

  useEffect(() => {
    if (tab === 'roster') {
      fetchRoster();
    } else {
      fetchStudents();
    }
  }, [tab, fetchRoster, fetchStudents]);

  // Selection helpers
  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      const currentIds = students.map((s) => s.source_id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    } else {
      const currentIds = new Set(students.map((s) => s.source_id));
      setSelectedIds((prev) => prev.filter((id) => !currentIds.has(id)));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Snapshot mutation with explicit IDs
  const handleSnapshotRoster = async () => {
    if (selectedIds.length === 0) {
      toast('error', 'Pilih minimal 1 siswa untuk disnapshot ke roster');
      return;
    }
    if (!targetExamId) {
      toast('error', 'Pilih target ujian terlebih dahulu');
      return;
    }

    setSnapshotting(true);
    try {
      const res = await POST<{ matched: number; added: number; skipped: number }>(
        `/api/kegiatan/events/${eventId}/exams/${targetExamId}/roster`,
        {
          student_ids: selectedIds,
          room_id: targetRoomId || null,
          tanggal_tes: tanggalTes.trim() || undefined,
          sesi_tes: sesiTes.trim() || undefined,
        }
      );

      if (res.success && res.data) {
        toast('success', `${res.data.added} siswa berhasil disnapshot ke roster (${res.data.skipped} dilewati/duplikat)`);
        setSelectedIds([]);
        setTab('roster');
        fetchRoster();
      } else {
        toast('error', res.error || 'Gagal memproses snapshot roster');
      }
    } catch {
      toast('error', 'Terjadi kesalahan jaringan');
    } finally {
      setSnapshotting(false);
    }
  };

  // Remove roster participant
  const handleRemoveRoster = async (rosterId: string, examId: string) => {
    if (!confirm('Yakin ingin menghapus peserta ini dari roster ujian?')) return;
    setDeletingId(rosterId);
    try {
      const res = await DEL(`/api/kegiatan/events/${eventId}/exams/${examId}/roster/${rosterId}`);
      if (res.success) {
        toast('success', 'Peserta berhasil dihapus dari roster');
        fetchRoster();
      } else {
        toast('error', res.error || 'Gagal menghapus peserta');
      }
    } catch {
      toast('error', 'Terjadi kesalahan');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub Tab Switcher */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: `1.5px solid ${C.border}`, paddingBottom: '12px' }}>
        <button
          onClick={() => setTab('roster')}
          style={{
            padding: '8px 16px',
            borderRadius: '9px',
            fontSize: '12.5px',
            fontWeight: tab === 'roster' ? 800 : 600,
            background: tab === 'roster' ? C.greenLight : 'transparent',
            color: tab === 'roster' ? C.green : C.textMid,
            border: `1.5px solid ${tab === 'roster' ? C.greenBorder : 'transparent'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <UserCheck size={14} />
          Peserta Terdaftar di Roster ({roster.length})
        </button>

        <button
          onClick={() => setTab('mansatas')}
          style={{
            padding: '8px 16px',
            borderRadius: '9px',
            fontSize: '12.5px',
            fontWeight: tab === 'mansatas' ? 800 : 600,
            background: tab === 'mansatas' ? C.greenLight : 'transparent',
            color: tab === 'mansatas' ? C.green : C.textMid,
            border: `1.5px solid ${tab === 'mansatas' ? C.greenBorder : 'transparent'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <Users size={14} />
          Tambah dari Database Siswa Madrasah (Mansatas)
        </button>
      </div>

      {/* ── TAB 1: ROSTER LIST ── */}
      {tab === 'roster' && (
        <div className="space-y-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: C.textMid }}>Filter Ujian:</span>
              <select
                value={filterRosterExam}
                onChange={(e) => setFilterRosterExam(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', background: C.white }}
              >
                <option value="all">Semua Ujian ({roster.length} baris)</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.title}</option>
                ))}
              </select>
            </div>

            <Button variant="primary" size="sm" onClick={() => setTab('mansatas')}>
              + Tambah Siswa ke Roster
            </Button>
          </div>

          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#fafbfa', borderBottom: `1.5px solid ${C.border}`, textAlign: 'left', color: C.textMid, fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px', width: '40px' }}>No</th>
                  <th style={{ padding: '10px 14px' }}>NISN / Username</th>
                  <th style={{ padding: '10px 14px' }}>Nama Lengkap</th>
                  <th style={{ padding: '10px 14px' }}>Kelas</th>
                  <th style={{ padding: '10px 14px' }}>Gender</th>
                  <th style={{ padding: '10px 14px' }}>Ujian</th>
                  <th style={{ padding: '10px 14px' }}>Ruangan</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', width: '60px' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rosterLoading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: C.textMuted }}>
                      Memuat roster peserta...
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: C.textMuted }}>
                      Belum ada peserta yang disnapshot ke roster untuk kegiatan ini.
                      <div className="mt-2">
                        <Button variant="secondary" size="sm" onClick={() => setTab('mansatas')}>
                          Buka Database Siswa Mansatas
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  roster.map((r, idx) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: '10px 14px', color: C.textFaint }}>{idx + 1}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, fontFamily: 'monospace' }}>{r.nisn || r.username}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: C.text }}>{r.full_name}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: C.greenLight, color: C.green, padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                          {r.class_name || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>{r.gender || '-'}</td>
                      <td style={{ padding: '10px 14px', color: '#1a5fa8', fontWeight: 600 }}>{r.exam_title || r.exam_id}</td>
                      <td style={{ padding: '10px 14px', color: C.textMid }}>{r.room_name || '-'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleRemoveRoster(r.id, r.exam_id)}
                          disabled={deletingId === r.id}
                          title="Hapus dari roster"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#dc2626' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 2: MANSATAS DIRECTORY BROWSER & SNAPSHOT ── */}
      {tab === 'mansatas' && (
        <div className="space-y-4">
          {/* Target Exam Assignment Card */}
          <div style={{ background: '#f8fafc', border: `1.5px solid #cbd5e1`, borderRadius: '12px', padding: '14px 18px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Pengaturan Target Snapshot Roster
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid }}>
                  Target Ujian Kegiatan <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  value={targetExamId}
                  onChange={(e) => setTargetExamId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', background: C.white, marginTop: '4px' }}
                >
                  {exams.length === 0 && <option value="">(Belum ada ujian di kegiatan ini)</option>}
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid }}>
                  Ruangan (Opsional)
                </label>
                <select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', background: C.white, marginTop: '4px' }}
                >
                  <option value="">-- Tanpa Ruangan Khusus --</option>
                  {rooms.map((rm) => (
                    <option key={rm.id} value={rm.id}>{rm.room_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid }}>
                  Tanggal & Sesi (Opsional)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="date"
                    value={tanggalTes}
                    onChange={(e) => setTanggalTes(e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', background: C.white }}
                  />
                  <input
                    type="text"
                    placeholder="Sesi 1"
                    value={sesiTes}
                    onChange={(e) => setSesiTes(e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', background: C.white }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Directory Filter Controls */}
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '12px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>Pencarian Siswa</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <Search size={13} style={{ position: 'absolute', left: '10px', top: '10px', color: C.textFaint }} />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Nama / NISN..."
                    style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>Filter Tingkat</label>
                <select
                  value={selectedGrade}
                  onChange={(e) => { setSelectedGrade(e.target.value); setPage(1); }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', marginTop: '4px', background: C.white }}
                >
                  <option value="">Semua Tingkat</option>
                  <option value="10">Kelas 10 (X)</option>
                  <option value="11">Kelas 11 (XI)</option>
                  <option value="12">Kelas 12 (XII)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>Filter Kelas</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => { setSelectedClassId(e.target.value); setPage(1); }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', marginTop: '4px', background: C.white }}
                >
                  <option value="">Semua Kelas</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>Gender</label>
                <select
                  value={selectedGender}
                  onChange={(e) => { setSelectedGender(e.target.value); setPage(1); }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: `1.5px solid ${C.border}`, fontSize: '12px', marginTop: '4px', background: C.white }}
                >
                  <option value="">Semua Gender</option>
                  <option value="L">Laki-laki (L)</option>
                  <option value="P">Perempuan (P)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Bar when students selected */}
          <div style={{ background: selectedIds.length > 0 ? C.greenLight : '#f8fafc', border: `1.5px solid ${selectedIds.length > 0 ? C.greenBorder : C.border}`, borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: selectedIds.length > 0 ? C.green : C.textMid }}>
                {selectedIds.length} Siswa Dipilih Secara Eksplisit
              </span>
              {selectedIds.length > 0 && (
                <button
                  onClick={() => setSelectedIds([])}
                  style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Batalkan Pilihan
                </button>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSnapshotRoster}
              disabled={selectedIds.length === 0 || !targetExamId || snapshotting}
            >
              <UserCheck size={14} />
              {snapshotting ? 'Memproses Snapshot...' : `Snapshot ${selectedIds.length} Siswa ke Roster`}
            </Button>
          </div>

          {/* Student Table */}
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#fafbfa', borderBottom: `1.5px solid ${C.border}`, textAlign: 'left', color: C.textMid, fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px', width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={students.length > 0 && students.every((s) => selectedIds.includes(s.source_id))}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th style={{ padding: '10px 14px' }}>NISN</th>
                  <th style={{ padding: '10px 14px' }}>Nama Siswa</th>
                  <th style={{ padding: '10px 14px' }}>Kelas Aktif</th>
                  <th style={{ padding: '10px 14px' }}>Gender</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {dirLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: C.textMuted }}>
                      Memuat daftar siswa dari Mansatas...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: C.textMuted }}>
                      Tidak ada siswa yang sesuai dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => {
                    const isSelected = selectedIds.includes(s.source_id);
                    return (
                      <tr
                        key={s.source_id}
                        onClick={() => handleToggleSelectOne(s.source_id)}
                        style={{
                          borderBottom: `1px solid ${C.borderLight}`,
                          background: isSelected ? '#f0fdf4' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '10px 14px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectOne(s.source_id)}
                          />
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 700 }}>{s.nisn}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: C.text }}>{s.full_name}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ background: C.greenLight, color: C.green, padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                            {s.class_name || '-'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>{s.gender}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: '10.5px', fontWeight: 800, color: C.green }}>AKTIF</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
