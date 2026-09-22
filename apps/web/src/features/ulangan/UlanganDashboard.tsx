'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET } from '@/lib/api';
import { Button, useToast, Spinner } from '@/components/ui';
import { Plus, Search, BookOpen, Clock, Users, Award, ArrowRight, FileQuestion } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import StatusBadge from '../exam-engine/components/StatusBadge';
import type { UlanganExam } from './types';
import { UlanganCreateModal } from './UlanganCreateModal';

interface Props {
  onSelectExam: (examId: string) => void;
}

export function UlanganDashboard({ onSelectExam }: Props) {
  const { toast } = useToast();
  const [exams, setExams] = useState<UlanganExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter !== 'all'
        ? `/api/ulangan/exams?status=${statusFilter}`
        : '/api/ulangan/exams';
      const res = await GET<UlanganExam[]>(url);
      if (res.success && res.data) {
        setExams(res.data);
      } else {
        toast('error', res.error || 'Gagal memuat ulangan harian');
      }
    } catch {
      toast('error', 'Gagal memuat ulangan harian');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  const filteredExams = exams.filter((e) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        (e.class_name && e.class_name.toLowerCase().includes(q)) ||
        (e.description && e.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const totalExams = exams.length;
  const readyActiveCount = exams.filter((e) => e.status === 'ready' || e.status === 'active').length;
  const totalSubmissions = exams.reduce((sum, e) => sum + (e.submitted_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Institutional Header Banner */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.border}`,
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                background: C.greenLight,
                color: C.green,
                border: `1.5px solid ${C.greenBorder}`,
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '999px',
                letterSpacing: '0.05em',
              }}
            >
              DOMAIN ULANGAN HARIAN
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: C.textMid }}>MAN 1 TASIKMALAYA</span>
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: C.text, marginTop: '6px' }}>
            Ulangan Harian & Kuis Kelas
          </h2>
          <p style={{ fontSize: '12.5px', color: C.textMid, marginTop: '2px', maxWidth: '650px' }}>
            Pembuatan asesmen formatif mandiri berbasis penugasan mengajar guru di Mansatas, langsung terikat dengan kelas ampunan tanpa kartu ruangan.
          </p>
        </div>

        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus size={14} /> Buat Ulangan Harian
        </Button>
      </div>

      {/* Summary KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.borderMid}`,
            borderRadius: '12px',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: '11px', color: C.textMuted, fontWeight: 700 }}>Total Ulangan Saya</p>
          <p style={{ fontSize: '24px', fontWeight: 900, color: C.text, marginTop: '4px' }}>
            {totalExams}
          </p>
        </div>

        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.borderMid}`,
            borderRadius: '12px',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: '11px', color: C.textMuted, fontWeight: 700 }}>Siap / Berlangsung</p>
          <p style={{ fontSize: '24px', fontWeight: 900, color: C.green, marginTop: '4px' }}>
            {readyActiveCount}
          </p>
        </div>

        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.borderMid}`,
            borderRadius: '12px',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: '11px', color: C.textMuted, fontWeight: 700 }}>Total Siswa Selesai</p>
          <p style={{ fontSize: '24px', fontWeight: 900, color: C.text, marginTop: '4px' }}>
            {totalSubmissions}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.borderMid}`,
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul ulangan atau kelas..."
            style={{
              width: '100%',
              padding: '7px 12px 7px 32px',
              fontSize: '12px',
              border: `1px solid ${C.borderMid}`,
              borderRadius: '8px',
              outline: 'none',
              background: C.bg,
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              fontSize: '11.5px',
              fontWeight: 600,
              padding: '6px 12px',
              border: `1.5px solid ${C.borderMid}`,
              borderRadius: '8px',
              background: C.white,
              color: C.textMid,
              cursor: 'pointer',
            }}
          >
            <option value="all">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="ready">Siap</option>
            <option value="active">Aktif</option>
            <option value="completed">Selesai</option>
            <option value="archived">Arsip</option>
          </select>
        </div>
      </div>

      {/* Exam Cards */}
      {loading ? (
        <div className="py-16 text-center">
          <Spinner />
          <p className="text-xs text-gray-400 mt-2">Memuat data ulangan...</p>
        </div>
      ) : filteredExams.length === 0 ? (
        <div
          style={{
            background: C.white,
            border: `1.5px dashed ${C.borderMid}`,
            borderRadius: '12px',
            padding: '40px 20px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '999px',
              background: C.greenLight,
              color: C.green,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
            }}
          >
            <BookOpen size={22} />
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: C.text }}>
            Belum Ada Ulangan Harian
          </h3>
          <p style={{ fontSize: '12px', color: C.textMid, maxWidth: '400px', margin: '6px auto 16px' }}>
            Buat ulangan harian baru yang terhubung langsung dengan jadwal mengajar dan kelas yang Anda ampu.
          </p>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} /> Buat Ulangan Pertama
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredExams.map((e) => (
            <div
              key={e.id}
              onClick={() => onSelectExam(e.id)}
              style={{
                background: C.white,
                border: `1.5px solid ${C.borderMid}`,
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              onMouseEnter={(el) => {
                el.currentTarget.style.borderColor = C.green;
                el.currentTarget.style.transform = 'translateY(-2px)';
                el.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.06)';
              }}
              onMouseLeave={(el) => {
                el.currentTarget.style.borderColor = C.borderMid;
                el.currentTarget.style.transform = 'translateY(0)';
                el.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      background: C.greenLight,
                      color: C.green,
                      border: `1px solid ${C.greenBorder}`,
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '999px',
                    }}
                  >
                    {e.class_name || 'Kelas Terdaftar'}
                  </span>
                  <StatusBadge status={e.status} />
                </div>

                <h4 style={{ fontSize: '14px', fontWeight: 800, color: C.text, lineHeight: 1.3 }}>
                  {e.title}
                </h4>

                {e.description && (
                  <p
                    style={{
                      fontSize: '11.5px',
                      color: C.textMid,
                      marginTop: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.description}
                  </p>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${C.borderLight}`, marginTop: '12px', paddingTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: C.textMuted }}>
                  <span className="flex items-center gap-1">
                    <FileQuestion size={12} /> {e.question_count || 0} Soal
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={12} /> {e.roster_count || 0} Siswa
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {e.duration_minutes}m
                  </span>
                  <span style={{ color: C.green, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Buka <ArrowRight size={11} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <UlanganCreateModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(newExam) => {
          setShowCreateModal(false);
          fetchExams();
          onSelectExam(newExam.id);
        }}
      />
    </div>
  );
}
