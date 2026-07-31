import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_REGISTRY, ALL_MODULES, moduleForPath } from './moduleRoutes.js';
import { resolveNav } from './navResolve.js';

// Global navigation registry. The desktop NavRail AND the mobile bottom bar
// (MobileTabBar) both render resolveNav(registry, prefs), so GOS has ONE
// navigation, identical in the browser and in the installed admin PWA.
// Regression guard for the 2026-07-13 incident where MobileTabBar hard-coded
// the Procedures module's local tabs instead of the global modules.

test('registry exposes the full set of admin modules', () => {
  const keys = ALL_MODULES.map((m) => m.key);
  for (const required of [
    'control', 'crm', 'tours', 'whatsapp', 'email',
    'finance', 'people', 'tour-content', 'documents',
    'procedures', 'questionnaires', 'settings', 'users',
  ]) {
    assert.ok(keys.includes(required), `missing module: ${required}`);
  }
});

test('the temporary migration module is gone', () => {
  assert.ok(!ALL_MODULES.some((m) => m.key === 'migration'));
  assert.equal(moduleForPath('/admin/migration/stage-config'), null);
});

test('every module targets a top-level /admin/<module> route (never a sub-tab)', () => {
  for (const m of ALL_MODULES) {
    assert.match(m.to, /^\/admin\/[^/]+$/, `${m.key} → ${m.to} is not a top-level module route`);
  }
  // Specifically: no global module points into the Procedures module's tabs.
  assert.ok(!ALL_MODULES.some((m) => m.to.startsWith('/admin/procedures/')));
});

test('every module carries the metadata the resolver and Settings cards need', () => {
  const keys = new Set();
  for (const m of MODULE_REGISTRY) {
    assert.ok(!keys.has(m.key), `duplicate module key: ${m.key}`);
    keys.add(m.key);
    assert.match(m.key, /^[a-z0-9][a-z0-9-]*$/, `${m.key} is not a valid stored preference key`);
    assert.ok(['primary', 'utility'].includes(m.railGroup), `${m.key} has no rail group`);
    assert.equal(typeof m.defaultInNav, 'boolean', `${m.key} has no defaultInNav`);
    assert.ok(m.description, `${m.key} has no description for its Settings card`);
  }
});

test('Operations Control is a pinned top-group module (the admin landing target)', () => {
  const control = MODULE_REGISTRY.find((m) => m.key === 'control');
  assert.equal(control.to, '/admin/control');
  assert.equal(control.railGroup, 'primary');
  assert.ok(control.pinned);
});

test('the escape hatches are pinned — Settings can never be hidden', () => {
  const pinned = MODULE_REGISTRY.filter((m) => m.pinned).map((m) => m.key);
  assert.ok(pinned.includes('settings'), 'hiding הגדרות would hide the screen that unhides modules');
  const r = resolveNav(MODULE_REGISTRY, [{ key: 'settings', inNav: false, sortOrder: 0 }]);
  assert.ok(r.rail.some((m) => m.key === 'settings'));
});

test('moduleForPath resolves deep routes to the right module (longest prefix)', () => {
  assert.equal(moduleForPath('/admin/crm/deals/123')?.key, 'crm');
  assert.equal(moduleForPath('/admin/tours')?.key, 'tours');
  // "tours" must NOT swallow "tour-content" (segment-boundary prefix).
  assert.equal(moduleForPath('/admin/tour-content/tours/x/stations/y')?.key, 'tour-content');
  assert.equal(moduleForPath('/admin/control')?.key, 'control');
  assert.equal(moduleForPath('/admin/procedures/bank')?.key, 'procedures');
});

test('moduleForPath ignores visibility — a hidden module still gets a breadcrumb', () => {
  // 'people' ships out of the rail; its breadcrumb must still resolve.
  assert.equal(moduleForPath('/admin/people/teams')?.key, 'people');
  assert.equal(moduleForPath('/admin/users')?.key, 'users');
});
