import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newPaymentToken,
  pickPaymentContact,
  buildPaymentSnapshot,
  linkMatchesSnapshot,
} from './dealPayment.js';

// ── newPaymentToken ──────────────────────────────────────────────────────────
test('newPaymentToken: URL-safe and unique across many generations', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = newPaymentToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.ok(t.length >= 24, 'high-entropy token');
    assert.ok(!seen.has(t), 'no collisions');
    seen.add(t);
  }
});

// ── pickPaymentContact ───────────────────────────────────────────────────────
const dc = (over) => ({ receivePaymentLinks: false, contact: {}, ...over });

test('pickPaymentContact: receivePaymentLinks wins over list order', () => {
  const flagged = dc({ receivePaymentLinks: true, contact: { firstNameHe: 'ב' } });
  const first = dc({ contact: { firstNameHe: 'א' } });
  assert.equal(pickPaymentContact([first, flagged]), flagged);
});

test('pickPaymentContact: falls back to the first (primary-ordered) contact', () => {
  const first = dc({ contact: { firstNameHe: 'א' } });
  assert.equal(pickPaymentContact([first, dc({})]), first);
  assert.equal(pickPaymentContact([]), null);
  assert.equal(pickPaymentContact(undefined), null);
});

// ── buildPaymentSnapshot ─────────────────────────────────────────────────────
const baseDeal = () => ({
  title: 'סיור גרפיטי לחברה',
  valueMinor: 540000n,
  currency: 'ILS',
  product: { nameHe: 'סיור גרפיטי' },
  contacts: [
    dc({
      contact: {
        firstNameHe: 'רחל',
        lastNameHe: 'כהן',
        phones: [{ value: '0501234567' }],
        emails: [{ value: 'rachel@example.com' }],
      },
    }),
  ],
});

test('buildPaymentSnapshot: full deal → all prefill fields', () => {
  const s = buildPaymentSnapshot(baseDeal());
  assert.deepEqual(s, {
    amountMinor: 540000n,
    currency: 'ILS',
    productName: 'סיור גרפיטי',
    firstName: 'רחל',
    lastName: 'כהן',
    customerName: 'רחל כהן',
    customerPhone: '0501234567',
    customerEmail: 'rachel@example.com',
  });
});

test('buildPaymentSnapshot: product name falls back to deal title', () => {
  const d = { ...baseDeal(), product: null };
  assert.equal(buildPaymentSnapshot(d).productName, 'סיור גרפיטי לחברה');
});

test('buildPaymentSnapshot: no contacts → null customer fields (optional prefill)', () => {
  const d = { ...baseDeal(), contacts: [] };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.customerName, null);
  assert.equal(s.customerPhone, null);
  assert.equal(s.customerEmail, null);
  assert.equal(s.firstName, '');
});

test('buildPaymentSnapshot: Hebrew name missing → English fallback', () => {
  const d = { ...baseDeal(), contacts: [dc({ contact: { firstNameEn: 'Rachel', lastNameEn: 'Cohen' } })] };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.customerName, 'Rachel Cohen');
});

// ── linkMatchesSnapshot (the regenerate-only-on-drift gate) ──────────────────
const matchingLink = () => ({
  amountMinor: 540000n,
  currency: 'ILS',
  productName: 'סיור גרפיטי',
  customerName: 'רחל כהן',
  customerPhone: '0501234567',
  customerEmail: 'rachel@example.com',
});

test('linkMatchesSnapshot: unchanged deal → reuse (no regenerate)', () => {
  assert.equal(linkMatchesSnapshot(matchingLink(), buildPaymentSnapshot(baseDeal())), true);
});

test('linkMatchesSnapshot: no active link → regenerate', () => {
  assert.equal(linkMatchesSnapshot(null, buildPaymentSnapshot(baseDeal())), false);
});

test('linkMatchesSnapshot: each relevant drift forces a new link', () => {
  const snap = buildPaymentSnapshot(baseDeal());
  for (const [field, value] of [
    ['amountMinor', 600000n],
    ['productName', 'סיור אחר'],
    ['customerName', 'דנה לוי'],
    ['customerPhone', '0529999999'],
    ['customerEmail', 'other@example.com'],
    ['currency', 'USD'],
  ]) {
    assert.equal(linkMatchesSnapshot({ ...matchingLink(), [field]: value }, snap), false, `${field} drift`);
  }
});

test('linkMatchesSnapshot: BigInt/number amount representations compare equal', () => {
  // Prisma returns BigInt; serialized copies may carry numbers — same value must match.
  assert.equal(linkMatchesSnapshot({ ...matchingLink(), amountMinor: 540000 }, buildPaymentSnapshot(baseDeal())), true);
});
