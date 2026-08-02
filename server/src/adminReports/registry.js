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
import { COORDINATION_MONITOR_DAYS } from './coordination.js';
import { GUIDE_REPORTS } from './guideReports.js';
import { REVIEW_REPORTS } from './reviewReports.js';
import { COORDINATION_FOLLOWUP_REPORTS } from './coordinationFollowups.js';
import { OFFICE_REPORTS_EN, OFFICE_REPORT_NAMES_EN } from './officeReportsEn.js';
import { NEW_LEAD_REPORT } from './newLeadReport.js';

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
      '💳 לקוח הוסיף תשלום 💳',
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

// ── coordination + summary reports (#4–#8) ───────────────────────────────────
// Canonical units (proven by audit):
//   coordination — ONE QuestionnaireSubmission per BOOKING (purpose
//     'coordination'); any assigned guide may complete it. NOT per guide.
//   tour_summary — per GUIDE (actorScope = externalPersonId) for the canonical
//     REQUIRED_SUMMARY_ROLES (lead_guide, guide).
// Forms are opened from the tour page, so that is the canonical form link.

const tourPage = (ctx, tourEventId) =>
  (ctx.links?.origin && tourEventId ? `${ctx.links.origin}/admin/tours/${tourEventId}` : null);

/** "לקוח - ארגון" for a compact aggregate line (no empty dash). */
const partyLabel = (item) => [item.customerName, item.orgName].filter(Boolean).join(' - ') || '—';

REPORTS.push(
  {
    number: 4,
    key: 'coordination_on_time',
    nameHe: 'שיחת תיאום בוצעה בזמן',
    triggerHe:
      'הגשה ראשונה של טופס שיחת תיאום, כאשר ההגשה בוצעה עד המועד הנדרש — יומיים לפני מועד הסיור (כולל). נורה פעם אחת לכל שיחת תיאום (טופס אחד לכל הזמנה/לקוח).',
    dataHe:
      'המועד מחושב מהמועד האפקטיבי הנוכחי של הסיור; אם הסיור נדחה — המועד הנדרש זז איתו. "מדריך" הוא מי שהגיש את הטופס בפועל.',
    render: (ctx) => {
      const c = ctx.coordinationReport || {};
      return lines([
        '✅ שיחת תיאום בוצעה בזמן ✅',
        '',
        `מדריך: ${c.guideName || '—'}`,
        `לקוח: ${customerLine(ctx)}`,
        `סיור: ${[c.productName, c.cityName].filter(Boolean).join(' - ') || '—'}`,
        `מועד הסיור: ${formatDateHe(c.tourDate) || '—'} ${c.tourTime || ''}`.trim(),
        `כמות משתתפים: ${c.participants ?? '—'}`,
        '',
        `לינק לטופס: ${tourPage(ctx, c.tourEventId) || '—'}`,
        `לינק לדיל: ${dealLink(ctx)}`,
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'משפחת', lastNameHe: 'רוזנברג' },
      org: null,
      deal: { orderNo: 27210 },
      links: { origin: 'https://app.grafitiyul.co.il' },
      coordinationReport: {
        guideName: 'יואב כהן', productName: 'סיור וסדנת גרפיטי', cityName: 'תל אביב',
        tourDate: '2026-09-20', tourTime: '10:00', participants: 24, tourEventId: 'tour_sample',
      },
    }),
  },

  {
    number: 5,
    key: 'coordination_late',
    nameHe: 'איחור בשיחת תיאום',
    triggerHe:
      'הגשה ראשונה של טופס שיחת תיאום לאחר המועד הנדרש (יומיים לפני הסיור). נורה פעם אחת לכל שיחת תיאום.',
    dataHe:
      'משך האיחור מחושב מההפרש בין מועד ההגשה בפועל למועד הנדרש — לא מתווית סטטוס. שני המועדים מוקפאים ברשומת הדיווח.',
    render: (ctx) => {
      const c = ctx.coordinationReport || {};
      return lines([
        '⛔ שיחת תיאום בוצעה באיחור ⛔',
        '',
        `מדריך: ${c.guideName || '—'}`,
        `לקוח: ${customerLine(ctx)}`,
        `סיור: ${[c.productName, c.cityName].filter(Boolean).join(' - ') || '—'}`,
        `מועד הסיור: ${formatDateHe(c.tourDate) || '—'} ${c.tourTime || ''}`.trim(),
        `כמות משתתפים: ${c.participants ?? '—'}`,
        `בוצע באיחור של: ${c.latenessLabel || '—'}`,
        '',
        `לינק לטופס: ${tourPage(ctx, c.tourEventId) || '—'}`,
        `לינק לדיל: ${dealLink(ctx)}`,
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
      org: { name: 'עיריית תל אביב' },
      deal: { orderNo: 27211 },
      links: { origin: 'https://app.grafitiyul.co.il' },
      coordinationReport: {
        guideName: 'מיכל ברק', productName: 'סיור גרפיטי', cityName: 'חיפה',
        tourDate: '2026-09-18', tourTime: '16:30', participants: 30,
        latenessLabel: 'יום ו-5 שעות', tourEventId: 'tour_sample',
      },
    }),
  },

  {
    number: 6,
    key: 'coordination_daily',
    nameHe: `מעקב שיחות תיאום ל-${COORDINATION_MONITOR_DAYS} הימים הקרובים`,
    schedule: { hour: 15, minute: 0 },
    triggerHe:
      `דיווח יומי ב-15:00 (שעון ישראל): כל שיחות התיאום לסיורים ב-${COORDINATION_MONITOR_DAYS} ימי הלוח הקרובים `
      + `(היום ועוד ${COORDINATION_MONITOR_DAYS - 1} ימים קדימה), שורה אחת לכל שיחה. סיורים מבוטלים אינם נכללים.`,
    dataHe:
      '✅ בוצע · ⛔ עבר המועד ולא הוגש · ⌛ טרם הוגש והמועד לא עבר. מיון: קודם ⛔, אחר כך ⌛, ואז ✅ — ובכל קבוצה הסיור הקרוב ביותר ראשון.',
    aggregate: true,
    emptyHe: 'אין שיחות תיאום למעקב',
    render: (ctx) => {
      const items = ctx.aggregate?.items || [];
      const icon = { overdue: '⛔', open: '⌛', done: '✅' };
      return lines([
        `📞 שיחות תיאום ל-${COORDINATION_MONITOR_DAYS} הימים הקרובים 📞`,
        '',
        ...items.map((i) => {
          const late = i.status === 'done' && i.wasLate ? ' (באיחור)' : '';
          return `${icon[i.status] || '⌛'} ${i.guideName || '—'} - ${partyLabel(i)} - ${i.participants ?? '—'}${late}`;
        }),
      ]);
    },
    sample: () => ({
      aggregate: {
        items: [
          { status: 'overdue', guideName: 'מיכל ברק', customerName: 'עיריית תל אביב', orgName: null, participants: 30 },
          { status: 'open', guideName: 'יואב כהן', customerName: 'משפחת רוזנברג', orgName: null, participants: 24 },
          { status: 'done', guideName: 'נועה בר', customerName: 'דנה לוי', orgName: 'בית ספר אלון', participants: 18, wasLate: true },
        ],
      },
    }),
  },

  {
    number: 7,
    key: 'summaries_missing_7d',
    nameHe: 'סיכומי סיור שלא נשלחו ב-7 הימים האחרונים',
    schedule: { hour: 6, minute: 0 },
    triggerHe:
      'דיווח יומי ב-06:00 (שעון ישראל): כל מדריך שטרם הגיש סיכום סיור לסיור שהסתיים ב-7 הימים האחרונים. שורה נפרדת לכל מדריך חסר — שני מדריכים שלא הגישו באותו סיור = שתי שורות.',
    dataHe:
      'מקור: הגשות סיכום סיור לפי מדריך (actorScope). תפקידים נדרשים: מדריך ראשי ומדריך. סיורים מבוטלים לא נכללים.',
    aggregate: true,
    emptyHe: 'כל סיכומי הסיור מ-7 הימים האחרונים הוגשו',
    render: (ctx) => {
      const items = ctx.aggregate?.items || [];
      return lines([
        '📝 סיכומי סיור שטרם נשלחו 📝',
        '',
        ...items.map((i) =>
          `⛔ ${i.guideName || '—'} - ${i.productName || '—'} - ${partyLabel(i)} - ${formatDateHe(i.tourDate) || '—'} ${i.tourTime || ''}`.trim()),
      ]);
    },
    sample: () => ({
      aggregate: {
        items: [
          { guideName: 'יואב כהן', productName: 'סיור גרפיטי', customerName: 'משפחת רוזנברג', orgName: null, tourDate: '2026-09-10', tourTime: '10:00' },
          { guideName: 'מיכל ברק', productName: 'סיור וסדנת גרפיטי', customerName: 'דנה לוי', orgName: 'עיריית תל אביב', tourDate: '2026-09-12', tourTime: '17:00' },
        ],
      },
    }),
  },

  {
    number: 8,
    key: 'summary_missing_yesterday',
    nameHe: 'סיכומי הסיור של אתמול שלא נשלחו',
    schedule: { hour: 6, minute: 0 },
    triggerHe:
      'דיווח יומי ב-06:00 (שעון ישראל): לכל מדריך שהיה חייב סיכום סיור לסיור שהתקיים אתמול ולא הגיש — דיווח נפרד אחד. מדריך ששכח שני סיורים יקבל שני דיווחים נפרדים.',
    dataHe:
      '"אתמול" נקבע לפי מועד הסיור בשעון ישראל. תפקידים נדרשים: מדריך ראשי ומדריך. סיורים מבוטלים לא נכללים; מי שכבר הגיש לא מדווח.',
    emptyHe: 'כל סיכומי הסיור של אתמול הוגשו',
    render: (ctx) => {
      const s = ctx.summaryReport || {};
      return lines([
        '📝 לא נשלח סיכום סיור 📝',
        '',
        `שם המדריך: ${s.guideName || '—'}`,
        `שם הלקוח: ${customerLine(ctx)}`,
        `שם הסיור: ${[s.productName, s.cityName].filter(Boolean).join(' - ') || '—'}`,
        `מועד הסיור: ${formatDateHe(s.tourDate) || '—'} ${s.tourTime || ''}`.trim(),
        '',
        'תודה,',
        'גרפיבוט',
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'משפחת', lastNameHe: 'רוזנברג' },
      org: null,
      summaryReport: {
        guideName: 'יואב כהן', productName: 'סיור וסדנת גרפיטי', cityName: 'תל אביב',
        tourDate: '2026-09-16', tourTime: '10:00',
      },
    }),
  },

  {
    number: 9,
    key: 'quote_signed',
    nameHe: 'הצעת מחיר נחתמה',
    triggerHe:
      'הלקוח חתם על הצעת מחיר בעמוד ההצעה. נורה פעם אחת לכל הצעה חתומה — מסמך הצעה נחתם פעם אחת בלבד ולעולם לא נחתם שוב.',
    dataHe:
      'הנתונים מגיעים מההצעה שנחתמה: הצעה מקבילה נושאת הקשר וסכום משלה, והצעה ראשית לוקחת אותם מהעסקה (זו הגדרת המערכת). הערכים מוקפאים ברגע החתימה.',
    render: (ctx) => {
      const q = ctx.signedQuote || {};
      return lines([
        '✍️ הצעת מחיר נחתמה ✍️',
        '',
        `לקוח: ${contactFullName(ctx.contact) || '—'}`,
        `ארגון: ${ctx.org?.name || '—'}`,
        `תאריך הסיור: ${formatDateHe(q.tourDate) || '—'} ${q.tourTime || ''}`.trim(),
        `מוצר: ${q.productName || '—'}`,
        `סכום: ${formatMoney(q.totalMinor, 'ILS') || '—'}`,
        '',
        'לאישור:',
        dealLink(ctx),
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
      org: { name: 'עיריית תל אביב' },
      deal: { orderNo: 27242 },
      links: { origin: 'https://app.grafitiyul.co.il' },
      signedQuote: {
        tourDate: '2026-10-04', tourTime: '10:00',
        productName: 'סיור וסדנת גרפיטי', totalMinor: 372000,
      },
    }),
  },

  {
    number: 10,
    key: 'agent_order_received',
    nameHe: 'הזמנה חדשה מסוכן',
    triggerHe:
      'טופס הזמנת סוכן עובד בהצלחה והדילים נוצרו. נורה פעם אחת לכל הזמנה — עיבוד חוזר של אותה הזמנה לא מדווח שוב.',
    dataHe:
      'שורה אחת לכל קבוצה בהזמנה: הזמנה עם קבוצה אחת מוצגת בפריסה מלאה, הזמנה מרובת קבוצות מוצגת כרשימה עם סכום כולל. הנתונים מגיעים מהדילים שנוצרו בפועל.',
    render: (ctx) => {
      const a = ctx.agentOrder || {};
      const groups = a.groups || [];
      const head = [
        '📥 הזמנה חדשה מסוכן 📥',
        '',
        `סוכן: ${contactFullName(ctx.contact) || '—'}`,
        `ארגון: ${ctx.org?.name || '—'}`,
        `מספר הזמנה: ${a.orderNo ?? '—'}`,
      ];
      const link = (g) =>
        (ctx.links?.origin && g.dealOrderNo != null
          ? `${ctx.links.origin}/admin/crm/deals/${g.dealOrderNo}`
          : '—');

      // One group → the full house layout. Several → a line per group plus the
      // order total, so a multi-class booking stays readable.
      if (groups.length === 1) {
        const g = groups[0];
        return lines([
          ...head,
          `תאריך הפעילות: ${formatDateHe(g.tourDate) || '—'} ${g.tourTime || ''}`.trim(),
          `מוצר: ${g.productName || '—'}`,
          `כמות משתתפים: ${g.participants ?? '—'}`,
          `סכום ההזמנה: ${formatMoney(g.totalMinor, 'ILS') || '—'}`,
          '',
          'לאישור:',
          link(g),
        ]);
      }
      return lines([
        ...head,
        '',
        ...groups.map((g) => `• ${[
          g.groupName || '—',
          `${formatDateHe(g.tourDate) || '—'} ${g.tourTime || ''}`.trim(),
          g.productName || '—',
          `${g.participants ?? '—'} משתתפים`,
          formatMoney(g.totalMinor, 'ILS') || '—',
        ].join(' - ')}`),
        '',
        `סה"כ: ${formatMoney(a.totalMinor, 'ILS') || '—'}`,
        '',
        'לאישור:',
        ...groups.map((g) => link(g)),
      ]);
    },
    sample: () => ({
      contact: { firstNameHe: 'דנה', lastNameHe: 'לוי' },
      org: { name: 'סוכנות הנסיעות' },
      links: { origin: 'https://app.grafitiyul.co.il' },
      agentOrder: {
        orderNo: 1042,
        totalMinor: 372000,
        groups: [{
          groupName: 'כיתה ז1', tourDate: '2026-10-04', tourTime: '10:00',
          productName: 'סיור וסדנת גרפיטי - תל אביב', participants: 24,
          totalMinor: 372000, dealOrderNo: 27242,
        }],
      },
    }),
  },
);

// Guide-facing notifications share this catalog (one engine, one renderer
// contract) but are surfaced in Tour Settings rather than on the Manager
// Reports screen. `group` is what routes them; 'office' is the default.
REPORTS.push(...GUIDE_REPORTS);

// Review-inbox reports (#17 per summary, #18 the daily digest email). Same
// catalog, same renderer contract — the email one simply also renders a subject.
REPORTS.push(...REVIEW_REPORTS);

// Coordination follow-ups (#21-#24). #23 and #24 are CUSTOMER-audience: same
// catalog and same renderer contract, transported by the shared WhatsApp queue
// rather than sent directly, because a customer message needs customer sending
// windows, connection deferral and attachments.
REPORTS.push(...COORDINATION_FOLLOWUP_REPORTS);

// #25 — the new-lead manager alert, migrated out of AUT-004 + Communication
// Center message #12 so one business event has one implementation.
REPORTS.push(NEW_LEAD_REPORT);

// ── Bilingual integrity, enforced at load ────────────────────────────────────
// A report that CLAIMS to be bilingual (it carries an English name) must
// actually be able to render in English — including the subject line, for email
// reports. Half a translation is worse than none: it sends an English subject
// over a Hebrew body, or silently falls back with no one noticing.
//
// This throws at import time, so a half-translated report cannot reach
// production — the server refuses to boot rather than sending something wrong.
// It is deliberately a claim-based rule: a report with no `nameEn` is honestly
// Hebrew-only and keeps working untouched.
// The office reports (#1-#10) get their English renderers attached here rather
// than inline: registry.js is already the longest file in the module, and a
// second renderer per definition would have doubled it. One object, two
// renderers — exactly the same contract as #11-#24, and bilingual.test.js
// proves the two languages report the same facts.
for (const r of REPORTS) {
  const en = OFFICE_REPORTS_EN[r.number];
  if (!en) continue;
  r.renderEn = en;
  r.nameEn = OFFICE_REPORT_NAMES_EN[r.number];
}

export function assertBilingualIntegrity(reports) {
  for (const r of reports) {
    if (!r.nameEn) continue;
    if (typeof r.renderEn !== 'function') {
      throw new Error(`report #${r.number} declares nameEn but has no renderEn — a bilingual report must render in both languages`);
    }
    if (typeof r.renderSubject === 'function' && typeof r.renderSubjectEn !== 'function') {
      throw new Error(`report #${r.number} has an English body but no English subject — an English mail would carry a Hebrew subject`);
    }
  }
}

assertBilingualIntegrity(REPORTS);

export function reportByNumber(number) {
  return REPORTS.find((r) => r.number === Number(number)) || null;
}

/**
 * The UI group a report belongs to — which settings screen surfaces it:
 * 'office' (Manager Reports) | 'coordination' | 'tour_summary'.
 */
export function reportGroup(report) {
  return report?.group || 'office';
}

/** Reports in one UI group, in catalog order. */
export function reportsInGroup(group) {
  return REPORTS.filter((r) => reportGroup(r) === group);
}

/** Reports that run on a daily schedule (hour/minute, Israel time). */
export function scheduledReports() {
  return REPORTS.filter((r) => r.schedule);
}

/** The channel a report goes out on. WhatsApp unless the report says otherwise. */
export function reportChannel(report) {
  return report?.channel === 'email' ? 'email' : 'whatsapp';
}

/** Rendered subject for email reports (null for WhatsApp ones). */
export function renderReportSubject(number, ctx, lang = 'he') {
  const report = reportByNumber(number);
  if (lang === 'en' && typeof report?.renderSubjectEn === 'function') return report.renderSubjectEn(ctx || {});
  if (!report?.renderSubject) return null;
  return report.renderSubject(ctx || {});
}

/** Render a report from a context — the ONE renderer, used everywhere. */
export function renderReport(number, ctx, lang = 'he') {
  const report = reportByNumber(number);
  if (!report) return null;
  // BILINGUAL: a report may declare renderEn beside render. Reports stay
  // CODE-DEFINED (the deliberate exception documented at the top of this file);
  // English is a second render function, not a second definition and not
  // editable database content. A report with no English falls back to Hebrew
  // rather than sending a blank — an untranslated report must still arrive.
  if (lang === 'en' && typeof report.renderEn === 'function') return report.renderEn(ctx || {});
  return report.render(ctx || {});
}

/** The preview text for a report, from its realistic synthetic sample. */
export function renderReportSample(number) {
  const report = reportByNumber(number);
  if (!report) return null;
  return report.render(report.sample());
}

/** Does this report have an English version? (drives the settings screen.) */
export function hasEnglish(report) {
  return typeof report?.renderEn === 'function';
}

/**
 * Both languages of a report's preview, for the side-by-side settings view.
 * Rendered through the SAME functions production uses, from the report's own
 * realistic sample — so what an author reviews is what will actually go out.
 */
export function renderReportBoth(number) {
  const report = reportByNumber(number);
  if (!report) return null;
  const ctx = report.sample();
  return {
    he: report.render(ctx),
    en: hasEnglish(report) ? report.renderEn(ctx) : null,
    subjectHe: report.renderSubject ? report.renderSubject(ctx) : null,
    subjectEn: report.renderSubjectEn ? report.renderSubjectEn(ctx) : null,
  };
}
