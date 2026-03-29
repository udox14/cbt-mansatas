'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShieldCheck, Clock, Monitor, CheckCircle2 } from 'lucide-react';

const API = 'https://cbtmansatas.drudox.workers.dev';

const FEATURES = [
  { icon: ShieldCheck, title: 'Anti-Kecurangan', desc: 'Deteksi pindah tab',    green: true  },
  { icon: Clock,       title: 'Auto-Save',        desc: 'Jawaban aman tersimpan', green: false },
  { icon: Monitor,     title: 'Berbasis Web',      desc: 'Tanpa install aplikasi', green: false },
];

const DEFAULTS: Record<string, string> = {
  landing_badge: 'Penerimaan Murid Baru 2025/2026',
  landing_title_1: 'Ujian Seleksi',
  landing_title_2: 'Penerimaan',
  landing_title_3: 'Murid Baru',
  landing_subtitle: 'Sistem CBT resmi MAN 1 Tasikmalaya. Aman, terstruktur, dan hasil tersedia langsung setelah ujian.',
  landing_login_hint: 'NISN & tanggal lahir (DDMMYYYY) sebagai password',
  landing_trust: 'Data terintegrasi langsung dari sistem pendaftaran PMB.',
};

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [s, setS] = useState(DEFAULTS);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    fetch(`${API}/api/settings`).then(r => r.json()).then(r => {
      if (r.success && r.data) setS(prev => ({ ...prev, ...r.data }));
    }).catch(() => {});
    return () => clearTimeout(t);
  }, []);

  const fade = (delay: number) =>
    `transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`;
  const style = (delay: number): React.CSSProperties => ({ transitionDelay: `${delay}ms` });

  return (
    <div className="min-h-screen flex flex-col select-none overflow-hidden" style={{ background: '#f4f6f4' }}>

      {/* dot texture */}
      <div className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.4 }} />

      {/* shape blobs */}
      <div className="pointer-events-none absolute -top-12 -right-12 w-52 h-52 rounded-full" style={{ background: '#dde2dd' }} />
      <div className="pointer-events-none absolute -bottom-10 -left-10 w-44 h-44 rounded-full" style={{ background: '#d6e8dc' }} />

      {/* NAV */}
      <nav className={`relative z-10 flex items-center gap-3 px-5 pt-10 pb-3 max-w-md mx-auto w-full ${fade(0)}`} style={style(0)}>
        <img src="/kemenag.png" alt="Kemenag" width={40} height={40} style={{ objectFit: 'contain', flexShrink: 0 }} />
        <div>
          <p className="font-extrabold leading-tight tracking-wide" style={{ color: '#1e2e22', fontSize: '12px' }}>MAN 1 TASIKMALAYA</p>
          <p className="font-semibold italic mt-0.5" style={{ color: '#7a9e86', fontSize: '10px', letterSpacing: '0.06em' }}>Bangkit · Maju · Juara</p>
        </div>
      </nav>

      {/* divider */}
      <div className="relative z-10 mx-5 max-w-md w-full self-center" style={{ height: '1px', background: 'linear-gradient(to right,transparent,#c4cec4,transparent)', marginBottom: '28px' }} />

      {/* HERO */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-5 max-w-md mx-auto w-full">

        {/* Badge */}
        <div className={`${fade(0)} mb-5`} style={style(0)}>
          <span className="inline-flex items-center gap-1.5 font-bold uppercase"
            style={{ background: '#e2ebe3', border: '1.5px solid #c4d4c7', color: '#2d6644', fontSize: '11px', letterSpacing: '0.09em', padding: '6px 14px', borderRadius: '999px' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#2d7a4f' }} />
            {s.landing_badge}
          </span>
        </div>

        {/* Headline */}
        <div className={`${fade(0)} mb-3`} style={style(80)}>
          <p className="font-black leading-[1.06]" style={{ color: '#1e2e22', fontSize: 'clamp(2.1rem,9vw,2.6rem)', letterSpacing: '-1.2px' }}>{s.landing_title_1}</p>
          <p className="font-black leading-[1.06]" style={{ color: '#2d7a4f', fontSize: 'clamp(2.1rem,9vw,2.6rem)', letterSpacing: '-1.2px' }}>{s.landing_title_2}</p>
          <p className="font-black leading-[1.06]" style={{ color: '#6b7c6e', fontSize: 'clamp(2.1rem,9vw,2.6rem)', letterSpacing: '-1.2px' }}>{s.landing_title_3}</p>
        </div>

        <p className={`${fade(0)} mb-8 leading-relaxed max-w-xs`} style={{ ...style(140), color: '#8a9e8d', fontSize: '13.5px', fontWeight: 500 }}>
          {s.landing_subtitle}
        </p>

        {/* CTA */}
        <div className={`${fade(0)} mb-2.5`} style={style(200)}>
          <Link href="/login/"
            className="flex items-center justify-between w-full active:scale-[0.98] transition-transform"
            style={{ background: '#2d7a4f', padding: '15px 20px', borderRadius: '16px' }}>
            <span className="font-extrabold" style={{ color: '#fff', fontSize: '15px', letterSpacing: '-0.2px' }}>Masuk ke Ujian</span>
            <span className="flex items-center justify-center rounded-lg" style={{ width: '34px', height: '34px', background: 'rgba(255,255,255,0.15)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </span>
          </Link>
        </div>
        <p className={`${fade(0)} text-center mb-8`} style={{ ...style(200), color: '#a8b9aa', fontSize: '11px', fontWeight: 500 }}>
          {s.landing_login_hint}
        </p>

        {/* Feature cards */}
        <div className={`${fade(0)} grid grid-cols-3 gap-2.5 mb-3`} style={style(260)}>
          {FEATURES.map(f => (
            <div key={f.title} className="flex flex-col" style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '16px', padding: '13px 11px' }}>
              <div className="flex items-center justify-center mb-2" style={{ width: '30px', height: '30px', background: f.green ? '#e2ebe3' : '#e8eae8', borderRadius: '9px' }}>
                <f.icon size={14} strokeWidth={2} color={f.green ? '#2d7a4f' : '#6b7c6e'} />
              </div>
              <p className="font-bold leading-tight mb-0.5" style={{ color: '#1e2e22', fontSize: '10.5px' }}>{f.title}</p>
              <p className="leading-tight" style={{ color: '#8a9e8d', fontSize: '9.5px' }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className={`${fade(0)} flex items-center gap-2.5 mb-8`} style={{ ...style(320), background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '14px', padding: '11px 14px' }}>
          <CheckCircle2 size={13} strokeWidth={2.2} color="#2d7a4f" className="shrink-0" />
          <p style={{ color: '#8a9e8d', fontSize: '11px', fontWeight: 500, lineHeight: 1.4 }}>
            {s.landing_trust}
          </p>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 pb-10 pt-2 text-center max-w-md mx-auto w-full">
        <p style={{ color: '#a8b3a8', fontSize: '11px', fontWeight: 500 }}>© 2026 MAN 1 Tasikmalaya — DRUDOX</p>
      </footer>
    </div>
  );
}
