// Card-option eligibility (Part A) — pure, no DB. A card is offered only if
// pinning it and running the engine yields a real positive price for the
// context; labels are the tab name with a deterministic ordinal for genuine
// same-tab duplicates; repeated builds are stable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardOptions, probeCard } from './cardOptions.js';

const V = 'v_flor';
const OTHER = 'v_haifa';
const ACT = { id: 'at1' };
const SEG = new Map([['seg_biz', 'עסקי'], ['seg_priv', 'פרטי'], ['seg_grp', 'קבוצתי']]);

// Two valid Business cards (both cover v_flor), one that covers only OTHER, an
// incomplete card (tiered_group with no tiers), and a ticket_types (group) card.
function list() {
  return {
    id: 'pl', nameHe: 'x', currency: 'ILS', isDefault: true, defaultVatMode: 'excluded', defaultVatRate: 0,
    rules: [
      { id: 'r_biz1', active: true, cardGroupId: 'c_biz1', pricingSegmentId: 'seg_biz', productId: 'p1', productVariantId: V,
        priceModel: 'tiered_group', perAdditionalParticipantMinor: 5000n, cardSortOrder: 2,
        tiers: [{ uptoParticipants: 10, totalPriceMinor: 140000n, sortOrder: 0 }] },
      { id: 'r_biz2', active: true, cardGroupId: 'c_biz2', pricingSegmentId: 'seg_biz', productId: 'p1', productVariantId: V,
        priceModel: 'tiered_group', perAdditionalParticipantMinor: 8000n, cardSortOrder: 3,
        tiers: [{ uptoParticipants: 10, totalPriceMinor: 170000n, sortOrder: 0 }] },
      { id: 'r_priv', active: true, cardGroupId: 'c_priv', pricingSegmentId: 'seg_priv', productId: 'p1', productVariantId: V,
        priceModel: 'fixed', fixedPriceMinor: 500000n, cardSortOrder: 1 },
      { id: 'r_haifa', active: true, cardGroupId: 'c_haifa', pricingSegmentId: 'seg_biz', productId: 'p1', productVariantId: OTHER,
        priceModel: 'fixed', fixedPriceMinor: 900000n, cardSortOrder: 4 },
      { id: 'r_incomplete', active: true, cardGroupId: 'c_bad', pricingSegmentId: 'seg_priv', productId: 'p1', productVariantId: V,
        priceModel: 'tiered_group', tiers: [], cardSortOrder: 5 },
      { id: 'r_ticket', active: true, cardGroupId: 'c_grp', pricingSegmentId: 'seg_grp', productId: 'p1', productVariantId: V,
        priceModel: 'ticket_types', ticketPrices: [{ ticketTypeId: 'tt', priceMinor: 6000n }], cardSortOrder: 6 },
    ],
  };
}
const build = (variant) =>
  buildCardOptions({
    priceList: list(), activityType: ACT,
    context: { productId: 'p1', productVariantId: variant, activityTypeId: 'at1' },
    counts: { participantCount: 8, groupCount: 1 }, segNameById: SEG,
  });

test('only eligible cards appear; incomplete + ticket_types + non-covering excluded', () => {
  const opts = build(V).map((o) => o.cardGroupId);
  assert.deepEqual(opts.sort(), ['c_biz1', 'c_biz2', 'c_priv'].sort());
  assert.equal(opts.includes('c_bad'), false); // incomplete → excluded
  assert.equal(opts.includes('c_grp'), false); // ticket_types resolves ₪0 → excluded
  assert.equal(opts.includes('c_haifa'), false); // doesn't cover this variant
});

test('valid same-segment duplicates BOTH remain, deterministic ordinal', () => {
  const opts = build(V);
  const biz = opts.filter((o) => o.label.startsWith('עסקי'));
  assert.deepEqual(biz.map((o) => o.label), ['עסקי', 'עסקי · 2']);
  assert.equal(biz[0].cardGroupId, 'c_biz1'); // lower cardSortOrder first
});

test('labels are stable across repeated builds (no context surprise)', () => {
  assert.deepEqual(build(V), build(V));
});

test('a context with no variant offers nothing (cannot price → no silent no-op)', () => {
  assert.deepEqual(build(null), []);
  assert.deepEqual(build(undefined), []);
});

test('probeCard: covering→ok+gross, non-covering→not_applicable, incomplete→rule_incomplete', () => {
  const pl = list();
  const ctx = { productId: 'p1', productVariantId: V, activityTypeId: 'at1' };
  const counts = { participantCount: 8, groupCount: 1 };
  assert.equal(probeCard({ priceList: pl, activityType: ACT, context: ctx, counts, cardGroupId: 'c_biz1' }).ok, true);
  assert.equal(probeCard({ priceList: pl, activityType: ACT, context: ctx, counts, cardGroupId: 'c_haifa' }).reason, 'pinned_card_not_applicable');
  assert.equal(probeCard({ priceList: pl, activityType: ACT, context: ctx, counts, cardGroupId: 'c_bad' }).reason, 'rule_incomplete');
  assert.equal(probeCard({ priceList: pl, activityType: ACT, context: ctx, counts, cardGroupId: 'c_grp' }).ok, false); // ₪0
});

test('eligibility probes at ≥1 participant so a 0-participant context still lists cards', () => {
  const opts = buildCardOptions({
    priceList: list(), activityType: ACT,
    context: { productId: 'p1', productVariantId: V, activityTypeId: 'at1' },
    counts: { participantCount: 0, groupCount: 1 }, segNameById: SEG,
  });
  assert.deepEqual(opts.map((o) => o.cardGroupId).sort(), ['c_biz1', 'c_biz2', 'c_priv'].sort());
});
