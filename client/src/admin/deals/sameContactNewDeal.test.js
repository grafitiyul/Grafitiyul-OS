import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameContactActionState, chooserRow } from './sameContactNewDeal.js';

// "פתח דיל חדש לאותו איש קשר" — the Deal-header entry into the canonical
// CreateDealModal. These tests pin the start-mode decision (none/direct/choose)
// and the chooser-row derivation.

test('no linked contacts → mode none (action disabled, never guessed)', () => {
  // A deal with a title, an organization and a phone-looking title must NOT
  // invent a contact — only DealContact rows count.
  const deal = { title: 'ליד חדש - 052-1234567', organizationId: 'o1', contacts: [] };
  assert.deepEqual(sameContactActionState(deal), { mode: 'none', rows: [] });
  assert.equal(sameContactActionState({}).mode, 'none');
  assert.equal(sameContactActionState(null).mode, 'none');
});

test('exactly one linked contact → direct mode with that row', () => {
  const dc = { id: 'dc1', contactId: 'c1', isPrimary: true, contact: { firstNameHe: 'דנה' } };
  const st = sameContactActionState({ contacts: [dc] });
  assert.equal(st.mode, 'direct');
  assert.equal(st.rows.length, 1);
  assert.equal(st.rows[0].contactId, 'c1');
});

test('multiple linked contacts → choose mode with all rows', () => {
  const st = sameContactActionState({
    contacts: [
      { id: 'dc1', contactId: 'c1', isPrimary: true, contact: {} },
      { id: 'dc2', contactId: 'c2', isPrimary: false, contact: {} },
    ],
  });
  assert.equal(st.mode, 'choose');
  assert.equal(st.rows.length, 2);
});

test('chooserRow — name, primary phone/email and primary flag', () => {
  const row = chooserRow({
    contactId: 'c1',
    isPrimary: true,
    contact: {
      firstNameHe: 'ישראל',
      lastNameHe: 'ישראלי',
      phones: [{ value: '052-1234567', isPrimary: true }],
      emails: [{ value: 'israel@example.com', isPrimary: true }],
    },
  });
  assert.deepEqual(row, {
    contactId: 'c1',
    name: 'ישראל ישראלי',
    phone: '052-1234567',
    email: 'israel@example.com',
    isPrimary: true,
  });
});

test('chooserRow — Latin-only contact falls back to the English pair', () => {
  const row = chooserRow({
    contactId: 'c2',
    isPrimary: false,
    contact: { firstNameEn: 'John', lastNameEn: 'Smith', phones: [], emails: [] },
  });
  assert.equal(row.name, 'John Smith');
  assert.equal(row.phone, '');
  assert.equal(row.email, '');
  assert.equal(row.isPrimary, false);
});

test('chooserRow — missing contact payload degrades to a dash, never throws', () => {
  const row = chooserRow({ contactId: 'c3' });
  assert.equal(row.name, '—');
  assert.equal(row.isPrimary, false);
});
