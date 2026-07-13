import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAndBackfill } from './attachDurationTelAviv.js';

// The pa_משך attach + backfill core over fakes for GOS + the Woo client. Verifies
// safe attach (preserving existing), duration map built from real GOS durations,
// abort-before-write on ambiguity, idempotency, and convergence gating.

const TERMS = [{ name: 'שעה' }, { name: 'שעה וחצי' }, { name: 'שעתיים' }, { name: 'שעתיים וחצי' }, { name: '3 שעות' }];
const EXISTING_ATTRS = [
  { id: 5, name: 'גיל', variation: true, options: ['מבוגר', 'ילד'] },
  { id: 3, name: 'פעילות', variation: true, options: ['סיור בלבד', 'סיור + סדנה'] },
  { id: 2, name: 'שעה', variation: true, options: ['07:00'] },
  { id: 1, name: 'תאריך', variation: true, options: ['15/07/2026'] },
];

function makeEnv({ durations = [2, 2.5], attrs = EXISTING_ATTRS, terms = TERMS } = {}) {
  const mappings = [{ id: 'm1', cardGroupId: 'cTour', wooProductId: 167, active: true, config: { activity: { attrId: 3 } } }];
  const product = { id: 167, attributes: attrs.map((a) => ({ ...a })) };
  const productUpdates = [];
  const mappingUpdates = [];
  const tourUpdates = [];
  const client = {
    _mappings: mappings,
    _mappingUpdates: mappingUpdates,
    wooProductMapping: {
      findMany: async () => mappings,
      update: async ({ where, data }) => { mappingUpdates.push({ where, data }); const m = mappings.find((x) => x.id === where.id); m.config = data.config; return m; },
    },
    openTourTemplateProduct: {
      findMany: async () => durations.map((d, i) => ({ templateId: 'tpl1', cardGroupId: 'cTour', productVariant: { durationHours: d } })),
    },
    tourEvent: {
      findMany: async ({ select }) => (select?.wooSyncStatus ? [{ id: 'T1', wooSyncStatus: 'synced' }] : [{ id: 'T1' }]),
      updateMany: async (args) => { tourUpdates.push(args); return { count: 1 }; },
    },
    wooVariationLink: { findMany: async () => [{ tourEventId: 'T1', cardGroupId: 'cTour', variantKey: 'tt', wooVariationId: 999, status: 'synced' }] },
    maintenanceJob: {},
  };
  const woo = {
    getProduct: async () => product,
    listVariations: async () => [{ id: 1560 }, { id: 1561 }],
    listAttributeTerms: async () => terms,
    updateProduct: async (id, data) => { productUpdates.push(data); product.attributes = data.attributes; return product; },
  };
  const reconcile = async (_deps, tourId) => 'ok';
  return { client, woo, reconcile, product, productUpdates, mappingUpdates, tourUpdates };
}

test('attaches pa_משך (id 4, variation) preserving all existing attributes; builds map from real GOS durations', async () => {
  const env = makeEnv({ durations: [2, 2.5] });
  const r = await attachAndBackfill(env.client, env.woo, env.reconcile, { log() {}, warn() {} });
  assert.equal(r.ok, true);
  assert.equal(r.attachedAttribute, true);
  // pa_משך appended, all 4 existing attrs preserved (5 total, none removed).
  const durAttr = env.product.attributes.find((a) => a.id === 4);
  assert.ok(durAttr && durAttr.variation === true);
  assert.equal(env.product.attributes.length, 5);
  assert.ok(env.product.attributes.some((a) => a.id === 1) && env.product.attributes.some((a) => a.id === 3));
  // Map from GOS durations → live terms (readable slug option), no hardcoding.
  assert.equal(r.durationMap['2'], 'שעתיים');
  assert.equal(r.durationMap['2.5'], 'שעתיים-וחצי');
  // Config written to the mapping.
  assert.equal(env.mappingUpdates[0].data.config.duration.attrId, 4);
});

test('ABORTS before any write when a GOS duration has no single matching term', async () => {
  const env = makeEnv({ durations: [4] }); // 4h → no term
  const r = await attachAndBackfill(env.client, env.woo, env.reconcile, { log() {}, warn() {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unmapped_or_ambiguous_durations');
  assert.equal(env.productUpdates.length, 0); // #167 untouched
  assert.ok(r.snapshot.attrsBefore.length === 4);
});

test('idempotent: when pa_משך is already declared, no product write', async () => {
  const withDur = [...EXISTING_ATTRS, { id: 4, name: 'משך', variation: true, options: ['שעתיים'] }];
  const env = makeEnv({ durations: [2], attrs: withDur });
  const r = await attachAndBackfill(env.client, env.woo, env.reconcile, { log() {}, warn() {} });
  assert.equal(r.ok, true);
  assert.equal(r.attachedAttribute, false);
  assert.equal(env.productUpdates.length, 0);
});

test('refuses if a local duplicate "משך" attribute exists', async () => {
  const withLocal = [...EXISTING_ATTRS, { name: 'משך', variation: true, options: ['שעתיים'] }]; // no id = local
  const env = makeEnv({ durations: [2], attrs: withLocal });
  const r = await attachAndBackfill(env.client, env.woo, env.reconcile, { log() {}, warn() {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'local_duration_attribute_exists');
  assert.equal(env.productUpdates.length, 0);
});

test('not converged (a tour left pending) → ok=false, job stays retryable', async () => {
  const env = makeEnv({ durations: [2] });
  env.client.tourEvent.findMany = async ({ select }) => (select?.wooSyncStatus ? [{ id: 'T1', wooSyncStatus: 'pending' }] : [{ id: 'T1' }]);
  const r = await attachAndBackfill(env.client, env.woo, env.reconcile, { log() {}, warn() {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'tours_not_converged');
  assert.deepEqual(r.notConverged, ['T1']);
});
