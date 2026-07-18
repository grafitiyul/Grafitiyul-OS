import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFinanceContact,
  setOrganizationFinanceContact,
  financeContactDisplay,
  FINANCE_ORG_ROLE,
} from './financeContact.js';

// The ONE finance-contact write path: canonical identity matching
// (phone → email → create, never by name), org membership, designation
// transfer that never touches the previous Contact, timeline evidence, and
// the service-owned scalar mirror.

function fakeTx({
  org,
  phones = [],
  emails = [],
  memberships = [],
} = {}) {
  const state = {
    org: { financeContactId: null, financeContactName: null, financeEmail: null, financePhone: null, financeContact: null, ...org },
    createdContacts: [],
    createdMemberships: [],
    orgUpdates: [],
    timeline: [],
  };
  return {
    state,
    contactPhone: {
      findMany: async ({ where }) => phones.filter((p) => p.value.includes(where.value.contains)),
    },
    contactEmail: {
      findFirst: async ({ where }) =>
        emails.find((e) => e.value.toLowerCase() === where.value.equals.toLowerCase()) || null,
    },
    contact: {
      create: async ({ data }) => {
        const row = { id: `new${state.createdContacts.length + 1}`, ...data };
        state.createdContacts.push(row);
        return { id: row.id };
      },
    },
    contactOrganization: {
      findFirst: async ({ where }) =>
        memberships.find((m) => m.contactId === where.contactId && m.organizationId === where.organizationId) || null,
      create: async ({ data }) => {
        state.createdMemberships.push(data);
        return data;
      },
    },
    organization: {
      findUnique: async () => ({ id: 'org1', ...state.org }),
      update: async ({ data }) => {
        state.orgUpdates.push(data);
        Object.assign(state.org, data);
        return state.org;
      },
    },
    timelineEntry: {
      create: async ({ data }) => {
        state.timeline.push(data);
        return data;
      },
    },
  };
}

test('matching priority: canonical phone match wins even when the email matches another contact', async () => {
  const tx = fakeTx({
    phones: [{ contactId: 'cPhone', value: '+972-50-1234567' }],
    emails: [{ contactId: 'cEmail', value: 'fin@a.co' }],
  });
  const r = await resolveFinanceContact(tx, { name: 'רותי', email: 'fin@a.co', phone: '050-1234567' });
  assert.deepEqual(r, { contactId: 'cPhone', matchedBy: 'phone' });
});

test('email match applies only when no phone match exists (case-insensitive)', async () => {
  const tx = fakeTx({ emails: [{ contactId: 'cEmail', value: 'Fin@A.co' }] });
  const r = await resolveFinanceContact(tx, { name: 'רותי', email: 'fin@a.CO', phone: '050-9999999' });
  assert.deepEqual(r, { contactId: 'cEmail', matchedBy: 'email' });
});

test('no identity match creates ONE new contact — names never merge people', async () => {
  const tx = fakeTx({
    // An existing person with the SAME NAME but different phone+email must
    // not be matched (name-based merging is forbidden).
    phones: [{ contactId: 'cOther', value: '050-1111111' }],
    emails: [{ contactId: 'cOther', value: 'other@a.co' }],
  });
  const r = await resolveFinanceContact(tx, { name: 'רותי לוין', email: 'ruti@b.co', phone: '052-2222222' });
  assert.equal(r.matchedBy, 'created');
  assert.equal(tx.state.createdContacts.length, 1);
  const c = tx.state.createdContacts[0];
  assert.equal(c.firstNameHe, 'רותי');
  assert.equal(c.lastNameHe, 'לוין');
  assert.equal(c.phones.create.value, '052-2222222'); // original value preserved
  assert.equal(c.emails.create.value, 'ruti@b.co');
});

test('role transfer: designation moves, previous Contact untouched, timeline records the change', async () => {
  const tx = fakeTx({
    org: {
      financeContactId: 'cOld',
      financeContactName: 'משה ישן',
      financeEmail: 'old@a.co',
      financePhone: '03-1111111',
      financeContact: { id: 'cOld', firstNameHe: 'משה', lastNameHe: 'ישן' },
    },
  });
  const r = await setOrganizationFinanceContact(tx, {
    organizationId: 'org1',
    name: 'רותי לוין',
    email: 'ruti@b.co',
    phone: '052-2222222',
    source: 'travel_agent',
    context: { submissionKey: 'sub_x' },
  });
  assert.equal(r.changed, true);
  assert.equal(r.previousContactId, 'cOld');
  // Mirror rewritten to the new nomination; designation moved.
  assert.equal(tx.state.org.financeContactId, r.contactId);
  assert.equal(tx.state.org.financeEmail, 'ruti@b.co');
  // The previous contact was never updated/deleted (no contact.update exists
  // on the fake at all — the service has no such call path).
  // Membership link created with the finance role.
  assert.equal(tx.state.createdMemberships[0].role, FINANCE_ORG_ROLE);
  // Timeline evidence: previous → new, source, context.
  const ev = tx.state.timeline[0];
  assert.equal(ev.subjectType, 'organization');
  assert.equal(ev.data.event, 'finance_contact_changed');
  assert.equal(ev.data.previousContactId, 'cOld');
  assert.equal(ev.data.newContactId, r.contactId);
  assert.equal(ev.data.source, 'travel_agent');
  assert.equal(ev.data.submissionKey, 'sub_x');
});

test('re-nominating the SAME person changes nothing structurally (no duplicate membership, no timeline)', async () => {
  const tx = fakeTx({
    org: { financeContactId: 'cSame', financeEmail: 'same@a.co' },
    emails: [{ contactId: 'cSame', value: 'same@a.co' }],
    memberships: [{ contactId: 'cSame', organizationId: 'org1' }],
  });
  const r = await setOrganizationFinanceContact(tx, {
    organizationId: 'org1',
    name: 'אותו אדם',
    email: 'same@a.co',
    phone: '050-1234567',
  });
  assert.equal(r.changed, false);
  assert.equal(tx.state.createdMemberships.length, 0);
  assert.equal(tx.state.timeline.length, 0);
});

test('clear mode removes only the designation and records it', async () => {
  const tx = fakeTx({ org: { financeContactId: 'cOld', financeEmail: 'old@a.co' } });
  const r = await setOrganizationFinanceContact(tx, { organizationId: 'org1' });
  assert.equal(r.cleared, true);
  assert.equal(tx.state.org.financeContactId, null);
  assert.equal(tx.state.timeline[0].data.event, 'finance_contact_cleared');
});

test('financeContactDisplay prefers the canonical Contact, falls back to the mirror', () => {
  const fromContact = financeContactDisplay({
    financeContactId: 'c1',
    financeContactName: 'שם ישן במראה',
    financeEmail: 'mirror@a.co',
    financePhone: null,
    financeContact: {
      firstNameHe: 'רותי',
      lastNameHe: 'לוין',
      emails: [{ value: 'ruti@b.co' }],
      phones: [{ value: '052-2222222' }],
    },
  });
  assert.deepEqual(fromContact, { contactId: 'c1', name: 'רותי לוין', email: 'ruti@b.co', phone: '052-2222222' });

  const fromMirror = financeContactDisplay({
    financeContactId: null,
    financeContactName: 'משה',
    financeEmail: 'mirror@a.co',
    financePhone: '03-1',
    financeContact: null,
  });
  assert.equal(fromMirror.name, 'משה');
  assert.equal(financeContactDisplay({ financeContact: null }), null);
});
