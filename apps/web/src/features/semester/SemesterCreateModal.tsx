'use client';

import React, { useState } from 'react';
import { POST } from '@/lib/api';
import { Modal, Button, useToast } from '@/components/ui';

interface SemesterCreateModalProps {
  academicYears: Array<{ id: string; nama: string; is_active: boolean }>;
  onClose: () => void;
  onSuccess: (eventId: string) => void;
}

const ACTIVITY_TYPES = [
  { value: 'pas', label: 'PAS (Penilaian Akhir Semester)' },
  { value: 'pat', label: 'PAT (Penilaian Akhir Tahun)' },
  { value: 'sas', label: 'SAS (Sumatif Akhir Semester)' },
  { value: 'asas', label: 'ASAS (Asesmen Sumatif Akhir Semester)' },
  { value: 'sumatif', label: 'Sumatif Bersama' },
  { value: 'other', label: 'Ujian Semester Lainnya' },
];

export function SemesterCreateModal({ academicYears, onClose, onSuccess }: SemesterCreateModalProps) {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [activityType, setActivityType] = useState('pas');
  const activeYear = academicYears.find((ay) => ay.is_active);
  const [academicYearId, setAcademicYearId] = useState(activeYear ? activeYear.id : academicYears[0]?.id || '');
  const [term, setTerm] = useState('1');
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

    const res = await POST<{ id: string }>('/api/semester/events', {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      activity_type: activityType,
      academic_year_id: academicYearId,
      academic_year_name: selectedAy ? selectedAy.nama : undefined,
      term,
      description: description.trim() || undefined,
    });

    setSubmitting(false);

    if (res.success && res.data?.id) {
      toast('success', 'Event semester berhasil dibuat');
      onSuccess(res.data.id);
    } else {
      toast('error', res.error || 'Gagal membuat event semester');
    }
  };

  return (
    <Modal open={true} title="Buat Event Semester Baru" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Kode Event <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="misal: PAS-2026-GANJIL"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono uppercase focus:ring-emerald-500 focus:border-emerald-500"
            required
          />
          <p className="text-[11px] text-gray-400 mt-0.5">Kode unik identifier event semester (uppercase).</p>
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Nama Event <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="misal: Penilaian Akhir Semester Ganjil 2026/2027"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-gray-700 mb-1">
              Tipe Pelaksanaan <span className="text-red-500">*</span>
            </label>
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
              required
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1">
              Semester (Term) <span className="text-red-500">*</span>
            </label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
              required
            >
              <option value="1">Semester 1 (Ganjil)</option>
              <option value="2">Semester 2 (Genap)</option>
            </select>
          </div>
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
                {ay.nama} {ay.is_active ? '(Aktif)' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-0.5">Tahun ajaran peserta siswa kelas 10, 11, dan 12.</p>
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">Keterangan / Catatan</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Catatan internal pelaksanaan ujian semester..."
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-emerald-500 focus:border-emerald-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Simpan Event
          </Button>
        </div>
      </form>
    </Modal>
  );
}
