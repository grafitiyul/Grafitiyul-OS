import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setAudienceDefault,
  clearAudienceDefault,
  getAudienceDefault,
  audienceSupportsDefault,
  activePatch,
  DEFAULTABLE_AUDIENCES,
  TemplateDefaultError,
} from './templateDefaults.js';

// A tiny in-memory WhatsAppTemplate table with just the operations this module
// uses. It enforces NOTHING on its own, so every invariant asserted below is
// the module's doing — a fake that also enforced "one default" would prove
// nothing.
function fakeDb(rows) {
  const store = rows.map((r) => ({ audience: 'guide', isActive: true, isAudienceDefault: false, sendAccountId: null, ...r }));
  const find = (id) => store.find((r) => r.id === id) || null;
  const matches = (r, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in v) return r[k] !== v.not;
    return r[k] === v;
  });
  const db = {
    store,
    whatsAppTemplate: {
      findUnique: async ({ where }) => find(where.id),
      findFirst: async ({ where }) => store.find((r) => matches(r, where)) || null,
      update: async ({ where, data }) => Object.assign(find(where.id), data),
      updateMany: async ({ where, data }) => {
        const hit = store.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

const ids = (db) => db.store.filter((r) => r.isAudienceDefault).map((r) => r.id);

test('the audience default is a GUIDE concept for now, stated explicitly', () => {
  assert.deepEqual(DEFAULTABLE_AUDIENCES, ['guide']);
  assert.equal(audienceSupportsDefault('guide'), true);
  assert.equal(audienceSupportsDefault('customer'), false);
  assert.equal(audienceSupportsDefault(undefined), false);
});

test('setting a default clears the previous one — never two at once', async () => {
  const db = fakeDb([{ id: 'a', isAudienceDefault: true }, { id: 'b' }, { id: 'c' }]);
  await setAudienceDefault(db, 'b');
  assert.deepEqual(ids(db), ['b'], 'A lost the star the moment B got it');
  await setAudienceDefault(db, 'c');
  assert.deepEqual(ids(db), ['c']);
});

test('setting the default NEVER touches another audience', async () => {
  const db = fakeDb([
    { id: 'cust', audience: 'customer', isAudienceDefault: true },
    { id: 'g1', audience: 'guide' },
  ]);
  await setAudienceDefault(db, 'g1');
  assert.deepEqual(ids(db).sort(), ['cust', 'g1'], 'each audience keeps its own');
});

test('a customer template cannot hold the composer default', async () => {
  const db = fakeDb([{ id: 'c1', audience: 'customer' }]);
  await assert.rejects(() => setAudienceDefault(db, 'c1'), (e) => e instanceof TemplateDefaultError && e.code === 'wrong_audience');
  assert.deepEqual(ids(db), []);
});

test('an INACTIVE template is refused loudly, not silently activated', async () => {
  const db = fakeDb([{ id: 'a', isActive: false }]);
  await assert.rejects(() => setAudienceDefault(db, 'a'), (e) => e.code === 'template_inactive');
  assert.equal(db.store[0].isActive, false, 'and it was not turned back on');
});

test('a missing template is a 404-shaped error', async () => {
  await assert.rejects(() => setAudienceDefault(fakeDb([]), 'nope'), (e) => e.code === 'not_found');
});

test('clearing is scoped to ONE template — stale screen state cannot clear another', async () => {
  const db = fakeDb([{ id: 'a', isAudienceDefault: true }, { id: 'b' }]);
  await clearAudienceDefault(db, 'b');
  assert.deepEqual(ids(db), ['a'], "clearing B did not touch A's star");
  await clearAudienceDefault(db, 'a');
  assert.deepEqual(ids(db), [], 'zero defaults is a valid state');
});

test('deactivating the default drops it in the SAME write', () => {
  assert.deepEqual(activePatch(false), { isActive: false, isAudienceDefault: false });
  assert.deepEqual(activePatch(true), { isActive: true }, 'reactivating never re-stars');
});

test('getAudienceDefault ignores an inactive row even if the flag survived', async () => {
  const db = fakeDb([{ id: 'a', isAudienceDefault: true, isActive: false }]);
  assert.equal(await getAudienceDefault(db, 'guide'), null);
  db.store[0].isActive = true;
  assert.equal((await getAudienceDefault(db, 'guide'))?.id, 'a');
  assert.equal(await getAudienceDefault(db, 'customer'), null, 'customer has no composer default');
});

// The sending account used to live here. It moved to the FLOW settings
// (whatsapp/guideMessageSettings.js) on the owner's decision that "which number
// do we write to guides from" is one office-wide answer, not one per wording.
// Its rules are tested there.
