// Every conflicting value the merge wizard shows must be readable business
// language. This suite is the guard against the bug it was written for: the
// wizard asked "מקור הליד — which one?" and offered "ערך אחר" against
// "ערך אחר", which is not a question anyone can answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFieldLabels, DISPLAYABLE_FIELD_KEYS } from './mergeFieldLabels.js';
import { MERGE_FIELDS } from './mergeResolve.js';

// A store that answers only the catalog reads the resolver makes, and COUNTS
// them — the batching claim is part of the contract, not a hope.
function makeDb(seed = {}) {
  const calls = [];
  const model = (name, rows) => ({
    findMany: async ({ where }) => {
      calls.push({ model: name, ids: [...where.id.in] });
      return (rows || []).filter((r) => where.id.in.includes(r.id));
    },
  });
  return {
    calls,
    organization: model('organization', seed.organizations),
    organizationUnit: model('organizationUnit', seed.units),
    organizationSubtype: model('organizationSubtype', seed.subtypes),
    organizationType: model('organizationType', seed.orgTypes),
    product: model('product', seed.products),
    productVariant: model('productVariant', seed.variants),
    location: model('location', seed.locations),
    dealSource: model('dealSource', seed.dealSources),
    paymentTerm: model('paymentTerm', seed.paymentTerms),
    paymentMethod: model('paymentMethod', seed.paymentMethods),
    adminUser: model('adminUser', seed.adminUsers),
  };
}

const F = (key) => MERGE_FIELDS.find((f) => f.key === key);

test('every merged field has a display rule — no field can fall through to an id', () => {
  // The rule that makes "ערך אחר" impossible: a field that can conflict must
  // know how to describe itself.
  const missing = MERGE_FIELDS.map((f) => f.key).filter((k) => !DISPLAYABLE_FIELD_KEYS.includes(k));
  assert.deepEqual(missing, [], `fields with no display rule: ${missing.join(', ')}`);
});

test('the lead source shows the CATALOG LABEL, never the id', async () => {
  const db = makeDb({ dealSources: [{ id: 's1', label: 'אתר' }, { id: 's2', label: 'המלצה' }] });
  const out = await resolveFieldLabels(db, [F('dealSourceId')], { dealSourceId: 's1' }, { dealSourceId: 's2' });
  const d = out.get('dealSourceId');
  assert.equal(d.survivor.label, 'אתר');
  assert.equal(d.other.label, 'המלצה');
});

test('the source DETAIL shows its actual text, marked as long-form', async () => {
  const db = makeDb();
  const out = await resolveFieldLabels(db, [F('source')], { source: 'Google Ads' }, { source: 'לקוח קיים' });
  assert.equal(out.get('source').survivor.label, 'Google Ads');
  assert.equal(out.get('source').other.label, 'לקוח קיים');
  assert.equal(out.get('source').survivor.long, true, 'free text is flagged so the UI can truncate + reveal');
});

test('an EMPTY value resolves to null so the UI can say "לא הוגדר"', async () => {
  const db = makeDb({ dealSources: [{ id: 's1', label: 'אתר' }] });
  const out = await resolveFieldLabels(db, [F('dealSourceId'), F('source')], { dealSourceId: 's1', source: '' }, {});
  assert.equal(out.get('dealSourceId').other.label, null);
  assert.equal(out.get('source').survivor.label, null, 'whitespace-only text is empty, not a value');
});

test('organization, unit, subtype and type all resolve to their own display column', async () => {
  const db = makeDb({
    organizations: [{ id: 'o1', name: 'ACME', orgNo: 42 }],
    units: [{ id: 'u1', name: 'סניף מרכז' }],
    subtypes: [{ id: 'st1', label: 'בית ספר יסודי' }],
    orgTypes: [{ id: 'ot1', label: 'חינוך' }],
  });
  const fields = [F('organizationId'), F('organizationUnitId'), F('organizationSubtypeId'), F('organizationTypeId')];
  const out = await resolveFieldLabels(db, fields,
    { organizationId: 'o1', organizationUnitId: 'u1', organizationSubtypeId: 'st1', organizationTypeId: 'ot1' }, {});
  assert.equal(out.get('organizationId').survivor.label, 'ACME');
  assert.equal(out.get('organizationId').survivor.hint, 'ארגון #42', 'the org number rides along as secondary detail');
  assert.equal(out.get('organizationUnitId').survivor.label, 'סניף מרכז');
  assert.equal(out.get('organizationSubtypeId').survivor.label, 'בית ספר יסודי');
  assert.equal(out.get('organizationTypeId').survivor.label, 'חינוך');
});

test('a variant reads as Product — City, the way search renders it', async () => {
  const db = makeDb({
    variants: [{ id: 'v1', product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'תל אביב' } }],
  });
  const out = await resolveFieldLabels(db, [F('productVariantId')], { productVariantId: 'v1' }, {});
  assert.equal(out.get('productVariantId').survivor.label, 'סיור גרפיטי — תל אביב');
});

test('payment terms, methods and the owner resolve to names, never ids', async () => {
  const db = makeDb({
    paymentTerms: [{ id: 'pt1', nameHe: 'שוטף +30' }],
    paymentMethods: [{ id: 'pm1', nameHe: 'העברה בנקאית' }],
    adminUsers: [{ id: 'u9', username: 'dor' }],
  });
  const out = await resolveFieldLabels(db, [F('paymentTermId'), F('paymentMethodId'), F('ownerUserId')],
    { paymentTermId: 'pt1', paymentMethodId: 'pm1', ownerUserId: 'u9' }, {});
  assert.equal(out.get('paymentTermId').survivor.label, 'שוטף +30');
  assert.equal(out.get('paymentMethodId').survivor.label, 'העברה בנקאית');
  assert.equal(out.get('ownerUserId').survivor.label, 'dor');
});

test('enums resolve through the SHARED vocabularies, never a local copy', async () => {
  const db = makeDb();
  const out = await resolveFieldLabels(db,
    [F('activityType'), F('tourLanguage'), F('communicationLanguage')],
    { activityType: 'group', tourLanguage: 'es', communicationLanguage: 'en' },
    { activityType: 'business', tourLanguage: 'he', communicationLanguage: 'he' });
  assert.equal(out.get('activityType').survivor.label, 'קבוצתי');
  assert.equal(out.get('activityType').other.label, 'עסקי');
  assert.equal(out.get('tourLanguage').survivor.label, 'ספרדית');
  assert.equal(out.get('communicationLanguage').survivor.label, 'אנגלית');
});

test('dates are formatted, never shown as a raw string or a JS Date', async () => {
  const db = makeDb();
  const out = await resolveFieldLabels(db, [F('tourDate'), F('expectedCloseDate')],
    { tourDate: '2027-01-14', expectedCloseDate: new Date('2026-12-01T00:00:00Z') }, {});
  assert.equal(out.get('tourDate').survivor.label, '14.01.2027');
  assert.equal(out.get('expectedCloseDate').survivor.label, '01.12.2026');
});

test('counts carry their unit so a bare number is never ambiguous', async () => {
  const db = makeDb();
  const out = await resolveFieldLabels(db, [F('groups'), F('durationHours')], { groups: 2, durationHours: 3.5 }, {});
  assert.equal(out.get('groups').survivor.label, '2 קבוצות');
  assert.equal(out.get('durationHours').survivor.label, '3.5 שעות');
});

test('a reference whose catalog row is gone SAYS SO instead of leaking the id', async () => {
  const db = makeDb({ dealSources: [] });
  const out = await resolveFieldLabels(db, [F('dealSourceId')], { dealSourceId: 'deleted-id' }, {});
  const d = out.get('dealSourceId').survivor;
  assert.equal(d.missing, true);
  assert.equal(d.label, 'ערך שנמחק מהקטלוג');
  assert.ok(!String(d.label).includes('deleted-id'), 'the id is never rendered');
});

test('catalogs are loaded ONCE for both deals, not once per field or per side', async () => {
  const db = makeDb({ dealSources: [{ id: 's1', label: 'אתר' }, { id: 's2', label: 'המלצה' }] });
  await resolveFieldLabels(db, [F('dealSourceId')], { dealSourceId: 's1' }, { dealSourceId: 's2' });
  const sourceCalls = db.calls.filter((c) => c.model === 'dealSource');
  assert.equal(sourceCalls.length, 1, 'one query for the catalog');
  assert.deepEqual(sourceCalls[0].ids.sort(), ['s1', 's2'], 'both sides in the same query');
});

test('a catalog nothing references is never queried at all', async () => {
  const db = makeDb();
  await resolveFieldLabels(db, [F('dealSourceId'), F('productId')], { dealSourceId: null }, { dealSourceId: null });
  assert.deepEqual(db.calls, [], 'no ids to resolve → no queries');
});
