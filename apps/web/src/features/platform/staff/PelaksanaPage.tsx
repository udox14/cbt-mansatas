'use client';

import { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import {
  Button, Input, Modal, EmptyState, useToast, Confirm, Spinner,
} from '@/components/ui';
import { Pencil, Trash2, Download, Plus } from 'lucide-react';
import { Proctor } from '@/features/exam-engine/types';
import { C } from '@/features/exam-engine/components/theme';
import { TableHead } from '@/features/exam-engine/components/TableHead';

export function PelaksanaPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'proktor' | 'admin'>('proktor');
  const [users, setUsers] = useState<Proctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Proctor | null>(null);

  // ── GTK IMPORT STATE ──
  const [showGtkModal, setShowGtkModal] = useState(false);
  const [gtkUsers, setGtkUsers] = useState<any[]>([]);
  const [loadingGtk, setLoadingGtk] = useState(false);
  const [gtkSearch, setGtkSearch] = useState('');
  const [selectedGtkEmails, setSelectedGtkEmails] = useState<Set<string>>(new Set());
  const [importingGtk, setImportingGtk] = useState(false);

  const fetchData = useCallback(async () => {
    const r = await GET<Proctor[]>('/api/admin/users');
    if (r.success) {
      const all = (r.data || []).filter((u: any) => u.role === 'proctor' || u.role === 'admin');
      setUsers(all);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Map tab name (Indonesian) → DB role (English)
  const TAB_TO_ROLE: Record<string, string> = { proktor: 'proctor', admin: 'admin' };
  const dbRole = TAB_TO_ROLE[tab] || tab;
  const displayed = users.filter(u => u.role === dbRole);

  const openGtkModal = async () => {
    setShowGtkModal(true);
    setLoadingGtk(true);
    setSelectedGtkEmails(new Set());
    setGtkSearch('');
    const r = await GET<any[]>('/api/admin/gtk-users');
    if (r.success) {
      setGtkUsers(r.data || []);
    } else {
      toast('error', r.error || 'Gagal mengambil data GTK');
    }
    setLoadingGtk(false);
  };

  const toggleGtkEmail = (email: string) => {
    setSelectedGtkEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const filteredGtk = gtkUsers.filter((u: any) => {
    const q = gtkSearch.trim().toLowerCase();
    if (!q) return true;
    return `${u.nama_lengkap} ${u.email}`.toLowerCase().includes(q);
  });

  const importGtkUsers = async () => {
    const selectedRows = gtkUsers.filter((u: any) => selectedGtkEmails.has(u.email));
    if (selectedRows.length === 0) {
      toast('error', 'Pilih minimal 1 GTK');
      return;
    }
    setImportingGtk(true);
    const r = await POST('/api/admin/gtk-users/import', {
      users: selectedRows.map((u: any) => ({
        email: u.email,
        name: u.nama_lengkap,
        role: tab === 'admin' ? 'admin' : 'proctor',
        password: u.password || undefined,
      })),
    });
    setImportingGtk(false);
    if (r.success) {
      toast('success', r.message || 'Berhasil di-import');
      setShowGtkModal(false);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal import GTK');
    }
  };

  const save = async () => {
    if (!editUser?.username || !editUser.full_name) {
      toast('error', 'Data tidak lengkap');
      return;
    }
    if (!editUser.id && !editUser.password) {
      toast('error', 'Password wajib');
      return;
    }
    setSaving(true);
    const role = TAB_TO_ROLE[editUser.role] || editUser.role || dbRole;
    const r = editUser.id
      ? await PUT(`/api/admin/users/${editUser.id}`, { ...editUser, role })
      : await POST('/api/admin/users', { ...editUser, role });
    setSaving(false);
    if (r.success) {
      toast('success', 'Berhasil');
      setEditUser(null);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal');
    }
  };

  const setupDummy = async () => {
    const inputName = prompt('Masukkan nama tampilan akun percobaan:', 'EL PERCOBAAN');
    if (inputName === null) return;
    const name = inputName.trim() || 'EL PERCOBAAN';
    const r = await POST('/api/admin/dummy-user/setup', { username: 'percobaan', password: 'percobaan1234', full_name: name });
    if (r.success) toast('success', r.message || `Akun percobaan "${name}" berhasil disiapkan (Username: percobaan / Password: percobaan1234)`);
    else toast('error', r.error || 'Gagal menyiapkan akun percobaan');
  };

  const resetDummyAll = async () => {
    if (!confirm('Bersihkan seluruh hasil pengerjaan akun percobaan?')) return;
    const r = await POST('/api/admin/dummy-user/reset-all', {});
    if (r.success) toast('success', r.message || 'Data percobaan berhasil dibersihkan');
    else toast('error', r.error || 'Gagal membersihkan data percobaan');
  };

  const del = async () => {
    if (!confirmDel) return;
    await DEL(`/api/admin/users/${confirmDel.id}`);
    toast('success', 'Dihapus');
    setConfirmDel(null);
    fetchData();
  };

  const TABS = [
    { key: 'proktor' as const, label: 'Proktor' },
    { key: 'admin' as const, label: 'Admin' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Pelaksana Tes</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{displayed.length} {tab} terdaftar</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={setupDummy}>Setup Akun Percobaan</Button>
          <Button variant="secondary" size="sm" onClick={resetDummyAll}>Reset Hasil Percobaan</Button>
          <Button variant="secondary" size="sm" onClick={openGtkModal}><Download size={13} /> Import dari MANSATAS App (GTK)</Button>
          <Button size="sm" onClick={() => setEditUser({ role: tab, is_active: 1 })}><Plus size={13} /> Tambah {tab === 'proktor' ? 'Proktor' : 'Admin'}</Button>
        </div>
      </div>

      {/* flat tabs */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', display: 'flex' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '11px 18px 10px', fontSize: '12.5px',
              fontWeight: tab === t.key ? 800 : 600,
              color: tab === t.key ? C.green : C.textMuted,
              background: 'none', border: 'none',
              borderBottom: `2.5px solid ${tab === t.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px', cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        {loading ? (
          <div className="py-12 text-center"><Spinner /></div>
        ) : displayed.length === 0 ? (
          <EmptyState title={`Belum ada ${tab}`} />
        ) : (
          <>
            {/* DESKTOP: table */}
            <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <TableHead cols={[
                  { label: '#' }, { label: 'Nama' }, { label: 'Username' },
                  ...(tab === 'proktor' ? [{ label: 'Ruangan' }] : []),
                  { label: 'Aksi', center: true },
                ]} />
                <tbody>
                  {displayed.map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: i < displayed.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.full_name}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.username}</td>
                      {tab === 'proktor' && (
                        <td style={{ padding: '10px 14px' }}>
                          {p.room_name ? (
                            <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.room_name}</span>
                          ) : (
                            <span style={{ color: C.borderMid }}>—</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <button
                            onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name, role: p.role })}
                            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.greenLight; (e.currentTarget as HTMLElement).style.color = C.green; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setConfirmDel(p)}
                            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBILE: cards */}
            <div className="md:hidden flex flex-col gap-2">
              {displayed.map(p => (
                <div key={p.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800 }}>{p.full_name}</p>
                      <p style={{ color: C.textMuted, fontSize: '11px', fontFamily: 'monospace', marginTop: '2px' }}>{p.username}</p>
                      {tab === 'proktor' && p.room_name && (
                        <span style={{ display: 'inline-block', marginTop: '6px', background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.room_name}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name, role: p.role })}
                        style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer', color: C.green }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmDel(p)}
                        style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser?.id ? `Edit ${tab === 'proktor' ? 'Proktor' : 'Admin'}` : `Tambah ${tab === 'proktor' ? 'Proktor' : 'Admin'}`} size="sm">
        {editUser && (
          <div className="space-y-3">
            <Input label="Nama Lengkap" value={editUser.full_name || ''} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} />
            <Input label="Username" value={editUser.username || ''} onChange={e => setEditUser({ ...editUser, username: e.target.value })} disabled={!!editUser.id} />
            <Input label={editUser.id ? 'Password Baru (opsional)' : 'Password'} type="password" value={editUser.password || ''} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={save}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={del}
        title={`Hapus ${tab === 'proktor' ? 'Proktor' : 'Admin'}?`}
        message={`Akun "${confirmDel?.full_name}" akan dihapus permanen.`}
      />

      <Modal open={showGtkModal} onClose={() => setShowGtkModal(false)} title={`Import GTK dari MANSATAS App (${tab === 'admin' ? 'Admin' : 'Proktor'})`} size="lg">
        <div className="space-y-3">
          <p style={{ color: C.textMuted, fontSize: '11.5px' }}>Pilih akun GTK/User MANSATAS App yang ingin di-import sebagai {tab === 'admin' ? 'Admin' : 'Proktor'}. Username menggunakan email, login menggunakan password akun MANSATAS masing-masing.</p>
          <Input
            placeholder="Cari nama GTK atau email..."
            value={gtkSearch}
            onChange={e => setGtkSearch(e.target.value)}
          />
          {loadingGtk ? (
            <div className="py-8 text-center"><Spinner /></div>
          ) : filteredGtk.length === 0 ? (
            <EmptyState title="Tidak ada GTK ditemukan" desc="Semua GTK mungkin sudah di-import atau data belum tersedia" />
          ) : (
            <div style={{ maxHeight: '340px', overflowY: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', background: C.bg }}>
              {filteredGtk.map((u: any, i: number) => {
                const isSelected = selectedGtkEmails.has(u.email);
                return (
                  <label
                    key={u.email}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                      borderBottom: i < filteredGtk.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                      background: isSelected ? C.greenLight : C.white,
                      cursor: u.already_imported ? 'not-allowed' : 'pointer',
                      opacity: u.already_imported ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={u.already_imported}
                      checked={isSelected || u.already_imported}
                      onChange={() => toggleGtkEmail(u.email)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: C.text, fontSize: '12.5px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nama_lengkap}</p>
                      <p style={{ color: C.textMuted, fontSize: '11px', fontFamily: 'monospace' }}>{u.email}</p>
                    </div>
                    {u.already_imported && (
                      <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Sudah Terdaftar</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowGtkModal(false)}>Batal</Button>
            <Button size="sm" loading={importingGtk} disabled={selectedGtkEmails.size === 0} onClick={importGtkUsers}>
              Import {selectedGtkEmails.size} GTK ({tab === 'admin' ? 'Admin' : 'Proktor'})
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
