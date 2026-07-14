import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateMenuOrder,
  timeMenuOrder,
  deriveAttributeOptions,
  managedAttrsFromConfigs,
  reconcileProductOptions,
} from './productOptions.js';

// Public-selector truth + chronological ordering. Pure derivation is tested
// directly; the reconcile is tested over fakes for db + the Woo client.

// ── Chronological keys ────────────────────────────────────────────────────────

test('dateMenuOrder parses dd/mm/yyyy and dd-mm-yyyy chronologically (not lexicographically)', () => {
  assert.equal(dateMenuOrder('15/07/2026'), 20260715);
  assert.equal(dateMenuOrder('15-07-2026'), 20260715);
  // Lexicographic order of these strings is 01/08 < 15/07 — chronological is not.
  assert.ok(dateMenuOrder('15/07/2026') < dateMenuOrder('01/08/2026'));
  assert.ok(dateMenuOrder('17/07/2026') < dateMenuOrder('01/08/2026'));
  // Cross-year: December 2026 before January 2027.
  assert.ok(dateMenuOrder('31/12/2026') < dateMenuOrder('01/01/2027'));
  assert.equal(dateMenuOrder('not a date'), null);
  assert.equal(dateMenuOrder(''), null);
});

test('timeMenuOrder parses HH:MM and HHMM', () => {
  assert.equal(timeMenuOrder('07:00'), 700);
  assert.equal(timeMenuOrder('1800'), 1800);
  assert.equal(timeMenuOrder('10:45'), 1045);
  assert.ok(timeMenuOrder('09:00') < timeMenuOrder('10:30'));
  assert.equal(timeMenuOrder('99:99'), null);
  assert.equal(timeMenuOrder('שעה'), null);
});

// ── Option derivation ─────────────────────────────────────────────────────────

const DATE_TERMS = [
  { id: 1, name: '15/07/2026', slug: '15-07-2026', menu_order: 0 },
  { id: 2, name: '16/07/2026', slug: '16-07-2026', menu_order: 0 },
  { id: 3, name: '17/07/2026', slug: '17-07-2026', menu_order: 0 },
  { id: 4, name: '01/08/2026', slug: '01-08-2026', menu_order: 0 },
  { id: 5, name: '05/01/2027', slug: '05-01-2027', menu_order: 0 },
];

test('cancelled occurrence: its date is removed when no published variation uses it', () => {
  const { options, removed } = deriveAttributeOptions({
    options: ['15/07/2026', '16/07/2026', '17/07/2026'],
    terms: DATE_TERMS,
    used: new Set(['15-07-2026', '17-07-2026']), // 16/07 only on private variations
    kind: 'date',
  });
  assert.deepEqual(options, ['15/07/2026', '17/07/2026']);
  assert.deepEqual(removed, ['16/07/2026']);
});

test('shared date: kept while at least one published variation still uses it', () => {
  const { options, removed } = deriveAttributeOptions({
    options: ['17/07/2026'],
    terms: DATE_TERMS,
    used: new Set(['17-07-2026']), // sibling occurrence on the same date still live
    kind: 'date',
  });
  assert.deepEqual(options, ['17/07/2026']);
  assert.deepEqual(removed, []);
});

test('never ADDS options — a published variation with an excluded date stays excluded', () => {
  const { options } = deriveAttributeOptions({
    options: ['15/07/2026'],
    terms: DATE_TERMS,
    used: new Set(['15-07-2026', '01-08-2026']), // 01/08 used but store excluded it
    kind: 'date',
  });
  assert.deepEqual(options, ['15/07/2026']);
});

test('date options are sorted chronologically across months and years', () => {
  const { options } = deriveAttributeOptions({
    options: ['01/08/2026', '05/01/2027', '15/07/2026', '17/07/2026'],
    terms: DATE_TERMS,
    used: new Set(['15-07-2026', '17-07-2026', '01-08-2026', '05-01-2027']),
    kind: 'date',
  });
  assert.deepEqual(options, ['15/07/2026', '17/07/2026', '01/08/2026', '05/01/2027']);
});

test('time options are sorted chronologically', () => {
  const terms = [
    { id: 1, name: '18:00', slug: '1800' },
    { id: 2, name: '09:00', slug: '0900' },
    { id: 3, name: '10:45', slug: '1045' },
  ];
  const { options } = deriveAttributeOptions({
    options: ['18:00', '09:00', '10:45'],
    terms,
    used: new Set(['1800', '0900', '1045']),
    kind: 'time',
  });
  assert.deepEqual(options, ['09:00', '10:45', '18:00']);
});

test('an option with no matching term and no usage is KEPT (never drop the unexplained)', () => {
  const { options } = deriveAttributeOptions({
    options: ['15/07/2026', 'מסתורי'],
    terms: DATE_TERMS,
    used: new Set(['15-07-2026']),
    kind: 'date',
  });
  assert.ok(options.includes('מסתורי')); // unattributable → kept (sorted last)
  assert.equal(options[0], '15/07/2026');
});

test('percent-encoded Hebrew slugs match their decoded variation options', () => {
  const terms = [{ id: 9, name: 'שעה וחצי', slug: '%d7%a9%d7%a2%d7%94-%d7%95%d7%97%d7%a6%d7%99' }];
  const { options } = deriveAttributeOptions({
    options: ['שעה וחצי'],
    terms,
    used: new Set(['שעה-וחצי']), // variations carry the decoded slug
    kind: 'other',
  });
  assert.deepEqual(options, ['שעה וחצי']);
});

test('managedAttrsFromConfigs unions all config nodes with ordering kinds', () => {
  const managed = managedAttrsFromConfigs([
    { date: { attrId: 1 }, time: { attrId: 2 }, activity: { attrId: 3 }, age: { attrId: 5 }, duration: { attrId: 4 } },
    { date: { attrId: 1 }, activity: { attrId: 3 } }, // second card, same product
    null,
  ]);
  assert.deepEqual(
    managed.map((m) => `${m.attrId}:${m.kind}`).sort(),
    ['1:date', '2:time', '3:other', '4:other', '5:other'],
  );
});

// ── Reconcile over fakes ──────────────────────────────────────────────────────

const CONFIG = {
  date: { attrId: 1, attrName: 'תאריך' },
  time: { attrId: 2, attrName: 'שעה' },
  activity: { attrId: 3, attrName: 'פעילות' },
  age: { attrId: 5, attrName: 'גיל' },
  duration: { attrId: 4, attrName: 'משך' },
};

function makeEnv({ productAttrs, variations, termsByAttr }) {
  const productUpdates = [];
  const termUpdates = [];
  const db = {
    wooProductMapping: { findMany: async () => [{ cardGroupId: 'cardA', wooProductId: 167, active: true, config: CONFIG }] },
  };
  const woo = {
    getProduct: async () => ({ id: 167, attributes: productAttrs }),
    listVariations: async () => variations,
    listAttributeTerms: async (attrId) => termsByAttr[attrId] || [],
    updateProduct: async (id, data) => { productUpdates.push({ id, data }); return { id, ...data }; },
    updateAttributeTerm: async (attrId, termId, data) => { termUpdates.push({ attrId, termId, ...data }); return { id: termId }; },
  };
  return { db, woo, productUpdates, termUpdates };
}

const varOf = (status, date, time) => ({
  status,
  attributes: [
    { id: 1, option: date },
    { id: 2, option: time },
    { id: 3, option: 'סיור-בלבד' },
    { id: 5, option: 'מבוגר' },
  ],
});

test('reconcile: cancelled date dropped from product options, chronological order, terms get menu_order', async () => {
  const env = makeEnv({
    productAttrs: [
      { id: 1, name: 'תאריך', options: ['01/08/2026', '15/07/2026', '16/07/2026'] },
      { id: 2, name: 'שעה', options: ['18:00', '09:00'] },
      { id: 3, name: 'פעילות', options: ['סיור בלבד'] },
      { id: 99, name: 'לא-מנוהל', options: ['x'] }, // not GOS-managed → untouched
    ],
    variations: [
      varOf('publish', '15-07-2026', '1800'),
      varOf('publish', '01-08-2026', '0900'),
      varOf('private', '16-07-2026', '1800'), // cancelled → hidden
    ],
    termsByAttr: {
      1: [
        { id: 11, name: '15/07/2026', slug: '15-07-2026', menu_order: 0 },
        { id: 12, name: '16/07/2026', slug: '16-07-2026', menu_order: 0 },
        { id: 13, name: '01/08/2026', slug: '01-08-2026', menu_order: 20260801 }, // already correct
      ],
      2: [
        { id: 21, name: '18:00', slug: '1800', menu_order: 0 },
        { id: 22, name: '09:00', slug: '0900', menu_order: 900 }, // already correct
      ],
      3: [{ id: 31, name: 'סיור בלבד', slug: 'סיור-בלבד', menu_order: 0 }],
    },
  });
  const res = await reconcileProductOptions({ ...env, log: null }, 167);
  assert.equal(res.changed, true);
  assert.deepEqual(res.removed[1], ['16/07/2026']);
  assert.equal(env.productUpdates.length, 1);
  const attrs = env.productUpdates[0].data.attributes;
  assert.deepEqual(attrs.find((a) => a.id === 1).options, ['15/07/2026', '01/08/2026']); // chronological
  assert.deepEqual(attrs.find((a) => a.id === 2).options, ['09:00', '18:00']);
  assert.deepEqual(attrs.find((a) => a.id === 99).options, ['x']); // unmanaged untouched
  // Only mismatched terms get menu_order writes (idempotent).
  assert.deepEqual(
    env.termUpdates.map((u) => `${u.attrId}:${u.termId}:${u.menu_order}`).sort(),
    ['1:11:20260715', '1:12:20260716', '2:21:1800'],
  );
});

test('reconcile: no-op when options already truthful and ordered (idempotent)', async () => {
  const env = makeEnv({
    productAttrs: [{ id: 1, name: 'תאריך', options: ['15/07/2026'] }],
    variations: [varOf('publish', '15-07-2026', '1800')],
    termsByAttr: { 1: [{ id: 11, name: '15/07/2026', slug: '15-07-2026', menu_order: 20260715 }] },
  });
  const res = await reconcileProductOptions({ ...env, log: null }, 167);
  assert.equal(res.changed, false);
  assert.equal(env.productUpdates.length, 0);
  assert.equal(env.termUpdates.length, 0);
});

test('reconcile: a LEGACY published variation keeps its options alive (not GOS-managed rows preserved)', async () => {
  const env = makeEnv({
    productAttrs: [{ id: 1, name: 'תאריך', options: ['15/07/2026', '01/06/2026'] }],
    variations: [
      varOf('private', '15-07-2026', '1800'), // GOS variation hidden
      varOf('publish', '01-06-2026', '0700'), // legacy variation still published
    ],
    termsByAttr: {
      1: [
        { id: 11, name: '15/07/2026', slug: '15-07-2026', menu_order: 20260715 },
        { id: 14, name: '01/06/2026', slug: '01-06-2026', menu_order: 20260601 },
      ],
    },
  });
  const res = await reconcileProductOptions({ ...env, log: null }, 167);
  assert.deepEqual(res.removed[1], ['15/07/2026']);
  assert.deepEqual(env.productUpdates[0].data.attributes.find((a) => a.id === 1).options, ['01/06/2026']);
});

test('reconcile: product without GOS mapping is untouched', async () => {
  const env = makeEnv({ productAttrs: [], variations: [], termsByAttr: {} });
  env.db.wooProductMapping.findMany = async () => [];
  const res = await reconcileProductOptions({ ...env, log: null }, 999);
  assert.equal(res.changed, false);
  assert.equal(env.productUpdates.length, 0);
});

test('reconcile: ALL dates cancelled → date options empty (nothing purchasable remains)', async () => {
  const env = makeEnv({
    productAttrs: [{ id: 1, name: 'תאריך', options: ['15/07/2026'] }],
    variations: [varOf('private', '15-07-2026', '1800')],
    termsByAttr: { 1: [{ id: 11, name: '15/07/2026', slug: '15-07-2026', menu_order: 20260715 }] },
  });
  const res = await reconcileProductOptions({ ...env, log: null }, 167);
  assert.equal(res.changed, true);
  assert.deepEqual(env.productUpdates[0].data.attributes.find((a) => a.id === 1).options, []);
});
