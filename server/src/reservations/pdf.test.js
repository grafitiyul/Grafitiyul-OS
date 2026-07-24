import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReservationSummaryPdf,
  buildReservationSummaryLayout,
  pngDimensions,
} from './pdf.js';
import { looksLikePdf, countPdfPages, createMeasurementFont } from '../services/pdfRender.js';

// Reservation-summary PDF — rendered through the canonical Documents engine
// via a MEASURED flow layout, from a FROZEN content snapshot. These tests
// verify real output bytes (magic, page math), the layout invariants that
// keep every annotation inside the printable area, the booker section, the
// bidi-safe pricing rows and the vector checkbox states.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// A frozen "exact" agent-pricing model — tiered base + extra participants +
// Saturday surcharge, VAT excluded at 17%.
function exactPricing(over = {}) {
  return {
    available: true,
    mode: 'exact',
    priceModel: 'tiered',
    rows: [
      { type: 'tier_up_to', threshold: 25, scope: 'per_group', quantity: 2, unitAmountMinor: 165000, totalMinor: 330000 },
      { type: 'extra_participant', scope: 'per_participant', quantity: 10, unitAmountMinor: 12000, totalMinor: 120000 },
      { type: 'saturday_surcharge', scope: 'per_group', quantity: 2, unitAmountMinor: 25000, totalMinor: 50000 },
    ],
    totals: { netMinor: 500000, vatMinor: 85000, grossMinor: 585000, vatMode: 'excluded', vatRate: 17 },
    missing: [],
    ...over,
  };
}

function makeGroup(i, over = {}) {
  return {
    index: i,
    groupName: `קבוצה ${i}`,
    cityLabel: 'חיפה',
    activityLabel: 'סיור גרפיטי',
    tourDate: '2026-08-01',
    tourTime: '10:30',
    participants: 40 + i,
    guides: 2,
    tourLanguage: 'en',
    onSiteContactName: i % 2 ? 'יוסי לוי' : null,
    onSiteContactPhone: i % 2 ? '050-1234567' : null,
    notes: i % 3 ? 'להביא כובעים' : null,
    orderNo: i % 2 ? 28100 + i : null,
    dealId: i % 2 ? `d${i}` : null,
    pricing: exactPricing(),
    ...over,
  };
}

function makeSnapshot(groupCount, over = {}) {
  return {
    version: 1,
    kind: 'agent_summary',
    sessionNo: 1042,
    language: 'he',
    submittedAt: '2026-07-16T10:00:00.000Z',
    generatedAt: '2026-07-16T10:05:00.000Z',
    booker: {
      name: 'דנה כהן',
      phone: '050-7654321',
      email: 'dana@agency.co.il',
      company: 'סוכנות הצפון',
    },
    groups: Array.from({ length: groupCount }, (_, i) => makeGroup(i + 1)),
    invoice: {
      toOrganizer: true,
      toFinance: true,
      financeName: 'רותי לוין',
      financeEmail: 'finance@agency.co.il',
      financePhone: '03-5551234',
    },
    confirmations: [{ key: 'flexible_cancellation', textVersion: 1, acceptedAt: '2026-07-16T10:00:00.000Z' }],
    signature: { signerName: 'דנה כהן', method: 'drawn' },
    ...over,
  };
}

// Layout invariants: nothing may start above the top margin or extend past
// the physical printable area; the signature field lives on the last page.
// Card boxes (form-snapshot borders) deliberately extend up to ~2% OUTSIDE the
// content margin — the card frame wraps the content like the form's padding —
// but must still stay well inside the physical page. All text stays inside the
// content margins exactly as before.
function assertLayoutInvariants(layout) {
  for (const a of layout.annotations) {
    assert.ok(a.page >= 1 && a.page <= layout.pageCount, `page ${a.page} in range`);
    assert.ok(a.yPct >= 3.5, `annotation top ${a.yPct} below top margin`);
    assert.ok(
      a.yPct + a.hPct <= 98,
      `annotation bottom ${(a.yPct + a.hPct).toFixed(1)} inside page`,
    );
    if (a.kind === 'box' && a.wPct > 50) {
      // Card frame — wraps the content column; ≥5.9% keeps it printable.
      assert.ok(a.xPct >= 5.9 && a.xPct + a.wPct <= 94.1, 'card frame inside page');
    } else {
      assert.ok(a.xPct >= 7.9 && a.xPct + a.wPct <= 92.1, 'inside side margins');
    }
  }
  for (const f of layout.fields.filter((f) => f.fieldType === 'signature')) {
    assert.equal(f.page, layout.pageCount, 'signature on the last page');
    assert.ok(f.yPct + f.hPct <= 92, 'signature inside the footer zone');
  }
}

const allText = (layout) => layout.annotations.map((a) => a.text || '').join('\n');

test('single-group snapshot renders a valid PDF with logo, booker section near the top', async () => {
  const snapshot = makeSnapshot(1);
  const layout = await buildReservationSummaryLayout(snapshot, { signatureBytes: PNG_1PX });
  assertLayoutInvariants(layout);
  const text = allText(layout);
  assert.ok(text.includes('סיכום הזמנת פעילות לסוכני תיירות'), 'title');
  assert.ok(text.includes('פרטי המזמין'), 'booker section');
  assert.ok(text.includes('שם: דנה כהן'));
  assert.ok(text.includes('טלפון: 050-7654321'));
  assert.ok(text.includes('אימייל: dana@agency.co.il'));
  assert.ok(text.includes('חברת נסיעות: סוכנות הצפון'));
  // Booker section sits near the top of page 1 (before any group content).
  const bookerAnn = layout.annotations.find((a) => (a.text || '').includes('פרטי המזמין'));
  assert.equal(bookerAnn.page, 1);
  assert.ok(bookerAnn.yPct < 30, `booker section near the top (yPct=${bookerAnn.yPct})`);
  const groupAnn = layout.annotations.find((a) => (a.text || '').includes('קבוצה 1'));
  assert.ok(bookerAnn.yPct < groupAnn.yPct, 'booker before groups');
  // Logo image field present on page 1 with preserved aspect ratio (232×202).
  const logo = layout.fields.find((f) => f.fieldType === 'stamp');
  assert.ok(logo, 'logo field present');
  assert.equal(logo.page, 1);
  const pdf = await buildReservationSummaryPdf(snapshot, { signatureBytes: PNG_1PX });
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), layout.pageCount);
});

test('group details include city, activity, guides, order number', async () => {
  const layout = await buildReservationSummaryLayout(makeSnapshot(1));
  const text = allText(layout);
  assert.ok(text.includes('עיר: חיפה'));
  assert.ok(text.includes('פעילות: סיור גרפיטי'));
  assert.ok(text.includes('מספר מדריכים: 2'));
  assert.ok(text.includes('מספר הזמנה: GOS-28101'));
});

test('pricing rows: locked LTR "qty × unit = total" runs + full VAT breakdown', async () => {
  const layout = await buildReservationSummaryLayout(makeSnapshot(1));
  const text = allText(layout);
  // The amount runs are standalone pure-LTR annotations — order locked.
  assert.ok(text.includes('2 × ₪1,650 = ₪3,300'), 'tier multiplication');
  assert.ok(text.includes('10 × ₪120 = ₪1,200'), 'extra participants multiplication');
  assert.ok(text.includes('2 × ₪250 = ₪500'), 'saturday surcharge multiplication');
  // Labels present (drawn as separate leading-edge runs).
  assert.ok(text.includes('עד 25 משתתפים'));
  assert.ok(text.includes('כל משתתף נוסף'));
  assert.ok(text.includes('תוספת שבת/חג'));
  // Totals: subtotal / VAT / total to pay reconcile with the frozen model.
  assert.ok(text.includes('צפי להזמנה זו'));
  assert.ok(text.includes('₪5,000'));
  assert.ok(text.includes('מע״מ (17%)'));
  assert.ok(text.includes('₪850'));
  assert.ok(text.includes('סה״כ לתשלום'));
  assert.ok(text.includes('₪5,850'));
  // An amount annotation must contain NO Hebrew (pure LTR run by contract).
  const amountAnn = layout.annotations.find((a) => a.text === '2 × ₪1,650 = ₪3,300');
  assert.ok(amountAnn, 'amount is its own annotation');
  assert.ok(!/[֐-׿]/.test(amountAnn.text));
});

test('VAT-exempt and price-list-fallback groups render their states', async () => {
  const snapshot = makeSnapshot(3, {
    groups: [
      makeGroup(1, {
        pricing: exactPricing({
          rows: [{ type: 'fixed_price', scope: 'per_group', quantity: 1, unitAmountMinor: 90000, totalMinor: 90000 }],
          totals: { netMinor: 90000, vatMinor: 0, grossMinor: 90000, vatMode: 'exempt', vatRate: null },
        }),
      }),
      makeGroup(2, { pricing: { available: false, reason: 'no_agents_card', fallbackKey: 'agent_price_list' } }),
      makeGroup(3, { pricing: null }),
    ],
  });
  const layout = await buildReservationSummaryLayout(snapshot);
  const text = allText(layout);
  assert.ok(text.includes('פטור ממע״מ'));
  assert.ok(text.includes('מחיר קבוע'));
  // Both the unavailable model AND the missing model degrade to the fallback.
  const fallbacks = layout.annotations.filter((a) =>
    (a.text || '').includes('החישוב האוטומטי של המחיר לא זמין'),
  );
  assert.equal(fallbacks.length, 2);
});

test('invoice checkbox group: checked = box+fill+check, unchecked = empty box', async () => {
  const layout = await buildReservationSummaryLayout(
    makeSnapshot(1, {
      invoice: { toOrganizer: true, toFinance: false, financeName: null, financeEmail: null, financePhone: null },
    }),
  );
  // Checkbox frames are the SMALL boxes; wide boxes are form-snapshot card frames.
  const boxes = layout.annotations.filter((a) => a.kind === 'box' && a.wPct < 5);
  assert.equal(boxes.length, 2, 'both recipients render a checkbox frame');
  const filled = boxes.filter((b) => b.fillColor);
  assert.equal(filled.length, 1, 'exactly the selected recipient is filled');
  // Form-snapshot card frames exist (booker/group/cancellation/invoice + boxes).
  const cards = layout.annotations.filter((a) => a.kind === 'box' && a.wPct > 50);
  assert.ok(cards.length >= 5, `expected card frames, got ${cards.length}`);
  // The check mark itself is a vector annotation, never a font glyph.
  const checks = layout.annotations.filter((a) => a.kind === 'check');
  assert.ok(checks.length >= 2, 'checked recipient + accepted cancellation terms');
  const text = allText(layout);
  assert.ok(text.includes('משלוח חשבונית'));
  assert.ok(text.includes('תנאי הביטול'));
});

test('a 12-group snapshot paginates across multiple pages, footer clear', async () => {
  const snapshot = makeSnapshot(12);
  const layout = await buildReservationSummaryLayout(snapshot, { signatureBytes: PNG_1PX });
  assert.ok(layout.pageCount >= 2, `expected multi-page, got ${layout.pageCount}`);
  assertLayoutInvariants(layout);
  const pdf = await buildReservationSummaryPdf(snapshot, { signatureBytes: PNG_1PX });
  assert.equal(await countPdfPages(pdf), layout.pageCount);
});

test('very long multi-paragraph notes render in FULL and flow across pages', async () => {
  const paragraph = 'שימו לב: הקבוצה מגיעה עם מדריך מטעם הסוכנות ונדרש תיאום מראש מול נציג השטח. '.repeat(6);
  const notes = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\nסוף-ההערה-סימן-ייחודי`;
  const snapshot = makeSnapshot(3, {
    groups: [makeGroup(1, { notes }), makeGroup(2, { notes }), makeGroup(3, { notes })],
  });
  const layout = await buildReservationSummaryLayout(snapshot);
  assertLayoutInvariants(layout);
  const text = allText(layout);
  assert.ok(text.includes('סוף-ההערה-סימן-ייחודי'), 'note tail present (no truncation)');
  assert.ok(text.includes('\n\n'), 'blank paragraph lines preserved');
  const pdf = await buildReservationSummaryPdf(snapshot);
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), layout.pageCount);
  assert.ok(layout.pageCount >= 2);
});

test('extreme long names/emails and emoji render without losing the line', async () => {
  const snapshot = makeSnapshot(1, {
    booker: {
      name: 'ז׳אן-פייר אלכסנדרוביץ׳-רוזנבלום הארוך במיוחד 😀',
      phone: '+972-50-123-4567 ext. 8901234',
      email: 'very.long.email.address.for.testing.overflow@extremely-long-subdomain.example-agency.co.il',
      company: 'The Extremely Long International Travel Organization of Northern Israel and Surroundings Ltd 🌍',
    },
    groups: [
      makeGroup(1, {
        groupName: 'קבוצת חוקרים בינלאומית עם שם ארוך במיוחד שנמשך עוד ועוד ועוד',
        notes: 'כתובת למשלוח: very.long.email@sub.example-agency.co.il 🎉🎉🎉',
      }),
    ],
  });
  const layout = await buildReservationSummaryLayout(snapshot);
  assertLayoutInvariants(layout);
  const text = allText(layout);
  assert.ok(text.includes('example-agency.co.il'));
  assert.ok(!text.includes('🎉'), 'unsupported glyphs filtered before layout');
  const pdf = await buildReservationSummaryPdf(snapshot);
  assert.ok(looksLikePdf(pdf));
});

test('EN snapshot: left-aligned, English labels, typed-name signature', async () => {
  const snapshot = makeSnapshot(2, {
    language: 'en',
    booker: { name: 'Dana Cohen', phone: '050-7654321', email: 'dana@agency.co.il', company: 'North Agency' },
    signature: { signerName: 'Dana Cohen', method: 'typed' },
  });
  const layout = await buildReservationSummaryLayout(snapshot);
  const text = allText(layout);
  assert.ok(text.includes('Travel Agent Activity Reservation Summary'));
  assert.ok(text.includes('Booker details'));
  assert.ok(text.includes('Travel company: North Agency'));
  assert.ok(text.includes('Number of guides: 2'));
  assert.ok(text.includes('Total to pay'));
  assert.ok(text.includes('2 × ₪1,650 = ₪3,300'));
  assert.ok(!text.includes('מע״מ'), 'no Hebrew pricing labels leak into the EN copy');
  const sigNote = layout.annotations.find((a) => a.fontSize === 16);
  assert.ok(sigNote, 'typed-name signature note present');
  assert.equal(sigNote.align, 'left');
  assert.equal(layout.fields.filter((f) => f.fieldType === 'signature').length, 0);
  const pdf = await buildReservationSummaryPdf(snapshot);
  assert.ok(looksLikePdf(pdf));
});

test('drawn-only signature (no signer name) renders image + signed-on line', async () => {
  const snapshot = makeSnapshot(1, { signature: { signerName: null, method: 'drawn' } });
  const layout = await buildReservationSummaryLayout(snapshot, { signatureBytes: PNG_1PX });
  assert.equal(layout.fields.filter((f) => f.fieldType === 'signature').length, 1);
  const text = allText(layout);
  assert.ok(text.includes('נחתם בתאריך'), 'signed-on line without a name');
  assert.ok(!text.includes('נחתם על ידי'));
  assertLayoutInvariants(layout);
});

test('renders without optional data (no signature, no invoice, no pricing, no labels)', async () => {
  const pdf = await buildReservationSummaryPdf(
    makeSnapshot(1, {
      booker: { name: '', phone: null, email: null, company: null },
      invoice: null,
      confirmations: null,
      signature: { signerName: null, method: null },
      groups: [
        makeGroup(1, {
          cityLabel: null,
          activityLabel: null,
          tourLanguage: null,
          onSiteContactName: null,
          onSiteContactPhone: null,
          notes: null,
          orderNo: null,
          tourTime: null,
          pricing: null,
        }),
      ],
    }),
  );
  assert.ok(looksLikePdf(pdf));
});

test('30 groups with heavy notes — the worst legal payload — stays valid', async () => {
  const notes = 'הערה ארוכה עם הרבה פרטים חשובים לתפעול הקבוצה בשטח. '.repeat(8);
  const snapshot = makeSnapshot(30, {
    groups: Array.from({ length: 30 }, (_, i) => makeGroup(i + 1, { notes })),
  });
  const layout = await buildReservationSummaryLayout(snapshot, { signatureBytes: PNG_1PX });
  assertLayoutInvariants(layout);
  const pdf = await buildReservationSummaryPdf(snapshot, { signatureBytes: PNG_1PX });
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), layout.pageCount);
});

test('deterministic: the same snapshot always yields the same layout', async () => {
  const font = await createMeasurementFont();
  const a = await buildReservationSummaryLayout(makeSnapshot(3), { font });
  const b = await buildReservationSummaryLayout(makeSnapshot(3), { font });
  assert.equal(a.pageCount, b.pageCount);
  assert.deepEqual(a.annotations, b.annotations);
});

test('pngDimensions reads IHDR', () => {
  assert.deepEqual(pngDimensions(PNG_1PX), { w: 1, h: 1 });
  assert.equal(pngDimensions(Buffer.from('nope')), null);
});
