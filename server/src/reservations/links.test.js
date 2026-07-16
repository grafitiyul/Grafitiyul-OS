import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReservationLink,
  eligibleAgencyOrg,
  mintLinkForContact,
} from './links.js';

// Agent reservation link resolver security suite (portal.resolve.test.js
// pattern). The resolver must: match the EXACT token only, never reveal the
// existence of unknown OR revoked tokens, fail closed for kill-switched
// links, and re-check agency eligibility on EVERY resolve.

const AGENCY_TYPE = { id: 'ot1', key: 'travel_agency', agentReservations: true };
const SCHOOL_TYPE = { id: 'ot2', key: 'school', agentReservations: false };

const AGENCY_ORG = { id: 'org1', name: 'סוכנות א', organizationType: AGENCY_TYPE };
const SCHOOL_ORG = { id: 'org2', name: 'בית ספר', organizationType: SCHOOL_TYPE };

function contactWith(orgLinks) {
  return { id: 'c1', firstNameHe: 'דנה', orgLinks };
}

function fakeDb(links) {
  return {
    agentReservationLink: {
      findUnique: async ({ where }) =>
        links.find((l) => l.token === where.token) || null,
      findMany: async ({ where }) =>
        links
          .filter((l) => l.contactId === where.contactId && l.status === where.status)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      create: async ({ data }) => ({ id: 'new', createdAt: new Date(), ...data }),
    },
  };
}

const ELIGIBLE_CONTACT = contactWith([
  { isPrimary: true, organization: AGENCY_ORG },
]);

const ACTIVE = {
  id: 'l1',
  contactId: 'c1',
  token: 'exact_ACTIVE_tok',
  status: 'active',
  isEnabled: true,
  contact: ELIGIBLE_CONTACT,
  createdAt: new Date('2026-07-01'),
};
const REVOKED = {
  id: 'l2',
  contactId: 'c1',
  token: 'exact_REVOKED_tok',
  status: 'revoked',
  isEnabled: true,
  contact: ELIGIBLE_CONTACT,
  createdAt: new Date('2026-06-01'),
};
const DISABLED = {
  id: 'l3',
  contactId: 'c1',
  token: 'exact_DISABLED_tok',
  status: 'active',
  isEnabled: false,
  contact: ELIGIBLE_CONTACT,
  createdAt: new Date('2026-07-02'),
};
const DETACHED = {
  id: 'l4',
  contactId: 'c2',
  token: 'exact_DETACHED_tok',
  status: 'active',
  isEnabled: true,
  // Contact left the agency — only a non-qualifying org remains.
  contact: contactWith([{ isPrimary: true, organization: SCHOOL_ORG }]),
  createdAt: new Date('2026-07-03'),
};

const ALL = [ACTIVE, REVOKED, DISABLED, DETACHED];

test('exact valid token resolves link + contact + qualifying organization', async () => {
  const r = await resolveReservationLink('exact_ACTIVE_tok', fakeDb(ALL));
  assert.equal(r.error, undefined);
  assert.equal(r.link.id, 'l1');
  assert.equal(r.contact.id, 'c1');
  assert.equal(r.organization.id, 'org1');
});

test('unknown token → not_found (does not leak existence)', async () => {
  const r = await resolveReservationLink('no_such_token', fakeDb(ALL));
  assert.deepEqual(r, { error: 'not_found' });
});

test('one-character-off token → not_found (no fuzzy match)', async () => {
  const r = await resolveReservationLink('exact_ACTIVE_toX', fakeDb(ALL));
  assert.equal(r.error, 'not_found');
});

test('empty / non-string token → not_found', async () => {
  for (const bad of ['', null, undefined, 123]) {
    const r = await resolveReservationLink(bad, fakeDb(ALL));
    assert.equal(r.error, 'not_found');
  }
});

test('revoked token reads as not_found (rotation leaks nothing)', async () => {
  const r = await resolveReservationLink('exact_REVOKED_tok', fakeDb(ALL));
  assert.equal(r.error, 'not_found');
});

test('kill-switched link → disabled (fails closed, debuggable)', async () => {
  const r = await resolveReservationLink('exact_DISABLED_tok', fakeDb(ALL));
  assert.equal(r.error, 'disabled');
});

test('contact detached from qualifying agency → not_eligible (link preserved)', async () => {
  const r = await resolveReservationLink('exact_DETACHED_tok', fakeDb(ALL));
  assert.equal(r.error, 'not_eligible');
  assert.equal(r.link.id, 'l4');
});

test('eligibleAgencyOrg: primary qualifying membership wins', () => {
  const secondAgency = { id: 'org3', name: 'סוכנות ב', organizationType: AGENCY_TYPE };
  const org = eligibleAgencyOrg(
    contactWith([
      { isPrimary: false, organization: secondAgency },
      { isPrimary: true, organization: AGENCY_ORG },
    ]),
  );
  assert.equal(org.id, 'org1');
});

test('eligibleAgencyOrg: falls back to first qualifying link when none is primary', () => {
  const org = eligibleAgencyOrg(
    contactWith([
      { isPrimary: true, organization: SCHOOL_ORG },
      { isPrimary: false, organization: AGENCY_ORG },
    ]),
  );
  assert.equal(org.id, 'org1');
});

test('eligibleAgencyOrg: no qualifying org / no links / null contact → null', () => {
  assert.equal(eligibleAgencyOrg(contactWith([{ isPrimary: true, organization: SCHOOL_ORG }])), null);
  assert.equal(eligibleAgencyOrg(contactWith([])), null);
  assert.equal(eligibleAgencyOrg(null), null);
});

test('mint is idempotent: an existing active link is returned, not replaced', async () => {
  const db = fakeDb(ALL);
  const r = await mintLinkForContact({ contactId: 'c1' }, db);
  assert.equal(r.created, false);
  // Newest active link for the contact wins (l3 is newer than l1).
  assert.equal(r.link.id, 'l3');
});

test('mint creates a token for a contact with no active link', async () => {
  const db = fakeDb(ALL.filter((l) => l.contactId !== 'c1'));
  const r = await mintLinkForContact({ contactId: 'c1' }, db);
  assert.equal(r.created, true);
  assert.ok(r.link.token.length >= 32);
  assert.equal(r.link.defaultLanguage, 'he');
});
