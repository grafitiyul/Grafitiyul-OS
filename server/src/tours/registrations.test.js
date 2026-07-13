import test from 'node:test';
import assert from 'node:assert/strict';
import { regStatusFromBooking } from './registrations.js';
import { mergeOccupancy } from './occupancy.js';

// The canonical registration mirror rules + the occupancy merge shape. Occupancy
// SEATS come from active registrations; booking counts stay CRM metadata.

test('only active bookings map to active (seat-counting) registrations', () => {
  assert.equal(regStatusFromBooking('active'), 'active');
  assert.equal(regStatusFromBooking('cancelled'), 'cancelled');
  // Orphaned seats must NOT count — they collapse to a non-active registration.
  assert.equal(regStatusFromBooking('orphaned'), 'cancelled');
});

test('mergeOccupancy: seats from registrations, booking counts from bookings', () => {
  const ids = ['t1', 't2', 't3'];
  const seatRows = [
    { tourEventId: 't1', _sum: { quantity: 12 } },
    { tourEventId: 't2', _sum: { quantity: 0 } },
  ];
  const activeBk = [{ tourEventId: 't1', _count: { _all: 2 } }];
  const totalBk = [
    { tourEventId: 't1', _count: { _all: 3 } },
    { tourEventId: 't2', _count: { _all: 1 } },
  ];
  const out = mergeOccupancy(ids, seatRows, activeBk, totalBk);
  assert.deepEqual(out.t1, { activeSeats: 12, activeBookings: 2, totalBookings: 3 });
  // Seats present but no bookings recorded → e.g. a WooCommerce-only open tour.
  assert.deepEqual(out.t2, { activeSeats: 0, activeBookings: 0, totalBookings: 1 });
  // Untouched tours default to all-zero.
  assert.deepEqual(out.t3, { activeSeats: 0, activeBookings: 0, totalBookings: 0 });
});

test('mergeOccupancy ignores aggregate rows for ids not in the requested set', () => {
  const out = mergeOccupancy(['t1'], [{ tourEventId: 'other', _sum: { quantity: 99 } }], [], []);
  assert.deepEqual(out, { t1: { activeSeats: 0, activeBookings: 0, totalBookings: 0 } });
});
