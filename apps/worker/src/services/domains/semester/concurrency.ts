// ============================================================
// Phase 7: Semester Concurrency & Generation Controls
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { SemesterGenerationStage, SemesterGenerationControl, SemesterGenerationLog } from './types.ts';

const STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface AcquireLockResult {
  acquired: boolean;
  batchId?: string;
  revision?: number;
  error?: string;
}

/**
 * Acquires an exclusive generation lock for a stage in a semester event.
 * Reclaims stale locks older than STALE_LOCK_TIMEOUT_MS.
 */
export async function acquireGenerationLock(
  db: D1Database,
  eventId: string,
  stage: SemesterGenerationStage,
  actorId: string
): Promise<AcquireLockResult> {
  const batchId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // Find or insert control record
  const existing = await db
    .prepare('SELECT * FROM cbt_semester_generation_controls WHERE event_id = ? AND stage = ?')
    .bind(eventId, stage)
    .first<SemesterGenerationControl>();

  if (!existing) {
    // Insert new idle record
    await db
      .prepare(`
        INSERT INTO cbt_semester_generation_controls (id, event_id, stage, active_batch_id, status, started_at, actor_id, revision)
        VALUES (?, ?, ?, ?, 'running', ?, ?, 1)
      `)
      .bind(crypto.randomUUID(), eventId, stage, batchId, nowIso, actorId)
      .run();

    return { acquired: true, batchId, revision: 1 };
  }

  if (existing.status === 'running') {
    const startedTime = existing.started_at ? new Date(existing.started_at).getTime() : 0;
    const isStale = Date.now() - startedTime > STALE_LOCK_TIMEOUT_MS;

    if (!isStale) {
      return {
        acquired: false,
        error: `Generation for stage '${stage}' is currently in progress by actor ${existing.actor_id}. Started at ${existing.started_at}.`,
      };
    }
  }

  const nextRevision = existing.revision + 1;
  const result = await db
    .prepare(`
      UPDATE cbt_semester_generation_controls
      SET active_batch_id = ?, status = 'running', started_at = ?, actor_id = ?, revision = ?
      WHERE event_id = ? AND stage = ?
    `)
    .bind(batchId, nowIso, actorId, nextRevision, eventId, stage)
    .run();

  if (!result.success) {
    return { acquired: false, error: 'Failed to acquire generation lock.' };
  }

  return { acquired: true, batchId, revision: nextRevision };
}

/**
 * Releases the generation lock after completion or failure.
 */
export async function releaseGenerationLock(
  db: D1Database,
  eventId: string,
  stage: SemesterGenerationStage,
  batchId: string,
  status: 'idle' = 'idle'
): Promise<void> {
  await db
    .prepare(`
      UPDATE cbt_semester_generation_controls
      SET status = ?, active_batch_id = NULL, started_at = NULL
      WHERE event_id = ? AND stage = ? AND (active_batch_id = ? OR active_batch_id IS NULL)
    `)
    .bind(status, eventId, stage, batchId)
    .run();
}

/**
 * Invalidates downstream stages whenever an upstream stage or manual structural mutation occurs.
 * Hierarchy: room_allocation -> seating -> timetable -> invigilators
 */
export async function invalidateDownstreamRevisions(
  db: D1Database,
  eventId: string,
  mutatedStage: SemesterGenerationStage
): Promise<void> {
  const stageOrder: SemesterGenerationStage[] = ['room_allocation', 'seating', 'timetable', 'invigilators'];
  const mutatedIdx = stageOrder.indexOf(mutatedStage);
  if (mutatedIdx < 0) return;

  const downstreamStages = stageOrder.slice(mutatedIdx + 1);
  for (const ds of downstreamStages) {
    await db
      .prepare(`
        INSERT INTO cbt_semester_generation_controls (id, event_id, stage, revision, status)
        VALUES (?, ?, ?, 2, 'idle')
        ON CONFLICT(event_id, stage) DO UPDATE SET
          revision = revision + 1,
          status = 'idle',
          active_batch_id = NULL,
          started_at = NULL
      `)
      .bind(crypto.randomUUID(), eventId, ds)
      .run();
  }
}

/**
 * Records an immutable entry into cbt_semester_generation_logs.
 */
export async function logGenerationResult(
  db: D1Database,
  eventId: string,
  stage: SemesterGenerationStage,
  actorId: string,
  seed: number | null,
  configuration: Record<string, any>,
  status: 'success' | 'impossible' | 'failed',
  summary: string
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO cbt_semester_generation_logs (id, event_id, stage, actor_id, seed, configuration, status, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    .bind(
      crypto.randomUUID(),
      eventId,
      stage,
      actorId,
      seed ?? null,
      JSON.stringify(configuration || {}),
      status,
      summary
    )
    .run();
}

/**
 * Gets generation control state for a stage.
 */
export async function getGenerationControl(
  db: D1Database,
  eventId: string,
  stage: SemesterGenerationStage
): Promise<SemesterGenerationControl | null> {
  return db
    .prepare('SELECT * FROM cbt_semester_generation_controls WHERE event_id = ? AND stage = ?')
    .bind(eventId, stage)
    .first<SemesterGenerationControl>();
}

/**
 * Fetches immutable generation logs for an event, optionally filtered by stage.
 */
export async function getGenerationLogs(
  db: D1Database,
  eventId: string,
  stage?: SemesterGenerationStage
): Promise<SemesterGenerationLog[]> {
  if (stage) {
    const { results } = await db
      .prepare(`
        SELECT * FROM cbt_semester_generation_logs
        WHERE event_id = ? AND stage = ?
        ORDER BY created_at DESC
        LIMIT 100
      `)
      .bind(eventId, stage)
      .all<SemesterGenerationLog>();
    return results || [];
  }

  const { results } = await db
    .prepare(`
      SELECT * FROM cbt_semester_generation_logs
      WHERE event_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `)
    .bind(eventId)
    .all<SemesterGenerationLog>();
  return results || [];
}
