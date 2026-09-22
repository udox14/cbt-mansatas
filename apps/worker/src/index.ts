// ============================================================
// Sistem CBT Worker - Main Entry Point
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';

import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import adminEventRoutes from './routes/admin-events';
import kegiatanRoutes from './routes/domains/kegiatan';
import ulanganRoutes from './routes/domains/ulangan';
import tkaRoutes from './routes/domains/tka';
import semesterRoutes from './routes/domains/semester';
import proctorRoutes from './routes/proctor';
import studentRoutes from './routes/student';
import reportingRoutes from './routes/reporting';
import { genericAiRoutes } from './routes/exam-engine/authoring';

const app = new Hono<{ Bindings: Env }>();

// ── Global Middleware ────────────────────────────────────────

app.use('*', async (c, next) => {
  const rawId = c.req.header('x-request-id') || c.req.header('cf-ray');
  // Strict sanitization: alphanumeric, hyphen, underscore, 1-64 chars max. Never trust for auth or keys.
  const reqId = (rawId && /^[a-zA-Z0-9\-_]{1,64}$/.test(rawId))
    ? rawId
    : crypto.randomUUID();
  c.set('requestId', reqId);
  c.header('X-Request-Id', reqId);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  if (c.res.status >= 400) {
    console.error(JSON.stringify({
      level: 'warn',
      requestId: reqId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    }));
  }
});

app.use('*', async (c, next) => {
  const allowedOrigins = (c.env.CORS_ORIGIN || '*')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const corsMiddleware = cors({
    origin: (origin) => {
      if (allowedOrigins.includes('*')) return origin || '*';
      if (!origin) return '';
      return allowedOrigins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

app.use('*', logger());

// ── Health Check ─────────────────────────────────────────────

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), requestId: c.get('requestId') });
});

// ── Routes ───────────────────────────────────────────────────

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminEventRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/kegiatan', kegiatanRoutes);
app.route('/api/ulangan', ulanganRoutes);
app.route('/api/tka', tkaRoutes);
app.route('/api/semester', semesterRoutes);
app.route('/api/proctor', proctorRoutes);
app.route('/api/student', studentRoutes);
app.route('/api/reporting', reportingRoutes);
app.route('/api', genericAiRoutes);

// ── R2 Media Serve (Public read) ─────────────────────────────

app.get('/r2/*', async (c) => {
  const key = c.req.path.replace('/r2/', '');
  // Cegah path traversal (meskipun R2 key-based, bukan filesystem)
  if (key.includes('..') || key.startsWith('/')) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  const object = await c.env.R2.get(key);
  if (!object) return c.json({ error: 'File tidak ditemukan' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

// ── Public Settings (untuk landing page) ─────────────────────
app.get('/api/settings', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT key, value FROM cbt_settings WHERE key LIKE 'landing_%'"
    ).all();
    const map: Record<string, string> = {};
    for (const r of results as any[]) map[r.key] = r.value;
    return c.json({ success: true, data: map });
  } catch { return c.json({ success: true, data: {} }); }
});

// ── 404 Fallback ─────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ success: false, error: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' }, 404);
});

// ── Error Handler ────────────────────────────────────────────

app.onError((e, c) => {
  const reqId = c.get('requestId') || 'unknown';
  console.error(JSON.stringify({
    level: 'error',
    requestId: reqId,
    error: e.message,
    stack: e.stack,
    path: c.req.path,
    method: c.req.method,
    timestamp: new Date().toISOString(),
  }));
  return c.json({
    success: false,
    error: 'Terjadi kesalahan server',
    code: 'INTERNAL_SERVER_ERROR',
    error_detail: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Terjadi kesalahan server',
      requestId: reqId,
    },
  }, 500);
});

export default app;
