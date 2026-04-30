// ============================================================
// Admin Routes — prefix cbt_, bind ke DB PMB existing
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashPassword, generateToken, newId, ok, err, now } from '../utils/helpers';

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware, requireRole('admin'));

// Jalur yang tidak ikut CBT — selalu dikecualikan dari semua query CBT
const EXCLUDE_JALUR_COND = "UPPER(jalur) NOT LIKE '%PRESTASI%'";
const DEFAULT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPPORTED_AI_MODELS = {
  'llama-hemat': {
    id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    label: 'Llama 3.1 8B FP8 Fast',
    schemaMode: 'response_format',
    neuronsPerMillionInput: 4119,
    neuronsPerMillionOutput: 34868,
  },
  'llama-terbaik': {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B FP8 Fast',
    schemaMode: 'response_format',
    neuronsPerMillionInput: 26668,
    neuronsPerMillionOutput: 204805,
  },
  'qwen-seimbang': {
    id: '@cf/qwen/qwen3-30b-a3b-fp8',
    label: 'Qwen 3 30B A3B FP8',
    schemaMode: 'response_format',
    neuronsPerMillionInput: 4625,
    neuronsPerMillionOutput: 30475,
  },
  'deepseek-analitis': {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    label: 'DeepSeek R1 Distill Qwen 32B',
    schemaMode: 'response_format',
    neuronsPerMillionInput: 45170,
    neuronsPerMillionOutput: 443756,
  },
  'mistral-konteks': {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    label: 'Mistral Small 3.1 24B',
    schemaMode: 'guided_json',
    neuronsPerMillionInput: 31876,
    neuronsPerMillionOutput: 50488,
  },
} as const;

type DifficultyKey = 'easy' | 'medium' | 'hard';

interface GeneratedQuestionOption {
  option_label: string;
  option_text: string;
  is_correct: number;
  image_url: string | null;
}

interface GeneratedQuestion {
  question_text: string;
  question_type: 'multiple_choice';
  question_order: number;
  image_url: string | null;
  audio_url: string | null;
  points: number;
  options: GeneratedQuestionOption[];
  ai_meta?: {
    subject: string;
    topic: string;
    difficulty: DifficultyKey;
    explanation: string;
  } | null;
}

interface GenerationBlueprint {
  subject: string;
  topic: string;
  question_count: number;
  focus?: string;
}

type SupportedModelKey = keyof typeof SUPPORTED_AI_MODELS;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtmlFragment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function normalizeOptionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

function normalizeDifficultyDistribution(
  input: Partial<Record<DifficultyKey, number>> | undefined,
  questionCount: number
): Record<DifficultyKey, number> {
  const base = {
    easy: Math.max(1, Math.round(questionCount * 0.3)),
    medium: Math.max(1, Math.round(questionCount * 0.5)),
    hard: 0,
  };
  base.hard = Math.max(0, questionCount - base.easy - base.medium);

  const provided = {
    easy: Math.max(0, Number(input?.easy || 0)),
    medium: Math.max(0, Number(input?.medium || 0)),
    hard: Math.max(0, Number(input?.hard || 0)),
  };

  const hasCustom = provided.easy + provided.medium + provided.hard > 0;
  const dist = hasCustom ? provided : base;
  const total = dist.easy + dist.medium + dist.hard;

  if (total === questionCount) return dist;
  if (total === 0) return normalizeDifficultyDistribution(undefined, questionCount);

  const keys: DifficultyKey[] = ['easy', 'medium', 'hard'];
  const scaled = { easy: 0, medium: 0, hard: 0 } as Record<DifficultyKey, number>;
  let assigned = 0;

  for (const key of keys) {
    scaled[key] = Math.floor((dist[key] / total) * questionCount);
    assigned += scaled[key];
  }

  let remainder = questionCount - assigned;
  for (const key of ['medium', 'easy', 'hard'] as DifficultyKey[]) {
    if (remainder <= 0) break;
    scaled[key] += 1;
    remainder -= 1;
  }

  return scaled;
}

function buildQuestionSchema(optionCount: number) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            question_text: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            explanation: { type: 'string' },
            options: {
              type: 'array',
              minItems: optionCount,
              maxItems: optionCount,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  option_text: { type: 'string' },
                  is_correct: { type: 'boolean' },
                },
                required: ['option_text', 'is_correct'],
              },
            },
          },
          required: ['question_text', 'subject', 'topic', 'difficulty', 'options'],
        },
      },
    },
    required: ['questions'],
  };
}

function normalizeGeneratedQuestions(
  rawQuestions: any[],
  optionCount: number,
  points: number,
  existingCount: number
): GeneratedQuestion[] {
  return rawQuestions
    .map((raw, index) => {
      const rawOptions: any[] = Array.isArray(raw?.options) ? raw.options.slice(0, optionCount) : [];
      const options: GeneratedQuestionOption[] = rawOptions
        .map((opt: any, optIndex: number) => ({
          option_label: normalizeOptionLabel(optIndex),
          option_text: toHtmlFragment(String(opt?.option_text || '')),
          is_correct: opt?.is_correct ? 1 : 0,
          image_url: null,
        }))
        .filter((opt: GeneratedQuestionOption) => opt.option_text);

      if (!options.length) return null;
      if (!options.some((opt) => opt.is_correct)) options[0].is_correct = 1;

      const firstCorrect = options.findIndex((opt) => opt.is_correct);
      options.forEach((opt, optIndex) => {
        opt.option_label = normalizeOptionLabel(optIndex);
        opt.is_correct = optIndex === (firstCorrect >= 0 ? firstCorrect : 0) ? 1 : 0;
      });

      const questionText = toHtmlFragment(String(raw?.question_text || ''));
      if (!questionText) return null;

      return {
        question_text: questionText,
        question_type: 'multiple_choice' as const,
        question_order: existingCount + index + 1,
        image_url: null,
        audio_url: null,
        points,
        options,
        ai_meta: {
          subject: String(raw?.subject || ''),
          topic: String(raw?.topic || ''),
          difficulty: (['easy', 'medium', 'hard'].includes(String(raw?.difficulty)) ? raw.difficulty : 'medium') as DifficultyKey,
          explanation: String(raw?.explanation || ''),
        },
      };
    })
    .filter(Boolean) as GeneratedQuestion[];
}

async function insertQuestionsForExam(env: Env, examId: string, questions: GeneratedQuestion[]) {
  for (const q of questions) {
    const qId = newId();
    await env.DB.prepare(
      `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(qId, examId, q.question_text, q.question_type || 'multiple_choice', q.question_order || 0, q.image_url || null, q.audio_url || null, q.points || 1).run();
    if (q.options?.length) {
      const stmts = q.options.map((o: any, i: number) =>
        env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
          .bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
      );
      await env.DB.batch(stmts);
    }
  }
}

function toBlueprints(body: {
  subject?: string;
  topic?: string;
  question_count?: number;
  question_focus?: string;
  blueprints?: GenerationBlueprint[];
}): GenerationBlueprint[] {
  if (Array.isArray(body.blueprints) && body.blueprints.length) {
    return body.blueprints
      .map((item) => ({
        subject: String(item.subject || '').trim(),
        topic: String(item.topic || '').trim(),
        question_count: Math.max(0, Number(item.question_count || 0)),
        focus: String(item.focus || '').trim(),
      }))
      .filter((item) => item.subject && item.topic && item.question_count > 0);
  }

  const subject = String(body.subject || '').trim();
  const topic = String(body.topic || '').trim();
  const questionCount = Math.max(0, Number(body.question_count || 0));
  return subject && topic && questionCount > 0
    ? [{ subject, topic, question_count: questionCount, focus: String(body.question_focus || '').trim() }]
    : [];
}

function resolveAiModel(chosenModel?: string | null) {
  if (chosenModel && SUPPORTED_AI_MODELS[chosenModel as SupportedModelKey]) {
    return SUPPORTED_AI_MODELS[chosenModel as SupportedModelKey];
  }
  const byId = Object.values(SUPPORTED_AI_MODELS).find((item) => item.id === chosenModel);
  return byId || SUPPORTED_AI_MODELS['llama-terbaik'];
}

function buildAiRequest(
  model: { id: string; schemaMode: 'response_format' | 'guided_json' },
  schema: ReturnType<typeof buildQuestionSchema>,
  messages: { role: string; content: string }[],
  maxTokens: number
) {
  const base = {
    messages,
    temperature: 0.5,
    max_tokens: maxTokens,
  } as Record<string, unknown>;

  if (model.schemaMode === 'guided_json') {
    base.guided_json = schema;
  } else {
    base.response_format = {
      type: 'json_schema',
      json_schema: schema,
    };
  }

  return base;
}

function estimateNeurons(
  model: { neuronsPerMillionInput: number; neuronsPerMillionOutput: number },
  usage?: { prompt_tokens?: number; completion_tokens?: number }
) {
  const promptTokens = Number(usage?.prompt_tokens || 0);
  const completionTokens = Number(usage?.completion_tokens || 0);
  const inputNeurons = (promptTokens / 1_000_000) * model.neuronsPerMillionInput;
  const outputNeurons = (completionTokens / 1_000_000) * model.neuronsPerMillionOutput;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated_neurons: inputNeurons + outputNeurons,
  };
}

async function getTableColumns(env: Env, tableName: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set((results as any[]).map((row) => String(row.name)));
}

// ══════════════════════════════════════════════════════════════
// ROOMS — auto-sync dari pendaftar.ruang_tes
// ══════════════════════════════════════════════════════════════

admin.get('/rooms', async (c) => {
  // Rooms + jumlah pendaftar non-Prestasi + proktor yang di-assign
  const { results } = await c.env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM pendaftar p WHERE p.ruang_tes = r.room_name AND ${EXCLUDE_JALUR_COND}) as jumlah_peserta,
       (SELECT GROUP_CONCAT(cu.nama_lengkap, ', ') FROM cbt_users cu WHERE cu.room_id = r.id AND cu.role = 'proctor') as proctor_names
     FROM cbt_rooms r ORDER BY r.room_name`
  ).all();
  return c.json(ok(results));
});

// Sync ruangan dari data pendaftar — buat otomatis dari ruang_tes
admin.post('/rooms/sync', async (c) => {
  // Ambil semua ruang_tes unik dari pendaftar — excludes jalur Prestasi
  const { results: rooms } = await c.env.DB.prepare(
    `SELECT DISTINCT ruang_tes FROM pendaftar WHERE ruang_tes IS NOT NULL AND ruang_tes != '' AND ${EXCLUDE_JALUR_COND} ORDER BY ruang_tes`
  ).all();

  let created = 0;
  for (const r of rooms as any[]) {
    const exists = await c.env.DB.prepare(
      'SELECT id FROM cbt_rooms WHERE room_name = ?'
    ).bind(r.ruang_tes).first();
    if (!exists) {
      await c.env.DB.prepare('INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,40)')
        .bind(newId(), r.ruang_tes).run();
      created++;
    }
  }
  return c.json(ok({ synced: rooms.length, created }, `${created} ruangan baru ditambahkan`));
});

admin.post('/rooms', async (c) => {
  const { room_name, capacity } = await c.req.json();
  const id = newId();
  await c.env.DB.prepare('INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,?)')
    .bind(id, room_name, capacity || 40).run();
  return c.json(ok({ id }, 'Ruangan ditambahkan'), 201);
});

admin.put('/rooms/:id', async (c) => {
  const { room_name, capacity } = await c.req.json();
  await c.env.DB.prepare('UPDATE cbt_rooms SET room_name=?, capacity=? WHERE id=?')
    .bind(room_name, capacity, c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan diperbarui'));
});

admin.delete('/rooms/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_rooms WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan dihapus'));
});

// ══════════════════════════════════════════════════════════════
// PROCTOR ASSIGNMENT — assign proktor ke ruangan
// ══════════════════════════════════════════════════════════════

// Get all proctors
admin.get('/proctors', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cu.id, cu.username, cu.nama_lengkap as full_name, cu.room_id,
       r.room_name
     FROM cbt_users cu
     LEFT JOIN cbt_rooms r ON r.id = cu.room_id
     WHERE cu.role = 'proctor' AND cu.is_active = 1
     ORDER BY cu.nama_lengkap`
  ).all();
  return c.json(ok(results));
});

// Assign proctor to room
admin.put('/proctors/:id/assign', async (c) => {
  const { room_id } = await c.req.json();
  await c.env.DB.prepare('UPDATE cbt_users SET room_id=?, updated_at=? WHERE id=? AND role=?')
    .bind(room_id || null, now(), c.req.param('id'), 'proctor').run();
  return c.json(ok(null, 'Proktor berhasil di-assign'));
});

// ══════════════════════════════════════════════════════════════
// USERS — cbt_users (proktor + student non-PMB)
// ══════════════════════════════════════════════════════════════

admin.get('/users', async (c) => {
  const role    = c.req.query('role');
  const room_id = c.req.query('room_id');

  // Kalau filter role=admin, ambil dari tabel admins
  if (role === 'admin') {
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok(results));
  }

  // Selain itu ambil dari cbt_users
  let sql = `SELECT id, username, nama_lengkap as full_name, role, room_id, nisn, is_active, 'cbt_user' as source FROM cbt_users`;
  const conditions: string[] = [];
  const params: string[] = [];
  if (role)    { conditions.push('role = ?');    params.push(role); }
  if (room_id) { conditions.push('room_id = ?'); params.push(room_id); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  // Kalau tidak ada filter role, tambahkan juga admin dari tabel admins
  if (!role) {
    const { results: admins } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok([...results, ...admins]));
  }

  return c.json(ok(results));
});

admin.post('/users', async (c) => {
  const body = await c.req.json();
  const { username, password, role, room_id, nisn } = body;
  const nama = body.full_name || body.nama_lengkap;
  if (!username || !password || !nama || !role) return c.json(err('Data tidak lengkap'), 400);
  try {
    const id = newId();
    if (role === 'admin') {
      // Admin disimpan ke tabel admins (tabel PMB existing) — password plain text
      await c.env.DB.prepare(
        'INSERT INTO admins (id, username, password, nama_lengkap) VALUES (?,?,?,?)'
      ).bind(id, username, password, nama).run();
    } else {
      // Proktor & student ke cbt_users dengan password hash PBKDF2
      const hash = await hashPassword(password);
      await c.env.DB.prepare(
        'INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, username, hash, nama, role, room_id || null, nisn || null).run();
    }
    return c.json(ok({ id }, 'User ditambahkan'), 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json(err('Username sudah digunakan'), 409);
    throw e;
  }
});

admin.post('/users/bulk', async (c) => {
  const { users } = await c.req.json<{ users: any[] }>();
  if (!users?.length) return c.json(err('Data kosong'), 400);
  const stmt = c.env.DB.prepare(
    'INSERT OR IGNORE INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
  );
  const batch = [];
  for (const u of users) {
    const hash = await hashPassword(u.password || u.username);
    batch.push(stmt.bind(newId(), u.username, hash, u.full_name || u.nama_lengkap, u.role || 'student', u.room_id || null, u.nisn || null));
  }
  for (let i = 0; i < batch.length; i += 100) { await c.env.DB.batch(batch.slice(i, i + 100)); }
  return c.json(ok({ imported: users.length }, 'Import user berhasil'));
});

admin.put('/users/:id', async (c) => {
  const body = await c.req.json();
  const nama = body.full_name || body.nama_lengkap;
  const id = c.req.param('id');
  if (body.role === 'admin') {
    // Update ke tabel admins
    let sql = 'UPDATE admins SET nama_lengkap=?';
    const params: any[] = [nama];
    if (body.password) { sql += ', password=?'; params.push(body.password); }
    sql += ' WHERE id=?'; params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  } else {
    let sql = 'UPDATE cbt_users SET nama_lengkap=?, role=?, room_id=?, nisn=?, is_active=?, updated_at=?';
    const params: any[] = [nama, body.role, body.room_id || null, body.nisn || null, body.is_active ?? 1, now()];
    if (body.password) { sql += ', password_hash=?'; params.push(await hashPassword(body.password)); }
    sql += ' WHERE id=?'; params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  }
  return c.json(ok(null, 'User diperbarui'));
});

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM cbt_exam_sessions WHERE user_id=? AND user_type=?').bind(id, 'cbt_user'),
    c.env.DB.prepare('DELETE FROM cbt_exam_results WHERE user_id=? AND user_type=?').bind(id, 'cbt_user'),
    c.env.DB.prepare('DELETE FROM cbt_users WHERE id=?').bind(id),
    c.env.DB.prepare('DELETE FROM admins WHERE id=?').bind(id),
  ]);
  return c.json(ok(null, 'User dihapus'));
});

// ══════════════════════════════════════════════════════════════
// PENDAFTAR PMB (read-only dari tabel existing)
// ══════════════════════════════════════════════════════════════

admin.get('/pendaftar', async (c) => {
  const room  = c.req.query('ruang_tes');
  const jalur = c.req.query('jalur');
  let sql = `SELECT id, nisn, nama_lengkap, no_pendaftaran, ruang_tes, jalur, asal_sekolah,
            jenis_kelamin, tanggal_lahir, tanggal_tes, sesi_tes,
            status_verifikasi, status_kelulusan
     FROM pendaftar WHERE ${EXCLUDE_JALUR_COND}`;
  const params: string[] = [];
  if (room)  { sql += ' AND ruang_tes = ?'; params.push(room); }
  if (jalur) { sql += ' AND LOWER(jalur) = LOWER(?)'; params.push(jalur); }
  sql += ' ORDER BY ruang_tes, nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(results));
});

// Hapus peserta dari tabel pendaftar PMB + sesi ujiannya
admin.delete('/pendaftar/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM cbt_exam_sessions WHERE user_id=? AND user_type=?').bind(id, 'pendaftar'),
    c.env.DB.prepare('DELETE FROM cbt_exam_results WHERE user_id=? AND user_type=?').bind(id, 'pendaftar'),
    c.env.DB.prepare('DELETE FROM pendaftar WHERE id = ?').bind(id),
  ]);
  return c.json(ok(null, 'Peserta berhasil dihapus'));
});

// Update ruang_tes peserta pendaftar PMB
admin.put('/pendaftar/:id/ruang', async (c) => {
  const { ruang_tes } = await c.req.json<{ ruang_tes: string | null }>();
  await c.env.DB.prepare(
    'UPDATE pendaftar SET ruang_tes = ? WHERE id = ?'
  ).bind(ruang_tes || null, c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan berhasil diperbarui'));
});

// Statistik pendaftar (exclude Prestasi)
admin.get('/pendaftar/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       COUNT(ruang_tes) as assigned_room,
       COUNT(DISTINCT ruang_tes) as total_rooms,
       COUNT(tanggal_tes) as has_schedule
     FROM pendaftar WHERE ${EXCLUDE_JALUR_COND}`
  ).first<any>();
  return c.json(ok(results));
});

// Daftar jalur unik dari pendaftar (exclude Prestasi)
admin.get('/pendaftar/jalur', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT jalur FROM pendaftar WHERE jalur IS NOT NULL AND jalur != '' AND ${EXCLUDE_JALUR_COND} ORDER BY jalur`
  ).all();
  return c.json(ok(results.map((r: any) => r.jalur)));
});

// ══════════════════════════════════════════════════════════════
// EXAMS
// ══════════════════════════════════════════════════════════════

admin.get('/exams', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(q.id) as question_count
     FROM cbt_exams e LEFT JOIN cbt_questions q ON q.exam_id = e.id
     GROUP BY e.id ORDER BY e.created_at DESC`
  ).all();
  return c.json(ok(results));
});

admin.get('/exams/:id', async (c) => {
  const exam = await c.env.DB.prepare('SELECT * FROM cbt_exams WHERE id=?').bind(c.req.param('id')).first();
  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);
  return c.json(ok(exam));
});

admin.post('/exams', async (c) => {
  const b = await c.req.json();
  const user = c.get('user');
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
     is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by,
     target_jalur, cheat_limit, cheat_action, enforce_fullscreen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, b.title, b.description || null, b.duration_minutes || 60,
    b.rules_text || null, b.completion_message || 'Ujian telah selesai. Terima kasih.',
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0, b.active_status || 'draft', b.passing_score || 0, user.sub,
    b.target_jalur || null,
    b.cheat_limit || 3,
    b.cheat_action || 'lock',
    b.enforce_fullscreen ? 1 : 0
  ).run();
  return c.json(ok({ id }, 'Ujian dibuat'), 201);
});

admin.put('/exams/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, target_jalur=?,
     cheat_limit=?, cheat_action=?, enforce_fullscreen=?, updated_at=? WHERE id=?`
  ).bind(b.title, b.description, b.duration_minutes, b.rules_text, b.completion_message,
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0, b.randomize_options ? 1 : 0,
    b.active_status, b.passing_score || 0, b.target_jalur || null,
    b.cheat_limit || 3, b.cheat_action || 'lock', b.enforce_fullscreen ? 1 : 0,
    now(), c.req.param('id')
  ).run();
  return c.json(ok(null, 'Ujian diperbarui'));
});

admin.delete('/exams/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_exams WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ujian dihapus'));
});

// ══════════════════════════════════════════════════════════════
// QUESTIONS
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { results: questions } = await c.env.DB.prepare(
    'SELECT * FROM cbt_questions WHERE exam_id=? ORDER BY question_order'
  ).bind(examId).all();
  const qIds = questions.map((q: any) => q.id);
  if (qIds.length === 0) return c.json(ok([]));
  const ph = qIds.map(() => '?').join(',');
  const { results: options } = await c.env.DB.prepare(
    `SELECT * FROM cbt_question_options WHERE question_id IN (${ph}) ORDER BY option_order`
  ).bind(...qIds).all();
  const optMap: Record<string, any[]> = {};
  for (const o of options as any[]) { if (!optMap[o.question_id]) optMap[o.question_id] = []; optMap[o.question_id].push(o); }
  return c.json(ok(questions.map((q: any) => ({ ...q, options: optMap[q.id] || [] }))));
});

admin.post('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { question_text, question_type, question_order, image_url, audio_url, points, options } = await c.req.json();
  const qId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(qId, examId, question_text, question_type || 'multiple_choice', question_order || 0, image_url || null, audio_url || null, points || 1).run();
  if (options?.length) {
    const stmts = options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok({ id: qId }, 'Soal ditambahkan'), 201);
});

admin.post('/exams/:examId/questions/bulk', async (c) => {
  const examId = c.req.param('examId');
  const { questions } = await c.req.json<{ questions: any[] }>();
  await insertQuestionsForExam(c.env, examId, questions);
  return c.json(ok({ imported: questions.length }, 'Soal berhasil diimport'));
});

admin.post('/exams/:examId/questions/generate-ai', async (c) => {
  if (!c.env.AI?.run) {
    return c.json(err('Binding Workers AI belum aktif di Worker ini'), 500);
  }

  const examId = c.req.param('examId');
  const body = await c.req.json<{
    subject?: string;
    topic?: string;
    question_count?: number;
    option_count?: number;
    points?: number;
    language?: string;
    question_focus?: string;
    additional_instructions?: string;
    difficulty_distribution?: Partial<Record<DifficultyKey, number>>;
    generation_mode?: 'review' | 'direct_save';
    blueprints?: GenerationBlueprint[];
    chosen_model?: string;
  }>();

  const blueprints = toBlueprints(body).slice(0, 12);
  const questionCount = Math.min(100, Math.max(1, blueprints.reduce((sum, item) => sum + item.question_count, 0)));
  const optionCount = Math.min(6, Math.max(3, Number(body.option_count || 0)));
  const points = Math.min(100, Math.max(1, Number(body.points || 1)));
  const language = String(body.language || 'Bahasa Indonesia').trim();
  const additionalInstructions = String(body.additional_instructions || '').trim();
  const generationMode = body.generation_mode === 'direct_save' ? 'direct_save' : 'review';
  const selectedModel = resolveAiModel(body.chosen_model || c.env.AI_MODEL || DEFAULT_AI_MODEL);

  if (!blueprints.length) {
    return c.json(err('Minimal satu paket mapel dan materi wajib diisi'), 400);
  }

  const exam = await c.env.DB.prepare(
    'SELECT id, title, description FROM cbt_exams WHERE id=?'
  ).bind(examId).first<{ id: string; title: string; description: string | null }>();

  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);

  const currentCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM cbt_questions WHERE exam_id=?'
  ).bind(examId).first<{ total: number }>();
  const existingCount = Number(currentCountRow?.total || 0);
  const difficultyDistribution = normalizeDifficultyDistribution(body.difficulty_distribution, questionCount);
  const questionSchema = buildQuestionSchema(optionCount);

  const systemPrompt = [
    `Anda adalah generator soal ujian profesional untuk ${language}.`,
    'Hasil wajib valid JSON sesuai schema.',
    `Buat soal pilihan ganda yang jelas, tidak ambigu, dan hanya memiliki satu jawaban benar dari ${optionCount} opsi.`,
    'Jangan menambahkan markdown, kode blok, atau teks pengantar di luar JSON.',
    'Variasikan bentuk soal: konsep, aplikasi, analisis singkat, dan pemahaman konteks.',
    'Gunakan bahasa yang rapi dan cocok untuk ujian sekolah/madrasah.',
    'Setiap soal harus membawa subject dan topic yang sesuai dengan paket permintaan.',
  ].join(' ');

  const userPrompt = [
    `Judul ujian: ${exam.title}`,
    exam.description ? `Deskripsi ujian: ${exam.description}` : '',
    `Jumlah soal: ${questionCount}`,
    `Jumlah opsi per soal: ${optionCount}`,
    `Distribusi level: mudah ${difficultyDistribution.easy}, sedang ${difficultyDistribution.medium}, sulit ${difficultyDistribution.hard}`,
    `Paket soal campuran: ${blueprints.map((item, index) => `${index + 1}. ${item.subject} | ${item.topic} | ${item.question_count} soal${item.focus ? ` | fokus: ${item.focus}` : ''}`).join('\n')}`,
    additionalInstructions ? `Instruksi tambahan: ${additionalInstructions}` : '',
    'Setiap opsi harus singkat namun cukup membedakan jawaban benar dan pengecoh.',
    'Jangan menggunakan opsi "semua jawaban benar" atau "semua jawaban salah".',
  ].filter(Boolean).join('\n');

  let aiResult: any;
  try {
    aiResult = await c.env.AI.run(
      selectedModel.id,
      buildAiRequest(
        selectedModel,
        questionSchema,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        Math.min(7000, 500 + questionCount * optionCount * 120)
      )
    );
  } catch (error: any) {
    return c.json(err(`Workers AI gagal memproses model ${selectedModel.label}: ${error?.message || 'unknown error'}`), 502);
  }

  let parsed: any;
  try {
    parsed = typeof aiResult?.response === 'string'
      ? JSON.parse(aiResult.response)
      : aiResult?.response;
  } catch {
    return c.json(err('Respons AI tidak bisa diproses. Coba generate ulang.'), 502);
  }

  const generatedQuestions = normalizeGeneratedQuestions(
    Array.isArray(parsed?.questions) ? parsed.questions : [],
    optionCount,
    points,
    existingCount
  );

  if (!generatedQuestions.length) {
    return c.json(err('AI tidak menghasilkan soal yang valid. Coba ubah instruksi atau jumlah soal.'), 502);
  }

  const usageStats = estimateNeurons(selectedModel, aiResult?.usage);
  const aiGenerationColumns = await getTableColumns(c.env, 'cbt_ai_generations');

  const generationId = newId();
  let importedCount = 0;
  if (generationMode === 'direct_save') {
    await insertQuestionsForExam(c.env, examId, generatedQuestions);
    importedCount = generatedQuestions.length;
  }

  if (aiGenerationColumns.size > 0) {
    const baseColumns = [
      'id', 'exam_id', 'created_by', 'generation_mode', 'status', 'model_name',
      'request_payload', 'generated_payload', 'generated_count', 'imported_count'
    ];
    const baseValues = [
      generationId,
      examId,
      c.get('user').sub,
      generationMode,
      generationMode === 'direct_save' ? 'imported' : 'draft',
      selectedModel.id,
      JSON.stringify({ ...body, blueprints, question_count: questionCount }),
      JSON.stringify(generatedQuestions),
      generatedQuestions.length,
      importedCount,
    ];
    const optionalColumns = [
      aiGenerationColumns.has('prompt_tokens') ? 'prompt_tokens' : null,
      aiGenerationColumns.has('completion_tokens') ? 'completion_tokens' : null,
      aiGenerationColumns.has('estimated_neurons') ? 'estimated_neurons' : null,
      aiGenerationColumns.has('imported_at') ? 'imported_at' : null,
      aiGenerationColumns.has('updated_at') ? 'updated_at' : null,
    ].filter(Boolean) as string[];
    const optionalValues = [
      aiGenerationColumns.has('prompt_tokens') ? usageStats.prompt_tokens : undefined,
      aiGenerationColumns.has('completion_tokens') ? usageStats.completion_tokens : undefined,
      aiGenerationColumns.has('estimated_neurons') ? usageStats.estimated_neurons : undefined,
      aiGenerationColumns.has('imported_at') ? (importedCount ? now() : null) : undefined,
      aiGenerationColumns.has('updated_at') ? now() : undefined,
    ].filter((value) => value !== undefined);
    const columns = [...baseColumns, ...optionalColumns];
    const placeholders = columns.map(() => '?').join(',');
    await c.env.DB.prepare(
      `INSERT INTO cbt_ai_generations (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(...baseValues, ...optionalValues).run();
  }

  return c.json(ok({
    questions: generationMode === 'review' ? generatedQuestions : [],
    meta: {
      generation_id: generationId,
      model: selectedModel.id,
      model_label: selectedModel.label,
      generated: generatedQuestions.length,
      requested: questionCount,
      difficulty_distribution: difficultyDistribution,
      option_count: optionCount,
      status: generationMode === 'direct_save' ? 'imported' : 'draft',
      imported_count: importedCount,
      generation_mode: generationMode,
      prompt_tokens: usageStats.prompt_tokens,
      completion_tokens: usageStats.completion_tokens,
      estimated_neurons: usageStats.estimated_neurons,
    },
  }, generationMode === 'direct_save' ? 'Soal AI berhasil dibuat dan langsung disimpan' : 'Draft soal berhasil dibuat'));
});

admin.get('/ai-usage/today', async (c) => {
  const aiGenerationColumns = await getTableColumns(c.env, 'cbt_ai_generations');
  if (!aiGenerationColumns.has('estimated_neurons')) {
    return c.json(ok({
      usage_date: new Date().toISOString().slice(0, 10),
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_neurons: 0,
      daily_limit: 10000,
      remaining_neurons: 10000,
      usage_percent: 0,
      total_generations: 0,
      note: 'Tracker neurons harian aktif setelah migrasi kolom usage dijalankan.',
    }));
  }
  const usageDate = new Date().toISOString().slice(0, 10);
  const row = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
       COALESCE(SUM(completion_tokens), 0) as completion_tokens,
       COALESCE(SUM(estimated_neurons), 0) as estimated_neurons,
       COUNT(*) as total_generations
     FROM cbt_ai_generations
     WHERE substr(created_at, 1, 10) = ?`
  ).bind(usageDate).first<{
    prompt_tokens: number;
    completion_tokens: number;
    estimated_neurons: number;
    total_generations: number;
  }>();

  const dailyLimit = 10000;
  const used = Number(row?.estimated_neurons || 0);
  return c.json(ok({
    usage_date: usageDate,
    prompt_tokens: Number(row?.prompt_tokens || 0),
    completion_tokens: Number(row?.completion_tokens || 0),
    estimated_neurons: used,
    daily_limit: dailyLimit,
    remaining_neurons: Math.max(0, dailyLimit - used),
    usage_percent: dailyLimit ? Math.min(100, (used / dailyLimit) * 100) : 0,
    total_generations: Number(row?.total_generations || 0),
    note: 'Estimasi dari usage token respons Workers AI yang dipakai lewat aplikasi ini.',
  }));
});

admin.get('/exams/:examId/ai-generations', async (c) => {
  const aiGenerationColumns = await getTableColumns(c.env, 'cbt_ai_generations');
  const selectColumns = [
    'id', 'exam_id', 'generation_mode', 'status', 'model_name', 'generated_count', 'imported_count',
    aiGenerationColumns.has('prompt_tokens') ? 'prompt_tokens' : '0 as prompt_tokens',
    aiGenerationColumns.has('completion_tokens') ? 'completion_tokens' : '0 as completion_tokens',
    aiGenerationColumns.has('estimated_neurons') ? 'estimated_neurons' : '0 as estimated_neurons',
    'created_at',
    aiGenerationColumns.has('imported_at') ? 'imported_at' : 'NULL as imported_at',
  ];
  const { results } = await c.env.DB.prepare(
    `SELECT ${selectColumns.join(', ')}
     FROM cbt_ai_generations
     WHERE exam_id=?
     ORDER BY created_at DESC
     LIMIT 20`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.get('/exams/:examId/ai-generations/:generationId', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM cbt_ai_generations WHERE id=? AND exam_id=?`
  ).bind(c.req.param('generationId'), c.req.param('examId')).first<any>();
  if (!row) return c.json(err('Riwayat generasi tidak ditemukan'), 404);

  return c.json(ok({
    ...row,
    request_payload: row.request_payload ? JSON.parse(row.request_payload) : null,
    generated_payload: row.generated_payload ? JSON.parse(row.generated_payload) : [],
  }));
});

admin.post('/exams/:examId/ai-generations/:generationId/import', async (c) => {
  const examId = c.req.param('examId');
  const generationId = c.req.param('generationId');
  const body = await c.req.json<{ questions?: GeneratedQuestion[] }>();
  const aiGenerationColumns = await getTableColumns(c.env, 'cbt_ai_generations');
  const row = await c.env.DB.prepare(
    `SELECT * FROM cbt_ai_generations WHERE id=? AND exam_id=?`
  ).bind(generationId, examId).first<any>();
  if (!row) return c.json(err('Riwayat generasi tidak ditemukan'), 404);

  const questions = Array.isArray(body.questions) && body.questions.length
    ? body.questions
    : (row.generated_payload ? JSON.parse(row.generated_payload) : []);
  if (!questions.length) return c.json(err('Draft soal kosong'), 400);

  const currentCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM cbt_questions WHERE exam_id=?'
  ).bind(examId).first<{ total: number }>();
  const existingCount = Number(currentCountRow?.total || 0);
  const normalized = questions.map((q: GeneratedQuestion, index: number) => ({
    ...q,
    question_order: existingCount + index + 1,
  }));

  await insertQuestionsForExam(c.env, examId, normalized);
  const updateParts = [
    'generated_payload=?',
    'imported_count=?',
    "status='imported'",
  ];
  const updateValues: any[] = [JSON.stringify(normalized), normalized.length];
  if (aiGenerationColumns.has('imported_at')) {
    updateParts.push('imported_at=?');
    updateValues.push(now());
  }
  if (aiGenerationColumns.has('updated_at')) {
    updateParts.push('updated_at=?');
    updateValues.push(now());
  }
  updateValues.push(generationId, examId);
  await c.env.DB.prepare(
    `UPDATE cbt_ai_generations SET ${updateParts.join(', ')} WHERE id=? AND exam_id=?`
  ).bind(...updateValues).run();

  return c.json(ok({ imported: normalized.length }, 'Draft AI berhasil diimpor'));
});

admin.put('/questions/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_questions SET question_text=?, question_type=?, question_order=?, image_url=?, audio_url=?, points=? WHERE id=?`
  ).bind(b.question_text, b.question_type, b.question_order, b.image_url || null, b.audio_url || null, b.points || 1, c.req.param('id')).run();
  if (b.options) {
    await c.env.DB.prepare('DELETE FROM cbt_question_options WHERE question_id=?').bind(c.req.param('id')).run();
    const stmts = b.options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), c.req.param('id'), o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok(null, 'Soal diperbarui'));
});

admin.delete('/questions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_questions WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Soal dihapus'));
});

// ══════════════════════════════════════════════════════════════
// EXAM TOKENS
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/tokens', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, r.room_name FROM cbt_exam_tokens et JOIN cbt_rooms r ON r.id = et.room_id WHERE et.exam_id=? ORDER BY r.room_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.post('/exams/:examId/tokens/generate', async (c) => {
  const examId = c.req.param('examId');
  const { room_ids } = await c.req.json<{ room_ids?: string[] }>();
  const targetRooms = room_ids?.length
    ? room_ids
    : (await c.env.DB.prepare('SELECT id FROM cbt_rooms').all()).results.map((r: any) => r.id);
  const stmts = targetRooms.map((rid: string) =>
    c.env.DB.prepare('INSERT OR REPLACE INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active) VALUES (?,?,?,?,1)')
      .bind(newId(), examId, rid, generateToken())
  );
  for (let i = 0; i < stmts.length; i += 100) { await c.env.DB.batch(stmts.slice(i, i + 100)); }
  return c.json(ok({ generated: targetRooms.length }, 'Token berhasil digenerate'));
});

// ══════════════════════════════════════════════════════════════
// R2 UPLOAD
// ══════════════════════════════════════════════════════════════

admin.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;
  if (!file || typeof file === 'string') return c.json(err('File tidak ditemukan'), 400);
  const ext = file.name.split('.').pop() || 'bin';
  const key = `media/${Date.now()}-${newId().slice(0, 8)}.${ext}`;
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  // Return full R2 path
  return c.json(ok({ key, url: `/r2/${key}` }, 'Upload berhasil'));
});

// ══════════════════════════════════════════════════════════════
// RESULTS & MONITORING
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/results', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT er.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_results er
     JOIN cbt_exam_sessions es ON es.id = er.session_id
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON er.user_id = p.id AND er.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON er.user_id = cu.id AND er.user_type = 'cbt_user'
     WHERE er.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.get('/exams/:examId/sessions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT es.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_sessions es
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
     WHERE es.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

// Update jalur peserta pendaftar
admin.put('/pendaftar/:id/jalur', async (c) => {
  const { jalur } = await c.req.json<{ jalur: string }>();
  await c.env.DB.prepare('UPDATE pendaftar SET jalur = ? WHERE id = ?').bind(jalur, c.req.param('id')).run();
  return c.json(ok(null, 'Jalur berhasil diperbarui'));
});

// ══════════════════════════════════════════════════════════════
// SETTINGS — key-value config
// ══════════════════════════════════════════════════════════════

admin.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM cbt_settings').all();
  const map: Record<string, string> = {};
  for (const r of results as any[]) map[r.key] = r.value;
  return c.json(ok(map));
});

admin.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stmts = Object.entries(body).map(([key, value]) =>
    c.env.DB.prepare('INSERT OR REPLACE INTO cbt_settings (key, value, updated_at) VALUES (?,?,?)').bind(key, value, now())
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(ok(null, 'Pengaturan disimpan'));
});

// ══════════════════════════════════════════════════════════════
// EXAM ASSIGNMENTS — assign ujian ke peserta tertentu
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/assignments', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ea.*, COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn, cu.username) as nisn
     FROM cbt_exam_assignments ea
     LEFT JOIN pendaftar p ON ea.user_id = p.id AND ea.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON ea.user_id = cu.id AND ea.user_type = 'cbt_user'
     WHERE ea.exam_id = ? ORDER BY full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.post('/exams/:examId/assignments', async (c) => {
  const { users } = await c.req.json<{ users: { user_id: string; user_type: string }[] }>();
  const examId = c.req.param('examId');
  const stmts = users.map(u =>
    c.env.DB.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, u.user_id, u.user_type)
  );
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json(ok({ added: users.length }, 'Peserta di-assign'));
});

admin.delete('/exams/:examId/assignments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_exam_assignments WHERE id=? AND exam_id=?')
    .bind(c.req.param('id'), c.req.param('examId')).run();
  return c.json(ok(null, 'Assignment dihapus'));
});

export default admin;
