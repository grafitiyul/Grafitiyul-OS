import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATION_TABS, tabForPath } from './config.js';
import { ALL_MODULES, moduleForPath } from '../../shell/moduleRoutes.js';

test('the six tabs match the approved information architecture, in order', () => {
  assert.deepEqual(
    MIGRATION_TABS.map((t) => t.key),
    ['organizations', 'contacts', 'name_cleanup', 'stage_config', 'exceptional', 'legacy_archive'],
  );
  assert.equal(MIGRATION_TABS.length, 6);
});

test('there is NO separate Units tab and NO separate phone-duplicates tab', () => {
  const keys = MIGRATION_TABS.map((t) => t.key);
  const labels = MIGRATION_TABS.map((t) => t.label).join(' ');
  assert.ok(!keys.some((k) => /unit/i.test(k)), 'units live inside the Organizations workflow');
  assert.ok(!keys.some((k) => /phone/i.test(k)), 'phone evidence lives inside the Contacts flow');
  assert.ok(!/יחידות|טלפונים/.test(labels));
});

test('tab navigation resolves the active tab from the pathname', () => {
  assert.equal(tabForPath('/admin/migration/stage-config')?.key, 'stage_config');
  assert.equal(tabForPath('/admin/migration/organizations')?.key, 'organizations');
  assert.equal(tabForPath('/admin/migration/name-cleanup')?.key, 'name_cleanup');
  assert.equal(tabForPath('/admin/migration/legacy-archive')?.key, 'legacy_archive');
  assert.equal(tabForPath('/admin/migration'), null, 'the bare hub matches no tab (it redirects)');
  assert.equal(tabForPath('/admin/crm/deals'), null);
});

test('every tab has a unique, URL-safe path', () => {
  const paths = MIGRATION_TABS.map((t) => t.path);
  assert.equal(new Set(paths).size, paths.length, 'unique');
  for (const p of paths) assert.match(p, /^[a-z-]+$/, `${p} is URL-safe`);
});

test('the Review Center is registered in the global admin navigation', () => {
  const mod = ALL_MODULES.find((m) => m.key === 'migration');
  assert.ok(mod, 'migration module registered');
  assert.equal(mod.to, '/admin/migration');
  assert.equal(moduleForPath('/admin/migration/stage-config')?.key, 'migration');
  // It must not swallow other modules' paths.
  assert.equal(moduleForPath('/admin/crm/deals')?.key, 'crm');
});
