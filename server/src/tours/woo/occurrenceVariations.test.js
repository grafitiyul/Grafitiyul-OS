import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOccurrenceVariations,
  dateTermName,
  dateTermSlug,
  timeTermSlug,
  findVariationForVariant,
  metaValue,
  META_TOUREVENT_ID,
  META_VARIANT_KEY,
  META_TICKET_TYPE_ID,
} from './desiredState.js';

// The corrected model, matching the LIVE theguy4u.co.il structure:
// global-taxonomy pa_תאריך / pa_שעה, activity via pa_פעילות, and adult/child as
// SEPARATE pa_גיל variations — each at its own canonical GOS price.

const TOUR = { id: 'slotTA', status: 'scheduled', date: '2026-08-08', startTime: '10:00' };

// Tel Aviv (#167): date/time/activity/age attributes, no duration pinned.
const TT_ADULT = 'tt_adult';
const TT_CHILD = 'tt_child';
const CONFIG_TA = {
  taxonomyMode: 'global',
  date: { attrId: 1, attrName: 'pa_תאריך', format: 'slash-dmy' },
  time: { attrId: 2, attrName: 'pa_שעה' },
  activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-בלבד', label: 'סיור בלבד' },
  age: { attrId: 5, attrName: 'pa_גיל' },
  ticketAge: {
    [TT_ADULT]: { option: 'מבוגר', label: 'מבוגר' },
    [TT_CHILD]: { option: 'ילד', label: 'ילד' },
  },
};
// Real per-age prices from the Pricing Card (adult ₪60, child ₪30 — tour only).
const ROWS = [
  { key: `tt:${TT_ADULT}`, ticketTypeId: TT_ADULT, label: 'מבוגר', unitPriceMinor: 6000 },
  { key: `tt:${TT_CHILD}`, ticketTypeId: TT_CHILD, label: 'ילד', unitPriceMinor: 3000 },
];

test('term name/slug derivation matches WooCommerce slugification', () => {
  assert.equal(dateTermName('2026-08-08'), '08/08/2026');
  assert.equal(dateTermSlug('2026-08-08'), '08-08-2026');
  assert.equal(timeTermSlug('07:00'), '0700');
});

test('one occurrence → one variation PER ticket type, each with its OWN price', () => {
  const set = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: ROWS,
    config: CONFIG_TA,
    capacity: 20,
    remaining: 7,
  });
  assert.equal(set.length, 2);

  const adult = set.find((v) => v.ticketTypeId === TT_ADULT);
  const child = set.find((v) => v.ticketTypeId === TT_CHILD);

  // No "first ticket type" collapse — each variation keeps its real price.
  assert.equal(adult.payload.regular_price, '60.00');
  assert.equal(child.payload.regular_price, '30.00');

  // Variant identity is stable (the ticketTypeId), for idempotent tracking.
  assert.equal(adult.variantKey, TT_ADULT);
  assert.equal(child.variantKey, TT_CHILD);
});

test('variations carry the four global-taxonomy attributes by id', () => {
  const [adult] = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: [ROWS[0]],
    config: CONFIG_TA,
    capacity: 20,
    remaining: 5,
  });
  const byId = Object.fromEntries(adult.payload.attributes.map((a) => [a.id, a.option]));
  assert.equal(byId[1], '08-08-2026'); // pa_תאריך (date slug)
  assert.equal(byId[2], '1000'); // pa_שעה (time slug)
  assert.equal(byId[3], 'סיור-בלבד'); // pa_פעילות (this card's activity)
  assert.equal(byId[5], 'מבוגר'); // pa_גיל (adult)
});

test('activity attribute separates the two cards on the SAME product', () => {
  const workshopConfig = {
    ...CONFIG_TA,
    activity: { attrId: 3, attrName: 'pa_פעילות', option: 'סיור-סדנה', label: 'סיור + סדנה' },
  };
  const [adult] = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardWorkshop',
    ticketRows: [{ ticketTypeId: TT_ADULT, unitPriceMinor: 10000 }],
    config: workshopConfig,
    capacity: 20,
    remaining: 5,
  });
  const activity = adult.payload.attributes.find((a) => a.id === 3);
  assert.equal(activity.option, 'סיור-סדנה');
  assert.equal(adult.payload.regular_price, '100.00'); // tour+workshop adult ₪100
});

test('stable per-variant metadata + adoption by (tour, variantKey)', () => {
  const set = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: ROWS,
    config: CONFIG_TA,
    capacity: 20,
    remaining: 5,
  });
  const adult = set.find((v) => v.ticketTypeId === TT_ADULT);
  assert.equal(metaValue(adult.payload, META_TOUREVENT_ID), 'slotTA');
  assert.equal(metaValue(adult.payload, META_VARIANT_KEY), TT_ADULT);
  assert.equal(metaValue(adult.payload, META_TICKET_TYPE_ID), TT_ADULT);

  // Adoption: given the existing live variations, match ours back by meta.
  const live = set.map((v, i) => ({ id: 900 + i, ...v.payload }));
  const found = findVariationForVariant(live, 'slotTA', 'cardTourOnly', TT_CHILD);
  assert.equal(metaValue(found, META_VARIANT_KEY), TT_CHILD);
  assert.equal(findVariationForVariant(live, 'slotTA', 'cardTourOnly', 'nope'), null);
  // Cross-card safety: the SAME variant key under a DIFFERENT card is NOT adopted.
  assert.equal(findVariationForVariant(live, 'slotTA', 'otherCard', TT_CHILD), null);
});

test('shared capacity: EVERY sibling variation advertises the SAME stock', () => {
  const set = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: ROWS,
    config: CONFIG_TA,
    capacity: 20,
    remaining: 3,
  });
  for (const v of set) {
    assert.equal(v.payload.stock_quantity, 3);
    assert.equal(v.payload.stock_status, 'instock');
    assert.equal(v.payload.status, 'publish');
  }
});

test('cancelled/postponed occurrence → every variation hidden + zero stock, never deleted', () => {
  const cancelled = buildOccurrenceVariations({
    tour: { ...TOUR, status: 'cancelled' },
    cardGroupId: 'cardTourOnly',
    ticketRows: ROWS,
    config: CONFIG_TA,
    capacity: 20,
    remaining: 7,
  });
  for (const v of cancelled) {
    assert.equal(v.payload.status, 'private');
    assert.equal(v.payload.stock_quantity, 0);
    assert.equal(v.payload.stock_status, 'outofstock');
  }
});

test('registration cutoff hides every sibling', () => {
  const closed = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: ROWS,
    config: CONFIG_TA,
    capacity: 20,
    remaining: 7,
    registrationClosed: true,
  });
  for (const v of closed) assert.equal(v.payload.status, 'private');
});

test('product WITHOUT age split (no pa_גיל) → one variation, still real price', () => {
  const cfg = { ...CONFIG_TA, age: null, ticketAge: {} };
  const set = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardSingle',
    ticketRows: [{ ticketTypeId: TT_ADULT, unitPriceMinor: 6000 }],
    config: cfg,
    capacity: 10,
    remaining: 4,
  });
  assert.equal(set.length, 1);
  assert.equal(set[0].payload.attributes.some((a) => a.id === 5), false);
  assert.equal(set[0].payload.regular_price, '60.00');
});

test('product WITHOUT a separate time attribute omits pa_שעה cleanly', () => {
  const cfg = { ...CONFIG_TA, time: null };
  const [v] = buildOccurrenceVariations({
    tour: TOUR,
    cardGroupId: 'cardTourOnly',
    ticketRows: [ROWS[0]],
    config: cfg,
    capacity: 10,
    remaining: 4,
  });
  assert.equal(
    v.payload.attributes.some((a) => a.id === 2),
    false,
  );
  assert.equal(
    v.payload.attributes.some((a) => a.id === 1),
    true,
  );
});

const CONFIG_DUR = {
  ...CONFIG_TA,
  duration: { attrId: 4, attrName: 'pa_משך', map: { '2': 'שעתיים', '2.5': 'שעתיים-וחצי' } },
};

test('duration → pa_משך option from the operational product hours (plain vs workshop)', () => {
  const plain = buildOccurrenceVariations({
    tour: TOUR, cardGroupId: 'c', ticketRows: [ROWS[0]], config: CONFIG_DUR, capacity: 10, remaining: 5, durationHours: 2,
  });
  assert.equal(plain[0].payload.attributes.find((a) => a.id === 4).option, 'שעתיים');
  const workshop = buildOccurrenceVariations({
    tour: TOUR, cardGroupId: 'c', ticketRows: [ROWS[0]], config: CONFIG_DUR, capacity: 10, remaining: 5, durationHours: 2.5,
  });
  assert.equal(workshop[0].payload.attributes.find((a) => a.id === 4).option, 'שעתיים-וחצי');
});

test('configured duration with NO mapping for the hours FAILS visibly (retryable)', () => {
  assert.throws(
    () => buildOccurrenceVariations({ tour: TOUR, cardGroupId: 'c', ticketRows: [ROWS[0]], config: CONFIG_DUR, capacity: 10, remaining: 5, durationHours: 4 }),
    /no pa_משך option mapped for duration=4/,
  );
  // Also fails when hours are unknown (null) but a duration attr is configured.
  assert.throws(
    () => buildOccurrenceVariations({ tour: TOUR, cardGroupId: 'c', ticketRows: [ROWS[0]], config: CONFIG_DUR, capacity: 10, remaining: 5, durationHours: null }),
    /no pa_משך option mapped/,
  );
});

test('no duration in config → no pa_משך attribute (existing behavior preserved)', () => {
  const [v] = buildOccurrenceVariations({ tour: TOUR, cardGroupId: 'c', ticketRows: [ROWS[0]], config: CONFIG_TA, capacity: 10, remaining: 5, durationHours: 2 });
  assert.equal(v.payload.attributes.some((a) => a.id === 4), false);
});

test('age configured but a ticket type is unmapped → refuses (no silent mis-sell)', () => {
  const cfg = { ...CONFIG_TA, ticketAge: { [TT_ADULT]: { option: 'מבוגר' } } }; // child missing
  assert.throws(
    () =>
      buildOccurrenceVariations({
        tour: TOUR,
        cardGroupId: 'cardTourOnly',
        ticketRows: ROWS,
        config: cfg,
        capacity: 10,
        remaining: 4,
      }),
    /no age term mapped/,
  );
});
