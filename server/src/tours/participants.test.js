import test from 'node:test';
import assert from 'node:assert/strict';
import { tourCustomerNames, tourParticipantBreakdown } from './participants.js';

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

test('tourParticipantBreakdown: aggregate + per-customer, generic dimensions only', () => {
  const rows = [
    {
      status: 'confirmed',
      quantity: 12,
      deal: deal('ענת', 'IBM'),
      ticketBreakdown: [
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 8 },
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_c', ticketLabel: 'ילד', quantity: 4 },
      ],
    },
    {
      status: 'held',
      quantity: 4,
      deal: deal('דנה', null),
      ticketBreakdown: [
        { cardGroupId: 'c2', cardTitle: 'סיור + סדנה', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 4 },
      ],
    },
  ];
  const { aggregate, customers } = tourParticipantBreakdown(rows);
  assert.equal(aggregate.total, 16);
  assert.deepEqual(aggregate.byCard, [
    { key: 'c1', label: 'סיור בלבד', quantity: 12 },
    { key: 'c2', label: 'סיור + סדנה', quantity: 4 },
  ]);
  assert.deepEqual(aggregate.byTicketType, [
    { key: 't_a', label: 'מבוגר', quantity: 12 },
    { key: 't_c', label: 'ילד', quantity: 4 },
  ]);
  assert.equal(customers.length, 2);
  assert.equal(customers[0].label, 'ענת · IBM');
  assert.equal(customers[0].held, false);
  assert.equal(customers[0].quantity, 12);
  assert.equal(customers[1].held, true);
});

test('tourParticipantBreakdown: legacy rows with no breakdown fall back to quantity, no fake dimensions', () => {
  const rows = [{ status: 'confirmed', quantity: 5, deal: deal('אורח', null), ticketBreakdown: null }];
  const { aggregate, customers } = tourParticipantBreakdown(rows);
  assert.equal(aggregate.total, 5);
  assert.deepEqual(aggregate.byCard, []);
  assert.deepEqual(aggregate.byTicketType, []);
  assert.equal(customers[0].quantity, 5);
  assert.deepEqual(customers[0].breakdown, []);
});
