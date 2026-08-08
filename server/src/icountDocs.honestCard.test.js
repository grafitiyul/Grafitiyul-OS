// The #27151 class: an accounting document must never state a payment fact GOS
// does not know.
//
// The audit found `card_number:'0000'`, `card_type:'VISA'`, `holder_id:
// '000000000'` and an invented expiry printed on a real customer's חשבונית מס
// קבלה, for a Tranzila charge whose last four digits the gateway never sent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentBlocks, normalizeBasedOnList } from './icountDocs.js';

const base = { method: 'cc', amount: 250, date: '2026-08-07' };

// ── Nothing is invented ──────────────────────────────────────────────────────

test('unknown last-four is OMITTED — never 0000', () => {
  const { cc } = buildPaymentBlocks([{ ...base }]);
  assert.equal('card_number' in cc, false);
  assert.notEqual(cc.card_number, '0000');
});

test('unknown card brand is OMITTED — never VISA', () => {
  const { cc } = buildPaymentBlocks([{ ...base }]);
  assert.equal('card_type' in cc, false);
});

test('expiry and holder id are never fabricated', () => {
  const { cc } = buildPaymentBlocks([{ ...base }]);
  assert.equal('exp_year' in cc, false);
  assert.equal('exp_month' in cc, false);
  assert.equal('holder_id' in cc, false);
});

test('a missing approval code leaves confirmation_code absent, not "000000"', () => {
  const { cc } = buildPaymentBlocks([{ ...base }]);
  assert.equal('confirmation_code' in cc, false);
});

test('the amount fields — the facts we DO know — are always sent', () => {
  const { cc } = buildPaymentBlocks([{ ...base }]);
  assert.equal(cc.sum, '250');
  assert.equal(cc.first_payment, '250');
  assert.equal(cc.date, '2026-08-07');
  assert.equal(cc.num_of_payments, 1);
});

// ── Real values pass through ─────────────────────────────────────────────────

test('a genuine last-four IS sent', () => {
  const { cc } = buildPaymentBlocks([{ ...base, cardLast4: '4821' }]);
  assert.equal(cc.card_number, '4821');
});

test('anything that is not four digits is NOT a last-four', () => {
  for (const junk of ['0000x', '48', 'XXXX', '', null, undefined, '1234567890123456']) {
    const { cc } = buildPaymentBlocks([{ ...base, cardLast4: junk }]);
    assert.equal('card_number' in cc, false, `${junk} must not be treated as a last-four`);
  }
  // '0000' from a GATEWAY would be a real four-digit value; the point of the
  // fix is that GOS never MINTS it. If a provider genuinely reports 0000 we
  // report what it said.
  assert.equal(buildPaymentBlocks([{ ...base, cardLast4: '0000' }]).cc.card_number, '0000');
});

test('a real approval code becomes the confirmation code', () => {
  // #27151's actual Tranzila approval number.
  const { cc } = buildPaymentBlocks([{ ...base, reference: '0430435' }]);
  assert.equal(cc.confirmation_code, '0430435');
});

test('holder name is known and is sent', () => {
  const { cc } = buildPaymentBlocks([{ ...base, holderName: 'Sabrina Aouizerate' }]);
  assert.equal(cc.holder_name, 'Sabrina Aouizerate');
});

test('real expiry + holder id are sent when supplied together', () => {
  const { cc } = buildPaymentBlocks([{ ...base, expYear: 2029, expMonth: 4, holderId: '123456782' }]);
  assert.equal(cc.exp_year, 2029);
  assert.equal(cc.exp_month, 4);
  assert.equal(cc.holder_id, '123456782');
  // A half-known expiry is no expiry.
  const half = buildPaymentBlocks([{ ...base, expYear: 2029 }]).cc;
  assert.equal('exp_year' in half, false);
});

// ── The provider-compatibility fallback ──────────────────────────────────────

test('the fallback shape uses EMPTY values, still never fabricated digits', () => {
  const { cc } = buildPaymentBlocks([{ ...base }], { emptyUnknownCardFields: true });
  assert.equal(cc.card_number, '');
  assert.equal(cc.card_type, '');
  assert.equal(cc.holder_id, '');
  assert.notEqual(cc.card_number, '0000');
});

test('the fallback never blanks a field we actually know', () => {
  const { cc } = buildPaymentBlocks(
    [{ ...base, cardLast4: '4821', cardType: 'MASTERCARD' }],
    { emptyUnknownCardFields: true },
  );
  assert.equal(cc.card_number, '4821');
  assert.equal(cc.card_type, 'MASTERCARD');
});

// ── Other payment blocks are untouched ───────────────────────────────────────

test('cash / bank transfer / Bit blocks are unchanged', () => {
  assert.deepEqual(buildPaymentBlocks([{ method: 'cash', amount: 100 }]).cash, { sum: '100' });
  assert.equal(buildPaymentBlocks([{ method: 'banktransfer', amount: 100, date: '2026-08-07', reference: '55' }]).banktransfer.account, '55');
  assert.deepEqual(buildPaymentBlocks([{ method: 'bit', amount: 100 }]).payment_app, { card_brand: 'bit', sum: '100' });
});

// ── Multiple source documents ────────────────────────────────────────────────

test('based_on accepts a list, a single object, or nothing', () => {
  assert.deepEqual(normalizeBasedOnList([{ doctype: 'invoice', docnum: 10 }, { doctype: 'invoice', docnum: '11' }]),
    [{ doctype: 'invoice', docnum: '10' }, { doctype: 'invoice', docnum: '11' }]);
  // The historical singular API still works — backward compatibility.
  assert.deepEqual(normalizeBasedOnList({ doctype: 'deal', docnum: '7' }), [{ doctype: 'deal', docnum: '7' }]);
  assert.deepEqual(normalizeBasedOnList(null), []);
  assert.deepEqual(normalizeBasedOnList([]), []);
  // Incomplete entries are dropped, never sent as half a reference.
  assert.deepEqual(normalizeBasedOnList([{ doctype: 'invoice' }, { docnum: '5' }, { doctype: 'invoice', docnum: '' }]), []);
});
