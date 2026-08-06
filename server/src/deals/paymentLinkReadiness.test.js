import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentLinkReadiness } from './paymentLinkReadiness.js';

// The asymmetry these tests protect: "פתח קישור" never consults this function
// at all (the operator is present, often mid-call), while "העתק"/"שלח" do —
// those put a link in a customer's hands unattended.

const COMPLETE = {
  activityType: 'private', productId: 'p', productVariantId: 'v', locationId: 'l',
  tourDate: '2026-09-07', tourTime: '20:00', participants: 2, tourLanguage: 'he',
  bookings: [],
};

test('a fully planned deal is ready', () => {
  const r = paymentLinkReadiness(COMPLETE);
  assert.equal(r.ready, true);
  assert.deepEqual(r.missing, []);
});

test('a missing activityType NEVER blocks a link — settlement resolves it', () => {
  // This is the #27105 shape. Blocking here would re-introduce the exact gate
  // the resolver was built to remove.
  const r = paymentLinkReadiness({ ...COMPLETE, activityType: null });
  assert.equal(r.ready, true, 'the link may go out');
  assert.equal(r.missing.find((m) => m.field === 'activityType'), undefined);
});

test('genuinely missing planning DOES hold a customer-facing link', () => {
  const r = paymentLinkReadiness({ ...COMPLETE, tourDate: null, tourTime: null });
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing.map((m) => m.field).sort(), ['tourDate', 'tourTime']);
  // Rendered verbatim by the dialog — the field list is data, never re-written.
  assert.ok(r.missing.every((m) => typeof m.labelHe === 'string' && m.labelHe.length));
});

test('a group deal with no slot is not ready — a seat is not reserved by paying', () => {
  const r = paymentLinkReadiness({ activityType: 'group', participants: 8, bookings: [] });
  assert.equal(r.ready, false);
  assert.equal(r.needsSlot, true);
});

test('a group deal already on its slot is ready', () => {
  const r = paymentLinkReadiness({
    activityType: 'group',
    participants: 8,
    bookings: [{ status: 'active', tourEventId: 'slot1', tourEvent: { kind: 'group_slot' } }],
  });
  assert.equal(r.ready, true);
  assert.equal(r.needsSlot, false);
});

test('an untyped deal on a group slot is judged as GROUP, not private', () => {
  // Resolution must match settlement's, or readiness would grade the deal
  // against a set of required fields it will never actually be held to.
  const r = paymentLinkReadiness({
    participants: 8,
    bookings: [{ status: 'active', tourEventId: 'slot1', tourEvent: { kind: 'group_slot' } }],
  });
  assert.equal(r.ready, true, 'group only needs participants + its slot');
});

test('a null deal is never treated as blocking', () => {
  assert.equal(paymentLinkReadiness(null).ready, true);
});
