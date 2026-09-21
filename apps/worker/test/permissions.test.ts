// test/permissions.test.ts
// Unit tests for RBAC permission evaluator and scope resolution

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  resolveAllowedModes,
} from '../src/services/platform/permissions.ts';
import type { PermissionGrant } from '../src/types.ts';

describe('RBAC Permissions & Scope Evaluation Suite', () => {
  it('grants all permissions to admin role regardless of grants', () => {
    assert.equal(hasPermission([], 'any.permission', undefined, ['admin']), true);
    assert.equal(hasPermission([], 'tka.manage', { type: 'mode', value: 'tka' }, ['admin']), true);
  });

  it('evaluates global scope wildcard grants (*)', () => {
    const grants: PermissionGrant[] = [
      {
        id: 'p1',
        staff_id: 's1',
        permission: 'ulangan.exam.create',
        scope_type: 'global',
        scope_value: '*',
        created_at: '2026-01-01',
      },
    ];

    // Any scope passes when grant is global wildcard
    assert.equal(hasPermission(grants, 'ulangan.exam.create', undefined, ['teacher']), true);
    assert.equal(hasPermission(grants, 'ulangan.exam.create', { type: 'own', value: 's1' }, ['teacher']), true);
    assert.equal(hasPermission(grants, 'ulangan.exam.delete', undefined, ['teacher']), false);
  });

  it('strictly validates scope matches for scoped grants', () => {
    const grants: PermissionGrant[] = [
      {
        id: 'p2',
        staff_id: 's1',
        permission: 'ulangan.exam.manage_own',
        scope_type: 'own',
        scope_value: 's1',
        created_at: '2026-01-01',
      },
      {
        id: 'p3',
        staff_id: 's1',
        permission: 'tka.exam.manage',
        scope_type: 'subject',
        scope_value: 'subj_biologi',
        created_at: '2026-01-01',
      },
    ];

    // Own scope matches
    assert.equal(hasPermission(grants, 'ulangan.exam.manage_own', { type: 'own', value: 's1' }, ['teacher']), true);
    assert.equal(hasPermission(grants, 'ulangan.exam.manage_own', { type: 'own', value: 's2' }, ['teacher']), false);

    // Subject scope matches
    assert.equal(hasPermission(grants, 'tka.exam.manage', { type: 'subject', value: 'subj_biologi' }, ['teacher']), true);
    assert.equal(hasPermission(grants, 'tka.exam.manage', { type: 'subject', value: 'subj_kimia' }, ['teacher']), false);
  });

  it('resolves allowed modes accurately based on roles and grants', () => {
    // Admin gets all 5 modes
    assert.deepEqual(resolveAllowedModes(['admin'], []), ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan']);

    // Default teacher gets ulangan
    assert.deepEqual(resolveAllowedModes(['teacher'], []), ['ulangan']);

    // Teacher with TKA and Ulangan grants
    const teacherGrants: PermissionGrant[] = [
      { id: '1', staff_id: 's1', permission: 'tka.access', scope_type: 'mode', scope_value: 'tka', created_at: '' },
      { id: '2', staff_id: 's1', permission: 'ulangan.access', scope_type: 'mode', scope_value: 'ulangan', created_at: '' },
    ];
    const modes = resolveAllowedModes(['teacher'], teacherGrants);
    assert.equal(modes.includes('tka'), true);
    assert.equal(modes.includes('ulangan'), true);
    assert.equal(modes.includes('pmb'), false);
  });
});
