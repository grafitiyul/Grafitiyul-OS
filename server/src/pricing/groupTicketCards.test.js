// Group Ticket Builder card-derivation tests. Pure — no DB. Covers the
// no-fallback-guessing rule and the structured-identity row shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTicketRows, buildGroupCards } from './groupTicketCards.js';

// A ticket_types rule rep with priced ticket types (as the route includes them).
function ticketCard(cardGroupId, tickets, extra = {}) {
  return {
    cardGroupId,
    priceModel: 'ticket_types',
    product: { nameHe: 'סיור גרפיטי' },
    vatMode: 'included',
    vatRate: 18,
    ticketPrices: tickets.map((t) => ({
      ticketTypeId: t.id,
      priceMinor: t.price,
      ticketType: { nameHe: t.name, sortOrder: t.sortOrder ?? 0 },
    })),
    ...extra,
  };
}

test('ticket_types card → one row per priced ticket type, carrying ticketTypeId', () => {
  const rows = deriveTicketRows(
    ticketCard('cg1', [
      { id: 'tt_adult', name: 'מבוגר', price: 12000, sortOrder: 0 },
      { id: 'tt_child', name: 'ילד', price: 8000, sortOrder: 1 },
    ]),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { key: 'tt:tt_adult', ticketTypeId: 'tt_adult', label: 'מבוגר', unitPriceMinor: 12000 });
  assert.equal(rows[1].ticketTypeId, 'tt_child');
});

test('rows are ordered by ticket-type sortOrder', () => {
  const rows = deriveTicketRows(
    ticketCard('cg1', [
      { id: 'b', name: 'ב', price: 1, sortOrder: 5 },
      { id: 'a', name: 'א', price: 1, sortOrder: 1 },
    ]),
  );
  assert.deepEqual(rows.map((r) => r.ticketTypeId), ['a', 'b']);
});

test('NO fallback: per_head card → null (never invents a row)', () => {
  assert.equal(deriveTicketRows({ priceModel: 'per_head', adultPriceMinor: 5000, ticketPrices: [] }), null);
});

test('NO fallback: fixed card → null', () => {
  assert.equal(deriveTicketRows({ priceModel: 'fixed', fixedPriceMinor: 50000, ticketPrices: [] }), null);
});

test('NO fallback: tiered_group card → null', () => {
  assert.equal(deriveTicketRows({ priceModel: 'tiered_group', tiers: [{ totalPriceMinor: 9 }], ticketPrices: [] }), null);
});

test('ticket_types card with NO priced tickets → null (unconfigured, not invented)', () => {
  assert.equal(deriveTicketRows({ priceModel: 'ticket_types', ticketPrices: [] }), null);
});

test('buildGroupCards dedupes siblings and splits sellable vs unconfigured', () => {
  const rules = [
    // Two sibling rules of the SAME card (one per location) — dedupe to one card.
    ticketCard('cg1', [{ id: 'tt_adult', name: 'מבוגר', price: 12000 }]),
    ticketCard('cg1', [{ id: 'tt_adult', name: 'מבוגר', price: 12000 }]),
    // A flagged-but-unconfigured per_head card.
    { cardGroupId: 'cg2', priceModel: 'per_head', product: { nameHe: 'סדנה' }, adultPriceMinor: 5000, ticketPrices: [] },
  ];
  const { cards, unconfigured } = buildGroupCards(rules);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cardGroupId, 'cg1');
  assert.equal(cards[0].rows.length, 1);
  assert.equal(cards[0].vatMode, 'included');
  assert.equal(unconfigured.length, 1);
  assert.deepEqual(unconfigured[0], { cardGroupId: 'cg2', title: 'סדנה' });
});

test('buildGroupCards ignores rules with no cardGroupId', () => {
  const { cards, unconfigured } = buildGroupCards([
    { cardGroupId: null, priceModel: 'ticket_types', ticketPrices: [{ ticketTypeId: 'x', priceMinor: 1, ticketType: { nameHe: 'X' } }] },
  ]);
  assert.equal(cards.length, 0);
  assert.equal(unconfigured.length, 0);
});
