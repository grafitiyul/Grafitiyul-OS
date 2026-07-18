import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSubmission,
  decodeSignaturePng,
  persistSubmission,
  invoiceRecipients,
  REQUIRED_CONFIRMATIONS,
  MAX_GROUPS,
} from './intake.js';

// Public intake validation + idempotency suite. Validation returns stable
// problem CODES (the client renders bilingual messages); persistence must be
// idempotent under retries AND under a concurrent unique-key race.

const CATALOG = {
  locations: [{ id: 'loc1', nameHe: 'חיפה', nameEn: 'Haifa' }],
  variants: [
    {
      id: 'var1',
      productId: 'prod1',
      locationId: 'loc1',
      nameHe: 'סיור גרפיטי',
      nameEn: 'Graffiti Tour',
      productLabel: 'סיור גרפיטי',
      locationLabel: 'חיפה',
    },
  ],
};

// 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

const TODAY = '2026-07-16';

function validGroup(over = {}) {
  return {
    groupName: 'קבוצת בוקר',
    productVariantId: 'var1',
    tourDate: '2026-08-01',
    tourTime: '10:30',
    participants: 42,
    tourLanguage: 'en',
    ...over,
  };
}

function validBody(over = {}) {
  return {
    submissionKey: 'sub_0123456789abcdef',
    language: 'he',
    groups: [validGroup()],
    signature: { signerName: 'דנה כהן', method: 'drawn', image: PNG_DATA_URL },
    confirmations: REQUIRED_CONFIRMATIONS.map((c) => ({ key: c.key, accepted: true })),
    invoice: { toOrganizer: true, toFinance: false },
    ...over,
  };
}

const codesByPath = (r) =>
  Object.fromEntries((r.problems || []).map((p) => [p.path, p.code]));

test('a fully valid submission normalizes with catalog-derived refs + labels', () => {
  const r = validateSubmission(validBody(), CATALOG, { today: TODAY });
  assert.equal(r.problems, undefined);
  const g = r.groups[0];
  assert.equal(g.productId, 'prod1');
  assert.equal(g.locationId, 'loc1');
  assert.equal(g.productLabel, 'סיור גרפיטי');
  assert.equal(g.locationLabel, 'חיפה');
  assert.equal(g.participants, 42);
  assert.ok(Buffer.isBuffer(r.session.signatureBytes));
  assert.equal(r.session.legalConfirmations.length, REQUIRED_CONFIRMATIONS.length);
});

test('missing required fields produce per-group problem paths', () => {
  const r = validateSubmission(
    validBody({ groups: [validGroup({ groupName: '', productVariantId: 'nope', participants: 0 })] }),
    CATALOG,
    { today: TODAY },
  );
  const codes = codesByPath(r);
  assert.equal(codes['groups.0.groupName'], 'required');
  assert.equal(codes['groups.0.productVariantId'], 'required');
  assert.equal(codes['groups.0.participants'], 'invalid');
});

test('date validation: malformed, impossible, and past dates are rejected', () => {
  for (const [tourDate, code] of [
    ['01/08/2026', 'invalid'],
    ['2026-02-30', 'invalid'],
    ['2026-07-15', 'past'],
  ]) {
    const r = validateSubmission(
      validBody({ groups: [validGroup({ tourDate })] }),
      CATALOG,
      { today: TODAY },
    );
    assert.equal(codesByPath(r)['groups.0.tourDate'], code, tourDate);
  }
  // Today itself is bookable.
  const ok = validateSubmission(
    validBody({ groups: [validGroup({ tourDate: TODAY })] }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(ok.problems, undefined);
});

test('on-site contact is both-or-nothing', () => {
  const half = validateSubmission(
    validBody({ groups: [validGroup({ onSiteContactName: 'יוסי' })] }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(half)['groups.0.onSiteContactPhone'], 'pair_required');

  const both = validateSubmission(
    validBody({
      groups: [validGroup({ onSiteContactName: 'יוסי', onSiteContactPhone: '050-1234567' })],
    }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(both.problems, undefined);

  const none = validateSubmission(validBody(), CATALOG, { today: TODAY });
  assert.equal(none.problems, undefined);
});

test('signature: drawn requires a valid PNG; typed requires only the name', () => {
  const noImg = validateSubmission(
    validBody({ signature: { signerName: 'דנה', method: 'drawn', image: 'data:image/jpeg;base64,xxxx' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(noImg)['signature.image'], 'invalid');

  const typed = validateSubmission(
    validBody({ signature: { signerName: 'Dana Cohen', method: 'typed' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(typed.problems, undefined);
  assert.equal(typed.session.signatureBytes, null);
});

test('signature: EITHER method alone satisfies — drawn needs no typed name', () => {
  // Option A: a drawn signature alone (no name) is valid.
  const drawnOnly = validateSubmission(
    validBody({ signature: { method: 'drawn', image: PNG_DATA_URL } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(drawnOnly.problems, undefined);
  assert.equal(drawnOnly.session.signerName, null);
  assert.ok(Buffer.isBuffer(drawnOnly.session.signatureBytes));

  // A name alongside a drawn signature is kept as context.
  const drawnNamed = validateSubmission(validBody(), CATALOG, { today: TODAY });
  assert.equal(drawnNamed.problems, undefined);
  assert.equal(drawnNamed.session.signerName, 'דנה כהן');

  // Option B failure: typed with no name → the name IS the signature.
  const typedEmpty = validateSubmission(
    validBody({ signature: { method: 'typed', signerName: '   ' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(typedEmpty)['signature.signerName'], 'required');

  // Neither method → validation fails.
  const neither = validateSubmission(
    validBody({ signature: { method: 'drawn' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(neither)['signature.image'], 'invalid');
});

test('all required confirmations must be accepted', () => {
  const r = validateSubmission(
    validBody({ confirmations: [] }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(r)['confirmations.flexible_cancellation'], 'required');
});

test('group cap and empty-group list are rejected', () => {
  const none = validateSubmission(validBody({ groups: [] }), CATALOG, { today: TODAY });
  assert.equal(codesByPath(none)['groups'], 'required');

  const many = validateSubmission(
    validBody({ groups: Array.from({ length: MAX_GROUPS + 1 }, () => validGroup()) }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(many)['groups'], 'too_many');
});

test('decodeSignaturePng rejects non-PNG payloads and accepts real PNG', () => {
  assert.equal(decodeSignaturePng('data:image/png;base64,aGVsbG8='), null); // not PNG magic
  assert.equal(decodeSignaturePng('not a data url'), null);
  assert.equal(decodeSignaturePng(null), null);
  assert.ok(Buffer.isBuffer(decodeSignaturePng(PNG_DATA_URL)));
});

test('invoice: at least one recipient is required; both may be selected', () => {
  const none = validateSubmission(
    validBody({ invoice: { toOrganizer: false, toFinance: false } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(none)['invoice.recipients'], 'required');

  const both = validateSubmission(
    validBody({ invoice: { toOrganizer: true, toFinance: true } }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(both.problems, undefined);
  assert.equal(both.invoice.toOrganizer, true);
  assert.equal(both.invoice.toFinance, true);
});

test('invoice: nominating a finance contact requires name, valid email AND phone', () => {
  const p = (invoice) =>
    codesByPath(validateSubmission(validBody({ invoice }), CATALOG, { today: TODAY }));

  const missing = p({ toFinance: true });
  assert.equal(missing['invoice.financeName'], 'required');
  assert.equal(missing['invoice.financeEmail'], 'required');
  assert.equal(missing['invoice.financePhone'], 'required');

  const bad = p({ toFinance: true, financeName: 'רותי', financeEmail: 'not-an-email', financePhone: '12' });
  assert.equal(bad['invoice.financeEmail'], 'invalid');
  assert.equal(bad['invoice.financePhone'], 'invalid');

  const ok = validateSubmission(
    validBody({
      invoice: { toFinance: true, financeName: 'רותי', financeEmail: 'fin@a.co', financePhone: '050-123 4567' },
    }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(ok.problems, undefined);
  assert.equal(ok.invoice.nominating, true);
  // The ORIGINAL entered phone is preserved — normalization is validation-only.
  assert.equal(ok.invoice.financePhone, '050-123 4567');
});

test('invoice: replacement nominates via the SAME flow; forged fields without replaceFinance are inert', () => {
  // Explicit replacement with a saved contact → full nomination is required.
  const missing = validateSubmission(
    validBody({ invoice: { toFinance: true, replaceFinance: true } }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(codesByPath(missing)['invoice.financeName'], 'required');

  const ok = validateSubmission(
    validBody({
      invoice: { toFinance: true, replaceFinance: true, financeName: 'רותי', financeEmail: 'fin@a.co', financePhone: '050-1234567' },
    }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(ok.problems, undefined);
  assert.equal(ok.invoice.replaceFinance, true);
  assert.equal(ok.invoice.nominating, true);

  // Forged details WITHOUT replaceFinance against a saved contact → not a
  // nomination at all; the saved contact stays authoritative.
  const forged = validateSubmission(
    validBody({
      invoice: { toFinance: true, financeName: 'תוקף', financeEmail: 'evil@x.co', financePhone: '050-9999999' },
    }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(forged.problems, undefined);
  assert.equal(forged.invoice.nominating, false);
});

test('invoice: a SAVED org finance contact needs no input; organizer-only needs nothing', () => {
  const saved = validateSubmission(
    validBody({ invoice: { toFinance: true } }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(saved.problems, undefined);
  assert.equal(saved.invoice.nominating, false);

  const toMe = validateSubmission(validBody(), CATALOG, { today: TODAY });
  assert.equal(toMe.problems, undefined);
  assert.equal(toMe.invoice.toFinance, false);
});

test('invoiceRecipients: reads the frozen snapshot, dedupes organizer==finance emails', () => {
  const snap = (invoice) => ({ invoice });
  const organizer = { organizerName: 'איילת', organizerEmail: 'Ayelet@Travel.co.il' };

  const both = invoiceRecipients(
    snap({ toOrganizer: true, toFinance: true, financeName: 'רותי', financeEmail: 'fin@a.co', financePhone: '03-555' }),
    organizer,
  );
  assert.deepEqual(both.map((r) => r.kind), ['organizer', 'finance']);

  // Same address (case-insensitive) → one delivery, never a duplicate email.
  const dup = invoiceRecipients(
    snap({ toOrganizer: true, toFinance: true, financeEmail: 'ayelet@travel.CO.IL' }),
    organizer,
  );
  assert.equal(dup.length, 1);
  assert.equal(dup[0].kind, 'organizer');

  const financeOnly = invoiceRecipients(
    snap({ toOrganizer: false, toFinance: true, financeEmail: 'fin@a.co' }),
    organizer,
  );
  assert.deepEqual(financeOnly.map((r) => r.email), ['fin@a.co']);
});

// ── persistSubmission idempotency ────────────────────────────────────────────

function fakePersistDb(existingByKey = new Map()) {
  const createdSessions = [];
  const db = {
    createdSessions,
    reservationSession: {
      findUnique: async ({ where }) => existingByKey.get(where.submissionKey) || null,
      create: async ({ data }) => {
        const row = { id: `s${createdSessions.length + 1}`, sessionNo: 1000 + createdSessions.length, ...data, groups: data.groups.create };
        createdSessions.push(row);
        existingByKey.set(data.submissionKey, row);
        return row;
      },
    },
    agentReservationLink: { update: async () => ({}) },
    // Finance-contact service internals (nomination path).
    organization: {
      findUnique: async () => ({
        id: 'org1',
        financeContactId: db.orgState.financeContactId,
        financeContactName: null,
        financeEmail: db.orgState.financeEmail,
        financePhone: null,
        financeContact: null,
      }),
      update: async ({ where, data }) => {
        db.orgUpdates.push({ where, data });
        Object.assign(db.orgState, data);
        return {};
      },
    },
    contactPhone: { findMany: async () => [] },
    contactEmail: { findFirst: async () => null },
    contact: {
      create: async ({ data }) => {
        db.createdContacts.push(data);
        return { id: `fin${db.createdContacts.length}` };
      },
    },
    contactOrganization: { findFirst: async () => null, create: async ({ data }) => data },
    timelineEntry: { create: async ({ data }) => data },
    $transaction: async (fn) => fn(db),
  };
  db.orgUpdates = [];
  db.createdContacts = [];
  db.orgState = { financeContactId: null, financeEmail: null };
  return db;
}

const PERSIST_ARGS = (validated) => ({
  link: { id: 'l1' },
  contact: { id: 'c1' },
  organization: { id: 'org1' },
  validated,
  payloadSnapshot: { groups: [] },
  clientMeta: null,
});

test('persistSubmission: same submissionKey returns the existing session (no duplicate)', async () => {
  const validated = validateSubmission(validBody(), CATALOG, { today: TODAY });
  const db = fakePersistDb();
  const first = await persistSubmission(PERSIST_ARGS(validated), db);
  assert.equal(first.created, true);
  const second = await persistSubmission(PERSIST_ARGS(validated), db);
  assert.equal(second.created, false);
  assert.equal(second.session.id, first.session.id);
  assert.equal(db.createdSessions.length, 1);
});

test('persistSubmission: a nomination resolves a canonical Contact and designates it on the ORG', async () => {
  const validated = validateSubmission(
    validBody({
      invoice: { toOrganizer: true, toFinance: true, financeName: 'רותי לוין', financeEmail: 'fin@a.co', financePhone: '050-1234567' },
    }),
    CATALOG,
    { today: TODAY },
  );
  const db = fakePersistDb();
  const { session } = await persistSubmission(PERSIST_ARGS(validated), db);
  // A real Contact was created (no match in the fake) and designated.
  assert.equal(db.createdContacts.length, 1);
  assert.equal(db.createdContacts[0].firstNameHe, 'רותי');
  assert.equal(db.orgState.financeContactId, 'fin1');
  // The frozen snapshot carries the resolved contact id + mode.
  assert.equal(session.payloadSnapshot.invoice.financeContactId, 'fin1');
  assert.equal(session.payloadSnapshot.invoice.financeMode, 'created');

  // Organizer-only never touches the org or creates contacts.
  const dbNone = fakePersistDb();
  await persistSubmission(PERSIST_ARGS(validateSubmission(validBody({ submissionKey: 'sub_other_key_0001' }), CATALOG, { today: TODAY })), dbNone);
  assert.deepEqual(dbNone.orgUpdates, []);
  assert.deepEqual(dbNone.createdContacts, []);
});

test('persistSubmission: saved-contact mode never writes the org; forged fields stay inert', async () => {
  // toFinance against a saved contact WITHOUT replaceFinance → nominating is
  // false (server-derived), so even forged details change nothing.
  const validated = validateSubmission(
    validBody({
      submissionKey: 'sub_guard_key_0001',
      invoice: { toFinance: true, financeName: 'תוקף', financeEmail: 'attacker@evil.co', financePhone: '050-9999999' },
    }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(validated.problems, undefined);
  const db = fakePersistDb();
  db.orgState.financeContactId = 'cSaved';
  db.orgState.financeEmail = 'saved@org.co';
  const { session } = await persistSubmission(
    { ...PERSIST_ARGS(validated), organization: { id: 'org1', financeContactId: 'cSaved', financeEmail: 'saved@org.co' } },
    db,
  );
  assert.deepEqual(db.orgUpdates, []);
  assert.deepEqual(db.createdContacts, []);
  // Snapshot still records the SAVED designation as the finance contact.
  assert.equal(session.payloadSnapshot.invoice.financeContactId, 'cSaved');
  assert.equal(session.payloadSnapshot.invoice.financeMode, 'existing');
});

test('persistSubmission: an explicit replacement transfers the designation (old contact preserved)', async () => {
  const validated = validateSubmission(
    validBody({
      submissionKey: 'sub_replace_key_01',
      invoice: { toFinance: true, replaceFinance: true, financeName: 'רותי לוין', financeEmail: 'ruti@b.co', financePhone: '052-2222222' },
    }),
    CATALOG,
    { today: TODAY, orgHasFinance: true },
  );
  assert.equal(validated.problems, undefined);
  const db = fakePersistDb();
  db.orgState.financeContactId = 'cOld';
  db.orgState.financeEmail = 'old@org.co';
  const { session } = await persistSubmission(
    { ...PERSIST_ARGS(validated), organization: { id: 'org1', financeContactId: 'cOld', financeEmail: 'old@org.co' } },
    db,
  );
  // Designation moved to the newly resolved contact; nothing deleted the old
  // one (the fake exposes no contact.update/delete — the service has none).
  assert.equal(db.orgState.financeContactId, 'fin1');
  assert.equal(session.payloadSnapshot.invoice.financeMode, 'replaced');
  assert.equal(session.payloadSnapshot.invoice.financeContactId, 'fin1');
});

test('persistSubmission: unique-key race (P2002) resolves to the winning session', async () => {
  const validated = validateSubmission(validBody(), CATALOG, { today: TODAY });
  const existingByKey = new Map();
  const db = fakePersistDb(existingByKey);
  // First lookup misses, then the create loses the race.
  const winner = { id: 'winner', submissionKey: validated.session.submissionKey, groups: [] };
  db.reservationSession.findUnique = (() => {
    let calls = 0;
    return async () => (calls++ === 0 ? null : winner);
  })();
  db.reservationSession.create = async () => {
    const e = new Error('unique');
    e.code = 'P2002';
    throw e;
  };
  const r = await persistSubmission(PERSIST_ARGS(validated), db);
  assert.equal(r.created, false);
  assert.equal(r.session.id, 'winner');
});
