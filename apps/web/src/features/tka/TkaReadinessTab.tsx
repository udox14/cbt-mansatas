'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, PUT } from '@/lib/api';
import { Button, Spinner, useToast, Confirm } from '@/components/ui';
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';
import type { TkaReadinessReport, TkaEvent } from './types';

export function TkaReadinessTab({
  event,
  onStatusChanged,
}: {
  event: TkaEvent;
  onStatusChanged: () => void;
}) {
  const { toast } = useToast();
  const [report, setReport] = useState<TkaReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    const res = await GET<TkaReadinessReport>(`/api/tka/events/${event.id}/readiness`);
    if (res.success && res.data) {
      setReport(res.data);
    } else {
      toast('error', res.error || 'Gagal memeriksa kesiapan event TKA');
    }
    setLoading(false);
  }, [event.id, toast]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const handleMarkReady = async () => {
    setTransitioning(true);
    const res = await PUT<any>(`/api/tka/events/${event.id}/status`, { status: 'ready' });
    setTransitioning(false);
    setShowConfirm(false);

    if (res.success) {
      toast('success', 'Event TKA berhasil ditandai SIAP PELAKSANAAN');
      onStatusChanged();
      fetchReadiness();
    } else {
      toast('error', res.error || 'Gagal menandai event siap');
      if ((res as any).readiness) setReport((res as any).readiness);
      else fetchReadiness();
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
            <h2 className="font-bold text-gray-900 text-sm">Gate Kesiapan Server-Authoritative TKA</h2>
          </div>
          <p className="text-gray-500 text-[11px] mt-0.5">
            Evaluasi 10 kriteria deterministik sebelum event dapat dialihkan ke status Ready (Siap Pelaksanaan).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fetchReadiness()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Periksa Ulang
          </Button>

          {event.status === 'configuration' && report?.ready && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={transitioning}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Tandai Siap Pelaksanaan
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
        <div className="space-y-6">
          {/* Status Verdict Box */}
          {report.ready ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-emerald-900 text-xs">
                  Event Siap untuk Pelaksanaan (10/10 Gate Lolos)
                </h3>
                <p className="text-emerald-700 text-[11px] mt-0.5">
                  Seluruh mata pelajaran memiliki soal dan token ruangan, serta siswa valid memiliki 5 roster ujian lengkap.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-900 text-xs">
                  Event Belum Siap ({report.blockers.length} Penghalang Ditemukan)
                </h3>
                <p className="text-amber-700 text-[11px] mt-0.5">
                  Perbaiki seluruh item bertanda merah di bawah ini sebelum menandai event berstatus Ready.
                </p>
              </div>
            </div>
          )}

          {/* Checklist of Gates */}
          <div className="space-y-3">
            {report.checks.map((check) => (
              <div
                key={check.id}
                className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                  check.passed
                    ? 'bg-white border-gray-200'
                    : check.severity === 'blocking'
                    ? 'bg-red-50/50 border-red-200'
                    : 'bg-amber-50/50 border-amber-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  {check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : check.severity === 'blocking' ? (
                    <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4
                      className={`font-bold text-xs ${
                        check.passed
                          ? 'text-gray-900'
                          : check.severity === 'blocking'
                          ? 'text-red-900'
                          : 'text-amber-900'
                      }`}
                    >
                      {check.name}
                    </h4>
                    <p className="text-gray-600 text-[11px] mt-1">{check.message}</p>
                    {check.details && (
                      <pre className="mt-2 text-[10px] bg-gray-50 p-2 rounded text-gray-600 border border-gray-100 font-mono">
                        {JSON.stringify(check.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>

                <div className="shrink-0 mt-1">
                  {check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {showConfirm && (
        <Confirm
          open={showConfirm}
          title="Tandai Event Siap Pelaksanaan?"
          message="Setelah beralih ke status Ready, data peserta, pilihan mata pelajaran, tahun ajaran, dan penugasan ruangan akan DIBEKUKAN (frozen) demi integritas ujian sekolah."
          confirmText={transitioning ? 'Memproses...' : 'Ya, Tandai Siap'}
          onConfirm={handleMarkReady}
          onClose={() => setShowConfirm(false)}
          danger={false}
        />
      )}
    </div>
  );
}
