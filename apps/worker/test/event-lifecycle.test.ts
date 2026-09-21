// test/event-lifecycle.test.ts
// Unit tests for Event Lifecycle state machine, canonical modes, and transition validation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidExamMode,
  isValidEventStatus,
  validateEventTransition,
  validatePmbEventIntegrity,
  validateEventPayload,
  resolveExamEventAndMode,
} from '../src/services/platform/event-lifecycle.ts';
import { EXAM_MODES, EVENT_STATUSES } from '../src/types.ts';

describe('Event Lifecycle & Mode Context Suite', () => {
  it('strictly validates the 5 canonical exam modes', () => {
    // Valid modes
    assert.equal(isValidExamMode('pmb'), true);
    assert.equal(isValidExamMode('kegiatan'), true);
    assert.equal(isValidExamMode('tka'), true);
    assert.equal(isValidExamMode('semester'), true);
    assert.equal(isValidExamMode('ulangan'), true);

    // Invalid modes (forbidden to invent a 6th mode)
    assert.equal(isValidExamMode('tryout'), false);
    assert.equal(isValidExamMode('simulasi'), false);
    assert.equal(isValidExamMode('ujian'), false);
    assert.equal(isValidExamMode(''), false);
    assert.equal(isValidExamMode(null), false);
    assert.equal(isValidExamMode(undefined), false);
  });

  it('strictly validates the 6 official event lifecycle statuses', () => {
    assert.equal(EVENT_STATUSES.length, 6);
    assert.deepEqual(EVENT_STATUSES, [
      'draft',
      'configuration',
      'ready',
      'active',
      'completed',
      'archived',
    ]);

    for (const st of EVENT_STATUSES) {
      assert.equal(isValidEventStatus(st), true);
    }

    assert.equal(isValidEventStatus('published'), false); // 'published' is not part of official 6
    assert.equal(isValidEventStatus('finished'), false);
    assert.equal(isValidEventStatus('unknown'), false);
  });

  it('permits official forward lifecycle transitions', () => {
    // draft -> configuration
    assert.equal(validateEventTransition('draft', 'configuration').valid, true);

    // configuration -> ready
    assert.equal(validateEventTransition('configuration', 'ready').valid, true);

    // ready -> active
    assert.equal(validateEventTransition('ready', 'active').valid, true);

    // active -> completed
    assert.equal(validateEventTransition('active', 'completed').valid, true);

    // completed -> archived
    assert.equal(validateEventTransition('completed', 'archived').valid, true);
  });

  it('permits administrative revisions and rollback before activation', () => {
    // ready -> configuration (administrator needs to adjust settings or roster)
    assert.equal(validateEventTransition('ready', 'configuration').valid, true);

    // configuration -> draft (administrator returns event to draft for redesign)
    assert.equal(validateEventTransition('configuration', 'draft').valid, true);
  });

  it('strictly enforces archived is ONLY reachable from completed (never from draft, configuration, ready, or active)', () => {
    // draft -> archived: REJECTED
    const draftToArchived = validateEventTransition('draft', 'archived');
    assert.equal(draftToArchived.valid, false);
    assert.match(draftToArchived.error || '', /tidak diizinkan|hanya diizinkan dari status 'completed'/);

    // configuration -> archived: REJECTED
    const configToArchived = validateEventTransition('configuration', 'archived');
    assert.equal(configToArchived.valid, false);
    assert.match(configToArchived.error || '', /tidak diizinkan|hanya diizinkan dari status 'completed'/);

    // ready -> archived: REJECTED
    const readyToArchived = validateEventTransition('ready', 'archived');
    assert.equal(readyToArchived.valid, false);
    assert.match(readyToArchived.error || '', /tidak diizinkan|hanya diizinkan dari status 'completed'/);

    // active -> archived: REJECTED
    const activeToArchived = validateEventTransition('active', 'archived');
    assert.equal(activeToArchived.valid, false);
    assert.match(activeToArchived.error || '', /tidak diizinkan|hanya diizinkan dari status 'completed'/);

    // completed -> archived: ALLOWED
    const completedToArchived = validateEventTransition('completed', 'archived');
    assert.equal(completedToArchived.valid, true);
  });

  it('strictly rejects arbitrary or illegal transitions', () => {
    // Cannot skip stages directly into active
    const skipToActive = validateEventTransition('draft', 'active');
    assert.equal(skipToActive.valid, false);
    assert.match(skipToActive.error || '', /tidak diizinkan/);

    // Cannot jump from draft directly to completed
    const skipToCompleted = validateEventTransition('draft', 'completed');
    assert.equal(skipToCompleted.valid, false);

    // Cannot revert an active exam back to draft
    const activeToDraft = validateEventTransition('active', 'draft');
    assert.equal(activeToDraft.valid, false);

    // Cannot uncomplete without archive
    const completedToActive = validateEventTransition('completed', 'active');
    assert.equal(completedToActive.valid, false);

    // Archived is a terminal state
    const archivedToActive = validateEventTransition('archived', 'active');
    assert.equal(archivedToActive.valid, false);
  });

  it('strictly protects event-pmb from mode alterations', () => {
    // event-pmb mode must remain 'pmb'
    const validPmb = validatePmbEventIntegrity('event-pmb', { mode: 'pmb' });
    assert.equal(validPmb.valid, true);

    const invalidPmb = validatePmbEventIntegrity('event-pmb', { mode: 'kegiatan' });
    assert.equal(invalidPmb.valid, false);
    assert.match(invalidPmb.error || '', /tidak dapat diubah/);

    // Other events are free to set their legitimate mode
    const otherEvent = validatePmbEventIntegrity('event-lomba-01', { mode: 'kegiatan' });
    assert.equal(otherEvent.valid, true);
  });

  it('validates event creation payload correctly', () => {
    const validPayload = {
      code: 'PAS-GENAP-2026',
      name: 'Penilaian Akhir Semester Genap 2025/2026',
      mode: 'semester',
      participant_source: 'mansatas',
      academic_year_id: 'ay_2025_2026',
      academic_year_name: '2025/2026',
      term: 'genap',
      proctor_access_before_minutes: 20,
      proctor_access_after_minutes: 45,
    };

    const res = validateEventPayload(validPayload, false);
    assert.equal(res.error, undefined);
    assert.ok(res.data);
    assert.equal(res.data.mode, 'semester');
    assert.equal(res.data.academicYearId, 'ay_2025_2026');
    assert.equal(res.data.proctorAccessBeforeMinutes, 20);
    assert.equal(res.data.proctorAccessAfterMinutes, 45);

    // Defaults test: proctor window defaults to 30 before, 45 after
    const defaultPayload = {
      code: 'PAS-DEFAULT',
      name: 'Ujian Standar',
      mode: 'semester',
      participant_source: 'mansatas',
    };
    const defaultRes = validateEventPayload(defaultPayload, false);
    assert.equal(defaultRes.error, undefined);
    assert.ok(defaultRes.data);
    assert.equal(defaultRes.data.proctorAccessBeforeMinutes, 30);
    assert.equal(defaultRes.data.proctorAccessAfterMinutes, 45);

    // Invalid mode payload
    const invalidModePayload = {
      ...validPayload,
      mode: 'invented_sixth_mode',
    };
    const invalidRes = validateEventPayload(invalidModePayload, false);
    assert.match(invalidRes.error || '', /Mode ujian 'invented_sixth_mode' tidak valid/);
  });

  it('strictly enforces mode immutability when an event has linked exams or roster', async () => {
    // Mock D1 database with an existing event having 1 exam
    const mockDb: any = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first<T>(): Promise<T | null> {
                if (sql.includes('FROM cbt_events')) {
                  return {
                    id: 'ev-sem-01',
                    code: 'PAS-01',
                    name: 'PAS Ganjil',
                    mode: 'semester',
                    activity_type: 'semester',
                    participant_source: 'mansatas',
                    status: 'draft',
                  } as any;
                }
                if (sql.includes('FROM cbt_exams')) {
                  return { total: 2 } as any; // 2 exams linked
                }
                if (sql.includes('FROM cbt_exam_roster')) {
                  return { total: 0 } as any;
                }
                return null;
              },
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    };

    const { updateEventRecord } = await import('../src/services/platform/events.ts');

    // Attempting to change mode from 'semester' to 'kegiatan' must be rejected
    const result = await updateEventRecord(mockDb, 'ev-sem-01', {
      mode: 'kegiatan',
    });

    assert.equal(result.success, false);
    assert.match(result.error || '', /tidak dapat diubah karena kegiatan sudah memiliki 2 ujian/);
  });
});

describe('Exam Creation Event & Mode Resolution Suite', () => {
  const mockEvents: Record<string, { id: string; mode: any }> = {
    'event-pmb': { id: 'event-pmb', mode: 'pmb' },
    'ev-sem-01': { id: 'ev-sem-01', mode: 'semester' },
    'ev-tka-01': { id: 'ev-tka-01', mode: 'tka' },
  };

  const mockLoader = async (id: string) => mockEvents[id] || null;

  it('1. strictly rejects all exam creation requests without event_id (zero magic fallback)', async () => {
    // Empty payload
    const resEmpty = await resolveExamEventAndMode({}, mockLoader);
    assert.equal(resEmpty.success, false);
    assert.match(resEmpty.error || '', /Kegiatan \(event_id\) wajib dipilih/);

    // Request with mode: 'pmb' but no event_id
    const resPmbMode = await resolveExamEventAndMode({ mode: 'pmb' }, mockLoader);
    assert.equal(resPmbMode.success, false);
    assert.match(resPmbMode.error || '', /Kegiatan \(event_id\) wajib dipilih/);

    // Request with legacy target_jalur but no event_id
    const resTargetJalur = await resolveExamEventAndMode({ target_jalur: 'REGULER' } as any, mockLoader);
    assert.equal(resTargetJalur.success, false);
    assert.match(resTargetJalur.error || '', /Kegiatan \(event_id\) wajib dipilih/);

    // Domain creation without event_id
    const resSem = await resolveExamEventAndMode({ mode: 'semester' }, mockLoader);
    assert.equal(resSem.success, false);
    assert.match(resSem.error || '', /Kegiatan \(event_id\) wajib dipilih/);
  });

  it('2. successfully resolves canonical PMB exam when explicit event_id is provided', async () => {
    const resPmb = await resolveExamEventAndMode({ event_id: 'event-pmb' }, mockLoader);
    assert.equal(resPmb.success, true);
    assert.equal(resPmb.eventId, 'event-pmb');
    assert.equal(resPmb.mode, 'pmb');

    // Matching mode assertion
    const resPmbMatch = await resolveExamEventAndMode({ event_id: 'event-pmb', mode: 'pmb' }, mockLoader);
    assert.equal(resPmbMatch.success, true);
    assert.equal(resPmbMatch.eventId, 'event-pmb');
    assert.equal(resPmbMatch.mode, 'pmb');
  });

  it('3. derives exam mode strictly from parent event for all domains', async () => {
    const resSem = await resolveExamEventAndMode({ event_id: 'ev-sem-01' }, mockLoader);
    assert.equal(resSem.success, true);
    assert.equal(resSem.eventId, 'ev-sem-01');
    assert.equal(resSem.mode, 'semester');

    const resTka = await resolveExamEventAndMode({ event_id: 'ev-tka-01', mode: 'tka' }, mockLoader);
    assert.equal(resTka.success, true);
    assert.equal(resTka.eventId, 'ev-tka-01');
    assert.equal(resTka.mode, 'tka');
  });

  it('4. strictly rejects client specifying a mode that conflicts with parent event mode', async () => {
    const resConflict = await resolveExamEventAndMode(
      { event_id: 'ev-sem-01', mode: 'pmb' },
      mockLoader
    );
    assert.equal(resConflict.success, false);
    assert.match(resConflict.error || '', /Mode ujian 'pmb' tidak sesuai dengan mode kegiatan 'semester'/);
  });

  it('5. strictly rejects non-existent event_id with 400 Bad Request error', async () => {
    const resNotFound = await resolveExamEventAndMode({ event_id: 'non-existent-event' }, mockLoader);
    assert.equal(resNotFound.success, false);
    assert.match(resNotFound.error || '', /Kegiatan dengan ID 'non-existent-event' tidak ditemukan/);
  });
});

