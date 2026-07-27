import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, reportByNumber, renderReport, renderReportSample, customerLine } from './registry.js';

// ── catalog integrity ────────────────────────────────────────────────────────

test('report numbers are stable, unique and documented', () => {
  const numbers = REPORTS.map((r) => r.number);
  assert.deepEqual(numbers, [1, 2, 3]);
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

test('unknown report numbers render nothing (no accidental blank sends)', () => {
  assert.equal(reportByNumber(99), null);
  assert.equal(renderReport(99, {}), null);
});
