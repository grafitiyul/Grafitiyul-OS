import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVariationPayload,
  occurrenceLabel,
  minorToWooPrice,
  metaValue,
  findVariationForTour,
  META_TOUREVENT_ID,
  variationMenuOrder,
} from './desiredState.js';

// The pure GOS→Woo variation-payload rules. WooCommerce simply REFLECTS GOS.

test('occurrenceLabel + price formatting', () => {
  assert.equal(occurrenceLabel('2026-08-08', '10:00'), '08.08.2026 10:00');
  assert.equal(minorToWooPrice(4500), '45.00');
  assert.equal(minorToWooPrice(null), undefined);
});

const TOUR = { id: 'slot1', status: 'scheduled', date: '2026-08-08', startTime: '10:00' };

test('scheduled occurrence → published, in-stock, with the stable GOS metadata', () => {
  const p = buildVariationPayload({
    tour: TOUR,
    cardGroupId: 'cardA',
    capacity: 20,
    remaining: 7,
    priceMinor: 4500,
    dateAttribute: 'Date',
  });
  assert.equal(p.status, 'publish');
  assert.equal(p.manage_stock, true);
  assert.equal(p.stock_quantity, 7);
  assert.equal(p.stock_status, 'instock');
  assert.equal(p.regular_price, '45.00');
  assert.deepEqual(p.attributes, [{ name: 'Date', option: '08.08.2026 10:00' }]);
  assert.equal(metaValue(p, META_TOUREVENT_ID), 'slot1');
  assert.equal(metaValue(p, '_gos_card_group_id'), 'cardA');
  assert.equal(metaValue(p, '_gos_capacity'), '20');
  assert.equal(metaValue(p, '_gos_date'), '2026-08-08');
});

test('a full tour is out of stock but still published', () => {
  const p = buildVariationPayload({ tour: TOUR, cardGroupId: 'c', capacity: 20, remaining: 0, priceMinor: 4500, dateAttribute: 'Date' });
  assert.equal(p.status, 'publish');
  assert.equal(p.stock_quantity, 0);
  assert.equal(p.stock_status, 'outofstock');
});

test('cancelled occurrence → hidden (private) + zero stock, never deleted, meta kept', () => {
  const p = buildVariationPayload({
    tour: { ...TOUR, status: 'cancelled' },
    cardGroupId: 'cardA',
    capacity: 20,
    remaining: 7,
    priceMinor: 4500,
    dateAttribute: 'Date',
  });
  assert.equal(p.status, 'draft'); // out of the storefront, order history preserved
  assert.equal(p.stock_quantity, 0);
  assert.equal(p.stock_status, 'outofstock');
  assert.equal(metaValue(p, META_TOUREVENT_ID), 'slot1'); // identity preserved
});

test('postponed (no date) → hidden and the date attribute is NOT rewritten', () => {
  const p = buildVariationPayload({
    tour: { id: 'slot1', status: 'postponed', date: null, startTime: null },
    cardGroupId: 'cardA',
    capacity: 20,
    remaining: 5,
    priceMinor: 4500,
    dateAttribute: 'Date',
  });
  assert.equal(p.status, 'draft');
  assert.equal(p.attributes, undefined); // keep whatever the variation already had
});

test('registrationClosed hides the occurrence even while scheduled', () => {
  const p = buildVariationPayload({ tour: TOUR, cardGroupId: 'c', capacity: 20, remaining: 5, priceMinor: 4500, dateAttribute: 'Date', registrationClosed: true });
  assert.equal(p.status, 'draft');
  assert.equal(p.stock_quantity, 0);
});

test('no known price → regular_price omitted (variation price left untouched)', () => {
  const p = buildVariationPayload({ tour: TOUR, cardGroupId: 'c', capacity: 20, remaining: 5, priceMinor: null, dateAttribute: 'Date' });
  assert.equal('regular_price' in p, false);
});

test('findVariationForTour matches by the stable meta link', () => {
  const variations = [
    { id: 1, meta_data: [{ key: META_TOUREVENT_ID, value: 'other' }] },
    { id: 2, meta_data: [{ key: META_TOUREVENT_ID, value: 'slot1' }] },
  ];
  assert.equal(findVariationForTour(variations, 'slot1').id, 2);
  assert.equal(findVariationForTour(variations, 'nope'), null);
});

// ── Chronological variation menu_order (the LIVE theme sorts by child order) ──

test('variationMenuOrder is monotonic across days, months, years and times', () => {
  const k = variationMenuOrder;
  assert.ok(k('2026-07-15', '18:00') < k('2026-07-17', '10:45'));
  assert.ok(k('2026-07-17', '10:45') < k('2026-07-17', '13:00')); // same date, later time
  assert.ok(k('2026-07-17', '13:00') < k('2026-08-01', '09:00')); // month rollover
  assert.ok(k('2026-12-31', '23:00') < k('2027-01-01', '07:00')); // year rollover
  assert.equal(k(null, '10:00'), null);
  assert.equal(k('2026-07-15', null), null);
});

test('payload carries the chronological menu_order for the occurrence', () => {
  const p = buildVariationPayload({ tour: TOUR, cardGroupId: 'c', capacity: 20, remaining: 5, priceMinor: 4500, dateAttribute: 'Date' });
  assert.equal(p.menu_order, variationMenuOrder(TOUR.date, TOUR.startTime));
  assert.ok(Number.isInteger(p.menu_order) && p.menu_order > 0);
});
