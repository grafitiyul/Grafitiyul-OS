import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeLegacyHtml, htmlToPlain,
  planNoteImport, planActivityImport, planDealBackfill, planOrgEnrichment, planTourCardEnrichment,
  buildEnrichmentPlan, checkEnrichmentGates, ORG_TYPE_MAPPING,
} from './enrichmentImport.js';

// SYNTHETIC fixtures — this repo is public. No real names/phones/emails.

test('sanitizer strips active content, keeps formatting; plain conversion preserves line breaks', () => {
  const dirty = '<div>שלום <b>עולם</b></div><script>alert(1)</script><img src=x onerror="hack()"><a href="javascript:evil()">x</a>';
  const clean = sanitizeLegacyHtml(dirty);
  assert.ok(!/script|onerror|javascript:/.test(clean));
  assert.ok(clean.includes('<b>עולם</b>'));
  assert.equal(htmlToPlain('<p>שורה 1</p><p>שורה 2</p><ul><li>א</li><li>ב</li></ul>'), 'שורה 1\nשורה 2\n- א\n- ב');
});

test('notes: deal-first subject resolution, author label, original timestamp; empty + already-imported skipped', () => {
  const r = planNoteImport({
    notes: [
      { id: 2, content: '<div>הערה על דיל</div>', deal_id: 100, user_id: 7, add_time: '2021-03-01 10:00:00' },
      { id: 1, content: 'הערה על איש קשר', person_id: 55, add_time: '2020-01-01 09:00:00' },
      { id: 3, content: '', deal_id: 100 },
      { id: 4, content: 'כבר יובא', deal_id: 100 },
      { id: 5, content: 'ללא נושא', person_id: 999 },
    ],
    dealXwalk: new Map([['100', 'd100']]),
    personXwalk: new Map([['55', { entityType: 'Contact', entityId: 'c55' }]]),
    orgXwalk: new Map(),
    existingNoteXwalk: new Map([['4', 'te-existing']]),
    userName: new Map([[7, 'אלמונית']]),
  });
  assert.equal(r.stats.create, 2);
  assert.equal(r.stats.alreadyImported, 1);
  assert.equal(r.stats.empty, 1);
  assert.equal(r.stats.noSubject, 1);
  const dealNote = r.payloads.find((p) => p.sourceId === '2');
  assert.equal(dealNote.subjectType, 'deal');
  assert.equal(dealNote.actorLabel, 'Pipedrive · אלמונית');
  assert.ok(dealNote.createdAt.startsWith('2021-03-01'));
  assert.equal(r.payloads.find((p) => p.sourceId === '1').subjectType, 'contact');
});

test('activities: done→system timeline at completion time; open on OPEN deal→active task; open on lost deal→timeline; bare person calls skipped', () => {
  const r = planActivityImport({
    activities: [
      { id: 1, type: 'call', done: true, subject: 'שיחה', note: '<div>סוכם המשך</div>', deal_id: 100, marked_as_done_time: '2022-05-05 12:00:00', add_time: '2022-05-01', user_id: 7 },
      { id: 2, type: 'task', done: false, subject: 'לחזור ללקוח', note: '', deal_id: 100, due_date: '2026-08-01', due_time: '09:30', add_time: '2026-07-01' },
      { id: 3, type: 'task', done: false, subject: 'ישן', deal_id: 200, due_date: '2023-01-01', add_time: '2022-12-01' },
      { id: 4, type: 'call', done: true, subject: 'רק שיחה', note: '', person_id: 55, add_time: '2020-02-02' },
      { id: 5, type: 'call', done: true, subject: 'עם תוכן', note: 'דיברנו', person_id: 55, marked_as_done_time: '2020-03-03 08:00:00', add_time: '2020-03-01' },
    ],
    dealXwalk: new Map([['100', 'd100'], ['200', 'd200']]),
    personXwalk: new Map([['55', { entityType: 'Contact', entityId: 'c55' }]]),
    orgXwalk: new Map(),
    openDealGosIds: new Set(['d100']), // d200 is lost/archived
    userName: new Map([[7, 'אלמונית']]),
    typeLabel: new Map([['call', 'שיחה'], ['task', 'משימה']]),
    taskOwnerUserId: 'admin-1',
  });
  assert.equal(r.stats.activeTasks, 1);
  assert.equal(r.tasks[0].dealId, 'd100');
  assert.equal(r.tasks[0].dueTime, '09:30');
  assert.equal(r.tasks[0].ownerUserId, 'admin-1');
  assert.equal(r.stats.doneTimeline, 2, 'deal call + person call WITH content');
  assert.equal(r.stats.openTimeline, 1, 'open on non-open deal → historical evidence');
  assert.equal(r.stats.personNoNote, 1, 'bare person call skipped by design');
  const done = r.timeline.find((p) => p.sourceId === '1');
  assert.ok(done.isSystem, 'activity evidence is not user-editable');
  assert.ok(done.createdAt.startsWith('2022-05-05'), 'timestamped at completion');
  assert.ok(done.body.includes('שיחה') && done.body.includes('סוכם המשך'));
});

test('deal backfill: fill-null-only source + catalog match; GOS-edited values untouched; inquiry note once', () => {
  const fieldKeys = { sourceText: 'srcText', sourceEnum: 'srcEnum', inquiryContent: 'inq' };
  const r = planDealBackfill({
    deals: [
      { id: 10, srcText: 'המלצה', srcEnum: 118, inq: 'רוצים סיור', add_time: '2021-01-01 08:00:00' },
      { id: 11, srcText: 'דף נחיתה', srcEnum: null, inq: '' },
      { id: 12, srcText: 'פייסבוק', srcEnum: null, inq: 'שוב' },
    ],
    fieldKeys,
    sourceOptionLabel: new Map([['118', 'המלצה']]),
    dealSourceIdByLabel: new Map([['המלצה', 'ds-1'], ['פייסבוק', 'ds-2']]),
    gosDeals: new Map([
      [10, { id: 'd10', source: null, dealSourceId: null }],
      [11, { id: 'd11', source: 'ערך שהוקלד ב-GOS', dealSourceId: null }],
      [12, { id: 'd12', source: null, dealSourceId: 'ds-existing' }],
    ]),
    existingInquiryXwalk: new Map([['12', 'done']]),
  });
  const u10 = r.updates.find((u) => u.orderNo === 10);
  assert.deepEqual(u10.set, { source: 'המלצה', dealSourceId: 'ds-1' });
  const u11 = r.updates.find((u) => u.orderNo === 11);
  assert.equal(u11, undefined, 'GOS-edited source + unmatched catalog → nothing to write');
  const u12 = r.updates.find((u) => u.orderNo === 12);
  assert.deepEqual(u12.set, { source: 'פייסבוק' }, 'existing dealSourceId preserved');
  assert.equal(r.stats.inquiryNotes, 1);
  assert.equal(r.stats.inquiryAlready, 1);
  assert.ok(r.inquiryNotes[0].createdAt.startsWith('2021-01-01'));
});

test('org enrichment: deterministic type mapping fills null only; private-customer maps to NO type; unknown value → review stat + card', () => {
  const orgFieldKeys = { bizType: 'bt', taxId: 'hp', icountId: 'ic', payTerms: 'pt', payMethod: 'pm', orderFormLink: 'ol' };
  const r = planOrgEnrichment({
    orgs: [
      { id: 1, bt: 5, hp: '512345678', ic: '777' },
      { id: 2, bt: 6 },        // private customer
      { id: 3, bt: 7 },        // unknown new value
      { id: 4, bt: 5 },        // GOS already classified
    ],
    orgFieldKeys,
    orgOptionLabel: new Map([['5', 'עסקים וחברות קטנות'], ['6', 'לא עסק-לקוח פרטי'], ['7', 'סוג חדש שלא הוגדר']]),
    typeIdByLabel: new Map([['חברות וארגונים', 'type-biz']]),
    orgXwalk: new Map([['1', 'o1'], ['2', 'o2'], ['3', 'o3'], ['4', 'o4']]),
    gosOrgs: new Map([
      ['o1', { organizationTypeId: null, taxId: null }],
      ['o2', { organizationTypeId: null, taxId: null }],
      ['o3', { organizationTypeId: null, taxId: null }],
      ['o4', { organizationTypeId: 'already', taxId: null }],
    ]),
    existingCards: new Map(),
  });
  const u1 = r.updates.find((u) => u.entityId === 'o1');
  assert.deepEqual(u1.set, { organizationTypeId: 'type-biz', taxId: '512345678' });
  assert.equal(r.stats.privateCustomer, 1);
  assert.deepEqual(r.stats.unmappedValues, { 'סוג חדש שלא הוגדר': 1 });
  assert.equal(r.stats.keptGosType, 1, 'GOS classification never overwritten');
  assert.ok(!r.updates.some((u) => u.entityId === 'o4'));
  const card3 = r.cardMerges.find((m) => m.entityId === 'o3');
  assert.ok(card3.adds.some((a) => a.label === 'סוג העסק (מקור)' && a.value === 'סוג חדש שלא הוגדר'), 'unknown value preserved on the card, never discarded');
});

test('tour card enrichment: adds only missing labels; participant blocks keyed by deal; junk values skipped', () => {
  const r = planTourCardEnrichment({
    tourRecords: [
      { id: 'rT1', fields: { 'לינק לתיקייה בדרייב': 'https://photos.app.goo.gl/abc', 'עיר': 'תל אביב', 'איך היה הסיור': 'היה מצוין', 'שם': { junk: true } } },
      { id: 'rT2', fields: { 'עיר': 'חיפה' } }, // not imported — no crosswalk
    ],
    participantRecords: [
      { id: 'p1', fields: { 'שם סיור': ['rT1'], 'פייפ דיל ID': 123, 'קצת על הקבוצה': 'חוגגים יום הולדת' } },
    ],
    tourXwalk: new Map([['rT1', 'te1']]),
    existingCards: new Map([['te1', [{ label: 'עיר (מקור)', value: 'תל אביב' }]]]),
  });
  assert.equal(r.merges.length, 1);
  const m = r.merges[0];
  assert.ok(m.adds.some((a) => a.label === 'תמונות/דרייב (מערכת קודמת)'));
  assert.ok(!m.adds.some((a) => a.label === 'עיר (מקור)'), 'existing label never duplicated');
  assert.ok(m.adds.some((a) => a.label === 'דיל 123 · על הקבוצה (תיאום)'));
  assert.ok(!m.adds.some((a) => a.value === '[object Object]'));
});

test('plan hash is deterministic; gates refuse missing subjects/owners', () => {
  const sections = {
    notes: { payloads: [{ sourceId: '1', subjectType: 'deal', subjectId: 'd1', createdAt: '2021-01-01T00:00:00.000Z' }] },
    activities: { timeline: [], tasks: [{ sourceId: '2', dealId: 'd1', ownerUserId: 'u1', dueDate: '2026-08-01T00:00:00.000Z' }] },
    dealBackfill: { updates: [], inquiryNotes: [] },
    orgs: { updates: [], cardMerges: [] },
    tourCards: { merges: [] },
  };
  const a = buildEnrichmentPlan(sections);
  const b = buildEnrichmentPlan(JSON.parse(JSON.stringify(sections)));
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(checkEnrichmentGates({ plan: a, expectHash: a.payloadHash }).ok, true);
  assert.equal(checkEnrichmentGates({ plan: a, expectHash: 'x' }).ok, false);
  const broken = buildEnrichmentPlan({ ...sections, notes: { payloads: [{ sourceId: '1', subjectType: 'deal', subjectId: null, createdAt: null }] } });
  assert.equal(checkEnrichmentGates({ plan: broken, expectHash: broken.payloadHash }).ok, false);
});
