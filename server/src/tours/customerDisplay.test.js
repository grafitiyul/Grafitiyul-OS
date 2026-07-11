import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactDisplayNameHe,
  dealCustomerLabel,
  bookingsCustomerSummary,
  bookingsOrganizationSummary,
} from './customerDisplay.js';

// Compact customer labels for tour list/calendar DTOs — org → primary
// contact → deal title, deterministic "+N" summaries for multi-booking tours.

const contact = (over = {}) => ({
  firstNameHe: 'דור',
  lastNameHe: 'קורן',
  firstNameEn: 'Dor',
  lastNameEn: 'Koren',
  ...over,
});

test('contact name: Hebrew wins, English fallback, empty-safe', () => {
  assert.equal(contactDisplayNameHe(contact()), 'דור קורן');
  assert.equal(
    contactDisplayNameHe(contact({ firstNameHe: '', lastNameHe: null })),
    'Dor Koren',
  );
  assert.equal(contactDisplayNameHe(null), '');
  assert.equal(contactDisplayNameHe({}), '');
});

test('deal label: organization name first', () => {
  assert.equal(
    dealCustomerLabel({
      title: 'דיל',
      organization: { name: 'IBM' },
      contacts: [{ contact: contact() }],
    }),
    'IBM',
  );
});

test('deal label: primary contact when no organization', () => {
  assert.equal(
    dealCustomerLabel({ title: 'דיל', organization: null, contacts: [{ contact: contact() }] }),
    'דור קורן',
  );
});

test('deal label: deal title as the last resort; null-safe', () => {
  assert.equal(dealCustomerLabel({ title: 'סיור חברת היי-טק', contacts: [] }), 'סיור חברת היי-טק');
  assert.equal(dealCustomerLabel({ title: null, contacts: [] }), null);
  assert.equal(dealCustomerLabel(null), null);
});

test('bookings summary: 0 → null, 1 → the label, N → deterministic "first +N-1"', () => {
  assert.equal(bookingsCustomerSummary([]), null);
  assert.equal(bookingsCustomerSummary(null), null);
  assert.equal(
    bookingsCustomerSummary([{ deal: { organization: { name: 'IBM' }, contacts: [] } }]),
    'IBM',
  );
  assert.equal(
    bookingsCustomerSummary([
      { deal: { organization: { name: 'IBM' }, contacts: [] } },
      { deal: { organization: null, contacts: [{ contact: contact() }] } },
      { deal: { title: 'עוד דיל', contacts: [] } },
    ]),
    'IBM +2',
  );
  // A booking whose deal resolves to no label is skipped, not counted.
  assert.equal(
    bookingsCustomerSummary([
      { deal: { title: null, contacts: [] } },
      { deal: { organization: { name: 'אינטל' }, contacts: [] } },
    ]),
    'אינטל',
  );
});

test('organization summary: distinct org names only, "+N" compaction, null when none', () => {
  assert.equal(bookingsOrganizationSummary([]), null);
  assert.equal(
    bookingsOrganizationSummary([{ deal: { organization: null } }, { deal: null }]),
    null,
  );
  assert.equal(
    bookingsOrganizationSummary([
      { deal: { organization: { name: 'IBM' } } },
      { deal: { organization: { name: 'IBM' } } },
    ]),
    'IBM',
    'duplicate orgs collapse',
  );
  assert.equal(
    bookingsOrganizationSummary([
      { deal: { organization: { name: 'IBM' } } },
      { deal: { organization: null } },
      { deal: { organization: { name: 'אינטל' } } },
    ]),
    'IBM +1',
  );
});
