'use client';
import React, { useState } from 'react';
import { POST } from '@/lib/api';
import { Button, Modal, useToast, Spinner } from '@/components/ui';
import MathContent from '@/components/content/MathContent';
import { isFullArabic } from '@/lib/rtl';
import {
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Pencil,
  Trash2,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { C } from '../components/theme';

export interface ParsedOptionItem {
  option_label: string;
  option_text: string;
  is_correct: number;
}

export interface ParsedQuestionItem {
  id: string;
  stem: string;
  options: ParsedOptionItem[];
  correct_index: number;
  explanation?: string | null;
  difficulty: 'easy' | 'balanced' | 'hard';
  content_hash: string;
  validation_status: 'valid' | 'invalid' | 'duplicate';
  validation_errors: string[];
}

interface AiQuestionGeneratorProps {
  examId: string;
  apiPrefix?: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type WizardStep = 'config' | 'prompt' | 'import' | 'review';

export function AiQuestionGenerator({
  examId,
  apiPrefix = '/api/admin',
  open,
  onClose,
  onSuccess,
}: AiQuestionGeneratorProps) {
  const { toast } = useToast();

  // Wizard Step State
  const [step, setStep] = useState<WizardStep>('config');

  // Step 1: Configuration inputs
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'balanced' | 'hard'>('balanced');
  const [variation, setVariation] = useState<'standard' | 'varied' | 'high_variation'>('standard');
  const [referenceText, setReferenceText] = useState('');
  const [instruction, setInstruction] = useState('');
  const [patternReferenceEnabled, setPatternReferenceEnabled] = useState(false);

  // Step 2: Generated Prompt
  const [promptText, setPromptText] = useState('');
  const [buildingPrompt, setBuildingPrompt] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Step 3: Pasted JSON
  const [jsonInput, setJsonInput] = useState('');
  const [validatingJson, setValidatingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Step 4: Parsed Questions & Review
  const [questions, setQuestions] = useState<ParsedQuestionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Edit Single Question Modal
  const [editItem, setEditItem] = useState<ParsedQuestionItem | null>(null);

  // ── Step 1 Action: Generate Prompt ──────────────────────────
  const handleBuildPrompt = async () => {
    if (!topic.trim()) {
      toast('error', 'Topik / materi pokok soal wajib diisi');
      return;
    }

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      toast('error', 'Jumlah soal harus antara 1 hingga 50 butir');
      return;
    }

    setBuildingPrompt(true);
    const payload = {
      topic: topic.trim(),
      question_count: count,
      difficulty_mode: difficulty,
      variation_level: variation,
      additional_instruction: instruction.trim() || undefined,
      reference_text: referenceText.trim() || undefined,
      pattern_reference_enabled: patternReferenceEnabled,
    };

    const res = await POST<{ prompt: string }>(`${apiPrefix}/exams/${examId}/ai/prompt`, payload);
    setBuildingPrompt(false);

    if (res.success && res.data?.prompt) {
      setPromptText(res.data.prompt);
      setStep('prompt');
      toast('success', 'Prompt AI berhasil disusun');
    } else {
      toast('error', res.error || 'Gagal menyusun prompt AI');
    }
  };

  // ── Step 2 Action: Copy Prompt ──────────────────────────────
  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPrompt(true);
      toast('success', 'Prompt berhasil disalin ke clipboard');
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast('error', 'Gagal menyalin otomatis. Silakan blok dan salin teks prompt secara manual.');
    }
  };

  // ── Step 3 Action: Validate Pasted JSON ──────────────────────
  const handleValidateJson = async () => {
    if (!jsonInput.trim()) {
      toast('error', 'Silakan tempelkan output JSON dari AI terlebih dahulu');
      return;
    }

    setValidatingJson(true);
    setJsonError(null);

    const res = await POST<{
      questions: ParsedQuestionItem[];
      stats: { total: number; valid: number; duplicate: number; invalid: number };
    }>(`${apiPrefix}/exams/${examId}/ai/validate`, { raw_json: jsonInput });

    setValidatingJson(false);

    if (res.success && res.data?.questions) {
      const items = res.data.questions;
      setQuestions(items);
      const validIds = new Set(items.filter((q) => q.validation_status === 'valid').map((q) => q.id));
      setSelectedIds(validIds);
      setStep('review');
      toast(
        'success',
        `JSON berhasil diproses: ${res.data.stats.valid} valid, ${res.data.stats.duplicate} duplikat, ${res.data.stats.invalid} tidak valid`
      );
    } else {
      setJsonError(res.error || 'Format JSON tidak valid atau struktur tidak sesuai skema.');
      toast('error', res.error || 'Gagal memproses JSON');
    }
  };

  // ── Step 4 Actions: Selection & Review ───────────────────────
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const validQuestions = questions.filter((q) => q.validation_status === 'valid');

  const toggleSelectAll = () => {
    if (selectedIds.size === validQuestions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(validQuestions.map((q) => q.id)));
    }
  };

  const handleDeleteItem = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast('success', 'Butir soal dihapus dari daftar');
  };

  // ── Edit Question & Immediate Revalidation ───────────────────
  const handleSaveEdit = async () => {
    if (!editItem) return;

    // Call server revalidation endpoint
    const res = await POST<{ question: ParsedQuestionItem }>(`${apiPrefix}/exams/${examId}/ai/revalidate`, {
      question: editItem,
      all_other_questions: questions.filter((q) => q.id !== editItem.id),
    });

    const updatedItem = res.success && res.data?.question ? res.data.question : editItem;

    setQuestions((prev) => prev.map((q) => (q.id === editItem.id ? updatedItem : q)));

    // If item became valid, ensure it is selected
    if (updatedItem.validation_status === 'valid') {
      setSelectedIds((prev) => new Set(prev).add(updatedItem.id));
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(updatedItem.id);
        return next;
      });
    }

    setEditItem(null);
    toast('success', 'Soal diperbarui dan divalidasi ulang');
  };

  // ── Final Action: Canonical Bulk Import ──────────────────────
  const handleImportToExam = async () => {
    const toImport = questions.filter((q) => selectedIds.has(q.id) && q.validation_status === 'valid');
    if (toImport.length === 0) {
      toast('error', 'Pilih setidaknya satu soal valid untuk diimpor');
      return;
    }

    setImporting(true);
    const payloadQuestions = toImport.map((q) => ({
      stem: q.stem,
      options: q.options,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      difficulty: q.difficulty,
    }));

    const res = await POST<{ acceptedCount: number }>(`${apiPrefix}/exams/${examId}/ai/import`, {
      questions: payloadQuestions,
    });
    setImporting(false);

    if (res.success) {
      toast('success', res.message || `${toImport.length} butir soal berhasil diimpor ke ujian`);
      onSuccess();
      onClose();
    } else {
      toast('error', res.error || 'Gagal mengimpor butir soal');
    }
  };

  // Stats
  const validCount = questions.filter((q) => q.validation_status === 'valid').length;
  const duplicateCount = questions.filter((q) => q.validation_status === 'duplicate').length;
  const invalidCount = questions.filter((q) => q.validation_status === 'invalid').length;

  return (
    <Modal open={open} onClose={onClose} title="AI Question Generator" size="lg">
      <div className="space-y-4">
        {/* Wizard Stepper Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-1 sm:gap-2">
            {[
              { id: 'config', label: '1. Spesifikasi' },
              { id: 'prompt', label: '2. Prompt AI' },
              { id: 'import', label: '3. Import JSON' },
              { id: 'review', label: '4. Review & Edit' },
            ].map((s, idx) => {
              const isActive = step === s.id;
              const isPast =
                (s.id === 'config' && step !== 'config') ||
                (s.id === 'prompt' && (step === 'import' || step === 'review')) ||
                (s.id === 'import' && step === 'review');

              return (
                <div key={s.id} className="flex items-center gap-1 sm:gap-2">
                  {idx > 0 && <span className="text-gray-300 text-xs">→</span>}
                  <button
                    type="button"
                    onClick={() => {
                      if (isPast) setStep(s.id as WizardStep);
                    }}
                    disabled={!isPast && !isActive}
                    className={`text-xs font-semibold px-2 py-1 rounded transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-bold'
                        : isPast
                        ? 'text-gray-600 hover:text-gray-900 cursor-pointer'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {s.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── STEP 1: CONFIGURATION ──────────────────────────────── */}
        {step === 'config' && (
          <div className="space-y-3.5">
            <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-lg p-3 text-xs text-emerald-900">
              <p className="font-semibold flex items-center gap-1.5">
                <Sparkles size={14} className="text-emerald-700" /> Alur Kerja Generator AI MANSATAS:
              </p>
              <p className="mt-1 text-emerald-800 leading-relaxed">
                Tentukan spesifikasi materi, salin prompt berkualitas tinggi ke AI pilihan Anda (ChatGPT, Gemini,
                Claude, dll.), lalu tempel kembali hasil JSON untuk ditelaah sebelum diimpor ke bank soal ujian.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Topik / Materi Pokok <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: Hukum Newton tentang Gerak / Struktur Kalimat Idhafah"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Jumlah Soal (1–50)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1 && val <= 50) setCount(val);
                      else if (e.target.value === '') setCount(1);
                    }}
                    className="w-20 px-2.5 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white font-medium text-center"
                  />
                  <select
                    value={[5, 10, 15, 20, 25, 30, 40, 50].includes(count) ? count : ''}
                    onChange={(e) => {
                      if (e.target.value) setCount(Number(e.target.value));
                    }}
                    className="flex-1 px-2 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white text-gray-700"
                  >
                    <option value="" disabled>Pilihan Cepat</option>
                    <option value={5}>5 Butir</option>
                    <option value={10}>10 Butir</option>
                    <option value={15}>15 Butir</option>
                    <option value={20}>20 Butir</option>
                    <option value={25}>25 Butir</option>
                    <option value={30}>30 Butir</option>
                    <option value={40}>40 Butir</option>
                    <option value={50}>50 Butir</option>
                  </select>
                </div>
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

            {/* Pattern Reference Toggle Card */}
            <div className="border border-amber-200/90 bg-amber-50/50 rounded-lg p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={patternReferenceEnabled}
                  onChange={(e) => setPatternReferenceEnabled(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer h-4 w-4"
                />
                <div className="flex-1 text-xs">
                  <span className="font-bold text-amber-950 flex items-center gap-1.5">
                    <BookOpen size={13} className="text-amber-700" />
                    Ikuti Pola dari File Referensi
                  </span>
                  <p className="mt-1 text-amber-900/80 leading-relaxed">
                    Setelah menyalin prompt, unggah file contoh soal Anda ke ChatGPT, Gemini, Claude, atau AI lain
                    bersamaan dengan prompt tersebut. File digunakan sebagai referensi pola, bukan diunggah ke MANSATAS.
                  </p>
                </div>
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Teks Referensi / Stimulus Wacana (Opsional)
              </label>
              <textarea
                rows={3}
                placeholder="Tempelkan kutipan wacana bacaan, artikel, kasus, atau teks Arab yang ingin dijadikan bahan stimulus pertanyaan..."
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 font-mono"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                Teks referensi diisolasi secara tegas dan diperlakukan sebagai bahan bacaan stimulus pasif.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Instruksi Tambahan Penulis (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: Perbanyak soal analisis grafik. Hindari istilah asing yang belum dipelajari."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Batal
              </Button>
              <Button size="sm" loading={buildingPrompt} onClick={handleBuildPrompt}>
                <Sparkles size={13} className="mr-1" />
                Buat Prompt AI
                <ArrowRight size={13} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: PROMPT PREVIEW & COPY ──────────────────────── */}
        {step === 'prompt' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-gray-800">Prompt AI Siap Salin</h4>
                <p className="text-[11px] text-gray-500">
                  Salin prompt terstruktur di bawah dan tempelkan ke aplikasi AI eksternal Anda.
                </p>
              </div>
              <Button size="sm" variant={copiedPrompt ? 'primary' : 'secondary'} onClick={handleCopyPrompt}>
                {copiedPrompt ? (
                  <>
                    <Check size={13} className="mr-1 text-white" />
                    Tersalin!
                  </>
                ) : (
                  <>
                    <Copy size={13} className="mr-1" />
                    Copy Prompt
                  </>
                )}
              </Button>
            </div>

            <div className="relative">
              <textarea
                readOnly
                value={promptText}
                rows={12}
                className="w-full p-3 font-mono text-[11px] leading-relaxed bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none select-all"
              />
            </div>

            {/* Step-by-Step AI Guide */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1.5">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <ExternalLink size={13} /> Petunjuk Langkah Selanjutnya:
              </span>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 pl-1">
                <li>Klik tombol <strong>Copy Prompt</strong> di atas.</li>
                <li>
                  Buka layanan AI pilihan Anda (<strong>ChatGPT</strong>, <strong>Gemini</strong>, <strong>Claude</strong>, atau AI lainnya).
                </li>
                {patternReferenceEnabled && (
                  <li className="text-amber-800 font-medium">
                    Unggah file contoh soal Anda bersamaan dengan prompt tersebut ke sesi obrolan AI.
                  </li>
                )}
                <li>Tempelkan prompt dan tunggu AI membalas dalam format JSON.</li>
                <li>Salin seluruh kode JSON yang diberikan AI.</li>
                <li>Kembali ke sini dan klik tombol <strong>Lanjut ke Import JSON</strong> di bawah.</li>
              </ol>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <Button variant="secondary" size="sm" onClick={() => setStep('config')}>
                <ArrowLeft size={13} className="mr-1" />
                Kembali ke Spesifikasi
              </Button>
              <Button size="sm" onClick={() => setStep('import')}>
                Lanjut ke Import JSON
                <ArrowRight size={13} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: PASTE & VALIDATE JSON ──────────────────────── */}
        {step === 'import' && (
          <div className="space-y-3.5">
            <div>
              <h4 className="text-xs font-bold text-gray-800">Paste Output JSON dari AI</h4>
              <p className="text-[11px] text-gray-500">
                Tempelkan seluruh respons JSON yang Anda salin dari ChatGPT / Gemini / Claude di bawah ini.
              </p>
            </div>

            <textarea
              rows={12}
              placeholder={`Paste output JSON dari AI di sini...\nContoh:\n{\n  "questions": [\n    {\n      "stem": "Pokok soal...",\n      "options": [\n        { "label": "A", "text": "Pilihan A" },\n        { "label": "B", "text": "Pilihan B" }\n      ],\n      "correctIndex": 0\n    }\n  ]\n}`}
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value);
                setJsonError(null);
              }}
              className="w-full p-3 font-mono text-[11px] leading-relaxed border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />

            {jsonError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 p-2.5 rounded-lg text-xs">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />
                <div className="flex-1">
                  <span className="font-bold">Gagal Memproses JSON:</span> {jsonError}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <Button variant="secondary" size="sm" onClick={() => setStep('prompt')}>
                <ArrowLeft size={13} className="mr-1" />
                Kembali ke Prompt
              </Button>
              <Button size="sm" loading={validatingJson} onClick={handleValidateJson}>
                Proses & Validasi JSON
                <ArrowRight size={13} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 4: REVIEW & EDIT ──────────────────────────────── */}
        {step === 'review' && (
          <div className="space-y-3">
            {/* Summary Bar */}
            <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-bold text-gray-700">{questions.length} Butir Soal</span>
                <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {validCount} Valid
                </span>
                {duplicateCount > 0 && (
                  <span className="text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                    <AlertTriangle size={11} /> {duplicateCount} Duplikat
                  </span>
                )}
                {invalidCount > 0 && (
                  <span className="text-red-700 font-semibold bg-red-50 px-2 py-0.5 rounded-full border border-red-200 flex items-center gap-1">
                    <AlertCircle size={11} /> {invalidCount} Tidak Valid
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs text-primary-600 hover:underline font-semibold"
                >
                  {selectedIds.size === validCount && validCount > 0 ? 'Batal Pilih Semua' : 'Pilih Semua Valid'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('import')}
                  className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 bg-white hover:bg-gray-50"
                >
                  Paste Ulang JSON
                </button>
              </div>
            </div>

            {/* Questions List */}
            <div className="max-h-[50vh] overflow-y-auto space-y-2.5 pr-1">
              {questions.map((q, i) => {
                const isSelected = selectedIds.has(q.id);
                const isDuplicate = q.validation_status === 'duplicate';
                const isInvalid = q.validation_status === 'invalid';

                return (
                  <div
                    key={q.id}
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
                        onChange={() => toggleSelect(q.id)}
                        className="mt-1 rounded text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-gray-400">#{i + 1}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                q.difficulty === 'hard'
                                  ? 'bg-purple-100 text-purple-700'
                                  : q.difficulty === 'easy'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {q.difficulty === 'hard' ? 'Sulit' : q.difficulty === 'easy' ? 'Mudah' : 'Seimbang'}
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
                              onClick={() => setEditItem(q)}
                              className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
                              title="Edit Soal"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(q.id)}
                              className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                              title="Hapus Soal"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Question Stem */}
                        <div
                          className={`text-xs text-gray-800 leading-relaxed font-medium ${
                            isFullArabic(q.stem) ? 'arabic text-right' : ''
                          }`}
                        >
                          <MathContent html={q.stem} />
                        </div>

                        {/* Options */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {q.options?.map((opt, oIdx) => {
                            const isCorrect = opt.is_correct === 1 || oIdx === q.correct_index;
                            return (
                              <div
                                key={oIdx}
                                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold'
                                    : 'bg-gray-50 border-gray-200 text-gray-700'
                                }`}
                              >
                                <span
                                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                    isCorrect ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600'
                                  }`}
                                >
                                  {opt.option_label}
                                </span>
                                <span
                                  className={`flex-1 truncate ${
                                    isFullArabic(opt.option_text) ? 'arabic text-right' : ''
                                  }`}
                                >
                                  {opt.option_text}
                                </span>
                                {isCorrect && <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />}
                              </div>
                            );
                          })}
                        </div>

                        {/* Explanation */}
                        {q.explanation && (
                          <div className="text-[11px] text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                            <span className="font-semibold text-gray-600">Penjelasan: </span>
                            {q.explanation}
                          </div>
                        )}

                        {/* Validation Errors */}
                        {q.validation_errors && q.validation_errors.length > 0 && (
                          <div className="text-[11px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                            {q.validation_errors.join('; ')}
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
              <Button variant="secondary" size="sm" onClick={() => setStep('import')}>
                <ArrowLeft size={13} className="mr-1" />
                Kembali ke Import
              </Button>
              <Button
                size="sm"
                loading={importing}
                disabled={selectedIds.size === 0}
                onClick={handleImportToExam}
              >
                <Check size={13} className="mr-1" />
                Tambahkan ke Soal Ujian ({selectedIds.size})
              </Button>
            </div>
          </div>
        )}

        {/* ── EDIT ITEM MODAL & REVALIDATE ───────────────────────── */}
        {editItem && (
          <Modal open={true} onClose={() => setEditItem(null)} title="Edit & Telaah Soal" size="md">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Teks Pokok Soal</label>
                <textarea
                  rows={3}
                  value={editItem.stem}
                  onChange={(e) => setEditItem({ ...editItem, stem: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-700">Pilihan Jawaban & Kunci</label>
                {editItem.options?.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="editCorrect"
                      checked={editItem.correct_index === oIdx}
                      onChange={() => {
                        const updated = editItem.options.map((o, idx) => ({
                          ...o,
                          is_correct: idx === oIdx ? 1 : 0,
                        }));
                        setEditItem({ ...editItem, options: updated, correct_index: oIdx });
                      }}
                      className="text-primary-600"
                    />
                    <span className="text-xs font-bold text-gray-500 w-4">{opt.option_label}</span>
                    <input
                      type="text"
                      value={opt.option_text}
                      onChange={(e) => {
                        const updated = [...editItem.options];
                        updated[oIdx] = { ...updated[oIdx], option_text: e.target.value };
                        setEditItem({ ...editItem, options: updated });
                      }}
                      className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Tingkat Kesulitan</label>
                  <select
                    value={editItem.difficulty}
                    onChange={(e) => setEditItem({ ...editItem, difficulty: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white"
                  >
                    <option value="easy">Mudah</option>
                    <option value="balanced">Seimbang</option>
                    <option value="hard">Sulit (HOTS)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Penjelasan Kunci</label>
                <textarea
                  rows={2}
                  value={editItem.explanation || ''}
                  onChange={(e) => setEditItem({ ...editItem, explanation: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="secondary" size="sm" onClick={() => setEditItem(null)}>
                  Batal
                </Button>
                <Button size="sm" onClick={handleSaveEdit}>
                  Simpan & Validasi Ulang
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
