import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStageMap, resolveFieldKeys, planDealImport } from './dealImport.js';

// SYNTHETIC fixtures — this repo is public.
const PIPELINES = [{ id: 1, name: 'מכירות גרפיטיול' }, { id: 5, name: 'שוברי מתנה' }];
const STAGES = [
  { id: 1, pipeline_id: 1, name: 'ליד נכנס' },
  { id: 2, pipeline_id: 1, name: 'בהמתנה- לא לשלוח פולואפים' }, // renamed after the freeze
  { id: 32, pipeline_id: 5, name: 'נרכש שובר-ממתין למימוש' },   // covered by 'כל השלבים'
  { id: 99, pipeline_id: 1, name: 'שלב חדש שלא מופה' },
];
const STAGE_CONFIG = [
  { proposal: { kind: 'stage_mapping', pipeline: 'מכירות', stage: 'ליד נכנס', targetStage: 'lead' } },
  { proposal: { kind: 'stage_mapping', pipeline: 'מכירות', stage: 'בהמתנה', targetStage: 'negotiation' } },
  { proposal: { kind: 'stage_mapping', pipeline: 'שוברי מתנה', stage: 'כל השלבים', targetStage: 'closing' } },
  { proposal: { kind: 'rule', title: 'x' } },
];
const FIELDS = [
  { key: 'a'.repeat(40), name: 'תאריך הסיור', field_type: 'date' },
  { key: 'b'.repeat(40), name: 'כמות משתתפים', field_type: 'double' },
  { key: 'c'.repeat(40), name: 'סוג פעילות', field_type: 'enum', options: [{ id: 1, label: 'פרטי' }, { id: 2, label: 'קבוצתי' }] },
  { key: 'd'.repeat(40), name: 'שפת התקשורת מול הלקוח', field_type: 'enum', options: [{ id: 7, label: 'רוסית' }, { id: 8, label: 'עברית' }] },
  { key: 'e'.repeat(40), name: 'קישור לדרייב', field_type: 'varchar' },
];
const GOS_STAGES = new Map([['lead', 'gs1'], ['negotiation', 'gs2'], ['closing', 'gs3']]);

const deal = (o) => ({
  id: o.id, title: o.title || `deal ${o.id}`, status: o.status || 'won',
  stage_id: o.stage ?? 1, value: o.value ?? 100, currency: o.currency || 'ILS',
  won_time: o.wonTime || '2023-01-01 10:00:00', lost_time: null, lost_reason: o.lostReason || null,
  person_id: o.personId != null ? { value: o.personId } : null,
  org_id: o.orgId != null ? { value: o.orgId } : null,
  user_id: { value: 11 }, archived: !!o.archived,
  ...o.custom,
});
const base = (over = {}) => ({
  deals: [], participantsByDeal: new Map(), dealDecisions: [],
  stageMap: buildStageMap({ stageConfigRows: STAGE_CONFIG, pipelines: PIPELINES, stages: STAGES }),
  fieldKeys: resolveFieldKeys(FIELDS),
  personXwalk: new Map(), orgXwalk: new Map(),
  gosStageIdByKey: GOS_STAGES, users: [{ id: 11, name: 'שרון' }],
  existingDealXwalk: new Map(),
  ...over,
});

test('stage mapping is BINDING: exact names, explicit renames, whole-pipeline rows; unmapped is reported', () => {
  const m = buildStageMap({ stageConfigRows: STAGE_CONFIG, pipelines: PIPELINES, stages: STAGES });
  assert.equal(m.byStageId.get(1).target, 'lead');
  assert.equal(m.byStageId.get(2).target, 'negotiation', 'the post-freeze rename resolves via the explicit alias');
  assert.equal(m.byStageId.get(32).target, 'closing', "'כל השלבים' covers the voucher pipeline");
  assert.deepEqual(m.unmapped.map((u) => u.stageId), [99], 'never guessed');
});

test('a deal on an unmapped stage is a BLOCKING problem, not a silent guess', () => {
  const r = planDealImport(base({ deals: [deal({ id: 1, stage: 99 })] }));
  assert.equal(r.stats.create, 0);
  assert.equal(r.problems[0].kind, 'stage_unmapped');
});

test('identity resolves through the crosswalk ONLY; dangling refs are counted, never placeheld', () => {
  const r = planDealImport(base({
    deals: [
      deal({ id: 1, personId: 10, orgId: 500 }),   // both resolve
      deal({ id: 2, personId: 99 }),               // dangling person (no xwalk row at all)
      deal({ id: 3, personId: 11 }),               // identity excluded (xwalk row, no entity)
      deal({ id: 4, personId: 12 }),               // person was really an ORGANIZATION
    ],
    participantsByDeal: new Map([[1, [13, 10]]]),  // one participant + the primary itself
    personXwalk: new Map([
      ['10', { entityType: 'Contact', entityId: 'c10' }],
      ['11', null],
      ['12', { entityType: 'Organization', entityId: 'o12' }],
      ['13', { entityType: 'Contact', entityId: 'c13' }],
    ]),
    orgXwalk: new Map([['500', 'org500']]),
  }));
  assert.equal(r.stats.contactsResolvedPrimary, 1);
  assert.equal(r.stats.danglingPersonRefs, 1);
  assert.equal(r.stats.identityExcludedOrDeleted, 2);
  assert.equal(r.stats.noContact, 3);
  assert.equal(r.stats.participantLinks, 1, 'the primary is never double-linked as a participant');
  const d4 = r.payloads.find((p) => p.orderNo === 4);
  assert.equal(d4.organizationId, 'o12', 'a person-as-organization fills the org slot');
  const d2 = r.payloads.find((p) => p.orderNo === 2);
  assert.equal(d2.primaryContactId, null, 'NO silent placeholder');
});

test('deal decisions are consumed: deleted/exclude import nothing, corrections override verbatim', () => {
  const r = planDealImport(base({
    deals: [deal({ id: 1 }), deal({ id: 2 }), deal({ id: 3, title: 'טעות', value: 5 }), deal({ id: 4 })],
    dealDecisions: [
      { subjectKey: 'deal:1', status: 'edited', decision: { treatment: 'deleted' } },
      { subjectKey: 'deal:2', status: 'edited', decision: { treatment: 'exclude' } },
      { subjectKey: 'deal:3', status: 'edited', decision: { treatment: 'import_corrected', corrections: { title: 'מתוקן', valueMinor: 123400 } } },
      { subjectKey: 'deal:4', status: 'edited', decision: { treatment: 'merge', mergeIntoDealId: 3 } },
    ],
  }));
  assert.equal(r.stats.ownerDeleted, 1);
  assert.equal(r.stats.excluded, 1);
  assert.equal(r.stats.merged, 1);
  assert.equal(r.stats.create, 1);
  const c = r.payloads.find((p) => p.kind === 'create');
  assert.equal(c.title, 'מתוקן');
  assert.equal(c.valueMinor, 123400);
  assert.equal(c.corrected, true);
});

test('the canonical payload: orderNo = source id, minor units, status independent of stage, card for the rest', () => {
  const custom = {
    ['a'.repeat(40)]: '2022-06-01', ['b'.repeat(40)]: 12.0, ['c'.repeat(40)]: 1, ['d'.repeat(40)]: 7,
    ['e'.repeat(40)]: 'https://drive.google.com/x',
  };
  const r = planDealImport(base({ deals: [deal({ id: 777, status: 'lost', lostReason: 'התאריך לא מתאים', value: 1650.5, custom })] }));
  const p = r.payloads[0];
  assert.equal(p.orderNo, 777);
  assert.equal(p.valueMinor, 165050);
  assert.equal(p.status, 'lost');
  assert.equal(p.dealStageKey, 'lead', 'stage from the frozen mapping — status preserved independently');
  assert.equal(p.lostReason, 'התאריך לא מתאים');
  assert.equal(p.tourDate, '2022-06-01');
  assert.equal(p.participants, 12);
  assert.equal(p.activityType, 'private');
  assert.equal(p.communicationLanguage, null, 'רוסית is not a GOS comm language — never invented');
  assert.ok(p.cardData.some((c) => c.label === 'שפת התקשורת (מקור)' && c.value === 'רוסית'), '…but preserved on the card');
  assert.ok(p.cardData.some((c) => c.label === 'קישור לדרייב' && /^https:/.test(c.value)), 'URLs import as links only');
  assert.ok(p.cardData.some((c) => c.label === 'בעלים במערכת הקודמת' && c.value === 'שרון'));
});

test('DETERMINISM: two runs over the same inputs produce byte-identical payload hashes', () => {
  const inputs = base({
    deals: [deal({ id: 3 }), deal({ id: 1, personId: 10 }), deal({ id: 2, orgId: 500 })],
    personXwalk: new Map([['10', { entityType: 'Contact', entityId: 'c10' }]]),
    orgXwalk: new Map([['500', 'org500']]),
  });
  const a = planDealImport(inputs);
  const b = planDealImport(inputs);
  assert.equal(a.payloadHash, b.payloadHash);
  assert.deepEqual(a.payloads.map((p) => p.orderNo), [1, 2, 3], 'source-id order, whatever the input order');
});

test('idempotency: an already-imported deal is skipped', () => {
  const r = planDealImport(base({ deals: [deal({ id: 1 })], existingDealXwalk: new Map([['1', 'deal-live-1']]) }));
  assert.equal(r.stats.create, 0);
  assert.equal(r.stats.alreadyImported, 1);
});
