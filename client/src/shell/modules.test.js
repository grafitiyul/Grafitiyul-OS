import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODULES, TOP_MODULES, moduleForPath } from './modules.js';

// Global navigation registry. Both the desktop NavRail AND the mobile bottom
// bar (MobileTabBar) map ALL_MODULES, so GOS has ONE navigation, identical in
// the browser and in the installed admin PWA. Regression guard for the
// 2026-07-13 incident where MobileTabBar hard-coded the Procedures module's
// local tabs instead of the global modules.

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

test('every module targets a top-level /admin/<module> route (never a sub-tab)', () => {
  for (const m of ALL_MODULES) {
    assert.match(m.to, /^\/admin\/[^/]+$/, `${m.key} → ${m.to} is not a top-level module route`);
  }
  // Specifically: no global module points into the Procedures module's tabs.
  assert.ok(!ALL_MODULES.some((m) => m.to.startsWith('/admin/procedures/')));
});

test('Operations Control is a top module (the admin landing target)', () => {
  assert.ok(TOP_MODULES.some((m) => m.key === 'control' && m.to === '/admin/control'));
});

test('moduleForPath resolves deep routes to the right module (longest prefix)', () => {
  assert.equal(moduleForPath('/admin/crm/deals/123')?.key, 'crm');
  assert.equal(moduleForPath('/admin/tours')?.key, 'tours');
  // "tours" must NOT swallow "tour-content" (segment-boundary prefix).
  assert.equal(moduleForPath('/admin/tour-content/tours/x/stations/y')?.key, 'tour-content');
  assert.equal(moduleForPath('/admin/control')?.key, 'control');
  assert.equal(moduleForPath('/admin/procedures/bank')?.key, 'procedures');
});
