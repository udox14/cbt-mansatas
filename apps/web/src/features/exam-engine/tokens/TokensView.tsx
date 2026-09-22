'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, EmptyState, useToast, Spinner } from '@/components/ui';
import { RefreshCw, Power } from 'lucide-react';
import { C } from '../components/theme';

export function TokensView({ examId, apiPrefix = '/api/admin' }: { examId: string; apiPrefix?: string }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(false);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [toggleId, setToggleId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [settingManual, setSettingManual] = useState(false);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const fetchT = useCallback(async () => { const r = await GET(`${apiPrefix}/exams/${examId}/tokens`); if (r.success) setTokens(r.data || []); setLoading(false); }, [examId, apiPrefix]);
  useEffect(() => { fetchT(); }, [fetchT]);
  const generate = async () => { setGen(true); const r = await POST(`${apiPrefix}/exams/${examId}/tokens/generate`, {}); setGen(false); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); fetchT(); };
  const regenerateOne = async (tokenId: string) => {
    setRegenId(tokenId);
    const r = await POST(`${apiPrefix}/exams/${examId}/tokens/generate`, { token_id: tokenId });
    setRegenId(null);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    fetchT();
  };
  const setTokenManual = async () => {
    const token_code = manualToken.trim().toUpperCase();
    if (!token_code) { toast('error', 'Isi token manual dulu'); return; }
    setSettingManual(true);
    const r = await POST(`${apiPrefix}/exams/${examId}/tokens/set-code`, { token_code });
    setSettingManual(false);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    if (r.success) { setManualToken(token_code); fetchT(); }
  };
  const toggleTokenActive = async (token: any) => {
    setToggleId(token.id);
    const nextActive = Number(token.is_active) === 1 ? 0 : 1;
    const r = await POST(`${apiPrefix}/exams/${examId}/tokens/${token.id}/active`, { is_active: nextActive });
    setToggleId(null);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal mengubah status token');
    if (r.success) fetchT();
  };
  const rooms = Array.from(new Set(tokens.map((t: any) => t.room_name))).sort();
  const groups = Array.from(new Map(tokens.map((t: any) => [`${t.tanggal_tes || ''}|${t.sesi_tes || ''}`, {
    key: `${t.tanggal_tes || ''}|${t.sesi_tes || ''}`,
    tanggal_tes: t.tanggal_tes || '',
    sesi_tes: t.sesi_tes || '',
  }])).values()).sort((a: any, b: any) => `${a.tanggal_tes} ${a.sesi_tes}`.localeCompare(`${b.tanggal_tes} ${b.sesi_tes}`));
  const visible = tokens.filter((t: any) => {
    if (filterRoom !== 'all' && t.room_name !== filterRoom) return false;
    if (filterGroup !== 'all' && `${t.tanggal_tes || ''}|${t.sesi_tes || ''}` !== filterGroup) return false;
    return true;
  });
  const formatDate = (value?: string) => {
    if (!value) return 'Tanpa tanggal';
    const raw = String(value).trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const dt = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}T00:00:00+07:00`);
      if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    const clean = raw.replace(/^[A-Za-zÀ-ÿ]+,\s*/i, '').trim();
    const monthMap: Record<string, number> = {
      januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4,
      mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8,
      september: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
    };
    const parts = clean.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/i);
    if (parts) {
      const month = monthMap[parts[2].toLowerCase()];
      if (month) {
        const dt = new Date(`${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}T00:00:00+07:00`);
        if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return raw;
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Token</span>
          <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Token dibuat per tanggal, sesi, dan ruangan.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {groups.length > 1 && (
            <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '220px' }}>
              <option value="all">Semua Sesi</option>
              {groups.map((g: any) => <option key={g.key} value={g.key}>{formatDate(g.tanggal_tes)} · {g.sesi_tes || 'Tanpa sesi'}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <input
            value={manualToken}
            onChange={e => setManualToken(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20))}
            placeholder="TOKEN SAMA"
            style={{ width: '128px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', padding: '7px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, color: C.text, outline: 'none', textTransform: 'uppercase' }}
          />
          <Button variant="secondary" size="sm" loading={settingManual} disabled={!manualToken.trim()} onClick={setTokenManual}>Set Semua</Button>
          <Button size="sm" loading={gen} onClick={generate}><RefreshCw size={13} /> Generate Semua</Button>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada token" />
          : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((t: any) => (
                <div key={t.id} style={{ background: C.white, border: `1.5px solid ${Number(t.is_active) === 1 ? C.borderMid : '#fecaca'}`, borderRadius: '12px', padding: '14px 16px', opacity: Number(t.is_active) === 1 ? 1 : 0.72 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <p style={{ color: C.textMuted, fontSize: '11px', fontWeight: 700 }}>{t.room_name}</p>
                        <span style={{ background: Number(t.is_active) === 1 ? C.greenLight : '#fef2f2', color: Number(t.is_active) === 1 ? C.green : '#dc2626', border: `1px solid ${Number(t.is_active) === 1 ? C.greenBorder : '#fecaca'}`, borderRadius: '999px', padding: '1px 7px', fontSize: '9.5px', fontWeight: 800 }}>
                          {Number(t.is_active) === 1 ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </div>
                      <p style={{ color: C.textFaint, fontSize: '10.5px', marginTop: '2px' }}>{formatDate(t.tanggal_tes)} · {t.sesi_tes || 'Tanpa sesi'}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button onClick={() => toggleTokenActive(t)} disabled={toggleId === t.id}
                        title={Number(t.is_active) === 1 ? 'Nonaktifkan token ruangan/sesi ini' : 'Aktifkan token ruangan/sesi ini'}
                        style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1.5px solid ${Number(t.is_active) === 1 ? '#fecaca' : C.greenBorder}`, background: Number(t.is_active) === 1 ? '#fef2f2' : C.greenLight, color: Number(t.is_active) === 1 ? '#dc2626' : C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: toggleId === t.id ? 'wait' : 'pointer' }}>
                        <Power size={13} />
                      </button>
                      <button onClick={() => regenerateOne(t.id)} disabled={regenId === t.id}
                        title="Regenerate token ini"
                        style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1.5px solid ${C.greenBorder}`, background: C.greenLight, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: regenId === t.id ? 'wait' : 'pointer' }}>
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                  <p style={{ color: Number(t.is_active) === 1 ? C.green : C.textMuted, fontSize: '22px', fontWeight: 900, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{t.token_code}</p>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

export default TokensView;
