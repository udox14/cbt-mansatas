'use client';
import React, { useState, useEffect } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Modal, useToast, Spinner } from '@/components/ui';
import MathContent from '@/components/content/MathContent';
import { isFullArabic } from '@/lib/rtl';
import {
  Sparkles,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Pencil,
  Trash2,
  Layers,
  BookOpen,
} from 'lucide-react';
import type { AiDraft, AiDraftOption } from '../types';
import { C } from '../components/theme';

interface AiQuestionGeneratorProps {
  examId: string;
  apiPrefix?: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AiQuestionGenerator({
  examId,
  apiPrefix = '/api/admin',
  open,
  onClose,
  onSuccess,
}: AiQuestionGeneratorProps) {
  const { toast } = useToast();

  // Form inputs
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'balanced' | 'hard'>('balanced');
  const [variation, setVariation] = useState<'standard' | 'varied' | 'high_variation'>('standard');
  const [instruction, setInstruction] = useState('');
  const [referenceText, setReferenceText] = useState('');

  // Execution states
  const [step, setStep] = useState<'config' | 'generating' | 'review'>('config');
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);

  // Edit draft modal
  const [editDraft, setEditDraft] = useState<AiDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load drafts if any active run exist
  useEffect(() => {
    if (open) {
      GET<AiDraft[]>(`${apiPrefix}/exams/${examId}/ai/drafts`).then((r) => {
        if (r.success && r.data && r.data.length > 0) {
          const unaccepted = r.data.filter((d) => d.status === 'draft');
          if (unaccepted.length > 0) {
            setDrafts(unaccepted);
            setSelectedIds(new Set(unaccepted.filter((d) => d.validation_status === 'valid').map((d) => d.id)));
            setStep('review');
          }
        }
      });
    }
  }, [open, examId, apiPrefix]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast('error', 'Topik / materi soal wajib diisi');
      return;
    }

    setStep('generating');
    const payload = {
      topic: topic.trim(),
      question_count: count,
      difficulty_mode: difficulty,
      variation_level: variation,
      additional_instruction: instruction.trim() || undefined,
      reference_text: referenceText.trim() || undefined,
    };

    const res = await POST<{ drafts?: AiDraft[] }>(`${apiPrefix}/exams/${examId}/ai/generate`, payload);

    if (res.success && res.data?.drafts) {
      const generatedDrafts = res.data.drafts;
      setDrafts(generatedDrafts);
      setSelectedIds(new Set(generatedDrafts.filter((d) => d.validation_status === 'valid').map((d) => d.id)));
      setStep('review');
      toast('success', res.message || 'Draf soal AI berhasil disusun');
    } else {
      setStep('config');
      toast('error', res.error || 'Gagal menghasilkan soal dengan AI');
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    const validDrafts = drafts.filter((d) => d.validation_status === 'valid');
    if (selectedIds.size === validDrafts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(validDrafts.map((d) => d.id)));
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    const res = await DEL(`${apiPrefix}/exams/${examId}/ai/drafts/${draftId}`);
    if (res.success) {
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
      toast('success', 'Draf soal dihapus');
    } else {
      toast('error', res.error || 'Gagal menghapus draf');
    }
  };

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    setSavingEdit(true);
    const res = await PUT(`${apiPrefix}/exams/${examId}/ai/drafts/${editDraft.id}`, {
      question_text: editDraft.question_text,
      options: editDraft.options,
      correct_index: editDraft.correct_index,
      explanation: editDraft.explanation,
      difficulty: editDraft.difficulty,
    });
    setSavingEdit(false);

    if (res.success) {
      toast('success', 'Draf berhasil diperbarui');
      // Refresh drafts
      const r = await GET<AiDraft[]>(`${apiPrefix}/exams/${examId}/ai/drafts`);
      if (r.success && r.data) {
        setDrafts(r.data.filter((d) => d.status === 'draft'));
      }
      setEditDraft(null);
    } else {
      toast('error', res.error || 'Gagal memperbarui draf');
    }
  };

  const handleAcceptSelected = async () => {
    if (selectedIds.size === 0) {
      toast('error', 'Pilih setidaknya satu soal untuk diimpor');
      return;
    }

    setAccepting(true);
    const res = await POST(`${apiPrefix}/exams/${examId}/ai/drafts/accept`, {
      draft_ids: Array.from(selectedIds),
    });
    setAccepting(false);

    if (res.success) {
      toast('success', res.message || 'Soal berhasil diterima dan diimpor');
      onSuccess();
      onClose();
    } else {
      toast('error', res.error || 'Gagal mengimpor soal');
    }
  };

  const validCount = drafts.filter((d) => d.validation_status === 'valid').length;
  const duplicateCount = drafts.filter((d) => d.validation_status === 'duplicate').length;
  const invalidCount = drafts.filter((d) => d.validation_status === 'invalid').length;

  return (
    <Modal open={open} onClose={onClose} title="AI Question Generator" size="lg">
      <div className="space-y-4">
        {step === 'config' && (
          <div className="space-y-3.5">
            <p className="text-xs text-gray-500">
              Buat draf soal pilihan ganda secara otomatis dengan panduan blueprint kurikulum dan telaah manusia sebelum
              masuk ke bank soal.
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Topik / Materi Pokok <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: Hukum Newton tentang Gerak dan Gravitasi"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Jumlah Soal</label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white"
                >
                  <option value={3}>3 Soal</option>
                  <option value={5}>5 Soal</option>
                  <option value={10}>10 Soal</option>
                  <option value={15}>15 Soal</option>
                  <option value={20}>20 Soal (Maks)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tingkat Kesulitan</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white"
                >
                  <option value="balanced">Seimbang (Mudah & Sulit)</option>
                  <option value="easy">Dominan Mudah</option>
                  <option value="hard">Dominan Sulit (HOTS)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Variasi Konteks</label>
                <select
                  value={variation}
                  onChange={(e) => setVariation(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white"
                >
                  <option value="standard">Standar (Terarah)</option>
                  <option value="varied">Bervariasi (Nyata)</option>
                  <option value="high_variation">Sangat Bervariasi</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Instruksi Khusus Penulis (Opsional)
              </label>
              <textarea
                rows={2}
                placeholder="Contoh: Fokuskan pada penerapan rumus gaya gesek dalam bidang miring. Hindari soal hafalan istilah."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Teks Referensi / Stimulus Bacaan (Opsional)
              </label>
              <textarea
                rows={3}
                placeholder="Tempelkan kutipan wacana, artikel ilmiah, studi kasus, atau teks Arab yang ingin dijadikan dasar pembuatan pertanyaan..."
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 font-mono text-xs"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                Teks referensi diisolasi secara ketat dan diperlakukan sebagai data bacaan pasif.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Batal
              </Button>
              <Button size="sm" onClick={handleGenerate}>
                <Sparkles size={13} className="mr-1" />
                Generate Soal AI
              </Button>
            </div>
          </div>
        )}

        {step === 'generating' && (
          <div className="py-12 text-center space-y-3">
            <Spinner size={32} />
            <div>
              <p className="text-sm font-bold text-gray-800">Menyusun Soal dengan AI...</p>
              <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                Memvalidasi struktur pilihan ganda, mendeteksi potensi duplikasi, dan menyelaraskan kunci jawaban.
              </p>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            {/* Summary Bar */}
            <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-bold text-gray-700">{drafts.length} Draf Soal</span>
                <span className="text-green-700 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                  {validCount} Valid
                </span>
                {duplicateCount > 0 && (
                  <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                    <AlertTriangle size={11} /> {duplicateCount} Duplikat
                  </span>
                )}
                {invalidCount > 0 && (
                  <span className="text-red-700 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200 flex items-center gap-1">
                    <AlertCircle size={11} /> {invalidCount} Tidak Valid
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs text-primary-600 hover:underline font-medium"
                >
                  {selectedIds.size === validCount && validCount > 0 ? 'Batal Pilih Semua' : 'Pilih Semua Valid'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('config')}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 bg-white hover:bg-gray-50"
                >
                  <RefreshCw size={11} /> Buat Ulang
                </button>
              </div>
            </div>

            {/* Draft Cards List */}
            <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
              {drafts.map((d, i) => {
                const isSelected = selectedIds.has(d.id);
                const isDuplicate = d.validation_status === 'duplicate';
                const isInvalid = d.validation_status === 'invalid';

                return (
                  <div
                    key={d.id}
                    style={{
                      background: C.white,
                      border: `1.5px solid ${isInvalid ? '#fca5a5' : isDuplicate ? '#fde68a' : isSelected ? C.greenBorder : C.borderMid}`,
                      borderRadius: '10px',
                      padding: '12px 14px',
                    }}
                    className="relative transition-all"
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isInvalid}
                        onChange={() => toggleSelect(d.id)}
                        className="mt-1 rounded text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-gray-400">#{i + 1}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                d.difficulty === 'hard'
                                  ? 'bg-purple-100 text-purple-700'
                                  : d.difficulty === 'easy'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {d.difficulty === 'hard' ? 'Sulit' : d.difficulty === 'easy' ? 'Mudah' : 'Seimbang'}
                            </span>

                            {isDuplicate && (
                              <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <AlertTriangle size={10} /> Duplikat
                              </span>
                            )}
                            {isInvalid && (
                              <span className="text-[10px] font-semibold bg-red-100 text-red-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <AlertCircle size={10} /> Tidak Valid
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setEditDraft(d)}
                              className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
                              title="Edit Draf"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDraft(d.id)}
                              className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                              title="Hapus Draf"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Question Stem */}
                        <div
                          className={`text-xs text-gray-800 leading-relaxed font-medium ${isFullArabic(d.question_text) ? 'arabic text-right' : ''}`}
                        >
                          <MathContent html={d.question_text} />
                        </div>

                        {/* Options */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {d.options?.map((opt, oIdx) => {
                            const isCorrect = opt.is_correct === 1 || oIdx === d.correct_index;
                            return (
                              <div
                                key={oIdx}
                                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${
                                  isCorrect
                                    ? 'bg-green-50 border-green-300 text-green-800 font-semibold'
                                    : 'bg-gray-50 border-gray-200 text-gray-700'
                                }`}
                              >
                                <span
                                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                    isCorrect ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                                  }`}
                                >
                                  {opt.option_label}
                                </span>
                                <span className={`flex-1 truncate ${isFullArabic(opt.option_text) ? 'arabic text-right' : ''}`}>
                                  {opt.option_text}
                                </span>
                                {isCorrect && <CheckCircle2 size={12} className="text-green-600 flex-shrink-0" />}
                              </div>
                            );
                          })}
                        </div>

                        {/* Explanation */}
                        {d.explanation && (
                          <div className="text-[11px] text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                            <span className="font-semibold text-gray-600">Penjelasan: </span>
                            {d.explanation}
                          </div>
                        )}

                        {/* Validation Errors warning if any */}
                        {d.validation_errors && d.validation_errors.length > 0 && (
                          <div className="text-[11px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                            {d.validation_errors.join('; ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Tutup
              </Button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  loading={accepting}
                  disabled={selectedIds.size === 0}
                  onClick={handleAcceptSelected}
                >
                  Terima & Import ({selectedIds.size}) Soal
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Draft Sub-Modal */}
        {editDraft && (
          <Modal open={true} onClose={() => setEditDraft(null)} title="Edit Draf Soal" size="md">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Teks Pokok Soal</label>
                <textarea
                  rows={3}
                  value={editDraft.question_text}
                  onChange={(e) => setEditDraft({ ...editDraft, question_text: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-700">Pilihan Jawaban & Kunci</label>
                {editDraft.options?.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="editCorrect"
                      checked={editDraft.correct_index === oIdx}
                      onChange={() => {
                        const updated = editDraft.options.map((o, idx) => ({
                          ...o,
                          is_correct: idx === oIdx ? 1 : 0,
                        }));
                        setEditDraft({ ...editDraft, options: updated, correct_index: oIdx });
                      }}
                      className="text-primary-600"
                    />
                    <span className="text-xs font-bold text-gray-500 w-4">{opt.option_label}</span>
                    <input
                      type="text"
                      value={opt.option_text}
                      onChange={(e) => {
                        const updated = [...editDraft.options];
                        updated[oIdx] = { ...updated[oIdx], option_text: e.target.value };
                        setEditDraft({ ...editDraft, options: updated });
                      }}
                      className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Penjelasan Kunci</label>
                <textarea
                  rows={2}
                  value={editDraft.explanation || ''}
                  onChange={(e) => setEditDraft({ ...editDraft, explanation: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="secondary" size="sm" onClick={() => setEditDraft(null)}>
                  Batal
                </Button>
                <Button size="sm" loading={savingEdit} onClick={handleSaveEdit}>
                  Simpan Perubahan
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
