import test from 'node:test';
import assert from 'node:assert/strict';
import { emitPaymentCompleted, PAYMENT_SOURCE_LINK } from './paymentCompleted.js';

// Report #1's narrowed trigger: a LINK payment on an ALREADY-WON deal, and
// nothing else. The payment that itself closed the deal belongs to Report #26.

const log = { log() {}, error() {} };

function run(payload) {
  const triggers = [];
  const reports = [];
  emitPaymentCompleted(payload, log, {
    fireTrigger: (t) => triggers.push(t),
    fireReport: async (r) => { reports.push(r); },
  });
  return { triggers, reports };
}

const base = {
  dealId: 'd1', amountMinor: 150000, currency: 'ILS',
  provider: 'cardcom', reference: 'txn_1', source: PAYMENT_SOURCE_LINK,
};

test('#1 fires for a link payment on an already-WON deal', () => {
  const { triggers, reports } = run({ ...base, dealWasWonBeforePayment: true });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].number, 1);
  assert.equal(reports[0].idempotencyKey, 'cardcom:d1:txn_1');
  // The CC payment_received trigger fires either way.
  assert.equal(triggers.length, 1);
});

test('#1 does NOT fire for the payment that itself closed the deal', () => {
  const { triggers, reports } = run({ ...base, dealWasWonBeforePayment: false });
  assert.equal(reports.length, 0, 'that payment is Report #26\'s, not #1\'s');
  assert.equal(triggers.length, 1, 'the CC trigger still announces the payment');
});

test('#1 does NOT fire when the pre-payment status is unknown (missing flag defaults to false)', () => {
  const { reports } = run({ ...base });
  assert.equal(reports.length, 0);
});

test('#1 never fires for non-link sources, already-WON or not', () => {
  const { reports } = run({ ...base, source: 'office', dealWasWonBeforePayment: true });
  assert.equal(reports.length, 0);
});

test('no dealId → nothing fires at all', () => {
  const { triggers, reports } = run({ ...base, dealId: null, dealWasWonBeforePayment: true });
  assert.equal(triggers.length, 0);
  assert.equal(reports.length, 0);
});
