import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateDeal, COPY_SCALARS, LINE_FIELDS, REUSABLE_NOTE_WHERE } from './duplicateDeal.js';

// Behavior contract of the canonical Duplicate Deal service: the copy is the
// full COMMERCIAL TEMPLATE (fields, contacts, Builder, planning, confirmation,
// reusable operator notes) and NONE of the executed lifecycle (status, waiver,
// payments, bookings, system/history timeline, tasks). A compact in-memory
// store models exactly the prisma surface the service touches — any write to a
// model outside that surface (booking, tourEvent, task, payment…) throws,
// which is itself the guard that the service never touches lifecycle tables.

const STAGE_FIRST = { id: 'stage_first' };

function makeStore({ deal, workingVersion = null, importVersion = null, timeline = [], quoteDrafts = [] }) {
  const s = { creates: {}, seq: 0 };
  const record = (model, row) => {
    (s.creates[model] ||= []).push(row);
    return row;
  };
  const id = (p) => `${p}_${++s.seq}`;

  const client = {
    _s: s,
    deal: {
      findUnique: async ({ where }) => (where.id === deal.id ? deal : null),
      create: async ({ data }) => record('deal', { id: 'copy1', ...data }) && { id: 'copy1' },
    },
    quoteVersion: {
      findFirst: async ({ where }) => {
        if (where.isWorking) return workingVersion;
        if (where.sourceKind === 'pipedrive_import') return importVersion;
        return null;
      },
      create: async ({ data }) => record('quoteVersion', { id: id('qv'), ...data }),
    },
    timelineEntry: {
      // Real allowlist filtering over the seeded rows — the include/exclude
      // tests exercise the WHERE the service actually sends.
      findMany: async ({ where }) =>
        timeline.filter(
          (e) =>
            e.subjectType === where.subjectType &&
            e.subjectId === where.subjectId &&
            e.kind === where.kind &&
            e.actorType === where.actorType &&
            e.isSystem === where.isSystem &&
            (e.deletedAt ?? null) === where.deletedAt,
        ),
      createMany: async ({ data }) => data.forEach((r) => record('timelineEntry', r)),
    },
    dealStage: { findFirst: async () => STAGE_FIRST },
    dealContact: { createMany: async ({ data }) => data.forEach((r) => record('dealContact', r)) },
    quoteOffer: { create: async ({ data }) => record('quoteOffer', { id: id('qo'), ...data }) },
    quoteDocument: {
      // Real WHERE filtering — the service must read the source's DRAFT only.
      // A produced document is an immutable customer record of the original and
      // may never follow a copy, so a seeded produced row that leaked into this
      // result would show up as a failing assertion below.
      findFirst: async ({ where }) =>
        quoteDrafts.find((d) => d.dealId === where.dealId && d.status === where.status) || null,
      create: async ({ data }) => record('quoteDocument', { id: id('qd'), ...data }),
    },
    quoteLine: { createMany: async ({ data }) => data.forEach((r) => record('quoteLine', r)) },
    dealTourPlan: { create: async ({ data }) => record('dealTourPlan', { id: id('plan'), ...data }) },
    dealTourPlanAssignment: { createMany: async ({ data }) => data.forEach((r) => record('planAssignment', r)) },
    dealTourPlanActivityComponent: { createMany: async ({ data }) => data.forEach((r) => record('planComponent', r)) },
    dealConfirmation: { create: async ({ data }) => record('dealConfirmation', { id: id('conf'), ...data }) },
    $transaction: async (fn) => fn(client),
  };
  return client;
}

// A rich source deal — WON, with a waiver, full commercial context.
function fullSource(overrides = {}) {
  return {
    id: 'src1',
    orderNo: 27000,
    title: 'בית ספר אורט',
    status: 'won',
    dealStageId: 'stage_final',
    wonAt: new Date('2026-07-01'),
    wonQuoteRef: { offerNo: 1 },
    lostAt: null,
    groupName: 'שכבת ט',
    organizationId: 'org1',
    organizationUnitId: 'unit1',
    organizationSubtypeId: 'sub1',
    organizationTypeId: null,
    activityType: 'business',
    productId: 'prod1',
    productVariantId: 'var1',
    locationId: 'loc1',
    valueMinor: 150000n,
    currency: 'ILS',
    discountMinor: 5000n,
    noPaymentWaiver: null,
    paymentTermId: 'term1',
    paymentMethodId: 'method1',
    dealSourceId: 'dsrc1',
    source: 'כנס מחנכים',
    ownerUserId: 'admin1',
    expectedCloseDate: new Date('2026-09-01'),
    notes: 'הערות פנימיות לדיל',
    tourDate: '2026-09-15',
    tourTime: '10:00',
    participants: 30,
    groups: 2,
    durationHours: 2.5,
    communicationLanguage: 'he',
    tourLanguage: 'he',
    customerInfo: '<p>מידע חשוב על הלקוח</p>',
    quoteEmailIntro: 'פתיח אישי',
    basePriceOverridden: false,
    paymentToken: 'tok_secret',
    collectionReviewStatus: 'active_collection',
    paymentReviewStatus: 'confirmed_full',
    contacts: [
      { contactId: 'c1', roles: ['organizer'], isPrimary: true, receiveConfirmations: true, receiveOperationalUpdates: true, receivePaymentLinks: true, receiveQuotes: true },
      { contactId: 'c2', roles: [], isPrimary: false, receiveConfirmations: false, receiveOperationalUpdates: false, receivePaymentLinks: false, receiveQuotes: false },
    ],
    confirmation: { fillers: [{ kind: 'activity_duration', hours: 2.5 }], overrideState: { sections: { intro: { html: '<p>x</p>' } } } },
    tourPlan: {
      notes: 'תכנון: לחלק לשתי קבוצות',
      componentsCustomized: true,
      assignments: [{ personRefId: 'p1', externalPersonId: null, displayName: 'מדריך א', role: 'guide', notes: 'מגיע מוקדם' }],
      activityComponents: [{ activityComponentId: 'ac1', workshopLocationId: 'w1', sortOrder: 1 }],
    },
    ...overrides,
  };
}

const WORKING_VERSION = {
  id: 'qv_src',
  vatMode: 'inclusive',
  lines: [
    { kind: 'product', label: 'סיור גרפיטי', productVariantId: 'var1', addonId: null, quantity: 1, unitPriceMinor: 120000n, vatMode: null, vatRate: null, active: true, note: 'בסיס', overridden: false, sourceKind: 'builder', sourceCardGroupId: null, pinnedCardGroupId: null, ticketTypeId: null, sortOrder: 1 },
    { kind: 'addon', label: 'סדנה', productVariantId: null, addonId: 'add1', quantity: 1, unitPriceMinor: 40000n, vatMode: 'exempt', vatRate: 0, active: true, note: null, overridden: true, sourceKind: 'builder', sourceCardGroupId: null, pinnedCardGroupId: null, ticketTypeId: null, sortOrder: 2 },
    { kind: 'discount', label: 'הנחת עמותה', productVariantId: null, addonId: null, quantity: 1, unitPriceMinor: -10000n, vatMode: null, vatRate: null, active: true, note: 'סוכם בטלפון', overridden: false, sourceKind: 'manual', sourceCardGroupId: null, pinnedCardGroupId: null, ticketTypeId: null, sortOrder: 3 },
    { kind: 'free_text', label: 'שורת טקסט', productVariantId: null, addonId: null, quantity: 1, unitPriceMinor: 0n, vatMode: null, vatRate: null, active: false, note: null, overridden: false, sourceKind: 'manual', sourceCardGroupId: null, pinnedCardGroupId: null, ticketTypeId: null, sortOrder: 4 },
  ],
};

test('1+10: main commercial fields copy; the copy is always OPEN at the first stage', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  const res = await duplicateDeal('src1', c);
  assert.equal(res.dealId, 'copy1');
  const copy = c._s.creates.deal[0];
  assert.equal(copy.status, 'open', 'WON source → OPEN copy');
  assert.equal(copy.dealStageId, STAGE_FIRST.id, 'always the first pipeline stage');
  assert.equal(copy.title, 'בית ספר אורט (עותק)');
  for (const f of ['productId', 'productVariantId', 'locationId', 'activityType', 'tourDate', 'tourTime', 'participants', 'groups', 'durationHours', 'tourLanguage', 'customerInfo', 'notes', 'quoteEmailIntro', 'dealSourceId', 'source']) {
    assert.equal(copy[f], fullSource()[f], `copies ${f}`);
  }
  // Lifecycle/payment/collection state never travels.
  for (const f of ['wonAt', 'wonQuoteRef', 'lostAt', 'paymentToken', 'collectionReviewStatus', 'paymentReviewStatus', 'noPaymentWaiver']) {
    assert.ok(!(f in copy), `${f} is NOT on the copy`);
  }
});

test('2: contacts copy with primary + roles + per-contact routing flags', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  const rows = c._s.creates.dealContact;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.contactId, r.isPrimary]), [['c1', true], ['c2', false]]);
  assert.deepEqual(rows[0].roles, ['organizer']);
  assert.equal(rows[0].dealId, 'copy1');
});

test('3+9: tour plan copies fully; no TourEvent/Booking/registration is ever written', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  assert.equal(c._s.creates.dealTourPlan[0].notes, 'תכנון: לחלק לשתי קבוצות');
  assert.equal(c._s.creates.planAssignment.length, 1);
  assert.equal(c._s.creates.planAssignment[0].displayName, 'מדריך א');
  assert.equal(c._s.creates.planComponent.length, 1);
  // The fake exposes NO booking/tourEvent/registration/payment/task models —
  // touching one would throw. The written-model list is the full footprint:
  assert.deepEqual(
    Object.keys(c._s.creates).sort(),
    ['deal', 'dealConfirmation', 'dealContact', 'dealTourPlan', 'planAssignment', 'planComponent', 'quoteLine', 'quoteOffer', 'quoteVersion'].sort(),
  );
});

test('4+5+11: Builder copies commercially byte-equivalent — discounts, VAT overrides, inactive lines — as NEW independent rows', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  const version = c._s.creates.quoteVersion[0];
  assert.equal(version.isWorking, true, 'the copy gets a WORKING (editable) version');
  assert.equal(version.status, 'draft');
  assert.equal(version.vatMode, 'inclusive', 'order-level VAT mode copies');
  assert.equal(version.dealId, 'copy1');
  assert.notEqual(version.id, WORKING_VERSION.id, 'new version id — no shared row');
  assert.equal(c._s.creates.quoteOffer[0].isPrimary, true);

  const lines = c._s.creates.quoteLine;
  assert.equal(lines.length, 4, 'ALL lines copy (including the inactive free-text line)');
  lines.forEach((line, i) => {
    for (const f of LINE_FIELDS) assert.deepEqual(line[f], WORKING_VERSION.lines[i][f], `line ${i} ${f}`);
    assert.equal(line.quoteVersionId, version.id, 'attached to the NEW version');
    assert.ok(!('id' in line), 'no source line id carried — fresh rows');
  });
  // The commercial specifics the task calls out:
  assert.equal(lines[2].kind, 'discount');
  assert.equal(Number(lines[2].unitPriceMinor), -10000);
  assert.equal(lines[1].vatMode, 'exempt', 'per-line VAT override copies');
  assert.equal(lines[1].overridden, true, 'price-override flag copies');
});

test('6+7: ONLY operator-authored notes copy — system/automation/import/changelog/deleted never do', async () => {
  const mk = (over) => ({
    subjectType: 'deal', subjectId: 'src1', kind: 'note', actorType: 'user', isSystem: false,
    deletedAt: null, body: '<p>x</p>', data: null, isPinned: false, pinSortOrder: 0,
    createdBy: 'admin1', createdByName: 'dor', createdAt: new Date('2026-07-01'), ...over,
  });
  const timeline = [
    mk({ body: '<p>הלקוח מעדיף בוקר</p>', isPinned: true, pinSortOrder: 2 }),
    mk({ body: '<p>תוכן הפנייה</p>', data: { origin: 'inquiry' } }),
    mk({ body: '<p>system pinned payment note</p>', actorType: 'system', isSystem: true }),
    mk({ body: '<p>automation note</p>', actorType: 'automation' }),
    mk({ body: '<p>imported pipedrive note</p>', actorType: 'import' }),
    mk({ body: 'changelog', kind: 'change' }),
    mk({ body: '<p>deleted note</p>', deletedAt: new Date('2026-07-02') }),
  ];
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION, timeline });
  await duplicateDeal('src1', c);
  const copied = c._s.creates.timelineEntry || [];
  assert.equal(copied.length, 2, 'exactly the two operator notes copy');
  assert.deepEqual(copied.map((n) => n.body), ['<p>הלקוח מעדיף בוקר</p>', '<p>תוכן הפנייה</p>']);
  assert.equal(copied[0].subjectId, 'copy1');
  assert.equal(copied[0].isPinned, true, 'pin state survives');
  assert.equal(copied[0].pinSortOrder, 2);
  assert.equal(copied[0].createdByName, 'dor', 'author attribution preserved');
  assert.deepEqual(copied[0].data, { copiedFromDealId: 'src1' }, 'provenance marker');
  assert.deepEqual(copied[1].data, { origin: 'inquiry', copiedFromDealId: 'src1' }, 'original data survives under the marker');
});

test('8: waiver does not copy; the copy returns to full Builder gross', async () => {
  const waiver = { reason: 'עמותה', waivedAt: '2026-07-01', lines: [{ cardGroupId: 'card1', ticketTypeId: 'tt1', quantityWaived: 2 }] };
  const version = {
    id: 'qv_src', vatMode: 'inclusive',
    lines: [{ kind: 'ticket', label: 'כרטיס', productVariantId: null, addonId: null, quantity: 5, unitPriceMinor: 10000n, vatMode: null, vatRate: null, active: true, note: null, overridden: false, sourceKind: 'group_ticket', sourceCardGroupId: 'card1', pinnedCardGroupId: null, ticketTypeId: 'tt1', sortOrder: 1 }],
  };
  // Source payable = gross 50,000 − waived 20,000 = 30,000.
  const c = makeStore({ deal: fullSource({ noPaymentWaiver: waiver, valueMinor: 30000n }), workingVersion: version });
  await duplicateDeal('src1', c);
  const copy = c._s.creates.deal[0];
  assert.ok(!('noPaymentWaiver' in copy), 'waiver never copies');
  assert.equal(Number(copy.valueMinor), 50000, 'valueMinor corrected back to the full gross');
});

test('12 (server side): one duplicate call = exactly one deal', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  assert.equal(c._s.creates.deal.length, 1);
});

test('14: the service creates NO tasks — the route fires the normal new-deal automation exactly once', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  assert.ok(!c._s.creates.task, 'no task rows written by the duplicate service');
});

test('a WON deal with no working version falls back to the frozen import as an EDITABLE working copy', async () => {
  const importVersion = { ...WORKING_VERSION, id: 'qv_frozen' };
  const c = makeStore({ deal: fullSource(), workingVersion: null, importVersion });
  await duplicateDeal('src1', c);
  const version = c._s.creates.quoteVersion[0];
  assert.equal(version.isWorking, true, 'frozen import becomes a fresh WORKING version on the copy');
  assert.equal(version.status, 'draft');
  assert.equal(c._s.creates.quoteLine.length, 4);
});

test('allowlist WHERE is sent verbatim (contract with REUSABLE_NOTE_WHERE)', async () => {
  let sentWhere = null;
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  const orig = c.timelineEntry.findMany;
  c.timelineEntry.findMany = async (args) => { sentWhere = args.where; return orig(args); };
  await duplicateDeal('src1', c);
  assert.deepEqual(sentWhere, { subjectType: 'deal', subjectId: 'src1', ...REUSABLE_NOTE_WHERE });
});

test('scalar copy list stays in sync with the fixture (COPY_SCALARS all land)', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION });
  await duplicateDeal('src1', c);
  const copy = c._s.creates.deal[0];
  const src = fullSource();
  for (const f of COPY_SCALARS) {
    if (src[f] === null || src[f] === undefined) continue;
    assert.deepEqual(copy[f], src[f], `COPY_SCALARS field ${f} lands on the copy`);
  }
});

// ── persistent quote overrides travel; one-version edits cannot ─────────────
//
// The persistence decision is STRUCTURAL. An override saved with "החל שינוי זה
// גם על גרסאות עתידיות" is written to the draft's overrideState; one saved
// without it never reaches the database at all (it rides a single produce call
// as temporaryOverrideState). So these tests are about copying the right ROW,
// never about comparing text.

const PERSISTENT_DRAFT = {
  dealId: 'src1',
  status: 'draft',
  language: 'en',
  displayProductName: 'Graffiti Tour & Workshop',
  overrideState: {
    blocks: {
      program: { html: '<p>תוכנית מותאמת</p>' },
      tour_details: { fields: { he: { duration: '~4 שעות' }, en: { duration: '~4 hours' } } },
    },
  },
};

test('the copy gets its own working draft carrying the PERSISTENT overrides', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION, quoteDrafts: [PERSISTENT_DRAFT] });
  await duplicateDeal('src1', c);
  const drafts = c._s.creates.quoteDocument || [];
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.deepEqual(d.overrideState, PERSISTENT_DRAFT.overrideState, 'section AND technical-field overrides both land');
  assert.equal(d.displayProductName, 'Graffiti Tour & Workshop');
  assert.equal(d.language, 'en', 'the quote language travels with the template');
});

test('the copied draft is an INDEPENDENT, never-issued document', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION, quoteDrafts: [PERSISTENT_DRAFT] });
  await duplicateDeal('src1', c);
  const d = c._s.creates.quoteDocument[0];
  assert.equal(d.status, 'draft');
  assert.equal(d.versionNo, undefined, 'the copy has issued nothing');
  assert.equal(d.producedAt, undefined);
  assert.equal(d.renderModelSnapshot, undefined, 'no frozen customer content follows a copy');
  assert.ok(d.publicToken, 'its own capability token…');
  assert.notEqual(d.publicToken, PERSISTENT_DRAFT.publicToken, '…never the original’s URL');
  // Bound to the COPY's own deal/offer/version, so editing it cannot reach back.
  assert.equal(d.dealId, 'copy1');
  assert.equal(d.quoteVersionId, c._s.creates.quoteVersion[0].id);
  assert.equal(d.offerId, c._s.creates.quoteOffer[0].id);
});

test('a source with no persistent overrides creates no draft at all', async () => {
  // Nothing was marked as lasting, so there is nothing to carry — and an empty
  // draft row would be a lie about the copy having been prepared.
  const c = makeStore({
    deal: fullSource(), workingVersion: WORKING_VERSION,
    quoteDrafts: [{ dealId: 'src1', status: 'draft', language: 'he', overrideState: null, displayProductName: null }],
  });
  await duplicateDeal('src1', c);
  assert.equal((c._s.creates.quoteDocument || []).length, 0);
});

test('a source that never opened the quote module copies cleanly', async () => {
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION, quoteDrafts: [] });
  const r = await duplicateDeal('src1', c);
  assert.equal(r.dealId, 'copy1', 'the copy is still created');
  assert.equal((c._s.creates.quoteDocument || []).length, 0);
});

test('only the DRAFT is read — a produced version is never a source', async () => {
  let sentWhere = null;
  const c = makeStore({ deal: fullSource(), workingVersion: WORKING_VERSION, quoteDrafts: [PERSISTENT_DRAFT] });
  const orig = c.quoteDocument.findFirst;
  c.quoteDocument.findFirst = async (args) => { sentWhere = args.where; return orig(args); };
  await duplicateDeal('src1', c);
  assert.deepEqual(sentWhere, { dealId: 'src1', status: 'draft' });
});
