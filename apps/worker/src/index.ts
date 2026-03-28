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
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
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

// ── 404 Fallback ─────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ success: false, error: 'Endpoint tidak ditemukan' }, 404);
});

// ── Error Handler ────────────────────────────────────────────

app.onError((e, c) => {
  console.error('Worker Error:', e.message, e.stack);
  return c.json({ success: false, error: 'Terjadi kesalahan server' }, 500);
});

export default app;
