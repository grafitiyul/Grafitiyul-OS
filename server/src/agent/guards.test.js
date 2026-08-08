// Hard guards — the layer that holds when the prompt does not.
//
// Each test below is a real way an AI-drafted WhatsApp message could damage the
// business: an invented price, a payment claim that contradicts the ledger, a
// confirmed booking that does not exist, another customer's phone number, a
// link to somewhere we do not control, or the internal deal name.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuards } from './guards.js';

const pack = {
  pricing: { totalText: '₪1,200', totalMinor: 120000 },
  payment: { state: 'unpaid', paidText: null, balanceText: '₪1,200', needsReview: false },
  tour: null,
};
const codes = (r) => r.findings.map((f) => f.code);

test('a clean logistics answer passes', () => {
  const r = runGuards({ text: 'נפגשים ליד הקיר הגדול בפלורנטין, אני אשלח תזכורת יום לפני.', pack });
  assert.deepEqual(r.findings, []);
  assert.equal(r.blocked, false);
});

test('an invented price is caught', () => {
  const r = runGuards({ text: 'המחיר הוא 950 ש"ח לקבוצה.', pack });
  assert.ok(codes(r).includes('invented_amount'));
  assert.equal(r.blocked, true);
});

test('a KNOWN price passes, in either notation', () => {
  // The comparison is on digits, so ₪1,200 and 1200 ש"ח are the same fact.
  assert.equal(runGuards({ text: 'המחיר הוא ₪1,200.', pack }).blocked, false);
  assert.equal(runGuards({ text: 'המחיר הוא 1200 ש"ח.', pack }).blocked, false);
});

test('a payment claim that contradicts the ledger is caught', () => {
  const r = runGuards({ text: 'התשלום התקבל, תודה!', pack });
  assert.ok(codes(r).includes('payment_claim'));
  assert.equal(r.blocked, true);
});

test('a payment claim is still blocked while the deal is under review', () => {
  const reviewPack = { ...pack, payment: { state: 'paid', needsReview: true } };
  const r = runGuards({ text: 'שולם במלואו, נתראה בסיור.', pack: reviewPack });
  assert.ok(codes(r).includes('payment_claim'));
});

test('a payment claim backed by the ledger passes', () => {
  const paidPack = { ...pack, payment: { state: 'paid', needsReview: false, paidText: '₪1,200' } };
  const r = runGuards({ text: 'התשלום התקבל, תודה!', pack: paidPack });
  assert.equal(r.blocked, false);
});

test('confirming a booking without a real tour is caught', () => {
  const r = runGuards({ text: 'ההזמנה אושרה, התאריך שמור עבורכם.', pack });
  assert.ok(codes(r).includes('booking_claim'));
});

test('confirming a booking WITH a real tour passes', () => {
  const booked = { ...pack, tour: { date: '2026-08-20', time: '18:00' } };
  const r = runGuards({ text: 'ההזמנה אושרה, נתראה!', pack: booked });
  assert.equal(codes(r).includes('booking_claim'), false);
});

test('refund language is always blocked', () => {
  const r = runGuards({ text: 'נחזיר לך את הכסף תוך שבוע.', pack });
  assert.ok(codes(r).includes('refund_language'));
  assert.equal(r.blocked, true);
});

test('the internal deal name never reaches a customer', () => {
  const r = runGuards({ text: 'שלום, לגבי ליד חדש - לילי כהן, נשמח לעדכן.', pack, dealTitle: 'ליד חדש - לילי כהן' });
  assert.ok(codes(r).includes('deal_title_leak'));
  assert.equal(r.blocked, true);
});

test('an unfilled template is caught', () => {
  assert.ok(codes(runGuards({ text: 'שלום {{first_name}}!', pack })).includes('raw_token'));
  assert.ok(codes(runGuards({ text: 'שלום [הכנס שם]!', pack })).includes('raw_token'));
});

test('a phone number that is not in this conversation is caught', () => {
  const r = runGuards({ text: 'תתקשרו ל-052-1234567 לפרטים.', pack });
  assert.ok(codes(r).includes('foreign_contact'));
});

test('an email that is not in this conversation is caught', () => {
  const r = runGuards({ text: 'שלחו מייל ל-someone@example.com', pack });
  assert.ok(codes(r).includes('foreign_contact'));
});

test('a link outside the allowlist is caught, an allowlisted one passes', () => {
  const bad = runGuards({ text: 'הפרטים כאן: https://random-site.example/x', pack });
  assert.ok(codes(bad).includes('disallowed_link'));

  const good = runGuards({ text: 'הפרטים כאן: https://www.grafitiyul.co.il/tours', pack });
  assert.equal(codes(good).includes('disallowed_link'), false);
});

test('an empty draft is blocked', () => {
  const r = runGuards({ text: '   ', pack });
  assert.deepEqual(codes(r), ['empty']);
  assert.equal(r.blocked, true);
});

test('an over-long draft is flagged but not blocked', () => {
  // Length is a quality signal, not a safety one — it should reach the operator
  // with a note rather than be suppressed.
  const r = runGuards({ text: 'א'.repeat(1600), pack });
  assert.deepEqual(codes(r), ['too_long']);
  assert.equal(r.blocked, false);
});

test('guards run against a completely empty context without throwing', () => {
  // The unmatched-conversation case: no contact, no deal, nothing known.
  const r = runGuards({ text: 'שלום! אשמח לשמוע עוד פרטים כדי לעזור.', pack: {} });
  assert.equal(r.blocked, false);
});
