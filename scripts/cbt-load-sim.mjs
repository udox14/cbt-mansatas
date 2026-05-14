#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const idx = argv.indexOf(name);
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
};
const hasArg = (name) => argv.includes(name);

const apiUrl = getArg('--api', process.env.CBT_API_URL || 'https://cbtmansatas.drudox.workers.dev').replace(/\/$/, '');
const usersFile = getArg('--users', process.env.CBT_USERS_FILE || '');
const proctorsFile = getArg('--proctors', process.env.CBT_PROCTORS_FILE || '');
const examIdArg = getArg('--exam-id', process.env.CBT_EXAM_ID || '');
const tokenCode = getArg('--token', process.env.CBT_EXAM_TOKEN || '');
const concurrency = Number(getArg('--concurrency', process.env.CBT_CONCURRENCY || '20'));
const proctorPolls = Number(getArg('--proctor-polls', process.env.CBT_PROCTOR_POLLS || '3'));
const confirmWrite = hasArg('--confirm-write');

function usage() {
  console.log(`Usage:
  node scripts/cbt-load-sim.mjs --users ./dummy-users.csv --token 123456 --confirm-write

Options:
  --api URL              Worker API URL. Defaults to CBT_API_URL or current production worker.
  --users FILE           CSV username,password for dummy students.
  --proctors FILE        Optional CSV username,password for proctors to poll /api/proctor/sessions.
  --exam-id ID           Optional exam id. If omitted, first listed student exam is used.
  --token CODE           Required token for validate-token.
  --concurrency N        Parallel student flows. Default 20.
  --proctor-polls N      Poll count per proctor. Default 3.
  --confirm-write        Required. This simulation creates sessions, answers, heartbeats, and submissions.

Use only on a dummy exam/users or a staging database.`);
}

if (hasArg('--help') || hasArg('-h')) {
  usage();
  process.exit(0);
}

if (!confirmWrite) {
  usage();
  throw new Error('Refusing to run without --confirm-write because this test mutates CBT data.');
}
if (!usersFile) throw new Error('Missing --users CSV file.');
if (!tokenCode) throw new Error('Missing --token exam token.');
if (!Number.isFinite(concurrency) || concurrency < 1) throw new Error('--concurrency must be a positive number.');

function parseCsv(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith('username,'))
    .map((line) => {
      const [username, password] = line.split(',').map((part) => part?.trim());
      if (!username || !password) throw new Error(`Invalid CSV row: ${line}`);
      return { username, password };
    });
}

async function request(path, options = {}, token = '') {
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const started = performance.now();
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  const ms = Math.round(performance.now() - started);
  if (!response.ok || !data.success) {
    throw new Error(`${path} failed in ${ms}ms: ${data.error || response.status}`);
  }
  return { data: data.data, ms };
}

async function login(user) {
  const res = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(user),
  });
  return res.data.token;
}

function buildAnswers(questions) {
  return questions.map((q) => ({
    question_id: q.id,
    selected_option_id: q.question_type === 'multiple_choice' ? q.options?.[0]?.id || null : null,
    essay_answer: q.question_type === 'essay' ? 'Jawaban simulasi beban.' : null,
    is_doubtful: false,
  }));
}

async function studentFlow(user, idx) {
  const metrics = [];
  const token = await login(user);
  const exams = await request('/api/student/exams', {}, token);
  metrics.push(exams.ms);
  const exam = examIdArg
    ? exams.data.find((item) => item.id === examIdArg)
    : exams.data[0];
  if (!exam) throw new Error(`No exam available for ${user.username}`);

  const validated = await request(`/api/student/exams/${exam.id}/validate-token`, {
    method: 'POST',
    body: JSON.stringify({ token_code: tokenCode, device_id: `load-${idx}-${randomUUID()}` }),
  }, token);
  metrics.push(validated.ms);

  const sessionId = validated.data.session_id;
  const loaded = await request(`/api/student/sessions/${sessionId}/questions`, {}, token);
  metrics.push(loaded.ms);

  const answers = buildAnswers(loaded.data.questions || []);
  const saved = await request(`/api/student/sessions/${sessionId}/answers`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  }, token);
  metrics.push(saved.ms);

  const heartbeat = await request(`/api/student/sessions/${sessionId}/heartbeat`, { method: 'POST' }, token);
  metrics.push(heartbeat.ms);

  const submitted = await request(`/api/student/sessions/${sessionId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  }, token);
  metrics.push(submitted.ms);

  return { username: user.username, sessionId, metrics };
}

async function proctorFlow(user) {
  const token = await login(user);
  const metrics = [];
  for (let i = 0; i < proctorPolls; i++) {
    const res = await request('/api/proctor/sessions', {}, token);
    metrics.push(res.ms);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return { username: user.username, metrics };
}

async function runPool(items, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      const started = performance.now();
      try {
        const result = await worker(item, idx);
        results[idx] = { ok: true, ms: Math.round(performance.now() - started), ...result };
        process.stdout.write('.');
      } catch (error) {
        results[idx] = { ok: false, ms: Math.round(performance.now() - started), error: error.message, username: item.username };
        process.stdout.write('x');
      }
    }
  });
  await Promise.all(runners);
  process.stdout.write('\n');
  return results;
}

function summarize(label, results) {
  const ok = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  const durations = ok.map((item) => item.ms).sort((a, b) => a - b);
  const p = (q) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))] || 0;
  console.log(`\n${label}`);
  console.log(`  ok=${ok.length} failed=${failed.length} p50=${p(0.5)}ms p95=${p(0.95)}ms max=${durations.at(-1) || 0}ms`);
  for (const item of failed.slice(0, 10)) console.log(`  FAIL ${item.username}: ${item.error}`);
}

const students = parseCsv(usersFile);
console.log(`Starting CBT load simulation: api=${apiUrl}, students=${students.length}, concurrency=${concurrency}`);
const studentResults = await runPool(students, studentFlow);
summarize('Student flows', studentResults);

if (proctorsFile) {
  const proctors = parseCsv(proctorsFile);
  console.log(`\nStarting proctor polling: proctors=${proctors.length}, polls=${proctorPolls}`);
  const proctorResults = await runPool(proctors, proctorFlow);
  summarize('Proctor polling', proctorResults);
}

const failed = studentResults.some((item) => !item.ok);
if (failed) process.exitCode = 1;
