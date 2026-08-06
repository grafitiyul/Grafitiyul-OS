import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReservationLink,
  eligibleAgencyOrg,
  eligibleAgencyOrgs,
  mintLinkForContact,
} from './links.js';
import { numericIdResolver } from '../routes/numericIdParam.js';

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

// ── every qualifying agency, for anything that DISPLAYS eligibility ─────────
//
// eligibleAgencyOrg answers "which organization does a reservation attach to"
// and must pick one. A SCREEN must not: showing one agency while the contact
// belongs to three hides the other two. The "טופס הזמנה" card reads this list.

test('eligibleAgencyOrgs: every qualifying agency, primary first', () => {
  const secondAgency = { id: 'org3', name: 'סוכנות ב', organizationType: AGENCY_TYPE };
  const orgs = eligibleAgencyOrgs(
    contactWith([
      { isPrimary: false, organization: secondAgency },
      { isPrimary: true, organization: AGENCY_ORG },
    ]),
  );
  assert.deepEqual(orgs.map((o) => o.id), ['org1', 'org3'], 'none is silently dropped');
});

test('eligibleAgencyOrgs: non-agency memberships never appear', () => {
  const orgs = eligibleAgencyOrgs(
    contactWith([
      { isPrimary: true, organization: SCHOOL_ORG },
      { isPrimary: false, organization: AGENCY_ORG },
    ]),
  );
  assert.deepEqual(orgs.map((o) => o.id), ['org1']);
});

test('eligibleAgencyOrgs: a contact with no agency qualifies through nothing', () => {
  assert.deepEqual(eligibleAgencyOrgs(contactWith([{ isPrimary: true, organization: SCHOOL_ORG }])), []);
  assert.deepEqual(eligibleAgencyOrgs(contactWith([])), []);
  assert.deepEqual(eligibleAgencyOrgs(null), []);
});

test('eligibility is the CAPABILITY FLAG — never the organization name', () => {
  // An organization named exactly like a travel agency, typed as a school:
  // not eligible. And an agency-typed organization named nothing like one:
  // eligible. Renaming an organization can never grant or remove a form.
  const namedLikeAgency = { id: 'orgX', name: 'סוכנות נסיעות ותיירות בע"מ', organizationType: SCHOOL_TYPE };
  const namedLikeAnything = { id: 'orgY', name: 'עמותת שכונה', organizationType: AGENCY_TYPE };
  assert.deepEqual(eligibleAgencyOrgs(contactWith([{ organization: namedLikeAgency }])), []);
  assert.deepEqual(
    eligibleAgencyOrgs(contactWith([{ organization: namedLikeAnything }])).map((o) => o.id),
    ['orgY'],
  );
});

test('a missing or untyped organization is never eligible', () => {
  assert.deepEqual(eligibleAgencyOrgs(contactWith([{ organization: null }, { organization: { id: 'o', name: 'x' } }])), []);
});

// ── the identity contract of the reservation-link routes ────────────────────
//
// The Contact URL is /admin/crm/contacts/36435 — the PUBLIC contactNo, not the
// cuid. contacts.js resolves that for its own `:id`, but the reservation-link
// router mounts on the same base path under `:contactId`, so the sibling's
// resolver never applied: every request built from a real Contact URL arrived
// as the literal "36435", missed the cuid lookup and 404'd. The agent's order
// form and the link manager both rendered nothing, on every numerically
// addressed contact — which is how the UI is actually navigated.
//
// These pin the resolver's behaviour for that param.
test('a numeric contactNo is swapped for the cuid before any handler runs', async () => {
  const req = { params: { contactId: '36435' } };
  let called = null;
  const resolver = numericIdResolver(async (n) => { called = n; return { id: 'cuid_abc' }; });
  await new Promise((done) => resolver(req, null, done, req.params.contactId, 'contactId'));
  assert.equal(called, 36435, 'looked up by NUMBER, not by string');
  assert.equal(req.params.contactId, 'cuid_abc', 'the handler sees the cuid');
});

test('a cuid passes through untouched (no pointless lookup)', async () => {
  const req = { params: { contactId: 'cmrhnus6v00119lko852zu092' } };
  let called = false;
  const resolver = numericIdResolver(async () => { called = true; return null; });
  await new Promise((done) => resolver(req, null, done, req.params.contactId, 'contactId'));
  assert.equal(called, false);
  assert.equal(req.params.contactId, 'cmrhnus6v00119lko852zu092');
});

test('an unknown number falls through so the handler 404s in its own shape', async () => {
  const req = { params: { contactId: '99999999' } };
  const resolver = numericIdResolver(async () => null);
  await new Promise((done) => resolver(req, null, done, req.params.contactId, 'contactId'));
  assert.equal(req.params.contactId, '99999999');
});
