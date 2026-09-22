'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GET, clearToken } from '@/lib/api';
import {
  GraduationCap,
  Trophy,
  BookOpen,
  Calendar,
  FileCheck,
  Lock,
  ArrowRight,
  LogOut,
  UserCheck,
  ShieldCheck,
} from 'lucide-react';

interface ExamModeDef {
  id: string;
  badge: string;
  title: string;
  desc: string;
  icon: any;
  targetUrl: string;
}

const EXAM_MODES: ExamModeDef[] = [
  {
    id: 'pmb',
    badge: 'PMB',
    title: 'Penerimaan Murid Baru',
    desc: 'Seleksi masuk tes CBT calon peserta didik baru madrasah tahun ajaran.',
    icon: GraduationCap,
    targetUrl: '/admin/?mode=pmb',
  },
  {
    id: 'kegiatan',
    badge: 'KEGIATAN',
    title: 'Kegiatan & Lomba',
    desc: 'Seleksi kesiswaan, olimpiade madrasah, dan kompetisi akademik khusus.',
    icon: Trophy,
    targetUrl: '/kegiatan',
  },
  {
    id: 'tka',
    badge: 'TKA',
    title: 'Tes Kemampuan Akademik',
    desc: 'Asesmen kemampuan akademik siswa kelas 12 dengan mapel pilihan terintegrasi.',
    icon: BookOpen,
    targetUrl: '/tka',
  },
  {
    id: 'semester',
    badge: 'SEMESTER',
    title: 'Penilaian Semester',
    desc: 'Penilaian Akhir Semester (PAS) & Asesmen Sumatif terjadwal per sesi & ruang.',
    icon: Calendar,
    targetUrl: '/semester',
  },
  {
    id: 'ulangan',
    badge: 'ULANGAN',
    title: 'Ulangan Guru',
    desc: 'Penilaian harian dan asesmen mandiri oleh guru mata pelajaran untuk kelas ajar.',
    icon: FileCheck,
    targetUrl: '/ulangan',
  },
];

export default function SelectModePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allowedModes, setAllowedModes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const rawUser = localStorage.getItem('cbt_user');
    if (!rawUser) {
      window.location.href = '/login/';
      return;
    }

    try {
      const parsed = JSON.parse(rawUser);
      setCurrentUser(parsed);
      if (Array.isArray(parsed.allowed_modes)) {
        setAllowedModes(parsed.allowed_modes);
      }
    } catch {
      window.location.href = '/login/';
      return;
    }

    // Refresh authoritative mode permissions from API
    GET('/api/auth/modes')
      .then((res) => {
        if (res.success && res.data?.modes) {
          setAllowedModes(res.data.modes);
          // Update local cache
          const updated = {
            ...JSON.parse(localStorage.getItem('cbt_user') || '{}'),
            allowed_modes: res.data.modes,
          };
          localStorage.setItem('cbt_user', JSON.stringify(updated));
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleSelectMode = (mode: ExamModeDef, isAllowed: boolean) => {
    if (!isAllowed) return;
    localStorage.setItem('cbt_active_mode', mode.id);
    window.location.href = mode.targetUrl;
  };

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('cbt_active_mode');
    window.location.href = '/login/';
  };

  const isAdmin = currentUser?.role === 'admin' || currentUser?.roles?.includes('admin');

  return (
    <div className="min-h-screen flex flex-col select-none" style={{ background: '#F4F6F4' }}>
      {/* Top Brand Header */}
      <header
        className="w-full border-b sticky top-0 z-30"
        style={{ background: '#FFFFFF', borderColor: '#E0E5E0' }}
      >
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/kemenag.png"
              alt="Kemenag"
              width={34}
              height={34}
              style={{ objectFit: 'contain' }}
            />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="font-extrabold text-xs uppercase tracking-wider"
                  style={{ color: '#1E2E22' }}
                >
                  MAN 1 TASIKMALAYA
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase"
                  style={{ background: '#E2EBE3', color: '#2D7A4F' }}
                >
                  CBT Portal
                </span>
              </div>
              <p className="text-[11px] font-medium" style={{ color: '#8A9E8D' }}>
                Platform Ujian Sekolah Multi-Domain
              </p>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold leading-tight" style={{ color: '#1E2E22' }}>
                  {currentUser.full_name || currentUser.username}
                </p>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.2 rounded"
                    style={{ background: '#F0F4F1', color: '#4A6655' }}
                  >
                    {isAdmin ? (
                      <>
                        <ShieldCheck size={11} className="text-emerald-700" />
                        Administrator
                      </>
                    ) : (
                      <>
                        <UserCheck size={11} className="text-emerald-700" />
                        {currentUser.role === 'proctor' ? 'Proktor' : 'Pendidik / Guru'}
                      </>
                    )}
                  </span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                style={{ borderColor: '#E0E5E0', color: '#6A7D70' }}
                title="Keluar dari akun"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Keluar</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-5 py-8 sm:py-10">
        <div className="mb-8">
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{ color: '#1E2E22' }}
          >
            Pilih Mode Pelaksanaan
          </h1>
          <p className="text-sm font-medium mt-1.5" style={{ color: '#4A6655' }}>
            Akses portal disesuaikan dengan penugasan dan wewenang akun Anda.
          </p>
        </div>

        {/* 5 Domains Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {EXAM_MODES.map((mode) => {
            const Icon = mode.icon;
            const isAllowed = isAdmin || allowedModes.includes(mode.id);

            return (
              <div
                key={mode.id}
                onClick={() => handleSelectMode(mode, isAllowed)}
                className={`relative flex flex-col justify-between p-5 rounded-2xl border transition-all ${
                  isAllowed
                    ? 'cursor-pointer hover:shadow-md hover:border-emerald-600 bg-white'
                    : 'cursor-not-allowed bg-gray-50/70 opacity-60'
                }`}
                style={{
                  borderColor: isAllowed ? '#D4DBD4' : '#E5E7EB',
                }}
              >
                <div>
                  {/* Card Header: Icon & Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{
                        background: isAllowed ? '#E2EBE3' : '#E5E7EB',
                        color: isAllowed ? '#2D7A4F' : '#9CA3AF',
                      }}
                    >
                      <Icon size={22} strokeWidth={2.2} />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-extrabold tracking-wider"
                        style={{
                          background: isAllowed ? '#F0F5F1' : '#F3F4F6',
                          color: isAllowed ? '#2D7A4F' : '#9CA3AF',
                          border: `1px solid ${isAllowed ? '#B5D9C4' : '#E5E7EB'}`,
                        }}
                      >
                        {mode.badge}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h2
                    className="text-base font-bold tracking-tight mb-1.5"
                    style={{ color: isAllowed ? '#1E2E22' : '#6B7280' }}
                  >
                    {mode.title}
                  </h2>
                  <p
                    className="text-xs leading-relaxed font-normal"
                    style={{ color: isAllowed ? '#4A6655' : '#9CA3AF' }}
                  >
                    {mode.desc}
                  </p>
                </div>

                {/* Card Action Footer */}
                <div
                  className="mt-6 pt-4 border-t flex items-center justify-between"
                  style={{ borderColor: isAllowed ? '#F0F4F1' : '#E5E7EB' }}
                >
                  {isAllowed ? (
                    <>
                      <span
                        className="text-xs font-bold flex items-center gap-1.5 transition-transform group-hover:translate-x-1"
                        style={{ color: '#2D7A4F' }}
                      >
                        Buka Portal
                        <ArrowRight size={14} strokeWidth={2.5} />
                      </span>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded"
                        style={{ background: '#E2EBE3', color: '#2D7A4F' }}
                      >
                        Tersedia
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className="text-xs font-semibold flex items-center gap-1.5"
                        style={{ color: '#9CA3AF' }}
                      >
                        <Lock size={13} />
                        Akses Dibatasi
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded"
                        style={{ background: '#E5E7EB', color: '#6B7280' }}
                      >
                        Belum Ditugaskan
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Security & Access Notice */}
        <div
          className="mt-10 p-4 rounded-xl border flex items-start gap-3"
          style={{ background: '#FFFFFF', borderColor: '#E0E5E0' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: '#E2EBE3', color: '#2D7A4F' }}
          >
            <ShieldCheck size={18} />
          </div>
          <div className="text-xs">
            <p className="font-bold" style={{ color: '#1E2E22' }}>
              Wewenang dan Hak Akses Terpusat
            </p>
            <p className="font-medium mt-0.5 leading-relaxed" style={{ color: '#6A7D70' }}>
              Hak akses pada setiap mode diatur berdasarkan penugasan mengajar dan SK panitia di
              MAN 1 Tasikmalaya. Jika Anda membutuhkan akses ke mode tertentu, silakan hubungi
              Administrator CBT atau Tim Kurikulum.
            </p>
          </div>
        </div>
      </main>

      {/* Institutional Footer */}
      <footer
        className="w-full border-t py-4 text-center mt-auto"
        style={{ background: '#FFFFFF', borderColor: '#E0E5E0' }}
      >
        <p className="text-[11px] font-medium" style={{ color: '#8A9E8D' }}>
          © 2026 MAN 1 Tasikmalaya — CBT MANSATAS Multi-Domain Engine
        </p>
      </footer>
    </div>
  );
}
