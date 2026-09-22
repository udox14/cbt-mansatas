// ============================================================
// Reporting Router — Canonical Reporting Endpoints
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { ok, err } from '../utils/helpers.ts';
import { assertReportContext, ReportAuthorizationError, ReportNotFoundError } from '../services/reporting/adapters.ts';
import { getExamOverview } from '../services/reporting/overview.ts';
import { getExamParticipation } from '../services/reporting/participation.ts';
import { getConsolidatedResults } from '../services/reporting/results.ts';
import { getConsolidatedAnalytics } from '../services/reporting/analytics.ts';
import { generateResultsCsv } from '../services/reporting/export.ts';
import type { ReportFilter } from '../services/reporting/types.ts';

export const reportingRoutes = new Hono<{ Bindings: Env }>();

reportingRoutes.use('*', authMiddleware);

function handleReportError(e: any, c: any) {
  if (e instanceof ReportAuthorizationError || e?.name === 'ForbiddenError' || e?.status === 403) {
    return c.json(err(e.message || 'Akses ditolak', undefined, 'AUTHORIZATION_DENIED'), e?.status || 403);
  }
  if (e instanceof ReportNotFoundError || e?.name === 'NotFoundError' || e?.status === 404) {
    return c.json(err(e.message || 'Data tidak ditemukan', undefined, 'NOT_FOUND'), e?.status || 404);
  }
  console.error('Reporting Error:', e);
  return c.json(err(e?.message || 'Terjadi kesalahan pada layanan pelaporan', undefined, 'INTERNAL_ERROR'), 500);
}

// ── 1. Overview & Statistics ─────────────────────────────────
reportingRoutes.get('/overview/:examId', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  try {
    await assertReportContext(c.env.DB, examId, user);
    const overview = await getExamOverview(c.env.DB, examId);
    return c.json(ok(overview));
  } catch (e) {
    return handleReportError(e, c);
  }
});

// ── 2. Participation Breakdown ───────────────────────────────
reportingRoutes.get('/participation/:examId', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  try {
    await assertReportContext(c.env.DB, examId, user);
    const participation = await getExamParticipation(c.env.DB, examId);
    return c.json(ok(participation));
  } catch (e) {
    return handleReportError(e, c);
  }
});

// ── 3. Paginated Results with Filtering ──────────────────────
reportingRoutes.get('/results/:examId', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  try {
    await assertReportContext(c.env.DB, examId, user);

    const filters: ReportFilter = {
      roomId: c.req.query('roomId') || undefined,
      roomName: c.req.query('roomName') || undefined,
      className: c.req.query('className') || undefined,
      grade: c.req.query('grade') || undefined,
      tanggalTes: c.req.query('tanggalTes') || undefined,
      sesiTes: c.req.query('sesiTes') || undefined,
      status: (c.req.query('status') as any) || undefined,
      search: c.req.query('search') || undefined,
    };

    const pagination = {
      page: Number(c.req.query('page') || 1),
      limit: Number(c.req.query('limit') || 50),
    };

    const results = await getConsolidatedResults(c.env.DB, examId, filters, pagination);
    return c.json(ok(results));
  } catch (e) {
    return handleReportError(e, c);
  }
});

// ── 4. Hardened Tabular Export ───────────────────────────────
reportingRoutes.get('/results/:examId/export', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  const format = (c.req.query('format') || 'csv').toLowerCase();

  try {
    await assertReportContext(c.env.DB, examId, user);

    const filters: ReportFilter = {
      roomId: c.req.query('roomId') || undefined,
      roomName: c.req.query('roomName') || undefined,
      className: c.req.query('className') || undefined,
      grade: c.req.query('grade') || undefined,
      tanggalTes: c.req.query('tanggalTes') || undefined,
      sesiTes: c.req.query('sesiTes') || undefined,
      status: (c.req.query('status') as any) || undefined,
      search: c.req.query('search') || undefined,
    };

    if (format === 'csv') {
      const { filename, csvContent } = await generateResultsCsv(c.env.DB, examId, filters);
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default or JSON format: return full items array
    const results = await getConsolidatedResults(c.env.DB, examId, filters, { page: 1, limit: 10000 });
    return c.json(ok(results.items));
  } catch (e) {
    return handleReportError(e, c);
  }
});

// ── 5. Question Analytics ────────────────────────────────────
reportingRoutes.get('/analytics/:examId', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  try {
    await assertReportContext(c.env.DB, examId, user);
    const analytics = await getConsolidatedAnalytics(c.env.DB, examId);
    return c.json(ok(analytics));
  } catch (e) {
    return handleReportError(e, c);
  }
});

export default reportingRoutes;
