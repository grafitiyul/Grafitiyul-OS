import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTourWoo, occurrenceClosed } from './syncWorker.js';
import { META_TOUREVENT_ID, META_CARD_GROUP_ID, META_VARIANT_KEY } from './desiredState.js';

// GOS→Woo reconciler with in-memory fakes for `db` and the `woo` client. Covers
// BOTH models: the legacy single-variation local-attribute path, and the LIVE
// global-taxonomy model where one occurrence yields adult + child age variations
// (each at its own price) split by activity, with term-ensure, mapping-change
// safety, retirement of dropped variants, and partial-failure retryability.

// A full global config matching the live Tel Aviv (#167) structure.
const TT_ADULT = 'tt_adult';
const TT_CHILD = 'tt_child';
const GLOBAL_CONFIG = {
  taxonomyMode: 'global',
  date: { attrId: 1, attrName: 'pa_תאריך', format: 'slash-dmy' },
  time: { attrId: 2, attrName: 'pa_שעה' },
  activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-בלבד', label: 'סיור בלבד' },
  age: { attrId: 5, attrName: 'pa_גיל' },
  ticketAge: { [TT_ADULT]: { option: 'מבוגר' }, [TT_CHILD]: { option: 'ילד' } },
};

function makeEnv(opts = {}) {
  const {
    tour = {
      id: 'slot1',
      status: 'scheduled',
      date: '2026-08-08',
      startTime: '10:00',
      capacity: 20,
      openTourTemplateId: 'tpl1',
      updatedAt: 'u1',
      wooSyncStatus: 'pending',
      wooAttempts: 0,
    },
    templateProducts = [{ cardGroupId: 'cardA' }],
    mappings = [{ cardGroupId: 'cardA', wooProductId: 101, dateAttribute: null, config: null, active: true }],
    // legacy: single ticket type per card; global: adult+child rows.
    ticketsByCard = { cardA: [{ ticketTypeId: 'tt1', priceMinor: 4500, nameHe: 'מבוגר', sortOrder: 0 }] },
    activeSeats = 0,
    links = {},
    variationsByProduct = {},
    products = {},
    attributeTerms = {},
    registrationCloseMinutes = null,
    failProductIds = [],
  } = opts;

  const calls = {
    created: [],
    updated: [],
    createdTerms: [],
    productUpdates: [],
    tourUpdates: [],
    linkUpserts: [],
    linkUpdateManys: [],
  };
  const linkStore = { ...links };
  const keyOf = (w) => `${w.tourEventId}::${w.cardGroupId}::${w.variantKey}`;

  const db = {
    tourEvent: {
      findUnique: async ({ where }) => (where.id === tour.id ? { ...tour } : null),
      updateMany: async ({ where, data }) => {
        if (where.updatedAt && where.updatedAt !== tour.updatedAt) return { count: 0 };
        calls.tourUpdates.push(data);
        return { count: 1 };
      },
    },
    openTourTemplate: { findUnique: async () => ({ registrationCloseMinutes }) },
    openTourTemplateProduct: { findMany: async () => templateProducts },
    wooProductMapping: {
      findMany: async ({ where }) =>
        mappings.filter((m) => m.active && where.cardGroupId.in.includes(m.cardGroupId)),
    },
    priceRule: {
      findFirst: async ({ where }) => {
        const rows = ticketsByCard[where.cardGroupId];
        if (!rows || !rows.length) return null;
        return {
          priceModel: 'ticket_types',
          ticketPrices: rows.map((r) => ({
            ticketTypeId: r.ticketTypeId,
            priceMinor: r.priceMinor,
            ticketType: { nameHe: r.nameHe, sortOrder: r.sortOrder },
          })),
        };
      },
    },
    ticketRegistration: {
      groupBy: async () => (activeSeats ? [{ tourEventId: tour.id, _sum: { quantity: activeSeats } }] : []),
    },
    booking: { groupBy: async () => [] },
    wooVariationLink: {
      findUnique: async ({ where }) => linkStore[keyOf(where.tourEventId_cardGroupId_variantKey)] || null,
      findMany: async ({ where }) =>
        Object.values(linkStore).filter(
          (l) => l.tourEventId === where.tourEventId && l.cardGroupId === where.cardGroupId,
        ),
      upsert: async ({ where, create, update }) => {
        const k = keyOf(where.tourEventId_cardGroupId_variantKey);
        const row = linkStore[k] ? { ...linkStore[k], ...update } : { ...create };
        linkStore[k] = row;
        calls.linkUpserts.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        calls.linkUpdateManys.push({ where, data });
        let count = 0;
        for (const [k, l] of Object.entries(linkStore)) {
          if (l.tourEventId !== where.tourEventId || l.cardGroupId !== where.cardGroupId) continue;
          if (where.variantKey && l.variantKey !== where.variantKey) continue;
          linkStore[k] = { ...l, ...data };
          count += 1;
        }
        return { count };
      },
    },
  };

  const woo = {
    listVariations: async (productId) => variationsByProduct[productId] || [],
    createVariation: async (productId, data) => {
      if (failProductIds.includes(productId)) throw new Error(`woo down for ${productId}`);
      calls.created.push({ productId, data });
      return { id: 900 + calls.created.length };
    },
    updateVariation: async (productId, variationId, data) => {
      if (failProductIds.includes(productId)) throw new Error(`woo down for ${productId}`);
      calls.updated.push({ productId, variationId, data });
      return { id: variationId };
    },
    listAttributeTerms: async (attrId) => attributeTerms[attrId] || [],
    createAttributeTerm: async (attrId, data) => {
      calls.createdTerms.push({ attrId, ...data });
      return { id: 5000 + calls.createdTerms.length, ...data };
    },
    getProduct: async (productId) => products[productId] || { id: productId, attributes: [] },
    updateProduct: async (productId, data) => {
      calls.productUpdates.push({ productId, data });
      return { id: productId, ...data };
    },
  };

  return { db, woo, calls, linkStore };
}

const meta = (data, key) => (data.meta_data.find((m) => m.key === key) || {}).value;
const deps = (env, now = 0) => ({ db: env.db, woo: env.woo, now });

// ── Legacy single-variation (local attribute) ────────────────────────────────

test('legacy: first sync creates one local-attribute variation with GOS meta', async () => {
  const env = makeEnv();
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 1);
  const { productId, data } = env.calls.created[0];
  assert.equal(productId, 101);
  assert.equal(data.regular_price, '45.00');
  assert.deepEqual(data.attributes, [{ name: 'Date', option: '08.08.2026 10:00' }]);
  assert.equal(meta(data, META_CARD_GROUP_ID), 'cardA');
  assert.equal(env.linkStore['slot1::cardA::default'].wooVariationId, 901);
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'synced');
});

test('legacy: repeat sync UPDATES the linked variation — no duplicate', async () => {
  const env = makeEnv({
    links: { 'slot1::cardA::default': { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: 'default', wooVariationId: 555, wooProductId: 101 } },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated.length, 1);
  assert.equal(env.calls.updated[0].variationId, 555);
});

test('legacy: multiple cards share ONE canonical capacity', async () => {
  const env = makeEnv({
    activeSeats: 5,
    templateProducts: [{ cardGroupId: 'cardA' }, { cardGroupId: 'cardB' }],
    mappings: [
      { cardGroupId: 'cardA', wooProductId: 101, active: true },
      { cardGroupId: 'cardB', wooProductId: 102, active: true },
    ],
    ticketsByCard: {
      cardA: [{ ticketTypeId: 'tt1', priceMinor: 4500, nameHe: 'מבוגר', sortOrder: 0 }],
      cardB: [{ ticketTypeId: 'tt2', priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 }],
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 2);
  assert.ok(env.calls.created.every((c) => c.data.stock_quantity === 15));
});

test('a card with 2 ticket types but NO config is a failure (no first-price collapse)', async () => {
  const env = makeEnv({
    ticketsByCard: {
      cardA: [
        { ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 3000, nameHe: 'ילד', sortOrder: 1 },
      ],
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'pending'); // retryable, not synced
  assert.match(env.calls.tourUpdates.at(-1).wooSyncError, /ticket types but no Woo config/);
});

test('a tour with no mapped sellable card is parked as skipped', async () => {
  const env = makeEnv({ mappings: [] });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'skipped');
});

// ── Global taxonomy, age × activity ──────────────────────────────────────────

function globalEnv(extra = {}) {
  return makeEnv({
    mappings: [{ cardGroupId: 'cardA', wooProductId: 167, config: GLOBAL_CONFIG, active: true }],
    ticketsByCard: {
      cardA: [
        { ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 3000, nameHe: 'ילד', sortOrder: 1 },
      ],
    },
    ...extra,
  });
}

test('global: one occurrence → adult + child variations, each at its OWN price', async () => {
  const env = globalEnv();
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 2);
  const byVariant = Object.fromEntries(env.calls.created.map((c) => [meta(c.data, META_VARIANT_KEY), c.data]));
  assert.equal(byVariant[TT_ADULT].regular_price, '60.00');
  assert.equal(byVariant[TT_CHILD].regular_price, '30.00');
  // Both reference the date/time/activity/age global attributes by id.
  const attrs = Object.fromEntries(byVariant[TT_ADULT].attributes.map((a) => [a.id, a.option]));
  assert.equal(attrs[1], '08-08-2026');
  assert.equal(attrs[2], '1000');
  assert.equal(attrs[3], 'סיור-בלבד');
  assert.equal(attrs[5], 'מבוגר');
  // Two links, one per age.
  assert.equal(env.linkStore['slot1::cardA::' + TT_ADULT].wooVariationId, 901);
  assert.equal(env.linkStore['slot1::cardA::' + TT_CHILD].wooVariationId, 902);
});

test('global: ensures the date term + attaches it to the product options', async () => {
  const env = globalEnv({
    attributeTerms: {
      1: [], // no date terms yet → must be created
      2: [{ name: '10:00', slug: '1000' }], // time term already exists
    },
    products: { 167: { id: 167, attributes: [{ id: 1, name: 'pa_תאריך', options: ['01/07/2026'] }] } },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.createdTerms.length, 1);
  assert.deepEqual(env.calls.createdTerms[0], { attrId: 1, name: '08/08/2026', slug: '08-08-2026' });
  // Date term appended to the product's attribute options (name form).
  assert.equal(env.calls.productUpdates.length, 1);
  const opts = env.calls.productUpdates[0].data.attributes[0].options;
  assert.deepEqual(opts, ['01/07/2026', '08/08/2026']);
});

test('global: repeat sync updates both variations — no duplicates', async () => {
  const env = globalEnv({
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167 },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.deepEqual(env.calls.updated.map((u) => u.variationId).sort(), [111, 112]);
});

test('global: cancellation disables EVERY sibling variation (never deletes)', async () => {
  const env = globalEnv({
    tour: { id: 'slot1', status: 'cancelled', date: '2026-08-08', startTime: '10:00', capacity: 20, openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooAttempts: 0 },
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167 },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.updated.length, 2);
  assert.ok(env.calls.updated.every((u) => u.data.status === 'private' && u.data.stock_quantity === 0));
});

test('global: reopen (cancelled→scheduled) re-publishes the SAME variations', async () => {
  const env = globalEnv({
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167 },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.ok(env.calls.updated.every((u) => u.data.status === 'publish'));
  assert.deepEqual(env.calls.updated.map((u) => u.variationId).sort(), [111, 112]);
});

test('mapping change: old-product variations DISABLED, new-product created; old never deleted', async () => {
  // Links currently point at product 167; mapping now says 170.
  const env = globalEnv({
    mappings: [{ cardGroupId: 'cardA', wooProductId: 170, config: GLOBAL_CONFIG, active: true }],
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167 },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  // Old product 167 variations disabled in place (updates, not deletes).
  const disabled = env.calls.updated.filter((u) => u.productId === 167);
  assert.equal(disabled.length, 2);
  assert.ok(disabled.every((u) => u.data.status === 'private' && u.data.stock_quantity === 0));
  // New product 170 gets fresh variations.
  assert.equal(env.calls.created.filter((c) => c.productId === 170).length, 2);
  // Links now point at the new product.
  assert.equal(env.linkStore['slot1::cardA::' + TT_ADULT].wooProductId, 170);
});

test('dropped ticket type: its stale variation is retired (disabled), never deleted', async () => {
  // Card now sells adults only, but a child link survives from before.
  const env = globalEnv({
    ticketsByCard: { cardA: [{ ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 }] },
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167, status: 'synced' },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167, status: 'synced' },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  // Child variation 112 disabled; link marked disabled.
  const childDisable = env.calls.updated.find((u) => u.variationId === 112);
  assert.ok(childDisable && childDisable.data.status === 'private');
  assert.equal(env.linkStore['slot1::cardA::' + TT_CHILD].status, 'disabled');
});

test('partial failure: one variation errors → tour stays pending (retryable), not synced', async () => {
  const env = globalEnv({ failProductIds: [167] });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'pending');
  assert.ok(env.calls.tourUpdates.at(-1).wooNextRetryAt); // backoff scheduled
});

// TWO cards on the SAME product (#167), distinguished only by pa_פעילות, sharing
// the SAME ticket type ids (מבוגר/ילד) → 4 distinct variations, no cross-clobber.
const CONFIG_WS = { ...GLOBAL_CONFIG, activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-סדנה' } };
const CONFIG_TOUR = { ...GLOBAL_CONFIG, activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-בלבד' } };
const TWO_CARDS = {
  templateProducts: [{ cardGroupId: 'cardWs' }, { cardGroupId: 'cardTour' }],
  mappings: [
    { cardGroupId: 'cardWs', wooProductId: 167, config: CONFIG_WS, active: true },
    { cardGroupId: 'cardTour', wooProductId: 167, config: CONFIG_TOUR, active: true },
  ],
  ticketsByCard: {
    cardWs: [
      { ticketTypeId: TT_ADULT, priceMinor: 25000, nameHe: 'מבוגר', sortOrder: 0 },
      { ticketTypeId: TT_CHILD, priceMinor: 20000, nameHe: 'ילד', sortOrder: 1 },
    ],
    cardTour: [
      { ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 },
      { ticketTypeId: TT_CHILD, priceMinor: 3000, nameHe: 'ילד', sortOrder: 1 },
    ],
  },
};

test('two cards, one product, shared ticket ids → 4 DISTINCT variations', async () => {
  const env = makeEnv(TWO_CARDS);
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 4);
  // 4 distinct (activity, age) combos on the one product.
  const combos = env.calls.created.map((c) => {
    const a = Object.fromEntries(c.data.attributes.map((x) => [x.id, x.option]));
    return `${a[3]}|${a[5]}`;
  });
  assert.deepEqual([...new Set(combos)].sort(), ['סיור-בלבד|ילד', 'סיור-בלבד|מבוגר', 'סיור-סדנה|ילד', 'סיור-סדנה|מבוגר']);
  // 4 distinct links keyed by (card, variantKey).
  assert.equal(Object.keys(env.linkStore).length, 4);
});

test('adding the tour-only card when workshop is ALREADY synced does not clobber it', async () => {
  // Product 167 already holds the two workshop variations with our meta + links.
  const wsVar = (id, age) => ({
    id,
    attributes: [{ id: 3, option: 'סיור-סדנה' }, { id: 5, option: age === TT_ADULT ? 'מבוגר' : 'ילד' }],
    meta_data: [
      { key: META_TOUREVENT_ID, value: 'slot1' },
      { key: META_CARD_GROUP_ID, value: 'cardWs' },
      { key: META_VARIANT_KEY, value: age },
    ],
  });
  const env = makeEnv({
    ...TWO_CARDS,
    variationsByProduct: { 167: [wsVar(111, TT_ADULT), wsVar(112, TT_CHILD)] },
    links: {
      ['slot1::cardWs::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardWs', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167, status: 'synced' },
      ['slot1::cardWs::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardWs', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167, status: 'synced' },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  // Workshop links → UPDATE 111/112 (never re-created). Tour-only → 2 CREATES,
  // NOT adopting the workshop variations despite the shared ticket ids.
  assert.deepEqual(env.calls.updated.map((u) => u.variationId).sort(), [111, 112]);
  assert.equal(env.calls.created.length, 2);
  assert.ok(env.calls.created.every((c) => c.data.attributes.find((a) => a.id === 3).option === 'סיור-בלבד'));
  assert.ok(env.calls.created.every((c) => ![111, 112].includes(c.data.__id)));
});

// ── Duration (pa_משך) from the operational product ───────────────────────────
const CONFIG_DUR = { ...GLOBAL_CONFIG, duration: { attrId: 4, attrName: 'pa_משך', map: { '2': 'שעתיים', '2.5': 'שעתיים-וחצי' } } };
function durEnv(hours, extra = {}) {
  return makeEnv({
    tour: { id: 'slot1', status: 'scheduled', date: '2026-08-08', startTime: '10:00', capacity: 20, openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooAttempts: 0, productVariant: { durationHours: hours } },
    mappings: [{ cardGroupId: 'cardA', wooProductId: 167, config: CONFIG_DUR, active: true }],
    ticketsByCard: {
      cardA: [
        { ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 3000, nameHe: 'ילד', sortOrder: 1 },
      ],
    },
    attributeTerms: { 4: [{ name: 'שעתיים' }, { name: 'שעתיים וחצי' }] },
    ...extra,
  });
}
const durOf = (data) => data.attributes.find((a) => a.id === 4)?.option;

test('duration synced to pa_משך from the operational product', async () => {
  const env = durEnv(2);
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 2);
  assert.ok(env.calls.created.every((c) => durOf(c.data) === 'שעתיים'));
});

test('operational product change (plain→workshop) updates duration IN PLACE, no dup', async () => {
  const env = durEnv(2.5, {
    links: {
      ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 },
      ['slot1::cardA::' + TT_CHILD]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_CHILD, wooVariationId: 112, wooProductId: 167 },
    },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.ok(env.calls.updated.every((u) => durOf(u.data) === 'שעתיים-וחצי'));
});

test('revert to plain updates duration back', async () => {
  const env = durEnv(2, {
    links: { ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167 } },
    ticketsByCard: { cardA: [{ ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 }] },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.ok(env.calls.updated.every((u) => durOf(u.data) === 'שעתיים'));
});

test('missing duration mapping → tour stays pending (retryable), not synced', async () => {
  const env = durEnv(4); // 4h not in the map
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'pending');
  assert.match(env.calls.tourUpdates.at(-1).wooSyncError, /pa_משך|duration/);
});

// ── Cutoff helper ────────────────────────────────────────────────────────────

test('occurrenceClosed respects the close cutoff', () => {
  const cutoffMs = Date.parse('2026-08-08T05:00:00Z');
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs - 60_000), false);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs + 60_000), true);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', null, cutoffMs + 1e9), false);
});
