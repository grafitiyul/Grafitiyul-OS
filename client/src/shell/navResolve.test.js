import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_REGISTRY } from './moduleRoutes.js';
import { resolveNav, settingsModules, toPreferencePayload } from './navResolve.js';

// The navigation resolver is the ONE place where the code registry (identity)
// meets the stored administrator preferences (presentation). Its invariants are
// what stop a configurable navigation from ever losing a module.

const FIXTURE = [
  { key: 'a', to: '/admin/a', label: 'A', railGroup: 'primary', defaultInNav: true, pinned: true },
  { key: 'b', to: '/admin/b', label: 'B', railGroup: 'primary', defaultInNav: true },
  { key: 'c', to: '/admin/c', label: 'C', railGroup: 'utility', defaultInNav: false, management: true },
];

test('with no preferences at all, code defaults decide the rail', () => {
  const r = resolveNav(FIXTURE, null);
  assert.deepEqual(r.primary.map((m) => m.key), ['a', 'b']);
  assert.deepEqual(r.utility.map((m) => m.key), []);
  assert.deepEqual(r.hidden.map((m) => m.key), ['c'], 'defaultInNav:false ships out of the rail');
});

test('a preference row overrides visibility, group and order', () => {
  const r = resolveNav(FIXTURE, [
    { key: 'c', inNav: true, railGroup: 'primary', sortOrder: 0 },
    { key: 'b', inNav: false, railGroup: 'primary', sortOrder: 1 },
  ]);
  assert.deepEqual(r.primary.map((m) => m.key), ['c', 'a'], 'c is now visible and sorts first');
  assert.deepEqual(r.hidden.map((m) => m.key), ['b']);
});

test('pinned modules can never be hidden', () => {
  const r = resolveNav(FIXTURE, [{ key: 'a', inNav: false, sortOrder: 0 }]);
  assert.ok(r.rail.some((m) => m.key === 'a'), 'a is pinned — the stored false is refused');
  // c is still hidden — it ships that way. Only the pinned module is protected.
  assert.deepEqual(r.hidden.map((m) => m.key), ['c']);
});

test('a stored row for a module deleted from code is ignored, not a crash', () => {
  const r = resolveNav(FIXTURE, [{ key: 'ghost', inNav: true, sortOrder: 0 }]);
  assert.deepEqual(r.all.map((m) => m.key), ['a', 'b', 'c']);
});

test('an unconfigured module sorts after every configured one, in registry order', () => {
  // Only 'c' is configured; a and b keep code defaults and follow it.
  const r = resolveNav(FIXTURE, [{ key: 'c', inNav: true, railGroup: 'primary', sortOrder: 5 }]);
  assert.deepEqual(r.primary.map((m) => m.key), ['c', 'a', 'b']);
});

test('settings grid lists EVERY module, management first — not only hidden ones', () => {
  const r = resolveNav(FIXTURE, null);
  assert.deepEqual(
    settingsModules(r).map((m) => m.key),
    ['c', 'a', 'b'],
    'c is the management module and leads; a and b are in the rail and still get cards',
  );
});

test('settings grid excludes הגדרות — a card linking to the current page is noise', () => {
  const r = resolveNav(MODULE_REGISTRY, null);
  const keys = settingsModules(r).map((m) => m.key);
  assert.ok(!keys.includes('settings'));
  // …and it stays reachable regardless, because it is pinned into the rail.
  assert.ok(r.rail.some((m) => m.key === 'settings'));
});

test('INVARIANT: rail ∪ settings grid covers every module, under any preferences', () => {
  const cases = [
    null,
    [],
    MODULE_REGISTRY.map((m, i) => ({ key: m.key, inNav: false, railGroup: 'utility', sortOrder: i })),
    MODULE_REGISTRY.map((m, i) => ({ key: m.key, inNav: true, railGroup: 'primary', sortOrder: i })),
  ];
  for (const prefs of cases) {
    const r = resolveNav(MODULE_REGISTRY, prefs);
    const reachable = new Set([...r.rail, ...settingsModules(r)].map((m) => m.key));
    for (const m of MODULE_REGISTRY) {
      assert.ok(reachable.has(m.key), `${m.key} became unreachable`);
    }
  }
});

test('the real registry ships the intended default rail', () => {
  const r = resolveNav(MODULE_REGISTRY, null);
  assert.deepEqual(r.primary.map((m) => m.key), ['control', 'management-tasks', 'crm', 'tours', 'whatsapp', 'email']);
  assert.deepEqual(r.utility.map((m) => m.key), ['finance', 'settings']);
  assert.deepEqual(
    settingsModules(r).map((m) => m.key),
    [
      // The six management modules lead — Settings is their home…
      'users', 'questionnaires', 'procedures', 'documents', 'tour-content', 'people',
      // …then every operational module, which also gets a permanent card.
      'control', 'management-tasks', 'crm', 'tours', 'whatsapp', 'email', 'finance',
    ],
    'every full module has a card, in the order the Settings page presents them',
  );
});

test('the save payload writes an explicit row per module', () => {
  const r = resolveNav(MODULE_REGISTRY, null);
  const payload = toPreferencePayload(r.all);
  assert.equal(payload.length, MODULE_REGISTRY.length);
  assert.deepEqual(payload.map((p) => p.sortOrder), payload.map((_, i) => i));
  for (const p of payload) {
    assert.equal(typeof p.inNav, 'boolean');
    assert.ok(['primary', 'utility'].includes(p.railGroup));
  }
});
