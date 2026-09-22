'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Spinner, useToast, Confirm } from '@/components/ui';
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, RefreshCw, Lock, AlertOctagon } from 'lucide-react';
import type { SemesterEvent, SemesterReadinessResult } from './types';

interface SemesterReadinessTabProps {
  event: SemesterEvent;
  onStatusChanged: () => void;
}

export function SemesterReadinessTab({ event, onStatusChanged }: SemesterReadinessTabProps) {
  const { toast } = useToast();
  const [report, setReport] = useState<SemesterReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    const res = await GET<SemesterReadinessResult>(`/api/semester/events/${event.id}/readiness`);
    if (res.success && res.data) {
      setReport(res.data);
    } else {
      toast('error', res.error || 'Gagal memeriksa kesiapan event semester');
    }
    setLoading(false);
  }, [event.id, toast]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const handleMarkReady = async () => {
    setTransitioning(true);
    const res = await POST<any>(`/api/semester/events/${event.id}/status`, { status: 'ready' });
    setTransitioning(false);
    setShowConfirm(false);

    if (res.success) {
      toast('success', 'Event Semester berhasil ditandai SIAP PELAKSANAAN (Ready)');
      onStatusChanged();
      fetchReadiness();
    } else {
      toast('error', res.error || 'Gagal menandai event siap pelaksanaan');
      fetchReadiness();
    }
  };

  const CATEGORY_TITLES: Record<string, string> = {
    event: '1. Konfigurasi Event Semester',
    participants: '2. Snapshot Peserta & Nomor Peserta',
    exams: '3. Ujian Semester & Mapel Mansatas',
    audience: '4. Cakupan Kelas Audiens',
    roster: '5. Roster Peserta Ujian',
    rooms: '6. Ruangan & Kapasitas Kursi',
    schedules: '7. Sesi Waktu & Konflik Jadwal',
    tokens: '8. Ketersediaan Token Ujian',
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
            <h2 className="font-bold text-gray-900 text-sm">Gate Kesiapan Server-Authoritative Semester</h2>
          </div>
          <p className="text-gray-500 text-[11px] mt-0.5">
            Evaluasi 8 gate deterministik (termasuk kapasitas ruangan dan konflik jadwal) sebelum event dapat dialihkan ke status Ready.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fetchReadiness()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Periksa Ulang
          </Button>

          {event.status === 'configuration' && report?.eligible && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={transitioning}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Tandai Siap Pelaksanaan (Kunci)
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Spinner size={24} />
        </div>
      ) : !report ? (
        <div className="p-8 text-center text-gray-400">Gagal memuat laporan kesiapan.</div>
      ) : (
        <div className="space-y-4">
          {/* Status Verdict Box */}
          {report.eligible ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-emerald-900 text-sm">Semua Gate Kesiapan Terpenuhi (Eligible)</h4>
                <p className="text-emerald-700 mt-0.5 text-xs">
                  Event semester ini telah memenuhi seluruh kriteria integritas data: peserta, ujian, audiens, roster, kuota ruangan, dan jadwal bebas konflik.
                </p>
                {event.status === 'configuration' && (
                  <div className="mt-3">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowConfirm(true)}
                      disabled={transitioning}
                    >
                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                      Kunci Konfigurasi & Ubah ke Status READY
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
              <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-rose-900 text-sm">
                  Kesiapan Belum Terpenuhi ({report.blockers?.length || 0} Blocker Ditemukan)
                </h4>
                <p className="text-rose-700 mt-0.5 text-xs">
                  Selesaikan kendala berikut sebelum mengunci event ke status Siap Pelaksanaan:
                </p>
                <ul className="mt-2.5 space-y-1 list-disc list-inside text-rose-800 text-xs font-medium">
                  {report.blockers?.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 8 Categories Detailed Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(report.categories || {}).map(([key, cat]) => {
              const isPassed = cat.status === 'passed';
              const isWarning = cat.status === 'warning';

              return (
                <div
                  key={key}
                  className={`p-4 rounded-xl border shadow-sm transition-all ${
                    isPassed
                      ? 'bg-white border-emerald-200'
                      : isWarning
                      ? 'bg-amber-50/40 border-amber-200'
                      : 'bg-rose-50/40 border-rose-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isPassed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : isWarning ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <h4 className="font-bold text-gray-900 text-xs">
                        {CATEGORY_TITLES[key] || cat.name}
                      </h4>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        isPassed
                          ? 'bg-emerald-100 text-emerald-800'
                          : isWarning
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {cat.status}
                    </span>
                  </div>

                  <p
                    className={`mt-2 text-xs leading-relaxed ${
                      isPassed ? 'text-gray-600' : isWarning ? 'text-amber-800' : 'text-rose-700'
                    }`}
                  >
                    {cat.message}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <Confirm
          open={true}
          title="Kunci Kesiapan Event Semester (Ready)"
          message="Anda akan mengubah status event menjadi 'ready' (Siap Pelaksanaan). Setelah ready, konfigurasi peserta, ujian, dan audiens akan dibekukan untuk menjaga integritas ujian. Lanjutkan?"
          confirmText="Ya, Kunci & Siapkan"
          danger={false}
          onConfirm={handleMarkReady}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
