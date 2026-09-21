'use client';

import React, { useState, useEffect } from 'react';
import { GET, PUT } from '@/lib/api';
import { Button, useToast, Spinner } from '@/components/ui';
import { ArrowRight } from 'lucide-react';
import { C } from '@/features/exam-engine/components/theme';

export function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const defaults: Record<string, string> = {
    landing_badge: 'Penerimaan Murid Baru 2025/2026',
    landing_title_1: 'Ujian Seleksi',
    landing_title_2: 'Penerimaan',
    landing_title_3: 'Murid Baru',
    landing_subtitle: 'Sistem CBT resmi MAN 1 Tasikmalaya. Aman, terstruktur, dan hasil tersedia langsung setelah ujian.',
    landing_login_hint: 'NISN & tanggal lahir (DDMMYYYY) sebagai password',
    landing_trust: 'Data terintegrasi langsung dari sistem pendaftaran PMB.',
  };

  useEffect(() => {
    GET<Record<string, string>>('/api/admin/settings').then(r => {
      if (r.success) setSettings({ ...defaults, ...(r.data || {}) });
      else setSettings({ ...defaults });
      setLoading(false);
    });
  }, []);

  const upd = (key: string, val: string) => setSettings(prev => ({ ...prev, [key]: val }));

  const save = async () => {
    setSaving(true);
    const r = await PUT('/api/admin/settings', settings);
    setSaving(false);
    toast(r.success ? 'success' : 'error', r.success ? 'Tersimpan!' : r.error || 'Gagal');
  };

  if (loading) return <div className="py-12 text-center"><Spinner /></div>;

  const EditableText = ({ k, style: s, className: cn }: { k: string; style?: React.CSSProperties; className?: string }) => (
    <span
      contentEditable
      suppressContentEditableWarning
      className={cn}
      style={{ ...s, outline: 'none', borderBottom: '2px dashed rgba(45,122,79,0.3)', cursor: 'text', minWidth: '20px', display: 'inline-block' }}
      onBlur={e => upd(k, e.currentTarget.textContent || '')}
      dangerouslySetInnerHTML={{ __html: settings[k] || '' }}
    />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Pengaturan Landing Page</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Klik teks di preview untuk mengedit langsung</p>
        </div>
        <Button size="sm" loading={saving} onClick={save}>Simpan Perubahan</Button>
      </div>

      <div style={{ flex: 1, padding: '20px', overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        {/* LIVE PREVIEW */}
        <div style={{ width: '100%', maxWidth: '400px', background: '#f4f6f4', borderRadius: '24px', border: `2px solid ${C.borderMid}`, padding: '0', overflow: 'hidden', position: 'relative' }}>

          {/* dot texture */}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.4, pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1, padding: '32px 24px 24px' }}>
            {/* Nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '20px' }}>
              <img src="/kemenag.png" alt="" width={36} height={36} style={{ objectFit: 'contain' }} />
              <div>
                <p style={{ color: '#1e2e22', fontSize: '11px', fontWeight: 800, letterSpacing: '0.01em' }}>MAN 1 TASIKMALAYA</p>
                <p style={{ color: '#7a9e86', fontSize: '9.5px', fontWeight: 600, fontStyle: 'italic' }}>Bangkit · Jaya · Juara</p>
              </div>
            </div>

            <div style={{ height: '1px', background: 'linear-gradient(to right,transparent,#c4cec4,transparent)', marginBottom: '24px' }} />

            {/* Badge */}
            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e2ebe3', border: '1.5px solid #c4d4c7', color: '#2d6644', fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', padding: '5px 12px', borderRadius: '999px', textTransform: 'uppercase' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2d7a4f' }} />
                <EditableText k="landing_badge" />
              </span>
            </div>

            {/* Titles */}
            <div style={{ marginBottom: '12px' }}>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_1" style={{ color: '#1e2e22', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_2" style={{ color: '#2d7a4f', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_3" style={{ color: '#6b7c6e', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
            </div>

            {/* Subtitle */}
            <p style={{ marginBottom: '20px', maxWidth: '280px' }}>
              <EditableText k="landing_subtitle" style={{ color: '#8a9e8d', fontSize: '12px', fontWeight: 500, lineHeight: '1.6' }} />
            </p>

            {/* CTA mock */}
            <div style={{ background: '#2d7a4f', padding: '13px 18px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 800 }}>Masuk ke Ujian</span>
              <span style={{ width: '30px', height: '30px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowRight size={14} color="#fff" strokeWidth={2.5} />
              </span>
            </div>
            <p style={{ textAlign: 'center', marginBottom: '16px' }}>
              <EditableText k="landing_login_hint" style={{ color: '#a8b9aa', fontSize: '10px', fontWeight: 500 }} />
            </p>

            {/* Trust */}
            <div style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '12px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#2d7a4f', flexShrink: 0, fontSize: '13px' }}>✓</span>
              <EditableText k="landing_trust" style={{ color: '#8a9e8d', fontSize: '10px', fontWeight: 500, lineHeight: '1.4' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
