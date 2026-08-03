// Report #26 — a deal became WON ("עסקה חדשה").
//
// Fires once per GENUINE transition from non-WON to WON, regardless of who
// performed it (operator button, verified credit-card payment, any canonical
// workflow) and regardless of amount — a ₪0 deal notifies too. It never fires
// for re-saves of an already-WON deal, webhook retries, migration/backfill
// imports or reopens; the idempotency key is the immutable transition identity
// (won_transition:<dealId>:<wonAt>), so a reopened deal that is later won
// again legitimately notifies once more.
//
// ── The deposit line (business rule, decided 2026-08) ───────────────────────
// "מקדמה ששולמה" appears only when there is a real, trustworthy amount:
//   * payment-driven WON → the VERIFIED amount of the payment that caused the
//     win (frozen into the trigger payload, never re-derived later);
//   * operator-driven WON → the canonical net amount collected to date
//     (collection.js SSOT), and only when it is a true partial payment
//     (0 < paid < total) — an existing FULL payment is not called a deposit;
//   * no payment → the line is omitted entirely (no blank label).
//
// ── Attribution ─────────────────────────────────────────────────────────────
// "מי סגר" is the authenticated GOS user for operator-driven wins. An
// automatic payment-driven win is attributed to the system explicitly
// ("מערכת — תשלום אשראי") — never a fabricated human.

import { formatMoney } from '../communication/format.js';
import { contactFullName } from '../communication/context.js';
import { adminDisplayName } from '../admin/displayName.js';

const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

/** "שם - ארגון" suffix only when an organization actually exists. */
function customerWithOrg(ctx) {
  const name = contactFullName(ctx.contact) || null;
  const org = ctx.org?.name || null;
  if (name && org) return `${name} - ${org}`;
  return name || org || '—';
}

/** "מוצר - עיר", the city only when it is NOT the canonical home location
 *  (Location.isHomeLocation — the same rule guide reports and the tours
 *  calendar use). Business data stays Hebrew in both languages. */
function activityLabel(ctx) {
  const product = ctx.deal?.product?.nameHe || null;
  const loc = ctx.deal?.location || null;
  const city = loc && !loc.isHomeLocation ? loc.nameHe : null;
  if (product && city) return `${product} - ${city}`;
  return product || city || '—';
}

/** The deposit amount to show, or null → the line is omitted. */
function depositMinor(ctx) {
  const w = ctx.wonReport || {};
  if (w.paymentAmountMinor != null) return Number(w.paymentAmountMinor);
  const paid = ctx.payment?.paidMinor != null ? Number(ctx.payment.paidMinor) : 0;
  const total = ctx.payment?.totalMinor != null ? Number(ctx.payment.totalMinor) : 0;
  if (paid > 0 && total > 0 && paid < total) return paid;
  return null;
}

function closedByLabel(ctx, lang) {
  const w = ctx.wonReport || {};
  if (w.closedBy) return adminDisplayName(w.closedBy) || '—';
  if (w.cause === 'card_payment') {
    return lang === 'en' ? 'System — credit-card payment' : 'מערכת — תשלום אשראי';
  }
  return lang === 'en' ? 'System' : 'מערכת';
}

function body(ctx, lang) {
  const he = lang !== 'en';
  const dealUrl =
    ctx.deal?.orderNo != null && ctx.links?.origin
      ? `${ctx.links.origin}/admin/crm/deals/${ctx.deal.orderNo}`
      : '—';
  // The deal total ALWAYS shows — including a genuine ₪0 deal.
  const total = formatMoney(ctx.deal?.valueMinor ?? 0, ctx.deal?.currency) || '₪0';
  const deposit = depositMinor(ctx);
  const participants = ctx.deal?.participants ?? null;
  return lines([
    he ? '💰 עסקה חדשה 💰' : '💰 New deal won 💰',
    '',
    `${he ? 'שם המזמינה' : 'Customer'}: ${customerWithOrg(ctx)}`,
    `${he ? 'פעילות' : 'Activity'}: ${activityLabel(ctx)}`,
    `${he ? 'משתתפים' : 'Participants'}: ${participants ?? (he ? 'לא צוין' : 'not specified')}`,
    `${he ? 'סכום עסקה' : 'Deal amount'}: ${total}`,
    deposit != null
      ? `${he ? 'מקדמה ששולמה' : 'Deposit paid'}: ${formatMoney(deposit, ctx.deal?.currency) || '—'}`
      : null,
    `${he ? 'מי סגר' : 'Closed by'}? ${closedByLabel(ctx, lang)}`,
    `${he ? 'דיל' : 'Deal'}:`,
    dealUrl,
  ]);
}

export const DEAL_WON_REPORT = {
  number: 26,
  key: 'deal_won_manager_alert',
  nameHe: 'עסקה חדשה — דיל הפך ל-WON',
  nameEn: 'A deal was won',
  triggerHe:
    'נורה פעם אחת על כל מעבר אמיתי של דיל ממצב שאינו WON ל-WON — סגירה ידנית על ידי נציג, '
    + 'תשלום אשראי שהשלים את הסגירה אוטומטית, או כל תהליך קנוני אחר שסוגר דיל. נורה גם על '
    + 'דיל בסכום ₪0. לא נורה על שמירה חוזרת של דיל שכבר WON, על ניסיון חוזר של webhook, על '
    + 'ייבוא/מיגרציה או על פתיחה מחדש; דיל שנפתח מחדש ונסגר שוב באמת — ידווח שוב פעם אחת.',
  dataHe:
    'שם המזמינה והארגון מהדיל; הפעילות היא המוצר, והעיר מוצגת רק כשהיא אינה מיקום הבית. '
    + 'סכום העסקה תמיד מוצג (כולל ₪0). שורת המקדמה מופיעה רק כשיש תשלום אמיתי: בסגירה '
    + 'מתשלום אשראי — סכום התשלום המאומת שגרם לסגירה; בסגירה ידנית — הסכום שנגבה בפועל '
    + '(מקור האמת של הגבייה) ורק כשהוא תשלום חלקי. "מי סגר" הוא המשתמש שביצע בפועל, או '
    + 'ייחוס מערכת מפורש בתשלום אוטומטי. הקישור הוא לדיל ב-GOS.',
  render: (ctx) => body(ctx, 'he'),
  renderEn: (ctx) => body(ctx, 'en'),
  sample: () => ({
    links: { origin: 'https://app.grafitiyul.co.il' },
    deal: {
      orderNo: 27201,
      valueMinor: 1250000,
      currency: 'ILS',
      participants: 25,
      product: { nameHe: 'סיור גרפיטי' },
      location: { nameHe: 'ירושלים', isHomeLocation: false },
    },
    contact: { firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: '', lastNameEn: '' },
    org: { name: 'עיריית תל אביב' },
    payment: { paidMinor: 300000, totalMinor: 1250000 },
    wonReport: {
      cause: null,
      closedBy: { displayName: 'יעל שחר', username: 'yael' },
      paymentAmountMinor: 300000,
    },
  }),
};
