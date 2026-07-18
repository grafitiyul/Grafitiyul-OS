import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReservationPdf, buildReservationLayout, pngDimensions } from './pdf.js';
import { looksLikePdf, countPdfPages, createMeasurementFont } from '../services/pdfRender.js';

// Reservation PDF — rendered through the canonical Documents engine via a
// MEASURED flow layout. These tests verify real output bytes (magic, page
// math) and the layout invariants that keep every annotation inside the
// printable area and the signature footer clear of body content.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function makeGroup(i, over = {}) {
  return {
    groupName: `קבוצה ${i}`,
    locationLabel: 'חיפה',
    productLabel: 'סיור גרפיטי',
    tourDate: '2026-08-01',
    tourTime: '10:30',
    participants: 40 + i,
    tourLanguage: 'en',
    onSiteContactName: i % 2 ? 'יוסי לוי' : null,
    onSiteContactPhone: i % 2 ? '050-1234567' : null,
    notes: i % 3 ? 'להביא כובעים' : null,
    createdDealOrderNo: i % 2 ? 28100 + i : null,
    ...over,
  };
}

function makeSession(groupCount, over = {}) {
  return {
    sessionNo: 1042,
    language: 'he',
    submittedAt: new Date('2026-07-16T10:00:00Z'),
    signerName: 'דנה כהן',
    signatureMethod: 'drawn',
    signatureBytes: PNG_1PX,
    agentName: 'דנה כהן',
    organizationName: 'סוכנות הצפון',
    legalConfirmations: [{ key: 'flexible_cancellation', textVersion: 1 }],
    payloadSnapshot: {
      invoice: {
        toOrganizer: true,
        toFinance: true,
        financeName: 'רותי לוין',
        financeEmail: 'finance@agency.co.il',
        financePhone: '03-5551234',
      },
    },
    groups: Array.from({ length: groupCount }, (_, i) => makeGroup(i + 1)),
    ...over,
  };
}

// Layout invariants: nothing may start above the top margin or extend past
// the physical printable area; the signature field lives on the last page.
function assertLayoutInvariants(layout) {
  for (const a of layout.annotations) {
    assert.ok(a.page >= 1 && a.page <= layout.pageCount, `page ${a.page} in range`);
    assert.ok(a.yPct >= 3.5, `annotation top ${a.yPct} below top margin`);
    assert.ok(
      a.yPct + a.hPct <= 98,
      `annotation bottom ${(a.yPct + a.hPct).toFixed(1)} inside page`,
    );
    assert.ok(a.xPct >= 7.9 && a.xPct + a.wPct <= 92.1, 'inside side margins');
  }
  for (const f of layout.fields) {
    assert.equal(f.page, layout.pageCount, 'signature on the last page');
    assert.ok(f.yPct + f.hPct <= 92, 'signature inside the footer zone');
  }
}

test('single-group session renders a one-page PDF with valid layout', async () => {
  const session = makeSession(1);
  const layout = await buildReservationLayout(session);
  assert.equal(layout.pageCount, 1);
  assertLayoutInvariants(layout);
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), 1);
});

test('a 12-group session paginates across multiple pages, footer clear', async () => {
  const session = makeSession(12);
  const layout = await buildReservationLayout(session);
  assert.ok(layout.pageCount >= 2, `expected multi-page, got ${layout.pageCount}`);
  assertLayoutInvariants(layout);
  const pdf = await buildReservationPdf(session);
  assert.equal(await countPdfPages(pdf), layout.pageCount);
});

test('very long multi-paragraph notes render in FULL and flow across pages', async () => {
  const paragraph = 'שימו לב: הקבוצה מגיעה עם מדריך מטעם הסוכנות ונדרש תיאום מראש מול נציג השטח. '.repeat(6);
  const notes = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\nסוף-ההערה-סימן-ייחודי`;
  const session = makeSession(3, {
    groups: [makeGroup(1, { notes }), makeGroup(2, { notes }), makeGroup(3, { notes })],
  });
  const layout = await buildReservationLayout(session);
  assertLayoutInvariants(layout);
  // The END of the note must appear somewhere — nothing was truncated.
  const allText = layout.annotations.map((a) => a.text || '').join('\n');
  assert.ok(allText.includes('סוף-ההערה-סימן-ייחודי'), 'note tail present (no truncation)');
  // Blank paragraph separators survive into the layout text.
  assert.ok(allText.includes('\n\n'), 'blank paragraph lines preserved');
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), layout.pageCount);
  assert.ok(layout.pageCount >= 2);
});

test('extreme long names/emails and emoji render without losing the line', async () => {
  const session = makeSession(1, {
    organizationName: 'The Extremely Long International Travel Organization of Northern Israel and Surroundings Ltd 🌍',
    agentName: 'ז׳אן-פייר אלכסנדרוביץ׳-רוזנבלום הארוך במיוחד 😀',
    groups: [
      makeGroup(1, {
        groupName: 'קבוצת חוקרים בינלאומית עם שם ארוך במיוחד שנמשך עוד ועוד ועוד',
        onSiteContactName: 'Maximilian-Alexander von Habsburg-Lothringen',
        onSiteContactPhone: '+972-50-123-4567 ext. 8901234',
        notes: 'כתובת למשלוח: very.long.email.address.for.testing.overflow@extremely-long-subdomain.example-agency.co.il 🎉🎉🎉',
      }),
    ],
    payloadSnapshot: {
      invoice: {
        toOrganizer: true,
        toFinance: true,
        financeName: 'איש כספים עם שם ארוך מאוד מאוד',
        financeEmail: 'accounts.payable.department@very-long-agency-domain-name.example.co.il',
        financePhone: '+972-3-555-1234',
      },
    },
  });
  const layout = await buildReservationLayout(session);
  assertLayoutInvariants(layout);
  const allText = layout.annotations.map((a) => a.text || '').join('\n');
  // The email survives (emoji are dropped by the font filter, text stays).
  assert.ok(allText.includes('example-agency.co.il'));
  assert.ok(!allText.includes('🎉'), 'unsupported glyphs filtered before layout');
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
});

test('typed signature (no image) renders the name as the signature; EN left-aligned', async () => {
  const session = makeSession(2, {
    language: 'en',
    signatureMethod: 'typed',
    signatureBytes: null,
    agentName: 'Dana Cohen',
    organizationName: 'North Agency',
  });
  const layout = await buildReservationLayout(session);
  assert.equal(layout.fields.length, 0);
  const sigNote = layout.annotations.find((a) => a.fontSize === 16);
  assert.ok(sigNote, 'typed-name signature note present');
  assert.equal(sigNote.text, 'דנה כהן');
  assert.equal(sigNote.align, 'left');
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
});

test('drawn-only signature (no signer name) renders image + signed-on line', async () => {
  const session = makeSession(1, { signerName: null });
  const layout = await buildReservationLayout(session);
  assert.equal(layout.fields.length, 1);
  const allText = layout.annotations.map((a) => a.text || '').join('\n');
  assert.ok(allText.includes('נחתם בתאריך'), 'signed-on line without a name');
  assert.ok(!allText.includes('נחתם על ידי'));
  assertLayoutInvariants(layout);
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
});

test('renders without optional data (no signature at all, no labels, no notes)', async () => {
  const pdf = await buildReservationPdf(
    makeSession(1, {
      signerName: null,
      signatureBytes: null,
      legalConfirmations: null,
      payloadSnapshot: null,
      groups: [
        makeGroup(1, {
          locationLabel: null,
          productLabel: null,
          tourLanguage: null,
          onSiteContactName: null,
          onSiteContactPhone: null,
          notes: null,
          createdDealOrderNo: null,
          tourTime: null,
        }),
      ],
    }),
  );
  assert.ok(looksLikePdf(pdf));
});

test('30 groups with heavy notes — the worst legal payload — stays valid', async () => {
  const notes = 'הערה ארוכה עם הרבה פרטים חשובים לתפעול הקבוצה בשטח. '.repeat(8);
  const session = makeSession(30, {
    groups: Array.from({ length: 30 }, (_, i) => makeGroup(i + 1, { notes })),
  });
  const layout = await buildReservationLayout(session);
  assertLayoutInvariants(layout);
  const pdf = await buildReservationPdf(session);
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), layout.pageCount);
});

test('invoice + confirmation sections appear when frozen on the session', async () => {
  const layout = await buildReservationLayout(makeSession(1));
  const allText = layout.annotations.map((a) => a.text || '').join('\n');
  assert.ok(allText.includes('משלוח חשבונית'));
  assert.ok(allText.includes('finance@agency.co.il'));
  assert.ok(allText.includes('תנאי הביטול'));
  assert.ok(layout.annotations.some((a) => a.kind === 'check'), 'check mark drawn');
});

test('pngDimensions reads IHDR; measurement font is reusable across layouts', async () => {
  assert.deepEqual(pngDimensions(PNG_1PX), { w: 1, h: 1 });
  assert.equal(pngDimensions(Buffer.from('nope')), null);
  const font = await createMeasurementFont();
  const a = await buildReservationLayout(makeSession(2), font);
  const b = await buildReservationLayout(makeSession(2), font);
  assert.equal(a.pageCount, b.pageCount);
});
