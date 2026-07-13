import test from 'node:test';
import assert from 'node:assert/strict';
import { tourCustomerNames, tourParticipantBreakdown, groupBreakdownByProduct } from './participants.js';

const deal = (contact, org) => ({
  title: null,
  organization: org ? { name: org } : null,
  contacts: contact ? [{ contact: { firstNameHe: contact, lastNameHe: '' } }] : [],
});

test('tourCustomerNames: distinct labels, order preserved, held only when all held', () => {
  const rows = [
    { status: 'confirmed', deal: deal('ענת', 'IBM') },
    { status: 'held', deal: deal('דנה', null) },
    { status: 'confirmed', deal: deal('ענת', 'IBM') }, // dup label → single entry, confirmed wins
    { status: 'active', deal: null, customerName: 'אתר' }, // website row
  ];
  const names = tourCustomerNames(rows);
  assert.deepEqual(names, [
    { label: 'ענת · IBM', held: false },
    { label: 'דנה', held: true },
    { label: 'אתר', held: false },
  ]);
});

test('tourCustomerNames: a label with one held + one confirmed reg is confirmed', () => {
  const rows = [
    { status: 'held', deal: deal('דנה', null) },
    { status: 'confirmed', deal: deal('דנה', null) },
  ];
  assert.deepEqual(tourCustomerNames(rows), [{ label: 'דנה', held: false }]);
});

test('groupBreakdownByProduct: nests ticket types under products, only positive rows', () => {
  const rows = [
    { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 2 },
    { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_c', ticketLabel: 'ילד', quantity: 1 },
    { cardGroupId: 'c2', cardTitle: 'סיור + סדנה', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 3 },
    { cardGroupId: 'c2', cardTitle: 'סיור + סדנה', ticketTypeId: 't_c', ticketLabel: 'ילד', quantity: 0 }, // dropped
  ];
  const byProduct = groupBreakdownByProduct(rows);
  assert.deepEqual(byProduct, [
    { key: 'c1', label: 'סיור בלבד', total: 3, ticketTypes: [{ key: 't_a', label: 'מבוגר', quantity: 2 }, { key: 't_c', label: 'ילד', quantity: 1 }] },
    { key: 'c2', label: 'סיור + סדנה', total: 3, ticketTypes: [{ key: 't_a', label: 'מבוגר', quantity: 3 }] },
  ]);
});

test('tourParticipantBreakdown: aggregate byProduct + per-customer byProduct, with matching keys', () => {
  const rows = [
    {
      id: 'r1', bookingId: 'b1', dealId: 'd1',
      status: 'confirmed', quantity: 3, deal: deal('ענת', 'IBM'),
      ticketBreakdown: [
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 2 },
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_c', ticketLabel: 'ילד', quantity: 1 },
      ],
    },
    {
      id: 'r2', bookingId: null, dealId: 'd2',
      status: 'held', quantity: 3, deal: deal('דנה', null),
      ticketBreakdown: [{ cardGroupId: 'c2', cardTitle: 'סיור + סדנה', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 3 }],
    },
  ];
  const { aggregate, customers } = tourParticipantBreakdown(rows);
  assert.equal(aggregate.total, 6);
  assert.equal(aggregate.byProduct.length, 2);
  assert.equal(aggregate.byProduct[0].label, 'סיור בלבד');
  assert.equal(aggregate.byProduct[0].ticketTypes.find((t) => t.key === 't_a').quantity, 2);
  // per-customer, with match keys for the guide portal
  assert.equal(customers[0].bookingId, 'b1');
  assert.equal(customers[0].registrationId, 'r1');
  assert.equal(customers[0].total, 3);
  assert.equal(customers[0].byProduct[0].label, 'סיור בלבד');
  assert.equal(customers[1].held, true);
  assert.equal(customers[1].byProduct[0].label, 'סיור + סדנה');
});

test('tourParticipantBreakdown: legacy rows with no breakdown fall back to quantity, no fake products', () => {
  const rows = [{ id: 'r1', status: 'confirmed', quantity: 5, deal: deal('אורח', null), ticketBreakdown: null }];
  const { aggregate, customers } = tourParticipantBreakdown(rows);
  assert.equal(aggregate.total, 5);
  assert.deepEqual(aggregate.byProduct, []);
  assert.equal(customers[0].total, 5);
  assert.deepEqual(customers[0].byProduct, []);
});
