import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTrail,
  parentOf,
  resolveNode,
  recordSettingsVisit,
  previousSettingsPath,
  __resetSettingsHistory,
} from './settingsNav.js';

// ── breadcrumb trail ─────────────────────────────────────────────────────────

test('trail for Main Products is root → CRM → Products → Main Products', () => {
  const trail = getTrail('/admin/settings/crm/products').map((c) => c.label);
  assert.deepEqual(trail, ['הגדרות', 'הגדרות CRM', 'מוצרים', 'מוצרים ראשיים']);
});

test('dynamic product page uses the supplied label as the last crumb', () => {
  const trail = getTrail('/admin/settings/crm/products/abc123', 'סיור גרפיטי').map((c) => c.label);
  assert.deepEqual(trail, ['הגדרות', 'הגדרות CRM', 'מוצרים', 'מוצרים ראשיים', 'סיור גרפיטי']);
});

test('unknown settings path yields no multi-crumb trail', () => {
  assert.equal(getTrail('/admin/settings/crm/does-not-exist').length, 0);
});

// ── parent fallback ──────────────────────────────────────────────────────────

test('Main Products parent is the Products area (the reported bug)', () => {
  assert.equal(parentOf('/admin/settings/crm/products'), '/admin/settings/crm/products-area');
});

test('product detail parent is the products list', () => {
  assert.equal(parentOf('/admin/settings/crm/products/abc'), '/admin/settings/crm/products');
});

test('unknown path falls back to settings root', () => {
  assert.equal(parentOf('/admin/settings/crm/nope'), '/admin/settings');
});

test('Shared Content Library sits under CRM settings', () => {
  assert.equal(parentOf('/admin/settings/crm/shared-content'), '/admin/settings/crm');
  assert.deepEqual(
    getTrail('/admin/settings/crm/shared-content').map((c) => c.label),
    ['הגדרות', 'הגדרות CRM', 'ספריית תוכן משותף'],
  );
});

test('resolveNode returns null for unknown, node for known', () => {
  assert.equal(resolveNode('/admin/settings/crm/nope'), null);
  assert.equal(resolveNode('/admin/settings/crm').label, 'הגדרות CRM');
});

// ── Tours settings hierarchy (same category-page pattern as CRM) ─────────────

test('every Tours category sits under the Tours landing page', () => {
  for (const path of [
    '/admin/settings/tours/group-tours',
    '/admin/settings/tours/components',
    '/admin/settings/tours/coordination',
    '/admin/settings/tours/summary',
    '/admin/settings/tours/guide-permissions',
  ]) {
    assert.equal(parentOf(path), '/admin/settings/tours', path);
  }
});

test('trail for Group Tours is root → Tours → Group Tours', () => {
  assert.deepEqual(
    getTrail('/admin/settings/tours/group-tours').map((c) => c.label),
    ['הגדרות', 'הגדרות סיורים', 'סיורים קבוצתיים'],
  );
});

// ── in-session history ───────────────────────────────────────────────────────

test('back returns to the actual previous settings location when available', () => {
  __resetSettingsHistory();
  recordSettingsVisit('/admin/settings/crm');
  recordSettingsVisit('/admin/settings/crm/products-area');
  recordSettingsVisit('/admin/settings/crm/products');
  assert.equal(previousSettingsPath('/admin/settings/crm/products'), '/admin/settings/crm/products-area');
});

test('no previous visit → null (caller uses the parent fallback)', () => {
  __resetSettingsHistory();
  recordSettingsVisit('/admin/settings/crm/products'); // deep link
  assert.equal(previousSettingsPath('/admin/settings/crm/products'), null);
});

test('returning to an earlier page trims the stack (no forward loop)', () => {
  __resetSettingsHistory();
  recordSettingsVisit('/admin/settings/crm');
  recordSettingsVisit('/admin/settings/crm/products-area');
  recordSettingsVisit('/admin/settings/crm/products');
  recordSettingsVisit('/admin/settings/crm/products-area'); // went back
  assert.equal(previousSettingsPath('/admin/settings/crm/products-area'), '/admin/settings/crm');
});

test('consecutive duplicate visits are ignored', () => {
  __resetSettingsHistory();
  recordSettingsVisit('/admin/settings/crm');
  recordSettingsVisit('/admin/settings/crm');
  assert.equal(previousSettingsPath('/admin/settings/crm'), null);
});
