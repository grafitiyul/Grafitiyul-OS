import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureReservationDocument,
  buildDocumentSnapshot,
  reservationDocumentFilename,
  jsonSafe,
} from './document.js';
import { looksLikePdf } from '../services/pdfRender.js';

// Canonical-document service suite: the ONE-document-per-session idempotency
// contract, the not-ready gate, atomic filing timeline events, the P2002
// race, and the frozen snapshot's field mapping.

function makeSession(over = {}) {
  return {
    id: 's1',
    sessionNo: 2001,
    status: 'processed',
    language: 'he',
    contactId: 'agent1',
    organizationId: 'org1',
    submittedAt: new Date('2026-07-20T09:00:00Z'),
    signerName: 'דנה כהן',
    signatureMethod: 'typed',
    signatureBytes: null,
    legalConfirmations: [{ key: 'flexible_cancellation', textVersion: 1, acceptedAt: '2026-07-20T09:00:00Z' }],
    payloadSnapshot: {
      invoice: { toOrganizer: true, toFinance: false },
      pricingByGroup: [
        {
          available: true,
          mode: 'exact',
          priceModel: 'fixed',
          rows: [{ type: 'fixed_price', scope: 'per_group', quantity: 2, unitAmountMinor: 165000, totalMinor: 330000 }],
          totals: { netMinor: 330000, vatMinor: 56100, grossMinor: 386100, vatMode: 'excluded', vatRate: 17 },
        },
        null,
      ],
    },
    contact: {
      firstNameHe: 'דנה',
      lastNameHe: 'כהן',
      firstNameEn: 'Dana',
      lastNameEn: 'Cohen',
      phones: [{ value: '050-7654321' }],
      emails: [{ value: 'dana@agency.co.il' }],
    },
    organization: { name: 'סוכנות הצפון' },
    groups: [
      {
        id: 'g1',
        sortOrder: 0,
        groupName: 'בוקר',
        locationLabel: 'חיפה',
        productLabel: 'סיור גרפיטי',
        tourDate: '2026-08-01',
        tourTime: '10:00',
        participants: 30,
        groups: 2,
        tourLanguage: 'en',
        onSiteContactName: null,
        onSiteContactPhone: null,
        notes: null,
        createdDealId: 'd1',
        createdDeal: { id: 'd1', orderNo: 28101 },
      },
      {
        id: 'g2',
        sortOrder: 1,
        groupName: 'צהריים',
        locationLabel: 'תל אביב',
        productLabel: 'סדנת גרפיטי',
        tourDate: '2026-08-02',
        tourTime: '13:00',
        participants: 20,
        groups: 1,
        tourLanguage: null,
        onSiteContactName: 'יוסי',
        onSiteContactPhone: '050-1111111',
        notes: 'הערה',
        createdDealId: 'd2',
        createdDeal: { id: 'd2', orderNo: 28102 },
      },
    ],
    ...over,
  };
}

function fakeDb(session, { failCreate = null } = {}) {
  const state = { documents: [], timeline: [], session };
  const db = {
    state,
    reservationSession: {
      findUnique: async ({ where }) => (session && session.id === where.id ? session : null),
    },
    reservationDocument: {
      findUnique: async ({ where }) =>
        state.documents.find((d) => d.sessionId === where.sessionId || d.id === where.id) || null,
      create: async ({ data }) => {
        if (failCreate) throw failCreate;
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
    timelineEntry: {
      create: async ({ data }) => {
        state.timeline.push(data);
        return data;
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

test('ensure creates ONE real PDF document and files it on contact + every deal', async () => {
  const db = fakeDb(makeSession());
  const r = await ensureReservationDocument('s1', db);
  assert.equal(r.created, true);
  assert.equal(db.state.documents.length, 1);
  const doc = db.state.documents[0];
  assert.equal(doc.sessionId, 's1');
  assert.equal(doc.filename, 'Grafitiyul-Agent-Reservation-2001.pdf');
  assert.equal(doc.mimeType, 'application/pdf');
  assert.ok(looksLikePdf(doc.pdfBytes), 'stored bytes are a real PDF');
  assert.equal(doc.sizeBytes, doc.pdfBytes.length);
  // Filing events: 1 on the contact + 1 per created deal, all pointing at the
  // SAME document (one asset, N associations).
  const events = db.state.timeline.filter(
    (t) => t.data?.event === 'agent_reservation_summary_generated',
  );
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => `${e.subjectType}:${e.subjectId}`).sort(),
    ['contact:agent1', 'deal:d1', 'deal:d2'],
  );
  assert.ok(events.every((e) => e.data.documentId === doc.id));
  assert.ok(events.every((e) => e.kind === 'file'));
});

test('rerun is a no-op: 0 new documents, 0 new timeline entries', async () => {
  const db = fakeDb(makeSession());
  await ensureReservationDocument('s1', db);
  const timelineCount = db.state.timeline.length;
  const again = await ensureReservationDocument('s1', db);
  assert.equal(again.created, false);
  assert.equal(again.document.id, db.state.documents[0].id);
  assert.equal(db.state.documents.length, 1);
  assert.equal(db.state.timeline.length, timelineCount);
});

test('not_ready gate: a session that is not fully processed gets no document', async () => {
  for (const status of ['submitted', 'processing', 'partially_processed', 'failed']) {
    const db = fakeDb(makeSession({ status }));
    const r = await ensureReservationDocument('s1', db);
    assert.equal(r.error, 'not_ready');
    assert.equal(db.state.documents.length, 0);
    assert.equal(db.state.timeline.length, 0);
  }
});

test('unknown session → not_found', async () => {
  const db = fakeDb(null);
  const r = await ensureReservationDocument('nope', db);
  assert.equal(r.error, 'not_found');
});

test('P2002 race: the loser adopts the winner document, no partial filing', async () => {
  const db = fakeDb(makeSession());
  // Simulate the race: another process created the document between the
  // fast-path check and our create.
  const winner = { id: 'docW', sessionId: 's1', filename: 'x.pdf', pdfBytes: Buffer.from('%PDF-x') };
  const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
  const racing = fakeDb(makeSession(), { failCreate: p2002 });
  racing.state.documents.push(winner);
  const r = await ensureReservationDocument('s1', racing);
  assert.equal(r.created, false);
  assert.equal(r.document.id, 'docW');
  assert.equal(racing.state.documents.length, 1);
  void db;
});

test('a PDF/create failure surfaces as a throw and leaves no partial state', async () => {
  const boom = new Error('db_down');
  const db = fakeDb(makeSession(), { failCreate: boom });
  await assert.rejects(() => ensureReservationDocument('s1', db), /db_down/);
  assert.equal(db.state.documents.length, 0);
});

test('snapshot freezes booker, group labels, orderNos and pricing by sortOrder', () => {
  const snap = buildDocumentSnapshot(makeSession(), { generatedAt: new Date('2026-07-21T08:00:00Z') });
  assert.equal(snap.sessionNo, 2001);
  assert.equal(snap.language, 'he');
  assert.deepEqual(snap.booker, {
    name: 'דנה כהן',
    phone: '050-7654321',
    email: 'dana@agency.co.il',
    company: 'סוכנות הצפון',
  });
  assert.equal(snap.groups.length, 2);
  assert.equal(snap.groups[0].orderNo, 28101);
  assert.equal(snap.groups[0].guides, 2);
  assert.equal(snap.groups[0].cityLabel, 'חיפה');
  assert.equal(snap.groups[0].pricing.mode, 'exact');
  assert.equal(snap.groups[1].pricing, null);
  assert.equal(snap.groups[1].orderNo, 28102);
  assert.equal(snap.generatedAt, '2026-07-21T08:00:00.000Z');
  assert.equal(snap.signature.signerName, 'דנה כהן');
  assert.equal(snap.invoice.toOrganizer, true);
  assert.equal(snap.invoice.toFinance, false);
});

test('EN session picks the English booker name; fallback chain works', () => {
  const en = buildDocumentSnapshot(makeSession({ language: 'en' }));
  assert.equal(en.booker.name, 'Dana Cohen');
  const noContact = buildDocumentSnapshot(makeSession({ contact: null }));
  assert.equal(noContact.booker.name, 'דנה כהן'); // signerName fallback
  assert.equal(noContact.booker.phone, null);
});

test('jsonSafe converts BigInt money values for JSON columns', () => {
  const out = jsonSafe({ totals: { netMinor: 100n, nested: [{ v: 5n }] }, s: 'x' });
  assert.deepEqual(out, { totals: { netMinor: 100, nested: [{ v: 5 }] }, s: 'x' });
  assert.equal(jsonSafe(undefined), null);
});

test('filename is human-readable and ASCII-safe', () => {
  assert.equal(reservationDocumentFilename(2001), 'Grafitiyul-Agent-Reservation-2001.pdf');
});
