import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSubmission,
  decodeSignaturePng,
  persistSubmission,
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

test('all required confirmations must be accepted', () => {
  const r = validateSubmission(
    validBody({ confirmations: [] }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(r)['confirmations.reservation_request'], 'required');
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

test('invoice: "לאיש כספים אחר" requires a valid email when the org has no finance contact', () => {
  const missing = validateSubmission(
    validBody({ invoice: { sendToFinance: true } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(missing)['invoice.financeEmail'], 'required');

  const bad = validateSubmission(
    validBody({ invoice: { sendToFinance: true, financeEmail: 'not-an-email' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(codesByPath(bad)['invoice.financeEmail'], 'invalid');

  const ok = validateSubmission(
    validBody({ invoice: { sendToFinance: true, financeName: 'רותי', financeEmail: 'fin@a.co' } }),
    CATALOG,
    { today: TODAY },
  );
  assert.equal(ok.problems, undefined);
  assert.deepEqual(ok.invoice, { sendToFinance: true, financeName: 'רותי', financeEmail: 'fin@a.co' });
});

test('invoice: a SAVED org finance contact needs no input; "אליי" needs nothing', () => {
  const saved = validateSubmission(
    validBody({ invoice: { sendToFinance: true } }),
    CATALOG,
    { today: TODAY, orgFinanceEmail: 'finance@org.co' },
  );
  assert.equal(saved.problems, undefined);
  assert.equal(saved.invoice.financeEmail, null); // canonical org value is used

  const toMe = validateSubmission(validBody(), CATALOG, { today: TODAY });
  assert.equal(toMe.problems, undefined);
  assert.equal(toMe.invoice.sendToFinance, false);
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
    organization: {
      update: async ({ where, data }) => {
        db.orgUpdates.push({ where, data });
        return {};
      },
    },
    $transaction: async (fn) => fn(db),
  };
  db.orgUpdates = [];
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

test('persistSubmission: a new finance contact persists onto the ORGANIZATION (canonical fields)', async () => {
  const validated = validateSubmission(
    validBody({ invoice: { sendToFinance: true, financeName: 'רותי לוין', financeEmail: 'fin@a.co' } }),
    CATALOG,
    { today: TODAY },
  );
  const db = fakePersistDb();
  await persistSubmission(PERSIST_ARGS(validated), db);
  assert.deepEqual(db.orgUpdates, [
    { where: { id: 'org1' }, data: { financeEmail: 'fin@a.co', financeContactName: 'רותי לוין' } },
  ]);

  // "אליי" (or the saved-contact mode, which sends no email) never touches the org.
  const dbNone = fakePersistDb();
  await persistSubmission(PERSIST_ARGS(validateSubmission(validBody({ submissionKey: 'sub_other_key_0001' }), CATALOG, { today: TODAY })), dbNone);
  assert.deepEqual(dbNone.orgUpdates, []);
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
