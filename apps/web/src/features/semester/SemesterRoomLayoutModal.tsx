'use client';

import React, { useState, useEffect } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, useToast, Spinner, Badge } from '@/components/ui';
import { X, Grid, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { SemesterRoomLayout } from './types';

interface SemesterRoomLayoutModalProps {
  eventId: string;
  room: { id: string; room_name: string; capacity: number };
  onClose: () => void;
  onSuccess: () => void;
}

export function SemesterRoomLayoutModal({
  eventId,
  room,
  onClose,
  onSuccess,
}: SemesterRoomLayoutModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'grid' | 'irregular'>('grid');
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(4);
  const [customSeatsText, setCustomSeatsText] = useState('');
  const [requiredInvigilators, setRequiredInvigilators] = useState<1 | 2>(1);
  const [existingLayout, setExistingLayout] = useState<SemesterRoomLayout | null>(null);

  useEffect(() => {
    async function loadLayout() {
      setLoading(true);
      try {
        const [layoutRes, seatsRes] = await Promise.all([
          GET<SemesterRoomLayout>(`/api/semester/events/${eventId}/rooms/${room.id}/layout`),
          GET<any[]>(`/api/semester/events/${eventId}/rooms/${room.id}/seats`),
        ]);

        if (layoutRes.success && layoutRes.data) {
          setExistingLayout(layoutRes.data);
          if (layoutRes.data.is_irregular === 1) {
            setMode('irregular');
          }
          if (layoutRes.data.rows_count && layoutRes.data.cols_count) {
            setRows(layoutRes.data.rows_count);
            setCols(layoutRes.data.cols_count);
          } else {
            const calculatedCols = 4;
            const calculatedRows = Math.ceil(room.capacity / calculatedCols);
            setRows(calculatedRows);
            setCols(calculatedCols);
          }
          setRequiredInvigilators(layoutRes.data.required_invigilators === 2 ? 2 : 1);
        }

        if (seatsRes.success && Array.isArray(seatsRes.data) && seatsRes.data.length > 0) {
          const lines = seatsRes.data.map(
            (s: any) => `${s.seat_number}, ${s.seat_label}, ${s.row_num || 1}, ${s.col_num || 1}, ${s.desk_group || ''}`
          );
          setCustomSeatsText(lines.join('\n'));
        } else {
          // Generate default lines
          const lines: string[] = [];
          for (let s = 1; s <= room.capacity; s++) {
            const r = Math.ceil(s / 4);
            const c = ((s - 1) % 4) + 1;
            const d = Math.ceil(c / 2) + (r - 1) * 2;
            lines.push(`${s}, K-${String(s).padStart(2, '0')}, ${r}, ${c}, ${d}`);
          }
          setCustomSeatsText(lines.join('\n'));
        }
      } catch {
        toast('error', 'Gagal memuat tata letak ruangan');
      } finally {
        setLoading(false);
      }
    }
    loadLayout();
  }, [eventId, room.id, room.capacity, toast]);

  // Parse custom seats
  const parsedCustomSeats = React.useMemo(() => {
    if (!customSeatsText) return [];
    const lines = customSeatsText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const results: Array<{ seat_number: number; seat_label: string; row_num: number; col_num: number; desk_group?: number }> = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        const num = parseInt(parts[0], 10);
        const label = parts[1];
        const row = parts[2] ? parseInt(parts[2], 10) : 1;
        const col = parts[3] ? parseInt(parts[3], 10) : 1;
        const desk = parts[4] && parseInt(parts[4], 10) ? parseInt(parts[4], 10) : undefined;
        if (!isNaN(num) && label) {
          results.push({ seat_number: num, seat_label: label, row_num: row, col_num: col, desk_group: desk });
        }
      }
    }
    return results;
  }, [customSeatsText]);

  const totalGridSeats = rows * cols;
  const isGridCapacityMatch = totalGridSeats === room.capacity;
  const isIrregularCapacityMatch = parsedCustomSeats.length === room.capacity;
  const isCapacityMatch = mode === 'grid' ? isGridCapacityMatch : isIrregularCapacityMatch;

  async function handleSave() {
    if (!isCapacityMatch) {
      if (mode === 'grid') {
        toast('error', `Jumlah kursi grid (${totalGridSeats}) harus sama persis dengan kapasitas ruangan (${room.capacity}).`);
      } else {
        toast('error', `Jumlah kursi kustom (${parsedCustomSeats.length}) harus sama persis dengan kapasitas ruangan (${room.capacity}).`);
      }
      return;
    }

    setSaving(true);
    try {
      const payload =
        mode === 'irregular'
          ? {
              is_irregular: true,
              custom_seats: parsedCustomSeats,
              required_invigilators: requiredInvigilators,
            }
          : {
              rows_count: rows,
              cols_count: cols,
              is_irregular: false,
              required_invigilators: requiredInvigilators,
            };

      const res = await POST<SemesterRoomLayout>(
        `/api/semester/events/${eventId}/rooms/${room.id}/layout`,
        payload
      );

      if (res.success) {
        toast('success', `Tata letak fisik ruangan ${room.room_name} berhasil dikonfigurasi.`);
        onSuccess();
        onClose();
      } else {
        toast('error', res.error || 'Gagal menyimpan konfigurasi tata letak ruangan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan saat menyimpan tata letak ruangan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Grid className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Konfigurasi Geometri Denah Ruangan
              </h3>
              <p className="text-xs text-gray-500">
                {room.room_name} &bull; Kapasitas Terdaftar: <strong>{room.capacity} Siswa</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-500">
              <Spinner size={24} />
              <p className="text-xs">Memuat data denah ruangan...</p>
            </div>
          ) : (
            <>
              {/* Provenance Banner */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-gray-600">Status Denah Saat Ini:</span>
                  <Badge color={existingLayout?.layout_type === 'physical_configured' ? 'green' : 'yellow'}>
                    {existingLayout?.layout_type === 'physical_configured'
                      ? 'Geometri Terkonfigurasi'
                      : 'Fallback Logis (Otomatis)'}
                  </Badge>
                </div>
                <span className="text-xs text-gray-400 font-mono">
                  {existingLayout?.total_seats || room.capacity} Kursi
                </span>
              </div>

              {/* Layout Mode Switcher */}
              <div className="flex border-b border-gray-200 gap-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMode('grid')}
                  className={`pb-2 border-b-2 transition-colors ${
                    mode === 'grid'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Kisi Teratur (Grid Rows &times; Columns)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('irregular')}
                  className={`pb-2 border-b-2 transition-colors ${
                    mode === 'irregular'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Denah Kustom / Tak Beraturan (Custom Irregular)
                </button>
              </div>

              {mode === 'grid' ? (
                /* Grid Inputs */
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Jumlah Baris Kursi (Rows)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={rows}
                      onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Baris ke belakang</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Jumlah Kolom Kursi (Columns)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={cols}
                      onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Lajur ke samping</p>
                  </div>
                </div>
              ) : (
                /* Custom Irregular Seats Editor */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-gray-700">
                      Definisi Kursi Tak Beraturan (CSV Line-by-Line)
                    </label>
                    <span className="text-[11px] text-gray-500">
                      Terdefinisi: <strong>{parsedCustomSeats.length}</strong> / Kapasitas:{' '}
                      <strong>{room.capacity}</strong> Kursi
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Format: <code>NomorKursi, LabelKursi, Baris, Kolom, IDMejaGroup (opsional)</code>
                  </p>
                  <textarea
                    rows={6}
                    value={customSeatsText}
                    onChange={(e) => setCustomSeatsText(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/40"
                    placeholder={`1, K-01, 1, 1, 1\n2, K-02, 1, 2, 1\n...`}
                  />
                </div>
              )}

              {/* Capacity Matching Validation */}
              <div
                className={`p-3.5 rounded-lg border flex items-center justify-between text-xs ${
                  isCapacityMatch
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isCapacityMatch ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>
                    {mode === 'grid' ? (
                      <>
                        Total Grid: <strong>{totalGridSeats} Kursi</strong> ({rows} Baris &times; {cols} Kolom)
                      </>
                    ) : (
                      <>
                        Total Kursi Kustom: <strong>{parsedCustomSeats.length} Kursi</strong>
                      </>
                    )}
                  </span>
                </div>
                {!isCapacityMatch && (
                  <span className="font-semibold">
                    Wajib sama dengan kapasitas ({room.capacity})
                  </span>
                )}
              </div>

              {/* Required Invigilators */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">
                  Kebutuhan Pengawas per Sesi di Ruangan Ini
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      requiredInvigilators === 1
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-medium'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="invigilators"
                      checked={requiredInvigilators === 1}
                      onChange={() => setRequiredInvigilators(1)}
                      className="accent-emerald-600"
                    />
                    <div>
                      <p className="text-xs font-semibold">1 Orang Pengawas</p>
                      <p className="text-[10px] text-gray-500">Standar pengawasan ruang reguler</p>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      requiredInvigilators === 2
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-medium'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="invigilators"
                      checked={requiredInvigilators === 2}
                      onChange={() => setRequiredInvigilators(2)}
                      className="accent-emerald-600"
                    />
                    <div>
                      <p className="text-xs font-semibold">2 Orang Pengawas</p>
                      <p className="text-[10px] text-gray-500">Pengawasan ganda (ruang besar/aula)</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Visual Grid Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-gray-700">Preview Denah Kursi</h4>
                  <span className="text-[10px] text-gray-400 font-mono">Depan Ruangan / Papan Tulis</span>
                </div>

                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex flex-col items-center">
                  <div className="w-full h-2 bg-gray-300 rounded mb-4 text-[9px] text-center text-gray-600 font-mono uppercase tracking-wider">
                    Papan Tulis / Meja Pengawas
                  </div>

                  {mode === 'grid' ? (
                    <div
                      className="grid gap-2 overflow-x-auto max-w-full p-2"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      }}
                    >
                      {Array.from({ length: totalGridSeats }).map((_, idx) => {
                        const r = Math.floor(idx / cols) + 1;
                        const c = (idx % cols) + 1;
                        const isExcess = idx >= room.capacity;
                        return (
                          <div
                            key={idx}
                            className={`w-14 h-10 rounded border flex flex-col items-center justify-center text-[10px] transition-colors ${
                              isExcess
                                ? 'bg-gray-100 border-dashed border-gray-300 text-gray-400'
                                : 'bg-white border-gray-300 text-gray-800 font-medium shadow-xs'
                            }`}
                          >
                            <span className="font-mono text-[9px]">R{r}-C{c}</span>
                            <span className="text-[8px] text-gray-400">Meja {Math.ceil(c / 2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 overflow-x-auto max-w-full p-2">
                      {parsedCustomSeats.map((seat) => (
                        <div
                          key={seat.seat_number}
                          className="p-1.5 rounded border bg-white border-emerald-300 text-gray-800 flex flex-col items-center justify-center text-[10px] shadow-xs"
                        >
                          <span className="font-mono font-bold text-[9px] text-emerald-800">
                            {seat.seat_label}
                          </span>
                          <span className="text-[8px] text-gray-500">
                            R{seat.row_num}C{seat.col_num} {seat.desk_group ? `M-${seat.desk_group}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || loading || !isCapacityMatch}
          >
            {saving ? <Spinner size={14} /> : 'Simpan Geometri Denah'}
          </Button>
        </div>
      </div>
    </div>
  );
}
