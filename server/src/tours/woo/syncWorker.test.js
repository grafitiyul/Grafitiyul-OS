import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTourWoo, occurrenceClosed, sweepWooRevisionDrift } from './syncWorker.js';
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
    // Default origin 'explicit': most tests exercise the converge paths, which
    // presume the occurrence's publication was approved. The first-publication
    // gate tests override the origin (and the env flag) explicitly.
    tour = {
      id: 'slot1',
      status: 'scheduled',
      date: '2026-08-08',
      startTime: '10:00',
      capacity: 20,
      openTourTemplateId: 'tpl1',
      updatedAt: 'u1',
      wooSyncStatus: 'pending',
      wooSyncOrigin: 'explicit',
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
      count: async ({ where }) =>
        Object.values(linkStore).filter((l) => l.tourEventId === where.tourEventId).length,
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
  // New terms are created WITH a chronological menu_order (yyyymmdd) so the
  // storefront selector lists them in real date order.
  assert.deepEqual(env.calls.createdTerms[0], { attrId: 1, name: '08/08/2026', slug: '08-08-2026', menu_order: 20260808 });
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
  assert.ok(env.calls.updated.every((u) => u.data.status === 'draft' && u.data.stock_quantity === 0));
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
  assert.ok(disabled.every((u) => u.data.status === 'draft' && u.data.stock_quantity === 0));
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
  assert.ok(childDisable && childDisable.data.status === 'draft');
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

// ── Duration (pa_משך) — PER SELLABLE CARD, from the card's own product variant ─
const CONFIG_DUR = { ...GLOBAL_CONFIG, duration: { attrId: 4, attrName: 'pa_משך', map: { '1.5': 'שעה-וחצי', '2': 'שעתיים', '2.5': 'שעתיים-וחצי' } } };
function durEnv(hours, extra = {}) {
  return makeEnv({
    // The card's canonical customer-facing duration lives on the card's own
    // offered product variant — NOT on the tour's operational product.
    templateProducts: [{ cardGroupId: 'cardA', productVariant: { durationHours: hours } }],
    mappings: [{ cardGroupId: 'cardA', wooProductId: 167, config: CONFIG_DUR, active: true }],
    ticketsByCard: {
      cardA: [
        { ticketTypeId: TT_ADULT, priceMinor: 6000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 3000, nameHe: 'ילד', sortOrder: 1 },
      ],
    },
    attributeTerms: { 4: [{ name: 'שעה וחצי' }, { name: 'שעתיים' }, { name: 'שעתיים וחצי' }] },
    ...extra,
  });
}
const durOf = (data) => data.attributes.find((a) => a.id === 4)?.option;

test('duration synced to pa_משך from the CARD\'s product variant', async () => {
  const env = durEnv(2);
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 2);
  assert.ok(env.calls.created.every((c) => durOf(c.data) === 'שעתיים'));
});

test('card duration change updates its variations IN PLACE, no dup', async () => {
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

// THE live #167 shape: tour-only (1.5h) and tour+workshop (2.5h) cards on the
// SAME TourEvent → each card's variations carry ITS OWN pa_משך, side by side.
test('plain + workshop cards on one TourEvent get DIFFERENT durations per card', async () => {
  const env = makeEnv({
    templateProducts: [
      { cardGroupId: 'cardWs', productVariant: { durationHours: 2.5 } },
      { cardGroupId: 'cardTour', productVariant: { durationHours: 1.5 } },
    ],
    mappings: [
      { cardGroupId: 'cardWs', wooProductId: 167, config: { ...CONFIG_DUR, activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-סדנה' } }, active: true },
      { cardGroupId: 'cardTour', wooProductId: 167, config: { ...CONFIG_DUR, activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-בלבד' } }, active: true },
    ],
    ticketsByCard: {
      cardWs: [
        { ticketTypeId: TT_ADULT, priceMinor: 25000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 20000, nameHe: 'ילד', sortOrder: 1 },
      ],
      cardTour: [
        { ticketTypeId: TT_ADULT, priceMinor: 15000, nameHe: 'מבוגר', sortOrder: 0 },
        { ticketTypeId: TT_CHILD, priceMinor: 9000, nameHe: 'ילד', sortOrder: 1 },
      ],
    },
    attributeTerms: { 4: [{ name: 'שעה וחצי' }, { name: 'שעתיים וחצי' }] },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 4);
  const activityOf = (data) => data.attributes.find((a) => a.id === 3)?.option;
  for (const c of env.calls.created) {
    const expected = activityOf(c.data) === 'סיור-סדנה' ? 'שעתיים-וחצי' : 'שעה-וחצי';
    assert.equal(durOf(c.data), expected);
  }
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'synced');
});

// ── First-publication gate (WOO_SYNC_BULK_ENABLED) + provenance ──────────────

function withBulk(value, fn) {
  const prev = process.env.WOO_SYNC_BULK_ENABLED;
  if (value == null) delete process.env.WOO_SYNC_BULK_ENABLED;
  else process.env.WOO_SYNC_BULK_ENABLED = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.WOO_SYNC_BULK_ENABLED;
    else process.env.WOO_SYNC_BULK_ENABLED = prev;
  });
}
const tourWithOrigin = (origin) => ({
  id: 'slot1', status: 'scheduled', date: '2026-08-08', startTime: '10:00', capacity: 20,
  openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooAttempts: 0,
  ...(origin ? { wooSyncOrigin: origin } : {}),
});

test('bulk OFF: never-linked occurrence is BLOCKED (parked to null, nothing created)', async () => {
  await withBulk(null, async () => {
    for (const origin of [undefined, 'auto', 'bulk', 'maintenance']) {
      const env = makeEnv({ tour: tourWithOrigin(origin) });
      const res = await reconcileTourWoo(deps(env), 'slot1');
      assert.equal(res, 'blocked', `origin=${origin}`);
      assert.equal(env.calls.created.length, 0);
      assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, null);
      assert.match(env.calls.tourUpdates.at(-1).wooSyncError, /first_publication_blocked/);
    }
  });
});

test('bulk OFF: explicit sync-one still publishes a never-linked occurrence', async () => {
  await withBulk(null, async () => {
    const env = makeEnv({ tour: tourWithOrigin('explicit') });
    await reconcileTourWoo(deps(env), 'slot1');
    assert.equal(env.calls.created.length, 1);
    assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'synced');
    assert.equal(env.linkStore['slot1::cardA::default'].createdVia, 'sync_one');
  });
});

test('bulk OFF: an ALREADY-LINKED occurrence still updates (repair/cancel/reopen)', async () => {
  await withBulk(null, async () => {
    const env = makeEnv({
      tour: tourWithOrigin('auto'),
      links: { 'slot1::cardA::default': { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: 'default', wooVariationId: 555, wooProductId: 101 } },
    });
    await reconcileTourWoo(deps(env), 'slot1');
    assert.equal(env.calls.updated.length, 1);
    assert.equal(env.calls.updated[0].variationId, 555);
    assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'synced');
  });
});

test('bulk OFF: a maintenance-marked pending sweep CANNOT bulk-publish unlinked occurrences', async () => {
  await withBulk(null, async () => {
    const env = makeEnv({ tour: tourWithOrigin('maintenance') });
    const res = await reconcileTourWoo(deps(env), 'slot1');
    assert.equal(res, 'blocked');
    assert.equal(env.calls.created.length, 0);
  });
});

test('bulk ON: never-linked occurrence publishes; provenance recorded as bulk', async () => {
  await withBulk('true', async () => {
    const env = makeEnv({ tour: tourWithOrigin('bulk') });
    await reconcileTourWoo(deps(env), 'slot1');
    assert.equal(env.calls.created.length, 1);
    assert.equal(env.linkStore['slot1::cardA::default'].createdVia, 'bulk');
  });
});

test('adoption provenance: existing Woo variation matched by meta → createdVia adoption', async () => {
  const adoptable = {
    id: 777,
    attributes: [],
    meta_data: [
      { key: META_TOUREVENT_ID, value: 'slot1' },
      { key: META_CARD_GROUP_ID, value: 'cardA' },
      { key: META_VARIANT_KEY, value: 'default' },
    ],
  };
  const env = makeEnv({ variationsByProduct: { 101: [adoptable] } });
  await reconcileTourWoo(deps(env), 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated[0].variationId, 777);
  assert.equal(env.linkStore['slot1::cardA::default'].createdVia, 'adoption');
});

test('new variant on an already-linked occurrence (bulk off) is created as repair', async () => {
  await withBulk(null, async () => {
    // Adult already linked; the card now also sells child → sibling created as
    // repair of the linked occurrence, allowed while bulk is off.
    const env = globalEnv({
      tour: tourWithOrigin('auto'),
      links: {
        ['slot1::cardA::' + TT_ADULT]: { tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: TT_ADULT, wooVariationId: 111, wooProductId: 167, status: 'synced' },
      },
    });
    await reconcileTourWoo(deps(env), 'slot1');
    assert.equal(env.calls.created.length, 1);
    assert.equal(env.linkStore['slot1::cardA::' + TT_CHILD].createdVia, 'repair');
  });
});

// ── Canonical Woo desired-revision ───────────────────────────────────────────
import { wooPendingPatch } from './service.js';

test('wooPendingPatch bumps the desired revision (every dirty-marker gets it free)', () => {
  const p = wooPendingPatch();
  assert.equal(p.wooSyncStatus, 'pending');
  assert.deepEqual(p.wooDesiredRevision, { increment: 1 });
});

test('a successful sync records the revision it synced (wooSyncedRevision)', async () => {
  const env = makeEnv({
    tour: { id: 'slot1', status: 'scheduled', date: '2026-08-08', startTime: '10:00', capacity: 20, openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooSyncOrigin: 'explicit', wooAttempts: 0, wooDesiredRevision: 7 },
  });
  await reconcileTourWoo(deps(env), 'slot1');
  const done = env.calls.tourUpdates.at(-1);
  assert.equal(done.wooSyncStatus, 'synced');
  assert.equal(done.wooSyncedRevision, 7); // stamps the desired revision it synced
});

// ── Expiry sweep ─────────────────────────────────────────────────────────────
import { sweepUnsellableWooTours } from './syncWorker.js';

function expiryDb({ mappings = [{ cardGroupId: 'cardA', active: true }], templateProducts = [{ templateId: 'tpl1' }] } = {}) {
  const updates = [];
  return {
    updates,
    wooProductMapping: { findMany: async () => mappings.filter((m) => m.active) },
    openTourTemplateProduct: { findMany: async () => templateProducts },
    tourEvent: {
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        return { count: 3 };
      },
    },
  };
}

test('sweepUnsellableWooTours re-pends by LINK STATE, not by sync origin', async () => {
  const db = expiryDb();
  const n = await sweepUnsellableWooTours(db, { today: '2026-08-02' });
  assert.equal(n, 3);
  const { where, data } = db.updates[0];
  // Past OR no longer scheduled — both mean "must not be on sale".
  assert.deepEqual(where.OR, [{ date: { lt: '2026-08-02' } }, { status: { not: 'scheduled' } }]);
  // Linked only — can never trigger a first publication…
  // …and ONLY while a link is still recorded as live. This is what makes the
  // sweep self-terminating AND self-healing: it no longer excludes rows by
  // wooSyncOrigin, so a pass that converged to the WRONG outcome (the tour was
  // still 'scheduled' when the reconcile read it) is picked up again instead of
  // being locked out forever — the defect that kept 02.08 and 04.08 on sale.
  assert.deepEqual(where.wooVariationLinks, { some: { status: { not: 'disabled' } } });
  assert.equal('wooSyncStatus' in where, false); // failed/null rows are swept too
  assert.equal(data.wooSyncStatus, 'pending');
  assert.equal(data.wooSyncOrigin, 'expiry');
  assert.deepEqual(data.wooDesiredRevision, { increment: 1 }); // desired-state bump
});

test('sweepUnsellableWooTours is a no-op with no active mapping', async () => {
  const db = expiryDb({ mappings: [] });
  assert.equal(await sweepUnsellableWooTours(db, { today: '2026-08-02' }), 0);
  assert.equal(db.updates.length, 0);
});

// ── Cutoff helper ────────────────────────────────────────────────────────────

test('occurrenceClosed respects the close cutoff', () => {
  const cutoffMs = Date.parse('2026-08-08T05:00:00Z'); // 08:00 IL = 10:00 − 120m
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs - 60_000), false);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs + 60_000), true);
  // NULL closeMinutes closes AT THE START TIME — it does NOT mean "never".
  // The old "null → never auto-closes" contract is precisely why a finished tour
  // could stay purchasable: the live Tel Aviv template has no cutoff configured.
  const startMs = Date.parse('2026-08-08T07:00:00Z'); // 10:00 IL (UTC+3, DST)
  assert.equal(occurrenceClosed('2026-08-08', '10:00', null, startMs - 60_000), false);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', null, startMs), true);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', null, startMs + 1e9), true);
});

// ── The 06.08.2026 storefront defect, reproduced at the worker level ─────────
//
// Production: Woo product 167 publicly offered 02.08.2026 and 04.08.2026 after
// they had happened. Both TourEvents were still `status:'scheduled'` when the
// expiry sweep's reconcile read them (the midnight completion sweep had not yet
// flipped them), the template has NO registrationCloseMinutes, and the desired
// state had no past-date term — so they derived as PUBLISHABLE and were stamped
// synced/expiry, which permanently excluded them from any later sweep.

const AUG6_NOON = Date.parse('2026-08-06T12:00:00Z');

// A tour on 02.08 that STILL READS 'scheduled' — the exact production row.
const pastButScheduled = (over = {}) => ({
  tour: {
    id: 'slotPast',
    status: 'scheduled',
    date: '2026-08-02',
    startTime: '17:00',
    capacity: 20,
    openTourTemplateId: 'tpl1',
    updatedAt: 'u1',
    wooSyncStatus: 'pending',
    wooSyncOrigin: 'expiry',
    wooAttempts: 0,
  },
  links: {
    'slotPast::cardA::default': {
      tourEventId: 'slotPast', cardGroupId: 'cardA', variantKey: 'default',
      wooVariationId: 2033, wooProductId: 101, status: 'synced',
    },
  },
  ...over,
});

test('REGRESSION: a past occurrence still marked scheduled is DRAFTED, not published', async () => {
  const env = makeEnv(pastButScheduled());
  await reconcileTourWoo(deps(env, AUG6_NOON), 'slotPast');

  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated.length, 1);
  const { variationId, data } = env.calls.updated[0];
  assert.equal(variationId, 2033);
  // Off the storefront AND unpurchasable — not merely hidden client-side.
  assert.equal(data.status, 'draft');
  assert.equal(data.stock_quantity, 0);
  assert.equal(data.stock_status, 'outofstock');
});

test('REGRESSION: converging a past occurrence records its links DISABLED', async () => {
  // This is what makes the unsellable sweep self-terminating: once the links
  // read 'disabled' the sweep stops selecting the tour. While they read 'synced'
  // (the old behaviour) the sweep keeps retrying — so a wrong outcome heals.
  const env = makeEnv(pastButScheduled());
  await reconcileTourWoo(deps(env, AUG6_NOON), 'slotPast');
  assert.equal(env.linkStore['slotPast::cardA::default'].status, 'disabled');
  // …and the link itself is PRESERVED, never deleted (order history + restore).
  assert.equal(env.linkStore['slotPast::cardA::default'].wooVariationId, 2033);
  assert.equal(env.linkStore['slotPast::cardA::default'].wooProductId, 101);
});

test('REGRESSION: a past occurrence is NEVER newly created on the storefront', async () => {
  // No existing link → nothing to converge. Creating a variation only to draft
  // it would litter the product with dead children the live theme enumerates.
  const env = makeEnv(pastButScheduled({ links: {} }));
  await reconcileTourWoo(deps(env, AUG6_NOON), 'slotPast');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated.length, 0);
});

test('a still-future occurrence is untouched by the past-date rule', async () => {
  const env = makeEnv(); // 2026-08-08 10:00, now = AUG6 noon → sellable
  await reconcileTourWoo(deps(env, AUG6_NOON), 'slot1');
  assert.equal(env.calls.created.length, 1);
  assert.equal(env.calls.created[0].data.status, 'publish');
  assert.equal(env.linkStore['slot1::cardA::default'].status, 'synced');
});

test('reopening a hidden occurrence republishes it through the same path', async () => {
  // Same tour, same link — only the clock moved back before the start. The link
  // flips 'disabled' → 'synced' and the variation is published again.
  const env = makeEnv({
    ...pastButScheduled(),
    links: {
      'slotPast::cardA::default': {
        tourEventId: 'slotPast', cardGroupId: 'cardA', variantKey: 'default',
        wooVariationId: 2033, wooProductId: 101, status: 'disabled',
      },
    },
  });
  await reconcileTourWoo(deps(env, Date.parse('2026-08-01T12:00:00Z')), 'slotPast');
  assert.equal(env.calls.updated[0].data.status, 'publish');
  assert.equal(env.linkStore['slotPast::cardA::default'].status, 'synced');
});

test('an occurrence past its configured sales window is drafted', async () => {
  // 08.08 10:00 IL = 07:00Z. A 120-minute cutoff closes it at 05:00Z.
  const env = makeEnv({
    registrationCloseMinutes: 120,
    links: {
      'slot1::cardA::default': {
        tourEventId: 'slot1', cardGroupId: 'cardA', variantKey: 'default',
        wooVariationId: 777, wooProductId: 101, status: 'synced',
      },
    },
  });
  await reconcileTourWoo(deps(env, Date.parse('2026-08-08T06:00:00Z')), 'slot1');
  assert.equal(env.calls.updated[0].data.status, 'draft');
});

// ── Revision-drift sweep ─────────────────────────────────────────────────────

test('sweepWooRevisionDrift re-pends tours whose desired revision moved past synced', async () => {
  const rows = [
    { id: 'a', wooDesiredRevision: 4, wooSyncedRevision: 4 }, // converged
    { id: 'b', wooDesiredRevision: 5, wooSyncedRevision: 4 }, // drifted
    { id: 'c', wooDesiredRevision: 1, wooSyncedRevision: null }, // never stamped
  ];
  const updates = [];
  const db = {
    tourEvent: {
      findMany: async ({ where }) => {
        assert.equal(where.wooSyncStatus, 'synced');
        assert.deepEqual(where.wooVariationLinks, { some: {} });
        return rows;
      },
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        return { count: where.id.in.length };
      },
    },
  };
  assert.equal(await sweepWooRevisionDrift(db), 2);
  assert.deepEqual(updates[0].where.id.in, ['b', 'c']);
  assert.equal(updates[0].data.wooSyncOrigin, 'drift');
});

test('sweepWooRevisionDrift is a no-op when everything is converged', async () => {
  const db = {
    tourEvent: {
      findMany: async () => [{ id: 'a', wooDesiredRevision: 2, wooSyncedRevision: 2 }],
      updateMany: async () => assert.fail('must not write when nothing drifted'),
    },
  };
  assert.equal(await sweepWooRevisionDrift(db), 0);
});
