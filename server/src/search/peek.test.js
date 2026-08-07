import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPeek, PEEK_TYPES } from './peek.js';

// A fake db that also RECORDS what was asked for — the peek must stay one
// bounded read per entity, never a walk of the full CRM record.
function fakeDb({ contact = null, organization = null } = {}) {
  const calls = [];
  return {
    calls,
    contact: {
      findUnique: async (args) => { calls.push(['contact', args]); return contact; },
    },
    organization: {
      findUnique: async (args) => { calls.push(['organization', args]); return organization; },
    },
  };
}

const CONTACT = {
  id: 'c1', contactNo: 50123,
  firstNameHe: 'דנה', lastNameHe: 'כהן', firstNameEn: 'Dana', lastNameEn: 'Cohen',
  phones: [
    { value: '0521234567', label: 'נייד', isPrimary: true },
    { value: '036543210', label: 'משרד', isPrimary: false },
    { value: '0509999999', label: null, isPrimary: false },
    { value: '0501111111', label: null, isPrimary: false },
  ],
  emails: [
    { value: 'dana@example.com', label: null, isPrimary: true },
    { value: 'dana.cohen@work.com', label: 'עבודה', isPrimary: false },
    { value: 'third@example.com', label: null, isPrimary: false },
  ],
  orgLinks: [
    { isPrimary: true, role: 'רכזת', organization: { id: 'o1', orgNo: 10001, name: 'סמסונג' }, organizationUnit: { id: 'u1', name: 'HR' } },
    { isPrimary: false, role: null, organization: { id: 'o2', orgNo: 10002, name: 'אלביט' }, organizationUnit: null },
    { isPrimary: false, role: null, organization: { id: 'o3', orgNo: 10003, name: 'טבע' }, organizationUnit: null },
    { isPrimary: false, role: null, organization: { id: 'o4', orgNo: 10004, name: 'אינטל' }, organizationUnit: null },
  ],
  _count: { dealContacts: 7 },
};

const ORG = {
  id: 'o1', orgNo: 10001, name: 'סמסונג',
  organizationType: { label: 'חברה עסקית' },
  units: [{ id: 'u1', name: 'HR' }, { id: 'u2', name: 'R&D' }, { id: 'u3', name: 'מכירות' }, { id: 'u4', name: 'כספים' }],
  _count: { deals: 12, contactLinks: 5 },
};

test('a contact peek carries exactly what the card shows', async () => {
  const db = fakeDb({ contact: CONTACT });
  const out = await loadPeek('contact', 'c1', { db });
  assert.equal(out.type, 'contact');
  assert.equal(out.path, '/admin/crm/contacts/50123');
  assert.equal(out.nameHe, 'דנה כהן');
  assert.equal(out.nameEn, 'Dana Cohen');
  assert.equal(out.dealCount, 7);
  assert.equal(db.calls.length, 1, 'one bounded read, never a record walk');
});

test('long lists are capped and the remainder is COUNTED, never silently dropped', async () => {
  const out = await loadPeek('contact', 'c1', { db: fakeDb({ contact: CONTACT }) });
  assert.equal(out.phones.length, 3);
  assert.equal(out.emails.length, 2);
  assert.equal(out.organizations.length, 3);
  assert.equal(out.moreOrganizations, 1, '4 links, 3 shown → "ועוד 1"');
});

test('the primary organization leads, and the unit travels with it', async () => {
  const out = await loadPeek('contact', 'c1', { db: fakeDb({ contact: CONTACT }) });
  assert.equal(out.organizations[0].name, 'סמסונג');
  assert.equal(out.organizations[0].isPrimary, true);
  assert.equal(out.organizations[0].unitName, 'HR');
  assert.equal(out.organizations[0].path, '/admin/crm/organizations/10001');
});

test('an organization peek shows its TYPE — subtype is never read from here', async () => {
  const out = await loadPeek('organization', 'o1', { db: fakeDb({ organization: ORG }) });
  assert.equal(out.typeLabel, 'חברה עסקית');
  // Subtype lives on the Deal by schema. If this object ever grows one, the
  // card would be showing a property the organization does not own.
  assert.ok(!('subtypeLabel' in out) && !('organizationSubtype' in out));
  assert.equal(out.units.length, 3);
  assert.equal(out.moreUnits, 1);
  assert.equal(out.dealCount, 12);
  assert.equal(out.contactCount, 5);
});

test('a deleted or unknown entity peeks to null rather than throwing', async () => {
  assert.equal(await loadPeek('contact', 'gone', { db: fakeDb() }), null);
  assert.equal(await loadPeek('organization', 'gone', { db: fakeDb() }), null);
});

test('only the two supported types are peekable — no arbitrary model access', async () => {
  assert.deepEqual(PEEK_TYPES, ['contact', 'organization']);
  const db = fakeDb({ contact: CONTACT });
  assert.equal(await loadPeek('deal', 'd1', { db }), null);
  assert.equal(await loadPeek('adminUser', 'a1', { db }), null);
  assert.equal(await loadPeek('contact', '', { db }), null);
  assert.equal(db.calls.length, 0, 'an unsupported type must not reach the database');
});
