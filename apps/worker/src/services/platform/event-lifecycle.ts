// ============================================================
// Event Lifecycle & Mode Context Service
//
// Manages the authoritative 6-stage event lifecycle:
//   draft -> configuration -> ready -> active -> completed -> archived
// with safe rollback support (ready -> configuration, configuration -> draft)
// and strict PMB compatibility guardrails.
// ============================================================

import type { EventStatus, ExamMode, CbtEvent } from '../../types.ts';
import { EXAM_MODES, EVENT_STATUSES } from '../../types.ts';

/**
 * Valid state transitions for CBT Events.
 * Canonical lifecycle: draft -> configuration -> ready -> active -> completed -> archived
 * Rollback preparatory states: configuration -> draft, ready -> configuration
 * Archived is strictly reachable ONLY from completed. Not for cancellation.
 */
const VALID_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['configuration'],
  configuration: ['ready', 'draft'],
  ready: ['active', 'configuration'],
  active: ['completed'],
  completed: ['archived'],
  archived: [], // Terminal state
} as const;

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates whether an event mode string is one of the 5 canonical domains.
 */
export function isValidExamMode(mode: unknown): mode is ExamMode {
  return typeof mode === 'string' && (EXAM_MODES as readonly string[]).includes(mode);
}

/**
 * Validates whether an event status string is one of the 6 official statuses.
 */
export function isValidEventStatus(status: unknown): status is EventStatus {
  return typeof status === 'string' && (EVENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Evaluates whether a lifecycle transition is permissible.
 */
export function validateEventTransition(
  currentStatus: EventStatus,
  targetStatus: EventStatus
): TransitionValidationResult {
  if (currentStatus === targetStatus) {
    return { valid: true };
  }

  if (!isValidEventStatus(targetStatus)) {
    return {
      valid: false,
      error: `Status target '${targetStatus}' tidak valid. Status yang diizinkan: ${EVENT_STATUSES.join(', ')}`,
    };
  }

  const allowedTargets = VALID_TRANSITIONS[currentStatus] || [];
  if (!allowedTargets.includes(targetStatus)) {
    return {
      valid: false,
      error: `Transisi status tidak diizinkan: dari '${currentStatus}' ke '${targetStatus}'.`,
    };
  }

  return { valid: true };
}

/**
 * Validates that PMB compatibility rules are preserved for event-pmb.
 */
export function validatePmbEventIntegrity(
  eventId: string,
  updates: { mode?: string; code?: string }
): TransitionValidationResult {
  if (eventId === 'event-pmb') {
    if (updates.mode && updates.mode !== 'pmb') {
      return {
        valid: false,
        error: "Mode untuk 'event-pmb' tidak dapat diubah dari 'pmb'.",
      };
    }
  }
  return { valid: true };
}

/**
 * Validates an event creation or update payload.
 */
export function validateEventPayload(body: any, isUpdate = false): {
  data?: {
    code: string;
    name: string;
    mode: ExamMode;
    activityType: string;
    participantSource: 'pmb' | 'mansatas' | 'cbt_user';
    academicYearId: string | null;
    academicYearName: string | null;
    term: string | null;
    proctorAccessBeforeMinutes: number;
    proctorAccessAfterMinutes: number;
  };
  error?: string;
} {
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  const mode = String(body.mode || '').trim().toLowerCase() as ExamMode;
  const participantSource = body.participant_source;
  const activityType = String(body.activity_type || 'other').trim().slice(0, 40) || 'other';

  if (!isUpdate && !code) {
    return { error: 'Kode kegiatan wajib diisi' };
  }
  if (code && !/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code)) {
    return { error: 'Kode kegiatan harus 2-30 karakter alfanumerik (huruf besar, angka, -, _)' };
  }

  if (!name || name.length > 120) {
    return { error: 'Nama kegiatan wajib diisi dan maksimal 120 karakter' };
  }

  if (!isValidExamMode(mode)) {
    return {
      error: `Mode ujian '${mode}' tidak valid. Mode resmi: ${EXAM_MODES.join(', ')}`,
    };
  }

  const validSources = ['pmb', 'mansatas', 'cbt_user'] as const;
  if (!validSources.includes(participantSource)) {
    return { error: `Sumber peserta '${participantSource}' tidak valid (harus: pmb, mansatas, atau cbt_user)` };
  }

  // Proctor window boundaries (default: 30 minutes before, 45 minutes after)
  const proctorBefore = Math.min(Math.max(Number(body.proctor_access_before_minutes ?? 30), 0), 180);
  const proctorAfter = Math.min(Math.max(Number(body.proctor_access_after_minutes ?? 45), 0), 240);

  return {
    data: {
      code,
      name,
      mode,
      activityType,
      participantSource,
      academicYearId: body.academic_year_id ? String(body.academic_year_id).trim() : null,
      academicYearName: body.academic_year_name ? String(body.academic_year_name).trim() : null,
      term: body.term ? String(body.term).trim().toLowerCase() : null,
      proctorAccessBeforeMinutes: proctorBefore,
      proctorAccessAfterMinutes: proctorAfter,
    },
  };
}

export interface ExamCreationPayload {
  event_id?: unknown;
  mode?: unknown;
}

export interface ExamEventResolutionResult {
  success: boolean;
  eventId?: string;
  mode?: ExamMode;
  error?: string;
}

/**
 * Resolves event_id and exam mode for exam creation.
 *
 * Rules:
 * 1. Exam creation strictly REQUIRES event_id. Missing event_id results in 400 Bad Request.
 * 2. Client cannot specify a mode that conflicts with the parent event's mode.
 * 3. Canonical mode is ALWAYS derived from parent event.mode (client mode is only a consistency assertion).
 */
export async function resolveExamEventAndMode(
  body: ExamCreationPayload,
  eventLoader: (eventId: string) => Promise<{ id: string; mode: ExamMode } | null>
): Promise<ExamEventResolutionResult> {
  const eventId = body.event_id ? String(body.event_id).trim() : '';

  if (!eventId) {
    return {
      success: false,
      error: 'Kegiatan (event_id) wajib dipilih untuk pembuatan ujian baru.',
    };
  }

  // Load parent event
  const event = await eventLoader(eventId);
  if (!event) {
    return {
      success: false,
      error: `Kegiatan dengan ID '${eventId}' tidak ditemukan.`,
    };
  }

  // Client cannot specify a mode different from parent event mode (consistency assertion)
  if (body.mode && body.mode !== event.mode) {
    return {
      success: false,
      error: `Mode ujian '${body.mode}' tidak sesuai dengan mode kegiatan '${event.mode}'. Mode ujian harus mengikuti kegiatan.`,
    };
  }

  // Exam mode is ALWAYS derived from parent event.mode
  return {
    success: true,
    eventId: event.id,
    mode: event.mode,
  };
}


