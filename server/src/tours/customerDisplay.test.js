import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactDisplayNameHe,
  dealContactName,
  dealOrganizationName,
  dealBookerLabel,
  resolveBookingsCustomerIdentity,
  withBookingCount,
} from './customerDisplay.js';

// The canonical customer identity: three explicit fields (contact / org /
// booker), a deterministic multi-booking rule, and one "+N" compaction.

const contact = (over = {}) => ({
  firstNameHe: 'דור',
  lastNameHe: 'קורן',
  firstNameEn: 'Dor',
  lastNameEn: 'Koren',
  ...over,
});
const deal = (over = {}) => ({ title: 'דיל', organization: null, contacts: [], ...over });

test('contact name: Hebrew wins, English fallback, empty-safe', () => {
  assert.equal(contactDisplayNameHe(contact()), 'דור קורן');
  assert.equal(contactDisplayNameHe(contact({ firstNameHe: '', lastNameHe: null })), 'Dor Koren');
  assert.equal(contactDisplayNameHe(null), '');
  assert.equal(contactDisplayNameHe({}), '');
});

test('contact column: the person only, never the organization', () => {
  const d = deal({ organization: { name: 'IBM' }, contacts: [{ contact: contact() }] });
  assert.equal(dealContactName(d), 'דור קורן');
  assert.equal(dealContactName(deal()), '', 'no contact → empty');
});

test('organization column: the org only, never the contact', () => {
  const d = deal({ organization: { name: 'IBM' }, contacts: [{ contact: contact() }] });
  assert.equal(dealOrganizationName(d), 'IBM');
  assert.equal(dealOrganizationName(deal()), '', 'no org → empty');
});

test('booker: "contact · organization", degrading each way', () => {
  assert.equal(
    dealBookerLabel(deal({ organization: { name: 'IBM' }, contacts: [{ contact: contact() }] })),
    'דור קורן · IBM',
  );
  assert.equal(
    dealBookerLabel(deal({ organization: null, contacts: [{ contact: contact() }] })),
    'דור קורן',
    'no org → contact only',
  );
  assert.equal(
    dealBookerLabel(deal({ organization: { name: 'IBM' }, contacts: [] })),
    'IBM',
    'no contact → org only',
  );
  assert.equal(
    dealBookerLabel(deal({ title: 'סיור מיוחד', organization: null, contacts: [] })),
    'סיור מיוחד',
    'neither → deal title',
  );
  assert.equal(dealBookerLabel(deal({ title: null })), null);
  assert.equal(dealBookerLabel(null), null);
});

test('multi-booking: first non-empty per field (stable order), additionalBookingCount = others', () => {
  const bookings = [
    // first booking: org only, no contact
    { deal: deal({ organization: { name: 'IBM' }, contacts: [] }) },
    // second: a contact, different org
    { deal: deal({ organization: { name: 'אינטל' }, contacts: [{ contact: contact() }] }) },
    { deal: deal({ title: 'שלישי' }) },
  ];
  const id = resolveBookingsCustomerIdentity(bookings);
  assert.equal(id.contactDisplayName, 'דור קורן', 'first NON-EMPTY contact, not blank from booking #1');
  assert.equal(id.organizationDisplayName, 'IBM', 'first non-empty org');
  assert.equal(id.bookerDisplayName, 'IBM', 'first booking already yields a booker');
  assert.equal(id.additionalBookingCount, 2);
});

test('multi-booking: empty / single / all-empty', () => {
  assert.deepEqual(resolveBookingsCustomerIdentity([]), {
    contactDisplayName: null,
    organizationDisplayName: null,
    bookerDisplayName: null,
    additionalBookingCount: 0,
  });
  const single = resolveBookingsCustomerIdentity([
    { deal: deal({ organization: { name: 'IBM' }, contacts: [{ contact: contact() }] }) },
  ]);
  assert.deepEqual(single, {
    contactDisplayName: 'דור קורן',
    organizationDisplayName: 'IBM',
    bookerDisplayName: 'דור קורן · IBM',
    additionalBookingCount: 0,
  });
  // Bookings present but resolving to nothing → null fields, count still counts.
  const empty = resolveBookingsCustomerIdentity([
    { deal: deal({ title: null }) },
    { deal: deal({ title: null }) },
  ]);
  assert.equal(empty.bookerDisplayName, null);
  assert.equal(empty.additionalBookingCount, 1);
});

test('withBookingCount: "value +N" compaction', () => {
  assert.equal(withBookingCount('דור קורן', 0), 'דור קורן');
  assert.equal(withBookingCount('דור קורן', 2), 'דור קורן +2');
  assert.equal(withBookingCount('IBM', 1), 'IBM +1');
  assert.equal(withBookingCount(null, 3), null, 'no base value → null, never "+N" alone');
});
