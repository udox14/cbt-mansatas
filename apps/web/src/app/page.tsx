'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BookOpen, LogIn, ShieldCheck, Wifi, Clock } from 'lucide-react';

export default function LandingPage() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(true); }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-primary-950 text-white">
      {/* Subtle grid bg */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <BookOpen size={16} strokeWidth={2.5} />
            </div>
            <span className="font-bold text-sm tracking-tight">CBT PMB</span>
          </div>
          <Link href="/login/" className="flex items-center gap-1.5 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors">
            <LogIn size={15} /> Masuk
          </Link>
        </nav>

        {/* Hero */}
        <main className="flex-1 flex items-center justify-center px-6">
          <div className={`text-center max-w-lg transition-all duration-700 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-xs font-medium text-primary-400 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-primary-400" />
              Penerimaan Murid Baru 2025/2026
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight">
              Ujian Seleksi<br />
              <span className="text-primary-400">Penerimaan Murid Baru</span>
            </h1>
            <p className="text-gray-400 mt-4 mb-8 leading-relaxed text-sm sm:text-base max-w-md mx-auto">
              Sistem ujian berbasis komputer yang aman, cepat, dan andal. Selamat datang dan semoga sukses.
            </p>
            <Link href="/login/" className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-xl shadow-lg shadow-primary-600/20 transition-all text-sm">
              <LogIn size={16} /> Masuk ke Ujian
            </Link>

            {/* Features */}
            <div className="grid grid-cols-3 gap-4 mt-16 text-center">
              {[
                { icon: ShieldCheck, label: 'Anti-Cheat' },
                { icon: Wifi, label: 'Offline-Ready' },
                { icon: Clock, label: 'Auto-Save' },
              ].map(f => (
                <div key={f.label} className="flex flex-col items-center gap-1.5">
                  <f.icon size={18} className="text-primary-500" />
                  <span className="text-xs text-gray-500">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>

        <footer className="text-center py-5 text-xs text-gray-600">© 2025 — Sistem CBT PMB</footer>
      </div>
    </div>
  );
}
