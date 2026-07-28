import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSignedQuoteContext } from './quoteSignedEvent.js';

const deal = {
  valueMinor: 500000n, tourDate: '2026-10-01', tourTime: '09:00',
  product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'תל אביב' },
};
const parallelOffer = {
  contextMode: 'own', isPrimary: false, valueMinor: 372000n,
  tourDate: '2026-11-15', tourTime: '17:00',
  product: { nameHe: 'סדנת גרפיטי' }, location: { nameHe: 'חיפה' },
};

test('a parallel offer reports ITS OWN context, never the deal', () => {
  const c = resolveSignedQuoteContext(parallelOffer, deal);
  assert.deepEqual(c, {
    tourDate: '2026-11-15', tourTime: '17:00',
    productName: 'סדנת גרפיטי - חיפה', totalMinor: 372000,
  });
});

test('a primary offer reports the DEAL context — the system invariant', () => {
  const primary = { contextMode: 'deal', isPrimary: true, valueMinor: null, tourDate: '9999-01-01', product: { nameHe: 'לא בשימוש' } };
  const c = resolveSignedQuoteContext(primary, deal);
  assert.equal(c.tourDate, '2026-10-01');
  assert.equal(c.tourTime, '09:00');
  assert.equal(c.productName, 'סיור גרפיטי - תל אביב');
  assert.equal(c.totalMinor, 500000);
});

test('a primary offer with its own computed total prefers that total', () => {
  const primary = { contextMode: 'deal', isPrimary: true, valueMinor: 610000n };
  assert.equal(resolveSignedQuoteContext(primary, deal).totalMinor, 610000);
});

test('a parallel offer with no total reports nothing rather than the deal headline', () => {
  const c = resolveSignedQuoteContext({ ...parallelOffer, valueMinor: null }, deal);
  assert.equal(c.totalMinor, null);
});

test('a legacy document with no offer falls back to the deal', () => {
  const c = resolveSignedQuoteContext(null, deal);
  assert.equal(c.productName, 'סיור גרפיטי - תל אביב');
  assert.equal(c.totalMinor, 500000);
});

test('missing product/location produce null, never a stray separator', () => {
  const c = resolveSignedQuoteContext({ contextMode: 'own', product: null, location: null }, null);
  assert.equal(c.productName, null);
});
