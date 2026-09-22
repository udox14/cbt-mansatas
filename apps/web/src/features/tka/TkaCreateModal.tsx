'use client';

import React, { useState } from 'react';
import { POST } from '@/lib/api';
import { Modal, Button, useToast } from '@/components/ui';

interface TkaCreateModalProps {
  academicYears: Array<{ id: string; nama: string; is_active: boolean }>;
  onClose: () => void;
  onSuccess: (eventId: string) => void;
}

export function TkaCreateModal({ academicYears, onClose, onSuccess }: TkaCreateModalProps) {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const activeYear = academicYears.find((ay) => ay.is_active);
  const [academicYearId, setAcademicYearId] = useState(activeYear ? activeYear.id : academicYears[0]?.id || '');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast('error', 'Kode event wajib diisi');
      return;
    }
    if (!name.trim()) {
      toast('error', 'Nama event wajib diisi');
      return;
    }
    if (!academicYearId) {
      toast('error', 'Tahun ajaran wajib dipilih');
      return;
    }

    setSubmitting(true);
    const selectedAy = academicYears.find((ay) => ay.id === academicYearId);

    const res = await POST<{ id: string }>('/api/tka/events', {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      academic_year_id: academicYearId,
      academic_year_name: selectedAy ? selectedAy.nama : undefined,
      description: description.trim() || undefined,
    });

    setSubmitting(false);

    if (res.success && res.data?.id) {
      toast('success', 'Event TKA berhasil dibuat');
      onSuccess(res.data.id);
    } else {
      toast('error', res.error || 'Gagal membuat event TKA');
    }
  };

  return (
    <Modal open={true} title="Buat Event TKA Baru" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Kode Event <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="misal: TKA-2026-RESMI"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono uppercase focus:ring-emerald-500 focus:border-emerald-500"
            required
          />
          <p className="text-[11px] text-gray-400 mt-0.5">Kode unik identifier ujian TKA sekolah.</p>
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Nama Event <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="misal: Tes Kemampuan Akademik Kelas 12 2026"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
            required
          />
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Tahun Ajaran <span className="text-red-500">*</span>
          </label>
          <select
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
            required
          >
            {academicYears.map((ay) => (
              <option key={ay.id} value={ay.id}>
                {ay.nama} {ay.is_active ? '(Tahun Aktif Saat Ini)' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Pilihan mapel siswa akan disinkronkan berdasarkan tahun ajaran ini.
          </p>
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">Keterangan / Catatan</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Catatan pelaksanaan, instruksi umum, atau jenis sesi (misal: Ujian Resmi Madrasah)..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Menyimpan...' : 'Simpan & Buka Event'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
