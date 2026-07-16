import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateViewInput, canEditView, viewsWhere, sortViews,
  VIEW_SCOPES, CREATABLE_SCOPES, MAX_VIEW_JSON_BYTES,
} from './savedViewsCore.js';

const KEYS = ['dueDate', 'priority', 'owner'];
const FULL = { name: 'היום שלי', scope: 'personal', filters: { window: 'today' }, sort: [{ key: 'dueDate', dir: 'asc' }] };

// ── validation ──────────────────────────────────────────────────────────────

test('create: name/scope/filters/sort are required', () => {
  assert.equal(validateViewInput(FULL, { sortableKeys: KEYS }).ok, true);
  assert.deepEqual(validateViewInput({ ...FULL, name: '  ' }, { sortableKeys: KEYS }), { ok: false, error: 'name_required' });
  assert.deepEqual(validateViewInput({ ...FULL, filters: null }, { sortableKeys: KEYS }), { ok: false, error: 'filters_required' });
  assert.deepEqual(validateViewInput({ ...FULL, filters: ['not-an-object'] }, { sortableKeys: KEYS }), { ok: false, error: 'filters_required' });
  assert.deepEqual(validateViewInput({ ...FULL, sort: 'dueDate' }, { sortableKeys: KEYS }), { ok: false, error: 'sort_required' });
});

test('SYSTEM scope can never arrive through the API', () => {
  assert.deepEqual(CREATABLE_SCOPES, ['personal', 'shared']);
  assert.deepEqual(validateViewInput({ ...FULL, scope: 'system' }, { sortableKeys: KEYS }), { ok: false, error: 'invalid_scope' });
  assert.deepEqual(validateViewInput({ ...FULL, scope: 'global' }, { sortableKeys: KEYS }), { ok: false, error: 'invalid_scope' });
});

test('sort entries are whitelisted against the sortable keys and capped at 3', () => {
  const r = validateViewInput(
    { ...FULL, sort: [{ key: 'bogus', dir: 'asc' }, { key: 'priority', dir: 'desc' }, { key: 'owner' }, { key: 'dueDate' }, { key: 'priority' }] },
    { sortableKeys: KEYS },
  );
  assert.equal(r.ok, true);
  // bogus dropped; dir defaults to asc; capped at 3
  assert.deepEqual(r.data.sort, [
    { key: 'priority', dir: 'desc' },
    { key: 'owner', dir: 'asc' },
    { key: 'dueDate', dir: 'asc' },
  ]);
});

test('partial update validates only the fields present', () => {
  const r = validateViewInput({ name: 'שם חדש' }, { sortableKeys: KEYS, partial: true });
  assert.deepEqual(r, { ok: true, data: { name: 'שם חדש' } });
  assert.equal(validateViewInput({}, { sortableKeys: KEYS, partial: true }).ok, true, 'empty partial is a no-op, route decides');
});

test('name/icon length caps, columns must be an object or null', () => {
  assert.deepEqual(validateViewInput({ ...FULL, name: 'א'.repeat(61) }, { sortableKeys: KEYS }), { ok: false, error: 'name_too_long' });
  assert.deepEqual(validateViewInput({ ...FULL, icon: '🔴🔴🔴🔴🔴🔴' }, { sortableKeys: KEYS }), { ok: false, error: 'icon_too_long' });
  assert.deepEqual(validateViewInput({ ...FULL, columns: 'wide' }, { sortableKeys: KEYS }), { ok: false, error: 'invalid_columns' });
  assert.equal(validateViewInput({ ...FULL, columns: null }, { sortableKeys: KEYS }).ok, true);
});

test('a view is a preference, not a document store — size is capped', () => {
  const r = validateViewInput({ ...FULL, filters: { blob: 'x'.repeat(MAX_VIEW_JSON_BYTES) } }, { sortableKeys: KEYS });
  assert.deepEqual(r, { ok: false, error: 'view_too_large' });
});

// ── permissions ─────────────────────────────────────────────────────────────

test('system views are editable by NOBODY — fixing one is a code change', () => {
  assert.equal(canEditView({ scope: 'system', ownerUserId: null }, 'u1'), false);
  assert.equal(canEditView({ scope: 'system', ownerUserId: 'u1' }, 'u1'), false, 'even a mislabelled owner cannot edit');
});

test('personal and shared views are editable by their owner only', () => {
  for (const scope of ['personal', 'shared']) {
    assert.equal(canEditView({ scope, ownerUserId: 'u1' }, 'u1'), true);
    assert.equal(canEditView({ scope, ownerUserId: 'u1' }, 'u2'), false);
  }
  assert.equal(canEditView({ scope: 'personal', ownerUserId: 'u1' }, null), false);
});

test('visibility where-clause: system + shared for everyone, personal only mine', () => {
  assert.deepEqual(viewsWhere('crm_tasks', 'u1'), {
    module: 'crm_tasks',
    OR: [
      { scope: 'system' },
      { scope: 'shared' },
      { scope: 'personal', ownerUserId: 'u1' },
    ],
  });
});

test('display order: system (seeded order) → shared → personal, alpha inside', () => {
  const sorted = sortViews([
    { scope: 'personal', name: 'ב', sortOrder: 0 },
    { scope: 'system', name: 'ב-מערכת', sortOrder: 2 },
    { scope: 'shared', name: 'א-משותף', sortOrder: 0 },
    { scope: 'system', name: 'א-מערכת', sortOrder: 1 },
    { scope: 'personal', name: 'א', sortOrder: 0 },
  ]);
  assert.deepEqual(sorted.map((v) => v.name), ['א-מערכת', 'ב-מערכת', 'א-משותף', 'א', 'ב']);
});

test('scope vocabulary is closed', () => {
  assert.deepEqual(VIEW_SCOPES, ['personal', 'shared', 'system']);
});
