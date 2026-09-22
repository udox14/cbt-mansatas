// ============================================================
// Reporting Service — Domain-Aware Adapters & Security Guards
// ============================================================

import type { ExamMode } from '../../types.ts';
import type { VerifiedReportContext } from './types.ts';
import { assertUlanganOwnership } from '../domains/ulangan/exams.ts';

export class ReportAuthorizationError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'ReportAuthorizationError';
    this.status = status;
  }
}

export class ReportNotFoundError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = 'ReportNotFoundError';
    this.status = 404;
  }
}

/**
 * Validates exam existence, resolves domain context, and enforces domain-specific
 * security boundaries before any reporting data is accessed or returned.
 */
export async function assertReportContext(
  db: D1Database,
  examId: string,
  user: any
): Promise<VerifiedReportContext> {
  const exam = await db.prepare(
    `SELECT e.id, e.title, e.mode, e.event_id, e.owner_staff_id, ev.mode as event_mode
     FROM cbt_exams e
     LEFT JOIN cbt_events ev ON ev.id = e.event_id
     WHERE e.id = ?`
  ).bind(examId).first<any>();

  if (!exam) {
    throw new ReportNotFoundError(`Ujian '${examId}' tidak ditemukan`);
  }

  const rawMode = exam.mode || exam.event_mode || 'pmb';
  const mode = rawMode as ExamMode;
  const isGlobalAdmin = user?.role === 'admin' || (user?.roles || []).includes('admin');

  // Domain-specific authorization enforcement
  switch (mode) {
    case 'ulangan': {
      // Must enforce teacher ownership
      try {
        await assertUlanganOwnership(db, examId, user);
      } catch (err: any) {
        if (err instanceof ReportAuthorizationError || err?.name === 'ForbiddenError' || err?.status === 403) {
          throw new ReportAuthorizationError(err.message || 'Akses ditolak: Anda bukan pemilik ujian ulangan ini', 403);
        }
        if (err instanceof ReportNotFoundError || err?.name === 'NotFoundError' || err?.status === 404) {
          throw new ReportNotFoundError(err.message || 'Ujian ulangan tidak ditemukan');
        }
        throw err;
      }
      break;
    }

    case 'tka': {
      if (!isGlobalAdmin) {
        const perms: string[] = user?.permissions || [];
        const allowed = perms.some(p => ['tka.results.read', 'tka.access', 'tka.event.manage', 'platform.manage'].includes(p));
        if (!allowed) {
          throw new ReportAuthorizationError('Akses ditolak: Anda tidak memiliki hak akses melihat hasil TKA');
        }
      }
      break;
    }

    case 'semester': {
      if (!isGlobalAdmin) {
        const perms: string[] = user?.permissions || [];
        const allowed = perms.some(p => ['semester.results.view', 'semester.event.manage', 'platform.manage'].includes(p));
        if (!allowed) {
          throw new ReportAuthorizationError('Akses ditolak: Anda tidak memiliki hak akses melihat hasil Semester');
        }
      }
      break;
    }

    case 'kegiatan': {
      if (!isGlobalAdmin) {
        const perms: string[] = user?.permissions || [];
        const allowed = perms.some(p => ['kegiatan.event.read', 'kegiatan.access', 'kegiatan.event.manage', 'platform.manage'].includes(p));
        if (!allowed) {
          throw new ReportAuthorizationError('Akses ditolak: Anda tidak memiliki hak akses melihat hasil Kegiatan');
        }
      }
      break;
    }

    case 'pmb': {
      if (!isGlobalAdmin) {
        const perms: string[] = user?.permissions || [];
        const allowed = perms.some(p => ['pmb.access', 'platform.manage'].includes(p));
        if (!allowed) {
          throw new ReportAuthorizationError('Akses ditolak: Anda tidak memiliki hak akses melihat hasil PMB');
        }
      }
      break;
    }

    default:
      if (!isGlobalAdmin) {
        throw new ReportAuthorizationError('Akses ditolak: Mode ujian tidak dikenal');
      }
  }

  return {
    examId: exam.id,
    eventId: exam.event_id || undefined,
    mode,
    staffId: user?.sub,
    isStaffAdmin: isGlobalAdmin,
    user,
  };
}
