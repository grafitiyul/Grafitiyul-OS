// THE catalog of code-managed admin reports ("דיווחי מנהלים").
//
// Deliberate exception to the "no template-specific code" rule: these internal
// notifications are DEFINED IN CODE and are not editable Communication Center
// templates. What that buys: exact formatting control and conditional lines
// that a generic template language would need extra vocabulary for.
//
// Non-negotiable rules for every report here:
//   * `number` is STABLE and never reused — it is how the operator refers to a
//     report ("שנה את דיווח מנהלים #3"). Adding a report takes the next number.
//   * `render(ctx)` is the ONE renderer. Production dispatch, the UI preview
//     and the test send all call it — there is no second rendering path.
//   * Nothing is hardcoded except LAYOUT. Every value comes from the canonical
//     context (loadTriggerContext + the frozen trigger payload) and canonical
//     formatters. No literal customer names, dates, amounts, owners or links.
//   * `sample()` returns a REALISTIC synthetic context for the preview, shaped
//     exactly like a real one, so the preview exercises the real renderer.

import { formatDateHe, formatMoney, ACTIVITY_TYPE_LABELS } from '../communication/format.js';
import { contactFullName } from '../communication/context.js';
import { adminDisplayName } from '../admin/displayName.js';

// ── shared line helpers (layout only — never business logic) ─────────────────

/** "שם הלקוח - שם הארגון", or just the customer when no organization exists. */
export function customerLine(ctx) {
  const name = contactFullName(ctx.contact) || null;
  const org = ctx.org?.name || null;
  if (name && org) return `${name} - ${org}`;
  return name || org || '—';
}

const dealLink = (ctx) =>
  (ctx.deal?.orderNo != null && ctx.links?.origin
    ? `${ctx.links.origin}/admin/crm/deals/${ctx.deal.orderNo}`
    : '—');

const ownerName = (ctx) => (ctx.owner ? adminDisplayName(ctx.owner) || '—' : '—');

const tourDate = (ctx) => formatDateHe(ctx.tour?.date || ctx.deal?.tourDate) || '—';
const tourTime = (ctx) => ctx.tour?.startTime || ctx.deal?.tourTime || '';

/** Drop empty lines produced by absent optional values, then join. */
const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

// ── the catalog ──────────────────────────────────────────────────────────────

export const REPORTS = [
  {
    number: 1,
    key: 'customer_paid_link',
    nameHe: 'לקוח שילם דרך לינק תשלום',
    triggerHe:
      'תשלום מקוון שהושלם בהצלחה דרך לינק תשלום (iCount או Cardcom). לא נורה על תשלומים שנרשמו ידנית במשרד, מזומן, העברה בנקאית או צ׳קים.',
    dataHe: 'סכום התשלום מגיע מהתשלום שהושלם בפועל (המסמך/האימות מול הספק) — לא מסכום העסקה.',
    render: (ctx) => lines([
      '💰 לקוח שילם 💰',
      '',
      customerLine(ctx),
      '',
      `סכום ששילם: ${formatMoney(ctx.payment?.completedAmountMinor, ctx.payment?.currency) || '—'}`,
      `תאריך הפעילות: ${tourDate(ctx)} ${tourTime(ctx)}`.trim(),
      '',
      `בעלים: ${ownerName(ctx)}`,
      `לינק לדיל: ${dealLink(ctx)}`,
    ]),
    sample: () => ({
      contact: { firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: '', lastNameEn: '' },
      org: { name: 'עיריית תל אביב' },
      deal: { orderNo: 27184, tourDate: '2026-09-14', tourTime: '10:30' },
      tour: { date: '2026-09-14', startTime: '10:30' },
      payment: { completedAmountMinor: 285000, currency: 'ILS' },
      owner: { displayName: 'יעל שחר', username: 'yael' },
      links: { origin: 'https://app.grafitiyul.co.il' },
    }),
  },

  {
    number: 2,
    key: 'quote_generated',
    nameHe: 'הצעת מחיר הופקה',
    triggerHe:
      'כל הפקה של הצעת מחיר, בין אם נשלחה ללקוח ובין אם לא. כל גרסה מופקת עומדת בפני עצמה; הפקה חוזרת של אותה גרסה לא תשלח פעמיים.',
    dataHe:
      'הסכום וסוג ההצעה (ראשית/מקבילה) נלקחים מההצעה שהופקה עצמה — לא מסכום הדיל, כדי שהצעות מקבילות יוצגו נכון. הקישור מפנה למסמך הקבוע של אותה גרסה.',
    render: (ctx) => {
      const q = ctx.quoteReport || {};
      // Parallel offers carry their own gross; the primary offer's truth IS the
      // deal headline (documented invariant) — never the deal total for a
      // parallel offer.
      const totalMinor = q.totalMinor != null
        ? q.totalMinor
        : (q.isPrimary ? ctx.deal?.valueMinor ?? null : null);
      const currency = q.currency || ctx.deal?.currency || 'ILS';
      return lines([
        '🆕 הצעת מחיר חדשה 🆕',
        '',
        `שם הלקוח: ${customerLine(ctx)}`,
        `תאריך: ${tourDate(ctx)}`,
        `בשעה: ${tourTime(ctx) || '—'}`,
        `סוג פעילות: ${ctx.tour?.product?.nameHe || ctx.deal?.product?.nameHe || '—'}`,
        `מיקום: ${ctx.tour?.location?.nameHe || ctx.deal?.location?.nameHe || '—'}`,
        `כמות משתתפים: ${ctx.deal?.participants ?? '—'}`,
        `סכום: ${formatMoney(totalMinor, currency) || '—'}`,
        `סוג הצעה: ${q.isPrimary === true ? 'ראשית' : q.isPrimary === false ? 'מקבילה' : '—'}`,
        `בעלים: ${ownerName(ctx)}`,
        `לינק לדיל: ${dealLink(ctx)}`,
        `לינק להצעה: ${q.publicToken && ctx.links?.origin ? `${ctx.links.origin}/quote/${q.publicToken}` : '—'}`,
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'משפחת', lastNameHe: 'רוזנברג', firstNameEn: '', lastNameEn: '' },
      org: null,
      deal: { orderNo: 27186, participants: 24, tourDate: '2026-10-02', tourTime: '17:00' },
      tour: {
        date: '2026-10-02', startTime: '17:00',
        product: { nameHe: 'סיור וסדנת גרפיטי' },
        location: { nameHe: 'תל אביב' },
      },
      quoteReport: { totalMinor: 372000, currency: 'ILS', isPrimary: false, publicToken: 'SAMPLEtoken123', versionNo: 2, offerNo: 2 },
      owner: { displayName: 'דור קורן', username: 'dorko' },
      links: { origin: 'https://app.grafitiyul.co.il' },
    }),
  },

  {
    number: 3,
    key: 'tour_datetime_changed',
    nameHe: 'שינוי תאריך או שעת סיור',
    triggerHe:
      'שינוי בפועל של תאריך או שעת סיור חי — דרך "עדכון סיור" בדיל או דרך החלפת מועד לסיור עם רשומים (דיווח נפרד לכל דיל מושפע). עריכות שלא משנות את המועד בפועל לא מפעילות דיווח.',
    dataHe:
      'המועד הקודם והחדש מוקפאים ברגע השינוי, כך ששינויים מאוחרים לא משכתבים היסטוריה. "מי עדכן" הוא המשתמש המחובר שביצע את הפעולה בפועל — לא בעל הדיל.',
    render: (ctx) => {
      const c = ctx.changeReport || {};
      const stamp = (d, t) => [formatDateHe(d) || null, t || null].filter(Boolean).join(', ') || '—';
      return lines([
        '⌚שינוי תאריך או שעת סיור⌚',
        '',
        customerLine(ctx),
        `מועד מקורי: ${stamp(c.prevDate, c.prevTime)}`,
        `מועד חדש: ${stamp(c.newDate, c.newTime)}`,
        '',
        `מי עדכן: ${c.actor ? adminDisplayName(c.actor) || '—' : '—'}`,
        `לינק לדיל: ${dealLink(ctx)}`,
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'גיא', lastNameHe: 'קורן', firstNameEn: '', lastNameEn: '' },
      org: { name: 'בית ספר אלון' },
      deal: { orderNo: 27190 },
      changeReport: {
        prevDate: '2026-09-01', prevTime: '09:00',
        newDate: '2026-09-08', newTime: '11:30',
        actor: { displayName: 'נועה בר', username: 'noa' },
      },
      links: { origin: 'https://app.grafitiyul.co.il' },
    }),
  },
];

export function reportByNumber(number) {
  return REPORTS.find((r) => r.number === Number(number)) || null;
}

/** Render a report from a context — the ONE renderer, used everywhere. */
export function renderReport(number, ctx) {
  const report = reportByNumber(number);
  if (!report) return null;
  return report.render(ctx || {});
}

/** The preview text for a report, from its realistic synthetic sample. */
export function renderReportSample(number) {
  const report = reportByNumber(number);
  if (!report) return null;
  return report.render(report.sample());
}
