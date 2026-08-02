import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCollection } from './collection.js';

// The Collection panel must never show a bare document number. Every row has to
// carry what an operator needs to trust it: type, number, date, amount,
// currency, status, what it MEANS for the money, and — for a shared historical
// document — that it settles other deals too and is counted once company-wide.

const deal = (valueMinor, extra = {}) => ({ valueMinor, currency: 'ILS', ...extra });
const doc = (over = {}) => ({
  id: 'd1', doctype: 'invrec', docnum: '38474', amountMinor: 100_000,
  currency: 'ILS', clientName: 'עיריית אור יהודה', status: 'issued',
  issuedAt: '2026-05-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z',
  source: 'backfill', ...over,
});

test('a document row carries every field the panel must display', () => {
  const row = computeCollection(deal(100_000), [doc()]).payments[0];
  assert.equal(row.doctypeLabel, 'חשבונית מס קבלה');
  assert.equal(row.docnum, '38474');
  assert.equal(row.issuedAt, '2026-05-01T00:00:00.000Z');
  assert.equal(row.amountMinor, 100_000);
  assert.equal(row.currency, 'ILS');
  assert.equal(row.status, 'issued');
  assert.equal(row.cancelled, false);
  assert.equal(row.paymentMeaning, 'הוכחת תשלום');
  assert.equal(row.evidenceClass, 'verified');
  assert.equal(row.clientName, 'עיריית אור יהודה');
});

test('payment meaning distinguishes proof of payment from billing paper', () => {
  const rows = computeCollection(deal(100_000), [
    doc({ id: 'a', doctype: 'invrec' }),
    doc({ id: 'b', doctype: 'receipt' }),
    doc({ id: 'c', doctype: 'invoice' }),
    doc({ id: 'd', doctype: 'deal' }),
    doc({ id: 'e', doctype: 'refund' }),
  ]).evidence;
  const by = Object.fromEntries(rows.map((r) => [r.doctype, r.paymentMeaning]));
  assert.equal(by.invrec, 'הוכחת תשלום');
  assert.equal(by.receipt, 'הוכחת תשלום');
  assert.equal(by.invoice, 'מסמך חיוב — אינו הוכחת תשלום');
  assert.equal(by.deal, 'מסמך חיוב — אינו הוכחת תשלום');
  assert.equal(by.refund, 'זיכוי — מופחת מהגבייה');
});

test('a cancelled document says so and contributes nothing', () => {
  const c = computeCollection(deal(100_000), [doc({ status: 'cancelled' })]);
  const row = c.evidence[0];
  assert.equal(row.cancelled, true);
  assert.equal(row.counts, false);
  assert.equal(row.countedMinor, 0);
  assert.equal(row.paymentMeaning, 'מסמך מבוטל — אינו נספר');
  assert.equal(c.paidMinor, 0);
});

test('a shared historical document is badged as such and shows its real size', () => {
  const c = computeCollection(deal(100_000), [
    doc({ amountMinor: 300_000, sharedHistorical: true, allocationMinor: 100_000 }),
  ]);
  const row = c.payments[0];
  assert.equal(row.evidenceClass, 'shared'); // its own badge, not "verified"
  assert.equal(row.sharedHistorical, true);
  assert.equal(row.documentAmountMinor, 300_000); // what the DOCUMENT is worth
  assert.equal(row.countedMinor, 100_000); // what THIS deal counts
  assert.equal(c.status, 'paid');
});

test('a webhook-captured document is badged as provider clearing', () => {
  assert.equal(computeCollection(deal(100_000), [doc({ source: 'webhook' })]).payments[0].evidenceClass, 'provider');
});

test('a manual row is never given document fields', () => {
  const c = computeCollection(deal(100_000), [], [{
    id: 'e1', kind: 'manual_payment', direction: 'in', amountMinor: 100_000,
    currency: 'ILS', paidAt: '2026-07-01T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z', origin: 'operator',
  }]);
  const row = c.payments[0];
  assert.equal(row.evidenceClass, 'manual');
  assert.equal(row.doctype, undefined);
  assert.equal(row.docnum, undefined);
  assert.equal(row.paymentMeaning, undefined);
});
