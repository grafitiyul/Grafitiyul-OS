import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { LEGAL_TEXTS, LEGAL_TEXTS_VERSION, legalTextsFor } from './legalTexts.js';
import { validateSubmission } from './intake.js';
import { buildDocumentSnapshot } from './document.js';
import { buildReservationSummaryPdf, buildReservationSummaryLayout } from './pdf.js';

// LEGAL IMMUTABILITY CONTRACT: the summary PDF is the permanent legal record of
// what the agent accepted. The exact wording (cancellation statement, disclaimer,
// invoice labels) is FROZEN at submit and the renderer reads ONLY the snapshot —
// so editing the registry can never reword an already-issued document.

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const CATALOG = {
  variants: [
    {
      id: 'v1',
      productId: 'p1',
      locationId: 'l1',
      productLabel: 'סיור',
      locationLabel: 'תל אביב',
    },
  ],
};

function validBody() {
  return {
    submissionKey: 'legal-test-key-123',
    language: 'he',
    groups: [
      {
        groupName: 'קבוצת בדיקה',
        productVariantId: 'v1',
        tourDate: '2999-01-01',
        tourTime: '10:00',
        participants: 10,
        groups: 1,
        tourLanguage: 'en',
      },
    ],
    signature: { method: 'typed', signerName: 'בודק חתימה' },
    confirmations: [{ key: 'flexible_cancellation', accepted: true }],
    invoice: { toOrganizer: true, toFinance: false },
  };
}

// A frozen snapshot exactly as buildDocumentSnapshot produces for a v2 session.
function frozenSnapshot() {
  const legal = legalTextsFor('he');
  const validated = validateSubmission(validBody(), CATALOG, { today: '2990-01-01' });
  assert.ok(!validated.problems, JSON.stringify(validated.problems));
  const session = {
    id: 's1',
    sessionNo: 9999,
    language: 'he',
    submittedAt: '2026-07-24T10:00:00.000Z',
    contact: null,
    organization: null,
    signerName: validated.session.signerName,
    signatureMethod: validated.session.signatureMethod,
    legalConfirmations: validated.session.legalConfirmations,
    payloadSnapshot: { pricingByGroup: [], legal, invoice: { toOrganizer: true, toFinance: false } },
    groups: [
      {
        sortOrder: 0,
        groupName: 'קבוצת בדיקה',
        locationLabel: 'תל אביב',
        productLabel: 'סיור',
        tourDate: '2999-01-01',
        tourTime: '10:00',
        participants: 10,
        groups: 1,
        tourLanguage: 'en',
        createdDealId: 'd1',
        createdDeal: { orderNo: 27100 },
      },
    ],
  };
  return buildDocumentSnapshot(session, { generatedAt: '2026-07-24T10:00:05.000Z' });
}

test('submit freezes the EXACT accepted wording on the confirmation + snapshot', () => {
  const validated = validateSubmission(validBody(), CATALOG, { today: '2990-01-01' });
  const conf = validated.session.legalConfirmations.find((c) => c.key === 'flexible_cancellation');
  assert.ok(conf, 'confirmation recorded');
  assert.equal(conf.language, 'he');
  assert.equal(conf.legalTextsVersion, LEGAL_TEXTS_VERSION);
  assert.deepEqual(conf.textLines, LEGAL_TEXTS.he.cancellation.lines); // exact text, not a key
  assert.ok(conf.acceptedAt, 'acceptance timestamp recorded');

  const snap = frozenSnapshot();
  assert.deepEqual(snap.legal.cancellation.lines, LEGAL_TEXTS.he.cancellation.lines);
  assert.equal(snap.legal.disclaimer, LEGAL_TEXTS.he.disclaimer);
  assert.equal(snap.legal.invoice.title, LEGAL_TEXTS.he.invoice.title);
  assert.equal(snap.language, 'he');
  assert.equal(snap.signature.signerName, 'בודק חתימה');
});

test('THE DRILL: registry wording changes after issuing → issued PDF bytes are byte-for-byte unchanged', async () => {
  const snap = frozenSnapshot();
  const before = await buildReservationSummaryPdf(snap);

  // "Change the current legal text" — mutate every legal string in the registry.
  const saved = JSON.parse(JSON.stringify(LEGAL_TEXTS));
  try {
    LEGAL_TEXTS.he.cancellation.lines = ['נוסח ביטול חדש לגמרי — גרסה עתידית.'];
    LEGAL_TEXTS.he.disclaimer = 'נוסח דיסקליימר חדש לגמרי.';
    LEGAL_TEXTS.he.invoice.title = 'כותרת חשבונית חדשה';
    LEGAL_TEXTS.he.invoice.toOrganizer = 'נמען חדש';

    // The issued document re-renders from ITS OWN frozen snapshot → identical bytes.
    const after = await buildReservationSummaryPdf(snap);
    assert.equal(sha(before), sha(after), 'issued PDF must be byte-for-byte unchanged');

    // While a NEW submission made after the change freezes (and renders) the NEW text.
    const newValidated = validateSubmission(
      { ...validBody(), submissionKey: 'legal-test-key-456' },
      CATALOG,
      { today: '2990-01-01' },
    );
    const newConf = newValidated.session.legalConfirmations.find(
      (c) => c.key === 'flexible_cancellation',
    );
    assert.deepEqual(newConf.textLines, ['נוסח ביטול חדש לגמרי — גרסה עתידית.']);
  } finally {
    // Restore the real registry for every other test.
    LEGAL_TEXTS.he = saved.he;
    LEGAL_TEXTS.en = saved.en;
  }
});

test('the PDF renders the frozen statement lines (not a generation-time paraphrase)', async () => {
  const snap = frozenSnapshot();
  const layout = await buildReservationSummaryLayout(snap);
  const texts = layout.annotations.filter((a) => a.text).map((a) => a.text);
  for (const line of LEGAL_TEXTS.he.cancellation.lines) {
    assert.ok(texts.some((x) => x.includes(line)), `PDF must contain the exact accepted line: ${line}`);
  }
  assert.ok(texts.some((x) => x.includes(LEGAL_TEXTS.he.disclaimer)), 'frozen disclaimer rendered');
  // The legacy one-line paraphrase must NOT be used when frozen text exists.
  assert.ok(!texts.some((x) => x.startsWith('אושרו תנאי הביטול לסוכני תיירות')), 'no paraphrase');
});

test('legacy snapshots (issued before freezing) keep their historical wording path', async () => {
  const snap = frozenSnapshot();
  // Strip the frozen legal content the way a pre-v2 snapshot looks.
  const legacy = JSON.parse(JSON.stringify(snap));
  delete legacy.legal;
  legacy.confirmations = [{ key: 'flexible_cancellation', textVersion: 1, acceptedAt: '2026-07-20T09:00:00Z' }];

  const layout = await buildReservationSummaryLayout(legacy);
  const texts = layout.annotations.filter((a) => a.text).map((a) => a.text);
  assert.ok(
    texts.some((x) => x.startsWith('אושרו תנאי הביטול לסוכני תיירות')),
    'legacy fallback line rendered',
  );
});
