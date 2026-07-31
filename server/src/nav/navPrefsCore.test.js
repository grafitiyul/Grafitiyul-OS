import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNavConfig, toClient } from './navPrefsCore.js';

const row = (key, over = {}) => ({ key, inNav: true, railGroup: 'primary', sortOrder: 0, ...over });

test('accepts a well-formed configuration and normalises the rows', () => {
  const v = validateNavConfig({
    modules: [row('crm'), row('tour-content', { inNav: false, railGroup: null, sortOrder: 3 })],
  });
  assert.ok(v.ok);
  assert.deepEqual(v.rows[1], { key: 'tour-content', inNav: false, railGroup: null, sortOrder: 3 });
});

test('rejects malformed payloads', () => {
  const cases = [
    [{}, 'modules_required'],
    [{ modules: [row('CRM')] }, 'invalid_key'],
    [{ modules: [row('a b')] }, 'invalid_key'],
    [{ modules: [row('crm'), row('crm')] }, 'duplicate_key'],
    [{ modules: [row('crm', { inNav: 'yes' })] }, 'invalid_in_nav'],
    [{ modules: [row('crm', { railGroup: 'middle' })] }, 'invalid_rail_group'],
    [{ modules: [row('crm', { sortOrder: -1 })] }, 'invalid_sort_order'],
    [{ modules: [row('crm', { sortOrder: 1.5 })] }, 'invalid_sort_order'],
  ];
  for (const [body, error] of cases) {
    const v = validateNavConfig(body);
    assert.equal(v.ok, false);
    assert.equal(v.error, error);
  }
});

test('an empty module list is valid — it clears the configuration', () => {
  const v = validateNavConfig({ modules: [] });
  assert.ok(v.ok);
  assert.deepEqual(v.rows, []);
});

test('the server stores keys opaquely — it does not own the module registry', () => {
  // A key the client no longer renders is still accepted and stored; the client
  // resolver ignores unknown keys. This is what keeps "delete a module from
  // code" safe with rows still in the table.
  assert.ok(validateNavConfig({ modules: [row('some-future-module')] }).ok);
});

test('toClient sorts by sortOrder with a stable key tie-break', () => {
  const out = toClient([
    { key: 'b', inNav: true, railGroup: null, sortOrder: 1 },
    { key: 'a', inNav: true, railGroup: null, sortOrder: 1 },
    { key: 'c', inNav: false, railGroup: 'utility', sortOrder: 0 },
  ]);
  assert.deepEqual(out.map((r) => r.key), ['c', 'a', 'b']);
});
