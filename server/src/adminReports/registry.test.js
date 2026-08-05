import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORTS, reportByNumber, renderReport, renderReportSample, customerLine, scheduledReports,
} from './registry.js';

// ── catalog integrity ────────────────────────────────────────────────────────

test('report numbers are stable, unique and documented', () => {
  const numbers = REPORTS.map((r) => r.number);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.equal(new Set(numbers).size, numbers.length);
  for (const r of REPORTS) {
    assert.ok(r.nameHe?.length > 3, `#${r.number} has a Hebrew name`);
    assert.ok(r.triggerHe?.length > 10, `#${r.number} documents its trigger`);
    assert.equal(typeof r.render, 'function');
    assert.equal(typeof r.sample, 'function');
  }
});

test('every report renders from its own realistic sample (the preview path)', () => {
  for (const r of REPORTS) {
    const text = renderReportSample(r.number);
    assert.ok(text && text.length > 20, `#${r.number} preview renders`);
    // A preview must never leak an unresolved placeholder.
    assert.ok(!/\{\{|undefined|null/.test(text), `#${r.number} preview has no placeholders: ${text}`);
  }
});

// ── Manager Report identification ("(#N)" as the final line) ─────────────────

test('every manager report ends with its "(#N)" identifier; guide and customer reports never carry it', () => {
  for (const r of REPORTS) {
    const text = renderReportSample(r.number);
    const internal = r.audience !== 'guides' && r.audience !== 'customer';
    if (internal) {
      assert.ok(text.endsWith(`\n\n(#${r.number})`), `#${r.number} identifies itself as its final line`);
    } else {
      assert.ok(!text.includes(`(#${r.number})`), `#${r.number} (${r.audience}) must not expose an internal catalog number`);
    }
  }
});

test('the identifier rides the English rendering too, from the same appender', () => {
  const r = reportByNumber(19); // bilingual office report
  const en = renderReport(19, r.sample(), 'en');
  assert.ok(en.endsWith('\n\n(#19)'), 'English body ends with the identifier');
});

// ── the shared customer line (business vs private) ───────────────────────────

test('customer line: business shows "name - organization", private shows name only', () => {
  const contact = { firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: '', lastNameEn: '' };
  assert.equal(customerLine({ contact, org: { name: 'עיריית תל אביב' } }), 'דנה לוי - עיריית תל אביב');
  assert.equal(customerLine({ contact, org: null }), 'דנה לוי');
  // No empty dash when the organization is missing — the explicit rule.
  assert.ok(!customerLine({ contact, org: null }).includes(' - '));
});

test('customer line falls back to the organization when no contact exists', () => {
  assert.equal(customerLine({ contact: null, org: { name: 'בית ספר אלון' } }), 'בית ספר אלון');
  assert.equal(customerLine({}), '—');
});

// ── #1 payment ───────────────────────────────────────────────────────────────

test('#1 reports the COMPLETED payment amount, never the deal total', () => {
  const text = renderReport(1, {
    contact: { firstNameHe: 'רון', lastNameHe: 'ברק' },
    org: null,
    deal: { orderNo: 27001, valueMinor: 900000 }, // deal total — must NOT appear
    tour: { date: '2026-09-14', startTime: '10:30' },
    payment: { completedAmountMinor: 150000, currency: 'ILS' },
    owner: { displayName: 'יעל' },
    links: { origin: 'https://x' },
  });
  assert.match(text, /סכום ששילם: ₪1,500/);
  assert.ok(!text.includes('9,000'), 'the deal total must not leak into the payment line');
  assert.match(text, /תאריך הפעילות: 14\/09\/2026 10:30/);
  assert.match(text, /לינק לדיל: https:\/\/x\/admin\/crm\/deals\/27001/);
  assert.match(text, /בעלים: יעל/);
});

// ── #2 quote ─────────────────────────────────────────────────────────────────

test('#2 uses the OFFER total for a parallel offer and labels it מקבילה', () => {
  const text = renderReport(2, {
    contact: { firstNameHe: 'משפחת', lastNameHe: 'כהן' },
    deal: { orderNo: 27002, participants: 30, valueMinor: 500000 }, // deal headline
    tour: { date: '2026-10-02', startTime: '17:00', product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'חיפה' } },
    quoteReport: { totalMinor: 372000, isPrimary: false, publicToken: 'tok', versionNo: 2 },
    links: { origin: 'https://x' },
  });
  assert.match(text, /סכום: ₪3,720/);
  assert.ok(!text.includes('5,000'), 'a parallel offer must never show the deal total');
  assert.match(text, /סוג הצעה: מקבילה/);
  assert.match(text, /לינק להצעה: https:\/\/x\/quote\/tok/);
  assert.match(text, /כמות משתתפים: 30/);
});

test('#2 falls back to the deal headline ONLY for the primary offer', () => {
  const base = {
    contact: { firstNameHe: 'א', lastNameHe: 'ב' },
    deal: { orderNo: 1, valueMinor: 500000 },
    links: { origin: 'https://x' },
  };
  const primary = renderReport(2, { ...base, quoteReport: { totalMinor: null, isPrimary: true, publicToken: 't' } });
  assert.match(primary, /סכום: ₪5,000/);
  assert.match(primary, /סוג הצעה: ראשית/);
  const parallel = renderReport(2, { ...base, quoteReport: { totalMinor: null, isPrimary: false, publicToken: 't' } });
  assert.match(parallel, /סכום: —/);
});

// ── #3 change ────────────────────────────────────────────────────────────────

test('#3 reports the frozen previous/new datetime and the REAL actor', () => {
  const text = renderReport(3, {
    contact: { firstNameHe: 'גיא', lastNameHe: 'קורן' },
    org: { name: 'בית ספר אלון' },
    deal: { orderNo: 27003 },
    owner: { displayName: 'בעל הדיל' }, // must NOT be used for "מי עדכן"
    changeReport: {
      prevDate: '2026-09-01', prevTime: '09:00',
      newDate: '2026-09-08', newTime: '11:30',
      actor: { displayName: 'נועה בר' },
    },
    links: { origin: 'https://x' },
  });
  assert.match(text, /מועד מקורי: 01\/09\/2026, 09:00/);
  assert.match(text, /מועד חדש: 08\/09\/2026, 11:30/);
  assert.match(text, /מי עדכן: נועה בר/);
  assert.ok(!text.includes('בעל הדיל'), 'the deal owner must never be reported as the updater');
  assert.match(text, /גיא קורן - בית ספר אלון/);
});

test('#3 with no authenticated actor reports an honest dash, never the owner', () => {
  const text = renderReport(3, {
    contact: { firstNameHe: 'א', lastNameHe: 'ב' },
    deal: { orderNo: 1 },
    owner: { displayName: 'בעל הדיל' },
    changeReport: { prevDate: '2026-09-01', prevTime: '09:00', newDate: '2026-09-02', newTime: '09:00', actor: null },
    links: { origin: 'https://x' },
  });
  assert.match(text, /מי עדכן: —/);
  assert.ok(!text.includes('בעל הדיל'));
});

// ── #1 headline ──────────────────────────────────────────────────────────────

test('#1 headline is the exact owner-specified line', () => {
  assert.ok(renderReportSample(1).startsWith('💳 לקוח הוסיף תשלום 💳\n'));
});

// ── #4 / #5 coordination ─────────────────────────────────────────────────────

const coordCtx = (extra) => ({
  contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
  org: { name: 'עיריית תל אביב' },
  deal: { orderNo: 27210 },
  links: { origin: 'https://x' },
  coordinationReport: {
    guideName: 'יואב כהן', productName: 'סיור גרפיטי', cityName: 'חיפה',
    tourDate: '2026-09-20', tourTime: '10:00', participants: 24, tourEventId: 'te_1',
    ...extra,
  },
});

test('#4 reports the guide, the customer line and the canonical form link', () => {
  const text = renderReport(4, coordCtx());
  assert.ok(text.startsWith('✅ שיחת תיאום בוצעה בזמן ✅\n'));
  assert.match(text, /מדריך: יואב כהן/);
  assert.match(text, /לקוח: דנה לוי - עיריית תל אביב/);
  assert.match(text, /סיור: סיור גרפיטי - חיפה/);
  assert.match(text, /מועד הסיור: 20\/09\/2026 10:00/);
  assert.match(text, /כמות משתתפים: 24/);
  assert.match(text, /לינק לטופס: https:\/\/x\/admin\/tours\/te_1/);
  assert.match(text, /לינק לדיל: https:\/\/x\/admin\/crm\/deals\/27210/);
  assert.ok(!text.includes('באיחור'), 'the on-time report never mentions lateness');
});

test('#5 adds the measured lateness and keeps the same facts', () => {
  const text = renderReport(5, coordCtx({ latenessLabel: 'יום ו-5 שעות' }));
  assert.ok(text.startsWith('⛔ שיחת תיאום בוצעה באיחור ⛔\n'));
  assert.match(text, /בוצע באיחור של: יום ו-5 שעות/);
  assert.match(text, /מדריך: יואב כהן/);
});

// ── #6 daily coordination monitor ────────────────────────────────────────────

test('#6 maps each status to its icon and flags a late completion', () => {
  const text = renderReport(6, {
    aggregate: {
      items: [
        { status: 'overdue', guideName: 'א', customerName: 'לקוח א', participants: 10 },
        { status: 'open', guideName: 'ב', customerName: 'לקוח ב', orgName: 'ארגון ב', participants: 20 },
        { status: 'done', guideName: 'ג', customerName: 'לקוח ג', participants: 30, wasLate: true },
        { status: 'done', guideName: 'ד', customerName: 'לקוח ד', participants: 40 },
      ],
    },
  });
  const rows = text.split('\n').slice(2);
  assert.equal(rows[0], '⛔ א - לקוח א - 10');
  assert.equal(rows[1], '⌛ ב - לקוח ב - ארגון ב - 20');
  assert.equal(rows[2], '✅ ג - לקוח ג - 30 (באיחור)');
  assert.equal(rows[3], '✅ ד - לקוח ד - 40');
});

// ── #7 / #8 missing summaries ────────────────────────────────────────────────

test('#7 is the headline plus the list — no preamble, no management link', () => {
  const text = renderReport(7, {
    links: { origin: 'https://x' },
    aggregate: {
      items: [
        { guideName: 'יואב', productName: 'סיור', customerName: 'לקוח א', tourDate: '2026-09-10', tourTime: '10:00' },
        { guideName: 'מיכל', productName: 'סדנה', customerName: 'לקוח ב', orgName: 'ארגון', tourDate: '2026-09-12', tourTime: '17:00' },
      ],
    },
  });
  assert.deepEqual(text.split('\n'), [
    '📝 סיכומי סיור שטרם נשלחו 📝',
    '',
    '⛔ יואב - סיור - לקוח א - 10/09/2026 10:00',
    '⛔ מיכל - סדנה - לקוח ב - ארגון - 12/09/2026 17:00',
    '',
    '(#7)',
  ]);
  assert.ok(!text.includes('להלן'), 'the introductory sentence is gone');
  assert.ok(!text.includes('לינק לניהול'), 'the management link is gone');
  assert.ok(!text.includes('https://x'), 'no link of any kind remains');
});

test('#8 is a single-guide message signed by גרפיבוט', () => {
  const text = renderReport(8, {
    contact: { firstNameHe: 'משפחת', lastNameHe: 'רוזנברג' },
    org: null,
    summaryReport: { guideName: 'יואב כהן', productName: 'סיור', cityName: 'תל אביב', tourDate: '2026-09-16', tourTime: '10:00' },
  });
  assert.ok(text.startsWith('📝 לא נשלח סיכום סיור 📝\n'));
  assert.match(text, /שם המדריך: יואב כהן/);
  assert.match(text, /שם הלקוח: משפחת רוזנברג/);
  assert.match(text, /שם הסיור: סיור - תל אביב/);
  assert.ok(text.endsWith('תודה,\nגרפיבוט\n\n(#8)'));
});

// ── #9 quote signed ──────────────────────────────────────────────────────────

test('#9 lists customer and organization separately and ends with the deal link', () => {
  const text = renderReport(9, {
    contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
    org: { name: 'עיריית תל אביב' },
    deal: { orderNo: 27242, valueMinor: 900000 }, // deal headline — must NOT leak
    links: { origin: 'https://x' },
    signedQuote: { tourDate: '2026-10-04', tourTime: '10:00', productName: 'סיור גרפיטי - חיפה', totalMinor: 372000 },
  });
  assert.ok(text.startsWith('✍️ הצעת מחיר נחתמה ✍️\n'));
  assert.match(text, /לקוח: דנה לוי/);
  assert.match(text, /ארגון: עיריית תל אביב/);
  assert.ok(!text.includes('דנה לוי - עיריית'), 'customer and organization are separate lines');
  assert.match(text, /תאריך הסיור: 04\/10\/2026 10:00/);
  assert.match(text, /מוצר: סיור גרפיטי - חיפה/);
  assert.match(text, /סכום: ₪3,720/);
  assert.ok(!text.includes('9,000'), 'the deal total must not leak into a parallel offer');
  assert.ok(text.endsWith('לאישור:\nhttps://x/admin/crm/deals/27242\n\n(#9)'));
});

test('#9 with no organization shows an honest dash, never an empty label', () => {
  const text = renderReport(9, {
    contact: { firstNameHe: 'רון', lastNameHe: 'ברק' },
    org: null, deal: { orderNo: 1 }, links: { origin: 'https://x' },
    signedQuote: { tourDate: null, productName: null, totalMinor: null },
  });
  assert.match(text, /ארגון: —/);
  assert.match(text, /תאריך הסיור: —/);
  assert.match(text, /סכום: —/);
});

// ── #10 agent order ──────────────────────────────────────────────────────────

const agentCtx = (groups, totalMinor = null) => ({
  contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
  org: { name: 'סוכנות הנסיעות' },
  links: { origin: 'https://x' },
  agentOrder: { orderNo: 1042, groups, totalMinor },
});

test('#10 with one group uses the full house layout', () => {
  const text = renderReport(10, agentCtx([{
    groupName: 'כיתה ז1', tourDate: '2026-10-04', tourTime: '10:00',
    productName: 'סיור וסדנת גרפיטי - תל אביב', participants: 24,
    totalMinor: 372000, dealOrderNo: 27242,
  }]));
  assert.deepEqual(text.split('\n'), [
    '📥 הזמנה חדשה מסוכן 📥',
    '',
    'סוכן: דנה לוי',
    'ארגון: סוכנות הנסיעות',
    'מספר הזמנה: 1042',
    'תאריך הפעילות: 04/10/2026 10:00',
    'מוצר: סיור וסדנת גרפיטי - תל אביב',
    'כמות משתתפים: 24',
    'סכום ההזמנה: ₪3,720',
    '',
    'לאישור:',
    'https://x/admin/crm/deals/27242',
    '',
    '(#10)',
  ]);
});

test('#10 with several groups lists one line each plus the order total', () => {
  const text = renderReport(10, agentCtx([
    { groupName: 'כיתה ז1', tourDate: '2026-10-04', tourTime: '10:00', productName: 'סיור גרפיטי', participants: 24, totalMinor: 372000, dealOrderNo: 27242 },
    { groupName: 'כיתה ז2', tourDate: '2026-10-05', tourTime: '10:00', productName: 'סיור גרפיטי', participants: 22, totalMinor: 341000, dealOrderNo: 27243 },
  ], 713000));
  assert.match(text, /• כיתה ז1 - 04\/10\/2026 10:00 - סיור גרפיטי - 24 משתתפים - ₪3,720/);
  assert.match(text, /• כיתה ז2 - 05\/10\/2026 10:00 - סיור גרפיטי - 22 משתתפים - ₪3,410/);
  assert.match(text, /סה"כ: ₪7,130/);
  // Every booked group is reachable — no order is left without its deal link.
  assert.match(text, /לאישור:\nhttps:\/\/x\/admin\/crm\/deals\/27242\nhttps:\/\/x\/admin\/crm\/deals\/27243\n\n\(#10\)$/);
});

test('#10 never invents an agency or a total it does not have', () => {
  const text = renderReport(10, {
    contact: { firstNameHe: 'רון', lastNameHe: 'ברק' }, org: null,
    links: { origin: 'https://x' },
    agentOrder: { orderNo: 7, totalMinor: null, groups: [{ groupName: null, tourDate: null, productName: null, participants: null, totalMinor: null, dealOrderNo: null }] },
  });
  assert.match(text, /ארגון: —/);
  assert.match(text, /סכום ההזמנה: —/);
  assert.ok(text.endsWith('לאישור:\n—\n\n(#10)'));
});

// ── #26 deal became WON ─────────────────────────────────────────────────────

test('#26 shows a ₪0 deal total honestly and omits the deposit line when nothing was paid', () => {
  const text = renderReport(26, {
    contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
    org: null,
    deal: { orderNo: 27300, valueMinor: 0, currency: 'ILS', participants: 12, product: { nameHe: 'סיור גרפיטי' }, location: null },
    payment: { paidMinor: 0, totalMinor: 0 },
    wonReport: { cause: 'manual', closedBy: { displayName: 'יעל שחר' }, paymentAmountMinor: null },
    links: { origin: 'https://x' },
  });
  assert.match(text, /💰 עסקה חדשה 💰/);
  assert.match(text, /סכום עסקה: ₪0/);
  assert.ok(!text.includes('מקדמה'), 'no deposit line without a real payment');
  assert.match(text, /מי סגר\? יעל שחר/);
  assert.match(text, /דיל:\nhttps:\/\/x\/admin\/crm\/deals\/27300/);
  // No organization → no " - " suffix on the customer line.
  assert.match(text, /שם המזמינה: דנה לוי\n/);
});

test('#26 payment-driven: system attribution + the verified payment amount as the deposit', () => {
  const text = renderReport(26, {
    contact: { firstNameHe: 'רון', lastNameHe: 'ברק' },
    org: { name: 'חברת אבק' },
    deal: { orderNo: 27301, valueMinor: 500000, currency: 'ILS', participants: null, product: { nameHe: 'סדנת גרפיטי' }, location: { nameHe: 'ירושלים', isHomeLocation: false } },
    payment: { paidMinor: 150000, totalMinor: 500000 },
    wonReport: { cause: 'card_payment', closedBy: null, paymentAmountMinor: 150000 },
    links: { origin: 'https://x' },
  });
  assert.match(text, /שם המזמינה: רון ברק - חברת אבק/);
  assert.match(text, /פעילות: סדנת גרפיטי - ירושלים/, 'non-home city IS shown');
  assert.match(text, /משתתפים: לא צוין/, 'an honest fallback, never a blank label');
  assert.match(text, /מקדמה ששולמה: ₪1,500/);
  assert.match(text, /מי סגר\? מערכת — תשלום אשראי/, 'automatic wins are attributed to the system');
});

test('#26 hides the home-location city and a FULL payment is never called a deposit', () => {
  const base = {
    contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
    org: null,
    deal: { orderNo: 27302, valueMinor: 300000, currency: 'ILS', participants: 20, product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'תל אביב', isHomeLocation: true } },
    links: { origin: 'https://x' },
  };
  // Manual WON with the FULL amount already collected → no deposit line.
  const paidFull = renderReport(26, {
    ...base,
    payment: { paidMinor: 300000, totalMinor: 300000 },
    wonReport: { cause: 'manual', closedBy: { displayName: 'יעל' }, paymentAmountMinor: null },
  });
  assert.match(paidFull, /פעילות: סיור גרפיטי\n/, 'home city is NOT appended');
  assert.ok(!paidFull.includes('מקדמה'), 'a full payment is not a deposit');
  // Manual WON with a genuine partial payment → the collected amount IS shown.
  const paidPart = renderReport(26, {
    ...base,
    payment: { paidMinor: 100000, totalMinor: 300000 },
    wonReport: { cause: 'manual', closedBy: { displayName: 'יעל' }, paymentAmountMinor: null },
  });
  assert.match(paidPart, /מקדמה ששולמה: ₪1,000/);
});

// ── schedules ────────────────────────────────────────────────────────────────

test('the scheduled reports run at exactly the owner-specified Israel slots', () => {
  const byNumber = Object.fromEntries(scheduledReports().map((r) => [r.number, r.schedule]));
  assert.deepEqual(Object.keys(byNumber).map(Number).sort((a, b) => a - b), [6, 7, 8, 11, 18]);
  assert.deepEqual(byNumber[6], { hour: 15, minute: 0 });
  assert.deepEqual(byNumber[7], { hour: 6, minute: 0 });
  assert.deepEqual(byNumber[8], { hour: 6, minute: 0 });
  assert.deepEqual(byNumber[11], { hour: 8, minute: 0 }, 'the guide digest goes out at 08:00');
  assert.deepEqual(byNumber[18], { hour: 7, minute: 0 }, 'the review digest lands before the workday');
  // Every scheduled report must say what it sends when there is nothing to say.
  for (const r of scheduledReports()) assert.ok(reportByNumber(r.number).emptyHe?.length > 3);
});

test('unknown report numbers render nothing (no accidental blank sends)', () => {
  assert.equal(reportByNumber(99), null);
  assert.equal(renderReport(99, {}), null);
});
