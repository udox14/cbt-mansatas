// ============================================================
// CBT PMB Worker - Main Entry Point
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';

import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import proctorRoutes from './routes/proctor';
import studentRoutes from './routes/student';

const app = new Hono<{ Bindings: Env }>();

// ── Global Middleware ────────────────────────────────────────

app.use('*', async (c, next) => {
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H1',location:'apps/worker/src/index.ts:20',message:'Incoming request context',data:{origin:c.req.header('origin')||null,host:c.req.header('host')||null,path:c.req.path,method:c.req.method,configuredCorsOrigin:c.env.CORS_ORIGIN||null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const allowedOrigins = (c.env.CORS_ORIGIN || '*')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const reqOrigin = c.req.header('origin');

  const corsMiddleware = cors({
    origin: (origin) => {
      if (allowedOrigins.includes('*')) return origin || '*';
      if (!origin) return '';
      return allowedOrigins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'post-fix',hypothesisId:'H1',location:'apps/worker/src/index.ts:36',message:'CORS decision',data:{origin:reqOrigin||null,allowedOrigins,allowed:reqOrigin?allowedOrigins.includes('*')||allowedOrigins.includes(reqOrigin):true},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return corsMiddleware(c, next);
});

app.use('*', logger());

// ── Health Check ─────────────────────────────────────────────

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ───────────────────────────────────────────────────

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/proctor', proctorRoutes);
app.route('/api/student', studentRoutes);

// ── R2 Media Serve (Public read) ─────────────────────────────

app.get('/r2/*', async (c) => {
  const key = c.req.path.replace('/r2/', '');
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
  return c.json({ success: false, error: 'Endpoint tidak ditemukan' }, 404);
});

// ── Error Handler ────────────────────────────────────────────

app.onError((e, c) => {
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H4',location:'apps/worker/src/index.ts:82',message:'Unhandled worker error',data:{path:c.req.path,method:c.req.method,errorMessage:e.message},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  console.error('Worker Error:', e.message, e.stack);
  return c.json({ success: false, error: 'Terjadi kesalahan server' }, 500);
});

export default app;
