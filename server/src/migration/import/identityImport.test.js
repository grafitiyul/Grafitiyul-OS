import test from 'node:test';
import assert from 'node:assert/strict';
import { planIdentityImport } from './identityImport.js';

// SYNTHETIC fixtures only — this repo is public.
const person = (o) => ({
  legacyId: o.id, name: o.name || `איש ${o.id}`, firstName: o.first ?? `פרטי${o.id}`, lastName: o.last ?? `משפחה${o.id}`,
  phones: o.phones || [], emails: o.emails || [], orgId: o.orgId ?? null, importable: o.importable ?? true,
});
const base = (over = {}) => ({
  persons: [], organizations: [], orgRows: [], contactRows: [], nameRows: [],
  identityEdits: {}, spamIds: new Set(), deletedIds: new Set(),
  existingPersonXwalk: new Map(), existingOrgXwalk: new Map(),
  ...over,
});
const xwalkOf = (r) => Object.fromEntries(r.plan.legacyRecords.map((x) => [`${x.sourceType}:${x.sourceId}`, x]));

test('no decision → SEPARATE contacts; a decided merge folds into ONE survivor', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1 }), person({ id: 2 }), person({ id: 3 }), person({ id: 4 })],
    contactRows: [
      // decided: 2 merges into 1
      { status: 'edited', decision: { primaryLegacyId: 1, mergeLegacyIds: [2], separateLegacyIds: [], result: { primary: { phones: ['050-1', '050-2'], emails: ['a@x.com'] } } }, proposal: {} },
      // UNDECIDED cluster over 3+4 — must not merge
      { status: 'pending', decision: null, proposal: { members: [{ legacyId: 3 }, { legacyId: 4 }] } },
    ],
  }));
  assert.equal(r.stats.contacts, 3, 'survivor + two separate');
  const xw = xwalkOf(r);
  assert.equal(xw['person:2'].entityRef.plannedId, xw['person:1'].entityRef.plannedId, 'merged member crosswalks to the SURVIVOR contact');
  assert.notEqual(xw['person:3'].entityRef.plannedId, xw['person:4'].entityRef.plannedId, 'undecided → separate');
  // The survivor carries the cluster result identity (corrections already folded in).
  const survivorPhones = r.plan.phones.filter((p) => p.contactId === xw['person:1'].entityRef.plannedId);
  assert.deepEqual(survivorPhones.map((p) => p.value), ['050-1', '050-2']);
});

test('an owner-DELETED id can never become an entity through ANY path', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1 }), person({ id: 2 })],
    deletedIds: new Set([2]),
    contactRows: [{ status: 'pending', decision: null, proposal: { members: [{ legacyId: 1 }, { legacyId: 2 }] } }],
  }));
  assert.equal(r.stats.contacts, 1);
  assert.equal(xwalkOf(r)['person:2'], undefined, 'no entity AND no crosswalk row — never resurfaces');
  assert.equal(r.skipped.deleted, 1);
});

test('spam and empty shells import nothing; a participant-only record IS importable', () => {
  const r = planIdentityImport(base({
    persons: [
      person({ id: 1, name: 'New Contact 0501', first: 'New Contact' }),
      person({ id: 2, importable: false }),           // shell
      person({ id: 3, importable: true }),            // rescued participant
    ],
    spamIds: new Set([1]),
  }));
  assert.equal(r.stats.contacts, 1);
  assert.equal(r.skipped.spam, 1);
  assert.equal(r.skipped.shells, 1);
});

test('name-cleanup decisions are binding: fields verbatim; exclude/deleted import nothing', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1, first: '', last: 'לוי' }), person({ id: 2 }), person({ id: 3 })],
    nameRows: [
      { subjectKey: 'name:1', status: 'edited', decision: { treatment: 'import', fields: { firstNameHe: 'לוי מתוקן', lastNameHe: '', firstNameEn: '', lastNameEn: '' }, phones: [{ value: '050-999', remove: false, isPrimary: true }] } },
      { subjectKey: 'name:2', status: 'edited', decision: { treatment: 'exclude' } },
      { subjectKey: 'name:3', status: 'edited', decision: { treatment: 'deleted' } },
    ],
  }));
  assert.equal(r.stats.contacts, 1);
  assert.equal(r.plan.contacts[0].firstNameHe, 'לוי מתוקן', 'the owner fields are the import result');
  assert.deepEqual(r.plan.phones.map((p) => p.value), ['050-999'], 'owner-edited phones override the raw ones');
  assert.equal(r.skipped.nameExcluded, 2);
});

test('"זה ארגון" creates a contact-free Organization and crosswalks the PERSON to it', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 7, name: 'Eastward Bound Ltd', phones: ['050-1'], emails: ['tal@x.com'] })],
    nameRows: [{ subjectKey: 'name:7', status: 'edited', decision: { treatment: 'organization', fields: null, phones: null, organization: { create: true, name: 'Eastward Bound Ltd', targetOrganizationKey: null } } }],
  }));
  assert.equal(r.stats.contacts, 0, 'NO contact');
  assert.equal(r.stats.phones, 0, 'the companion phone is imported NOWHERE');
  assert.equal(r.stats.organizations, 1);
  assert.equal(r.plan.organizations[0].name, 'Eastward Bound Ltd');
  const xw = xwalkOf(r);
  assert.equal(xw['person:7'].entityType, 'Organization', 'the person record maps to the Organization');
});

test('org cluster decisions drive canonical + units + elsewhere + excluded treatments', () => {
  const r = planIdentityImport(base({
    persons: [
      person({ id: 10, orgId: 100 }), // → canonical
      person({ id: 11, orgId: 102 }), // member routed to canonical of same cluster
      person({ id: 12, orgId: 103 }), // excluded org, contacts no_organization
      person({ id: 13, orgId: 900 }), // standalone (never clustered)
    ],
    organizations: [
      { legacyId: 100, name: 'בנק א' }, { legacyId: 101, name: 'בנק א סניף' },
      { legacyId: 102, name: 'בנק אצל' }, { legacyId: 103, name: 'זבל' }, { legacyId: 900, name: 'עצמאי' },
    ],
    orgRows: [{
      subjectKey: 'org:normName:בנק', status: 'edited',
      proposal: { members: [{ legacyId: 100 }, { legacyId: 101 }, { legacyId: 102 }, { legacyId: 103 }] },
      decision: {
        canonicalName: 'בנק אחד', organizationTypeId: null, mergeIntoGosId: null,
        units: [{ key: 'u1', name: 'סניף מרכז' }],
        dispositions: {
          100: { disposition: 'organization' },
          101: { disposition: 'unit', targetUnitKey: 'u1' },
          102: { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:בנק' },
          103: { disposition: 'excluded', linkedEntityTreatment: { contacts: 'no_organization' } },
        },
        result: {
          organization: { name: 'בנק אחד', members: [{ legacyId: 100 }] },
          units: [{ key: 'u1', name: 'סניף מרכז', members: [{ legacyId: 101 }] }],
          elsewhere: [{ legacyId: 102, targetOrganizationKey: 'prop:org:normName:בנק', targetUnitKey: null }],
          excluded: [{ legacyId: 103 }],
        },
      },
    }],
  }));
  // Organizations: the canonical + the standalone (never-clustered) org. NOT the
  // excluded one, NOT the folded members.
  assert.deepEqual(r.plan.organizations.map((o) => o.name).sort(), ['בנק אחד', 'עצמאי']);
  assert.equal(r.stats.units, 1);
  const xw = xwalkOf(r);
  const canonicalId = r.plan.organizations.find((o) => o.name === 'בנק אחד').id;
  assert.equal(xw['organization:100'].entityRef.plannedId, canonicalId);
  assert.equal(xw['organization:101'].entityRef.plannedId, canonicalId, 'unit member folds into the canonical org');
  assert.equal(xw['organization:102'].entityRef.plannedId, canonicalId, 'elsewhere resolves through the key');
  assert.equal(xw['organization:103'], undefined, 'excluded org: no entity, no crosswalk');
  // Contact org links follow the same routing.
  const linkOf = (pid) => r.plan.orgLinks.find((l) => l.contactId === xw[`person:${pid}`].entityRef.plannedId) || null;
  assert.equal(linkOf(10)?.orgRef?.plannedId, canonicalId);
  assert.equal(linkOf(11)?.orgRef?.plannedId, canonicalId);
  assert.equal(linkOf(12), null, 'excluded org + no_organization → contact imports with NO org');
  assert.equal(linkOf(13)?.orgRef?.plannedId, r.plan.organizations.find((o) => o.name === 'עצמאי').id);
});

test('idempotency: already-imported source ids are skipped and their entities reused', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1 }), person({ id: 2, orgId: 900 })],
    organizations: [{ legacyId: 900, name: 'עצמאי' }],
    existingPersonXwalk: new Map([['1', 'contact-live-1']]),
    existingOrgXwalk: new Map([['900', 'org-live-900']]),
  }));
  assert.equal(r.stats.contacts, 1, 'person 1 skipped');
  assert.equal(r.skipped.alreadyImported, 1);
  assert.equal(r.stats.organizations, 0, 'org 900 not recreated');
  assert.equal(r.skipped.orgAlreadyImported, 1);
  const link = r.plan.orgLinks[0];
  assert.equal(link.orgRef.existingId, 'org-live-900', 'the new contact links to the EXISTING org entity');
});

test('idempotency covers CLUSTER canonicals and person-orgs too — a re-run creates nothing', () => {
  const inputs = base({
    persons: [person({ id: 7, name: 'חברה' })],
    organizations: [{ legacyId: 100, name: 'בנק א' }],
    orgRows: [{
      subjectKey: 'org:x', status: 'edited',
      proposal: { members: [{ legacyId: 100 }] },
      decision: {
        canonicalName: 'בנק אחד', mergeIntoGosId: null, units: [],
        dispositions: { 100: { disposition: 'organization' } },
        result: { organization: { name: 'בנק אחד', members: [{ legacyId: 100 }] }, units: [], elsewhere: [], excluded: [] },
      },
    }],
    nameRows: [{ subjectKey: 'name:7', status: 'edited', decision: { treatment: 'organization', organization: { create: true, name: 'חברה', targetOrganizationKey: null } } }],
    // Everything already imported.
    existingPersonXwalk: new Map([['7', 'org-live-7']]),
    existingOrgXwalk: new Map([['100', 'org-live-100']]),
  });
  const r = planIdentityImport(inputs);
  assert.equal(r.stats.organizations, 0, 'no canonical re-created, no person-org re-created');
  assert.equal(r.stats.contacts, 0);
  assert.equal(r.stats.legacyRecords, 0);
});

test('a contact that would fail GOS validation is skipped and reported, never crashes', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1, first: '', last: '', name: '' })],
  }));
  assert.equal(r.stats.contacts, 0);
  assert.equal(r.skipped.invalid, 1);
  assert.ok(r.problems.some((p) => /ללא שם פרטי/.test(p)));
});

test('a merge whose survivor is not imported falls back to SEPARATE (fail-safe)', () => {
  const r = planIdentityImport(base({
    persons: [person({ id: 1 }), person({ id: 2 })],
    deletedIds: new Set([1]), // the survivor was owner-deleted
    contactRows: [{ status: 'edited', decision: { primaryLegacyId: 1, mergeLegacyIds: [2], separateLegacyIds: [], result: { primary: { phones: [], emails: [] } } }, proposal: {} }],
  }));
  assert.equal(r.stats.contacts, 1, 'member 2 imports separately');
  assert.ok(r.problems.some((p) => /איחוד לא ישים/.test(p)));
  assert.equal(xwalkOf(r)['person:1'], undefined, 'the deleted survivor still imports NOTHING');
});

test('nameless standalone orgs are not Organizations', () => {
  const r = planIdentityImport(base({ organizations: [{ legacyId: 1, name: '  ' }, { legacyId: 2, name: 'אמיתי' }] }));
  assert.equal(r.stats.organizations, 1);
  assert.equal(r.skipped.orgNoName, 1);
});
