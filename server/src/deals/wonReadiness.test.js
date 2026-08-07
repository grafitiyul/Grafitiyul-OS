import test from 'node:test';
import assert from 'node:assert/strict';
import { wonGate } from '../tours/tourFromDeal.js';
import { resolveActivityType } from './resolveActivityType.js';
import { WON_DRAFT_FIELDS, WON_REQUIRED_FIELDS } from '../tours/requiredFields.js';

// The WON completion form asks the server "what would WON require if I saved
// this draft?". Its whole correctness claim is that the answer comes from the
// SAME pair the transition runs, in the same order, over the same merged shape.
// These pin that pair — a divergence here is the form quietly showing a
// checklist the transition does not agree with.
//
// This mirrors POST /api/deals/:id/won-readiness exactly.
function readiness(deal, draft = {}, { slotKind = null, tourEventId = null } = {}) {
  const merged = { ...deal };
  for (const f of WON_DRAFT_FIELDS) {
    if (draft[f] === undefined) continue;
    merged[f] = f === 'participants'
      ? (draft[f] === '' || draft[f] === null ? null : Number(draft[f]))
      : (draft[f] || null);
  }
  const resolved = resolveActivityType(merged, { groupSlotSelected: slotKind === 'group_slot' });
  const gate = wonGate({ ...merged, activityType: resolved.activityType }, tourEventId);
  return {
    activityType: resolved.activityType,
    activityTypeAssumed: resolved.assumed,
    activityTypeReason: resolved.reason,
    missing: gate.missing,
    needsSlot: gate.needsSlot,
    ready: gate.missing.length === 0 && !gate.needsSlot,
  };
}

const PLANNED = {
  productId: 'p1', productVariantId: 'v1', locationId: 'l1',
  tourDate: '2026-09-01', tourTime: '10:00', participants: 12, tourLanguage: 'he',
};
const BARE = {
  activityType: null, organizationId: null,
  productId: null, productVariantId: null, locationId: null,
  tourDate: null, tourTime: null, participants: null, tourLanguage: null,
};

test('the draft allow-list is DERIVED from the gate lists, never typed out twice', () => {
  const fromLists = new Set(Object.values(WON_REQUIRED_FIELDS).flat());
  assert.deepEqual(new Set(WON_DRAFT_FIELDS), fromLists);
  // Adding a field to a WON list must make it draftable automatically.
  assert.ok(WON_DRAFT_FIELDS.includes('tourLanguage'));
  assert.ok(WON_DRAFT_FIELDS.includes('activityType'));
});

test('a draft may only propose gate fields — anything else is ignored', () => {
  const r = readiness({ ...BARE, activityType: 'private', ...PLANNED }, {
    title: 'hacked', valueMinor: 999n, status: 'lost', ownerUserId: 'x',
  });
  assert.equal(r.ready, true, 'the junk was dropped, not merged');
});

test('ONE missing scalar is reported, and filling it in the draft clears it', () => {
  const deal = { ...BARE, activityType: 'private', ...PLANNED, tourTime: null };
  assert.deepEqual(readiness(deal).missing.map((m) => m.field), ['tourTime']);
  assert.equal(readiness(deal, { tourTime: '10:00' }).ready, true);
});

test('SEVERAL missing fields are all reported, and a partial fill shrinks the list', () => {
  const deal = { ...BARE, activityType: 'private' };
  const all = readiness(deal).missing.map((m) => m.field);
  assert.deepEqual(all.sort(), [
    'locationId', 'participants', 'productId', 'productVariantId',
    'tourDate', 'tourLanguage', 'tourTime',
  ]);
  const partial = readiness(deal, { tourDate: '2026-09-01', tourTime: '10:00', participants: 12 });
  assert.deepEqual(partial.missing.map((m) => m.field).sort(), [
    'locationId', 'productId', 'productVariantId', 'tourLanguage',
  ]);
});

test('the product/variant dependency is reported as two fields, because it is', () => {
  const deal = { ...BARE, activityType: 'private', ...PLANNED, productId: null, productVariantId: null };
  const fields = readiness(deal).missing.map((m) => m.field);
  assert.ok(fields.includes('productId'));
  assert.ok(fields.includes('productVariantId'));
  // A variant alone still blocks — the city resolved no product×city pair.
  const noVariant = readiness({ ...BARE, activityType: 'private', ...PLANNED, productVariantId: null });
  assert.deepEqual(noVariant.missing.map((m) => m.field), ['productVariantId']);
});

test('choosing GROUP changes the requirement set LIVE — the form never guesses it', () => {
  const deal = { ...BARE };
  // As private (the resolved default): the full planning set.
  const asPrivate = readiness(deal, { activityType: 'private' });
  assert.equal(asPrivate.missing.length, 7);
  assert.equal(asPrivate.needsSlot, false);
  // As group: only participants — and then a SLOT.
  const asGroup = readiness(deal, { activityType: 'group' });
  assert.deepEqual(asGroup.missing.map((m) => m.field), ['participants']);
  const groupReady = readiness(deal, { activityType: 'group', participants: 8 });
  assert.deepEqual(groupReady.missing, []);
  assert.equal(groupReady.needsSlot, true, 'a slot is required and never guessed');
  assert.equal(groupReady.ready, false, 'needsSlot is NOT ready');
});

test('a chosen group slot satisfies needsSlot', () => {
  const r = readiness({ ...BARE }, { activityType: 'group', participants: 8 }, {
    slotKind: 'group_slot', tourEventId: 'te1',
  });
  assert.equal(r.needsSlot, false);
  assert.equal(r.ready, true);
});

test('an ASSUMED activity type is marked as assumed, with its reason', () => {
  const orgDeal = { ...BARE, organizationId: 'o1', ...PLANNED };
  const r = readiness(orgDeal);
  assert.equal(r.activityType, 'business');
  assert.equal(r.activityTypeAssumed, true);
  assert.equal(r.activityTypeReason, 'organization_linked');
  assert.equal(r.ready, true, 'an assumption never blocks the sale');
});

test('a type the OPERATOR chose is not an assumption', () => {
  const r = readiness({ ...BARE, organizationId: 'o1', ...PLANNED }, { activityType: 'private' });
  assert.equal(r.activityType, 'private');
  assert.equal(r.activityTypeAssumed, false);
  assert.equal(r.activityTypeReason, null);
});

test('participants is a POSITIVE integer — 0 and blank are both missing', () => {
  const base = { ...BARE, activityType: 'private', ...PLANNED };
  assert.equal(readiness(base, { participants: 0 }).ready, false);
  assert.equal(readiness(base, { participants: '' }).ready, false);
  assert.equal(readiness(base, { participants: '12' }).ready, true, 'a form string is a number');
});

test('the probe NEVER writes — it is a pure function of (deal, draft)', () => {
  const deal = Object.freeze({ ...BARE, activityType: 'private' });
  const draft = Object.freeze({ tourDate: '2026-09-01' });
  readiness(deal, draft);
  assert.equal(deal.tourDate, null, 'the stored deal is untouched');
  assert.equal(draft.tourDate, '2026-09-01');
});
