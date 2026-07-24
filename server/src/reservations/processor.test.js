import test from 'node:test';
import assert from 'node:assert/strict';
import { processReservationSession, retryDelayMs, MAX_ATTEMPTS } from './processor.js';
import { createDealFromReservationGroup, INTAKE_STAGE_KEY } from './createDeal.js';

// Processor exactly-once suite: full success, idempotent re-run, claim
// contention, partial failure with retry scheduling, and the coded failure
// reasons from the Deal-creation service.

const STAGE = { id: 'st1', key: INTAKE_STAGE_KEY, label: 'הסכמה לסגירה' };
const VARIANT = { id: 'var1', productId: 'prod1', locationId: 'loc1' };
const ORG = { id: 'org1', organizationTypeId: 'ot1' };

function makeGroup(over = {}) {
  return {
    id: over.id || 'g1',
    sessionId: 's1',
    sortOrder: 0,
    status: 'pending',
    groupName: 'קבוצת בוקר',
    productVariantId: 'var1',
    tourDate: '2026-08-01',
    tourTime: '10:00',
    participants: 42,
    tourLanguage: 'en',
    onSiteContactName: null,
    onSiteContactPhone: null,
    notes: null,
    createdDealId: null,
    attemptCount: 0,
    ...over,
  };
}

function makeSession(over = {}) {
  return {
    id: 's1',
    sessionNo: 1001,
    status: 'submitted',
    contactId: 'agent1',
    organizationId: 'org1',
    language: 'he',
    attemptCount: 0,
    claimId: null,
    claimExpiresAt: null,
    processedAt: null,
    ...over,
  };
}

function fakeDb({ session, groups, failDealFor = () => false, stages = [STAGE] } = {}) {
  const state = {
    session: { ...session },
    groups: new Map(groups.map((g) => [g.id, { ...g }])),
    deals: [],
    timeline: [],
    dealSources: [],
    contacts: [],
    contactPhones: [],
    documents: [],
  };
  const db = {
    state,
    reservationSession: {
      updateMany: async ({ where, data }) => {
        const s = state.session;
        if (s.id !== where.id) return { count: 0 };
        if (!where.status.in.includes(s.status)) return { count: 0 };
        const now = new Date();
        const claimFree = !s.claimId || (s.claimExpiresAt && s.claimExpiresAt < now);
        if (!claimFree) return { count: 0 };
        Object.assign(s, {
          status: data.status,
          claimId: data.claimId,
          claimExpiresAt: data.claimExpiresAt,
          attemptCount: s.attemptCount + (data.attemptCount?.increment || 0),
        });
        return { count: 1 };
      },
      findUnique: async ({ where }) =>
        state.session.id === where.id
          ? {
              ...state.session,
              groups: [...state.groups.values()].sort((a, b) => a.sortOrder - b.sortOrder),
            }
          : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, state.session.id);
        Object.assign(state.session, data);
        return state.session;
      },
    },
    reservationGroup: {
      findUnique: async ({ where }) => state.groups.get(where.id) || null,
      update: async ({ where, data }) => {
        const g = state.groups.get(where.id);
        const inc = data.attemptCount?.increment || 0;
        Object.assign(g, { ...data, attemptCount: g.attemptCount + inc });
        return g;
      },
    },
    dealStage: {
      findUnique: async ({ where }) => stages.find((s) => s.key === where.key) || null,
    },
    productVariant: {
      findUnique: async ({ where }) => (where.id === VARIANT.id ? VARIANT : null),
    },
    organization: {
      findUnique: async ({ where }) => (where.id === ORG.id ? ORG : null),
    },
    dealSource: {
      findFirst: async ({ where }) =>
        state.dealSources.find((s) => s.label === where.label) || null,
      create: async ({ data }) => {
        const row = { id: `ds${state.dealSources.length + 1}`, ...data };
        state.dealSources.push(row);
        return row;
      },
    },
    contactPhone: {
      findMany: async ({ where }) =>
        state.contactPhones.filter((p) => p.value.includes(where.value.contains)),
    },
    contact: {
      create: async ({ data }) => {
        const row = { id: `c${state.contacts.length + 1}`, ...data };
        state.contacts.push(row);
        return row;
      },
    },
    deal: {
      create: async ({ data }) => {
        if (failDealFor(data)) throw new Error('db_down');
        const row = { id: `d${state.deals.length + 1}`, orderNo: 28000 + state.deals.length, ...data };
        state.deals.push(row);
        return { id: row.id, orderNo: row.orderNo };
      },
    },
    timelineEntry: {
      create: async ({ data }) => {
        state.timeline.push(data);
        return data;
      },
    },
    reservationDocument: {
      findUnique: async ({ where }) =>
        state.documents.find((d) => d.sessionId === where.sessionId || d.id === where.id) || null,
      create: async ({ data }) => {
        if (state.documents.some((d) => d.sessionId === data.sessionId)) {
          const e = new Error('unique');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `doc${state.documents.length + 1}`, generatedAt: new Date(), ...data };
        state.documents.push(row);
        return row;
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

test('full success: every group becomes exactly one deal, session processed, claim released', async () => {
  const db = fakeDb({
    session: makeSession(),
    groups: [makeGroup({ id: 'g1', sortOrder: 0 }), makeGroup({ id: 'g2', sortOrder: 1 })],
  });
  const r = await processReservationSession('s1', db);
  assert.deepEqual(
    { claimed: r.claimed, status: r.status, processed: r.processed, failed: r.failed },
    { claimed: true, status: 'processed', processed: 2, failed: 0 },
  );
  assert.equal(db.state.deals.length, 2);
  assert.equal(db.state.session.status, 'processed');
  assert.ok(db.state.session.processedAt);
  assert.equal(db.state.session.claimId, null);
  for (const g of db.state.groups.values()) {
    assert.equal(g.status, 'processed');
    assert.ok(g.createdDealId);
  }
  // Deal shape honors the binding decisions.
  const deal = db.state.deals[0];
  assert.equal(deal.status, 'open');
  assert.equal(deal.dealStageId, STAGE.id);
  assert.equal(deal.activityType, 'business');
  assert.equal(deal.organizationTypeId, null); // classification force-clears the copy
  assert.equal(deal.title, 'קבוצת בוקר');
  assert.equal(deal.groupName, 'קבוצת בוקר');
  assert.deepEqual(deal.contacts.create[0], {
    contactId: 'agent1',
    isPrimary: true,
    roles: ['ongoingBooking'],
  });
  // History: one deal-created entry per deal + session result entry + contact entry.
  const dealEvents = db.state.timeline.filter((t) => t.data?.event === 'reservation_deal_created');
  assert.equal(dealEvents.length, 2);
  assert.ok(db.state.timeline.some((t) => t.subjectType === 'reservation_session'));
  assert.ok(db.state.timeline.some((t) => t.subjectType === 'contact'));
  // Canonical summary document: generated exactly once on full success, a
  // REAL PDF, filed on the contact + EVERY created deal (kind 'file').
  assert.equal(db.state.documents.length, 1);
  const doc = db.state.documents[0];
  assert.equal(doc.sessionId, 's1');
  assert.ok(doc.pdfBytes.length > 1000);
  assert.equal(doc.filename, 'Grafitiyul-Agent-Reservation-1001.pdf');
  const fileEvents = db.state.timeline.filter(
    (t) => t.data?.event === 'agent_reservation_summary_generated',
  );
  assert.equal(fileEvents.filter((t) => t.subjectType === 'contact').length, 1);
  assert.equal(fileEvents.filter((t) => t.subjectType === 'deal').length, 2);
  const dealIds = [...db.state.groups.values()].map((g) => g.createdDealId).sort();
  assert.deepEqual(
    fileEvents.filter((t) => t.subjectType === 'deal').map((t) => t.subjectId).sort(),
    dealIds,
  );
});

test('re-run is idempotent: stamped groups are skipped, no duplicate deals', async () => {
  const db = fakeDb({ session: makeSession(), groups: [makeGroup()] });
  await processReservationSession('s1', db);
  assert.equal(db.state.deals.length, 1);
  const again = await processReservationSession('s1', db);
  // 'processed' is terminal — the second run cannot even claim.
  assert.equal(again.claimed, false);
  assert.equal(db.state.deals.length, 1);
});

test('claim contention: a live claim blocks a second processor', async () => {
  const db = fakeDb({
    session: makeSession({
      status: 'processing',
      claimId: 'other',
      claimExpiresAt: new Date(Date.now() + 60_000),
    }),
    groups: [makeGroup()],
  });
  const r = await processReservationSession('s1', db);
  assert.equal(r.claimed, false);
  assert.equal(db.state.deals.length, 0);
});

test('an EXPIRED claim is re-claimable (crash recovery)', async () => {
  const db = fakeDb({
    session: makeSession({
      status: 'processing',
      claimId: 'dead',
      claimExpiresAt: new Date(Date.now() - 1000),
    }),
    groups: [makeGroup()],
  });
  const r = await processReservationSession('s1', db);
  assert.equal(r.claimed, true);
  assert.equal(r.status, 'processed');
});

test('partial failure: sibling deals are kept, session schedules a retry', async () => {
  let failuresLeft = 1; // transient failure — the retry pass heals
  const db = fakeDb({
    session: makeSession(),
    groups: [
      makeGroup({ id: 'g1', sortOrder: 0 }),
      makeGroup({ id: 'g2', sortOrder: 1, groupName: 'קבוצה נופלת' }),
    ],
    failDealFor: (data) =>
      data.groupName === 'קבוצה נופלת' && failuresLeft > 0 && !!failuresLeft--,
  });
  const r = await processReservationSession('s1', db);
  assert.equal(r.status, 'partially_processed');
  assert.equal(db.state.deals.length, 1); // the success is NEVER rolled back
  assert.equal(db.state.groups.get('g1').status, 'processed');
  const failedGroup = db.state.groups.get('g2');
  assert.equal(failedGroup.status, 'failed');
  assert.equal(failedGroup.lastError, 'db_down');
  assert.ok(db.state.session.nextRetryAt instanceof Date);
  assert.equal(db.state.session.processedAt, null);
  // Retry heals: the failing condition clears, only g2 is (re)processed.
  db.state.session.nextRetryAt = null;
  const heal = await processReservationSession('s1', db);
  assert.equal(heal.status, 'processed');
  assert.equal(db.state.deals.length, 2);
});

test('coded failures land in group.lastError (stage_not_found / catalog_missing / agent_contact_missing)', async () => {
  const noStage = fakeDb({ session: makeSession(), groups: [makeGroup()], stages: [] });
  await processReservationSession('s1', noStage);
  assert.equal(noStage.state.groups.get('g1').lastError, 'stage_not_found');

  const noVariant = fakeDb({
    session: makeSession(),
    groups: [makeGroup({ productVariantId: 'gone' })],
  });
  await processReservationSession('s1', noVariant);
  assert.equal(noVariant.state.groups.get('g1').lastError, 'catalog_missing');

  const noContact = fakeDb({ session: makeSession({ contactId: null }), groups: [makeGroup()] });
  const r = await processReservationSession('s1', noContact);
  assert.equal(r.status, 'failed');
  assert.equal(noContact.state.groups.get('g1').lastError, 'agent_contact_missing');
});

test('on-site contact: reused by exact phone digits, else created with role fieldRep', async () => {
  const group = makeGroup({ onSiteContactName: 'יוסי לוי', onSiteContactPhone: '050-1234567' });
  const db = fakeDb({ session: makeSession(), groups: [group] });
  db.state.contactPhones.push({ contactId: 'existing9', value: '+972501234567' });
  await processReservationSession('s1', db);
  const contacts = db.state.deals[0].contacts.create;
  assert.deepEqual(contacts[1], { contactId: 'existing9', isPrimary: false, roles: ['fieldRep'] });
  assert.equal(db.state.contacts.length, 0); // reused, not created

  const db2 = fakeDb({
    session: makeSession(),
    groups: [makeGroup({ onSiteContactName: 'דנה בר', onSiteContactPhone: '052-9999999' })],
  });
  await processReservationSession('s1', db2);
  assert.equal(db2.state.contacts.length, 1);
  assert.equal(db2.state.contacts[0].firstNameHe, 'דנה');
  assert.equal(db2.state.contacts[0].lastNameHe, 'בר');
  assert.deepEqual(db2.state.deals[0].contacts.create[1].roles, ['fieldRep']);
});

test('retry backoff doubles and caps; attempts stop at MAX_ATTEMPTS', () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 120_000);
  assert.equal(retryDelayMs(6), 60_000 * 32);
  assert.equal(retryDelayMs(7), 60 * 60 * 1000); // 64m capped at 1h
  assert.equal(retryDelayMs(20), 60 * 60 * 1000);
  assert.ok(MAX_ATTEMPTS >= 3);
});

test('createDealFromReservationGroup requires the agency organization (BINDING #2)', async () => {
  const db = fakeDb({ session: makeSession(), groups: [makeGroup()] });
  await assert.rejects(
    () =>
      createDealFromReservationGroup(db, {
        session: makeSession({ organizationId: null }),
        group: makeGroup(),
      }),
    (e) => e.code === 'organization_missing',
  );
});

// ── pinned Deal note from the group's הערות / דגשים ─────────────────────────
test('createPinnedNotesNote: pinned+editable note, line breaks preserved, per-group isolation', async () => {
  const { createPinnedNotesNote } = await import('./processor.js');
  const created = [];
  const tx = { timelineEntry: { create: async ({ data }) => created.push(data) } };
  const session = { id: 's1', sessionNo: 1234 };

  await createPinnedNotesNote(tx, {
    dealId: 'deal1',
    group: { id: 'g1', notes: 'שורה ראשונה\nשורה שנייה <b>לא HTML</b>' },
    session,
  });
  assert.equal(created.length, 1);
  const n = created[0];
  assert.equal(n.subjectType, 'deal');
  assert.equal(n.subjectId, 'deal1');
  assert.equal(n.kind, 'note');
  assert.equal(n.isPinned, true, 'pinned');
  assert.equal(n.isSystem, false, 'must stay EDITABLE (not a system event)');
  assert.ok(n.body.includes('שורה ראשונה<br>שורה שנייה'), 'line breaks preserved as <br>');
  assert.ok(n.body.includes('&lt;b&gt;'), 'agent text is escaped, never raw HTML');
  assert.equal(n.data.reservationGroupId, 'g1');

  // Empty/whitespace notes create nothing.
  await createPinnedNotesNote(tx, { dealId: 'deal2', group: { id: 'g2', notes: '   ' }, session });
  await createPinnedNotesNote(tx, { dealId: 'deal3', group: { id: 'g3', notes: null }, session });
  assert.equal(created.length, 1, 'no note without text');
});
