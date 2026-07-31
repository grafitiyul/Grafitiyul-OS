import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactDisplayNameHe,
  dealContactName,
  dealOrganizationName,
  dealBookerLabel,
  resolveBookingsCustomerIdentity,
  bookingsCustomerInfos,
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

// ── per-booking customer notes (the Tours table's מידע חשוב על הלקוח) ──

test('bookingsCustomerInfos: ONE entry per booking, silent customers included', () => {
  const infos = bookingsCustomerInfos([
    {
      deal: deal({
        customerInfo: '<p>יש אלרגיה</p>',
        organization: { name: 'IBM' },
        contacts: [{ contact: contact() }],
      }),
    },
    { deal: deal({ title: 'דיל בלי מידע', customerInfo: null }) },
  ]);
  assert.equal(infos.length, 2, 'a customer without a note is NEVER skipped');
  assert.equal(infos[0].html, '<p>יש אלרגיה</p>');
  assert.equal(infos[0].label, 'דור קורן · IBM', 'canonical booker label');
  assert.equal(infos[1].html, null, 'no note ships as null, not an empty string');
  assert.equal(infos[1].label, 'דיל בלי מידע');
});

test('bookingsCustomerInfos: order preserved, deal-less rows dropped, empty input safe', () => {
  const infos = bookingsCustomerInfos([
    { deal: deal({ title: 'A', customerInfo: '<p>a</p>' }) },
    { deal: null },
    { deal: deal({ title: 'B', customerInfo: '<p>b</p>' }) },
  ]);
  assert.deepEqual(infos.map((i) => i.label), ['A', 'B'], 'caller order is preserved');
  assert.deepEqual(bookingsCustomerInfos([]), []);
  assert.deepEqual(bookingsCustomerInfos(null), []);
});

test('bookingsCustomerInfos: an unlabelable deal still gets a readable heading', () => {
  const infos = bookingsCustomerInfos([{ deal: deal({ title: null }) }]);
  assert.equal(infos[0].label, 'לקוח', 'never an empty heading');
});
