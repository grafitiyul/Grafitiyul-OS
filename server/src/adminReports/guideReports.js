// Guide-facing code-managed notifications (catalog #11–#16).
//
// Same contract as every other report: ONE render(ctx) used by production
// dispatch, the settings preview and the test send. What is different is the
// AUDIENCE — `audience: 'guides'` means the dispatcher addresses one person by
// phone instead of the configured group, and ctx.recipient carries who.
//
// Grouping: `group` decides WHICH settings screen surfaces a report, and each
// workflow owns only its own notifications:
//   'coordination'  → Tour Settings → שיחת תיאום → התראות אוטומטיות (#11–#13)
//   'tour_summary'  → Tour Settings → סיכום סיור → התראות אוטומטיות (#14–#16)
// The Manager Reports screen keeps showing the office reports. One catalog,
// several windows onto it.

import { formatDateHe } from '../communication/format.js';
import { COORDINATION_MONITOR_DAYS } from './coordination.js';

const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

// ── shared display rules ─────────────────────────────────────────────────────

const HEB_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Hebrew weekday name for a "YYYY-MM-DD" date. */
export function hebrewWeekday(dateStr) {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d) ? null : HEB_WEEKDAYS[new Date(d).getUTCDay()];
}

/**
 * The date label in the daily digest (owner rule): today → היום,
 * tomorrow → מחר, anything further out → the Hebrew weekday name.
 */
export function dayLabel(daysAway, dateStr) {
  if (daysAway === 0) return 'היום';
  if (daysAway === 1) return 'מחר';
  return hebrewWeekday(dateStr) || formatDateHe(dateStr) || '—';
}

/**
 * The coordination status icon (owner rule, 2026-07-28):
 *   ✅ done, whatever the distance
 *   🔴 not done, tour today or tomorrow
 *   🔵 not done, tour in 2–3 days
 *   🟡 not done, tour in 4 days
 * There is deliberately no green bucket.
 */
export function statusIcon(done, daysAway) {
  if (done) return '✅';
  if (daysAway <= 1) return '🔴';
  if (daysAway <= 3) return '🔵';
  return '🟡';
}

/**
 * A city is shown ONLY when it is not the home location, and then in WhatsApp
 * bold. Comparison is by stable location id (never by city string) — the same
 * rule the tours calendar uses.
 */
export function cityChip(item) {
  if (!item.cityName) return null;
  if (item.homeLocationId && item.locationId && item.locationId === item.homeLocationId) return null;
  return `*${item.cityName}*`;
}

const guideFirst = (ctx) => ctx.recipient?.firstName || ctx.recipient?.name || 'מדריך';
const guideFirstEn = (ctx) => ctx.recipient?.firstName || ctx.recipient?.name || 'guide';

/** Chronological instant of a digest item — canonical start ms, else the date. */
const itemInstant = (i) => {
  if (i.tourStartMs != null) return i.tourStartMs;
  const t = Date.parse(`${i.tourDate}T00:00:00Z`);
  return Number.isFinite(t) ? t : 0;
};
/**
 * TRUE chronological order (owner rule, 2026-08-03): the nearest activity
 * first, and a completed call (✅) keeps its chronological place — done-ness
 * never pushes a line to the bottom.
 */
const chronological = (items) => [...items].sort((a, b) => itemInstant(a) - itemInstant(b));
// The DIRECT link to this one form. Never a portal link — see staffLinks.js.
const formLink = (ctx) => ctx.guideNotice?.formUrl || '—';
// The two labeled link sections of the summary ladder (#14-#16) — the same
// structure in every message and both languages. The photo link is the
// guide's gallery-scoped upload capability (tours/gallery/links.js); when it
// could not be built (gallery off for guides, no PersonRef) the whole photo
// section is omitted rather than sending a dead link.
const summaryLinkSections = (ctx, lang = 'he') => {
  const photo = ctx.guideNotice?.photoUploadUrl || null;
  return [
    ...(photo
      ? ['', lang === 'en' ? '📸 Photo upload link:' : '📸 לינק להעלאת תמונות:', photo]
      : []),
    '',
    lang === 'en' ? '📝 Tour summary link:' : '📝 לינק לסיכום סיור:',
    formLink(ctx),
  ];
};
// Day/month/year is read the same way in both languages, so the date itself
// needs no translation — only the words around it do.
const dateTimeLine = (f) => `${formatDateHe(f.tourDate) || '—'} | ${f.tourTime || '—'}`;

// ── English display rules ────────────────────────────────────────────────────
// A guide whose preferred language is English gets the SAME facts in the same
// order — the icons, the structure and the link are identical, so a manager
// comparing the two messages sees one report, not two.

const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function englishWeekday(dateStr) {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d) ? null : EN_WEEKDAYS[new Date(d).getUTCDay()];
}

/** The English twin of dayLabel — same buckets, same order. */
export function dayLabelEn(daysAway, dateStr) {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return englishWeekday(dateStr) || formatDateHe(dateStr) || '—';
}

// ── #11 body (both languages) ────────────────────────────────────────────────
// The digest is one body with a language switch: identical structure, En data
// (product/city/day names/labels) where it exists, stored customer names as-is.

function digestBody(ctx, lang) {
  const en = lang === 'en';
  const g = ctx.guideDigest || {};
  const items = chronological(g.coordination || []);
  const missing = chronological(g.missingSummaries || []);
  const out = [en ? '☎️ Coordination-call status for the days ahead' : '☎️ סטטוס שיחות התיאום לימים הקרובים', ''];
  // An empty list must SAY it is empty — otherwise the message opens with
  // a blank gap and reads like a broken send.
  if (!items.length) out.push(en ? 'No coordination calls in the days ahead.' : 'אין שיחות תיאום לימים הקרובים.');
  out.push(...items.map((i) => [
    `${statusIcon(i.done, i.daysAway)} ${en ? dayLabelEn(i.daysAway, i.tourDate) : dayLabel(i.daysAway, i.tourDate)}`,
    `${i.customerName || '—'} (${i.participants ?? '—'})`,
    cityChip({ ...i, cityName: (en ? i.cityNameEn : null) || i.cityNameHe }),
    (en ? i.productNameEn : null) || i.productNameHe || '—',
  ].filter(Boolean).join(' | ')));
  if (missing.length) {
    out.push('', '────────────────', '', en ? '📝 Tour summaries still missing' : '📝 סיכומי סיור שטרם הושלמו', '');
    missing.forEach((m, idx) => {
      if (idx) out.push(''); // one blank line between entries, each with its link
      out.push([
        formatDateHe(m.tourDate) || '—',
        m.customerName || '—',
        (en ? m.productNameEn : null) || m.productNameHe || '—',
      ].join(' | '));
      // EVERY pending summary carries ITS OWN direct form link (perActor).
      if (m.formUrl) out.push(m.formUrl);
    });
  }
  return lines(out);
}

// ── #12/#13 body (both languages) ────────────────────────────────────────────
// The two messages are ONE family: same spacing, same icon order, same
// hierarchy — only the title differs. Per BOOKING always: the 👤 line and the
// participant count describe this one customer, and the link opens this one
// booking's coordination form (scoped — never a portal or tour-page link).

function coordinationBody(ctx, lang, title) {
  const en = lang === 'en';
  const f = ctx.guideNotice || {};
  const contact = f.contactName || f.customerName || null;
  const org = f.orgName && f.orgName !== contact ? f.orgName : null;
  const product = (en ? f.productNameEn : null) || f.productNameHe || '—';
  // The city rides the product line ONLY away from home (canonical
  // Location.isHomeLocation flag; unknown reads as "show it").
  const city = f.cityNameHe && f.cityIsHome !== true
    ? ((en ? f.cityNameEn : null) || f.cityNameHe)
    : null;
  const count = f.participants == null
    ? null
    : (en ? `${f.participants} participants` : `${f.participants} משתתפים`);
  return lines([
    title,
    '',
    `👤 ${[contact || '—', org].filter(Boolean).join(' | ')}`,
    `📅 ${dateTimeLine(f)}`,
    `🎨 ${[product, city, count].filter(Boolean).join(' | ')}`,
    '',
    en ? 'Coordination Call Form:' : 'טופס שיחת תיאום:',
    formLink(ctx),
  ]);
}

// ── the catalog entries ──────────────────────────────────────────────────────

export const GUIDE_REPORTS = [
  {
    number: 11,
    key: 'guide_daily_coordination',
    nameHe: 'סטטוס שיחות תיאום יומי (למדריך)',
    nameEn: 'Daily coordination-call status (to the guide)',
    group: 'coordination',
    audience: 'guides',
    schedule: { hour: 8, minute: 0 },
    triggerHe:
      `כל יום ב-08:00 (שעון ישראל), לכל מדריך בנפרד: שיחות התיאום של הסיורים שלו ב-${COORDINATION_MONITOR_DAYS} הימים הקרובים, `
      + 'ואחריהן סיכומי סיור שלו שכבר עברו את המועד.',
    dataHe:
      '✅ בוצעה שיחת תיאום · 🔴 טרם בוצעה והסיור היום או מחר · 🔵 טרם בוצעה והסיור בעוד 2–3 ימים · 🟡 טרם בוצעה והסיור בעוד 4 ימים. '
      + 'עיר מוצגת רק כשהיא אינה מיקום הבית. הסיכומים החסרים כוללים רק סיורים מאתמול ואחורה.',
    emptyHe: 'אין למדריך שיחות תיאום או סיכומים פתוחים',
    // ONE body for both languages — the digest lists the same facts in the
    // same order; `en` only swaps day names, labels and the English data
    // (product/city) where it exists. Customer/organization names stay as
    // stored in both languages.
    render: (ctx) => digestBody(ctx, 'he'),
    renderEn: (ctx) => digestBody(ctx, 'en'),
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideDigest: {
        coordination: [
          // Deliberately out of order — the renderer's chronological sort is
          // part of the layout contract (✅ today stays FIRST).
          { done: false, daysAway: 1, tourDate: '2026-08-03', tourStartMs: 2, customerName: 'חברת ABC', participants: 18, productNameHe: 'סיור קולינרי', productNameEn: 'Culinary Tour', cityNameHe: 'ירושלים', cityNameEn: 'Jerusalem', locationId: 'loc_jlm', homeLocationId: 'loc_tlv' },
          { done: true, daysAway: 0, tourDate: '2026-08-02', tourStartMs: 1, customerName: 'משפחת כהן', participants: 4, productNameHe: 'סיור גרפיטי', productNameEn: 'Graffiti Tour' },
          { done: false, daysAway: 4, tourDate: '2026-08-06', tourStartMs: 4, customerName: 'משפחת ישראלי', participants: 6, productNameHe: 'סיור גרפיטי', productNameEn: 'Graffiti Tour' },
          { done: false, daysAway: 3, tourDate: '2026-08-05', tourStartMs: 3, customerName: 'רות לוי', participants: 2, productNameHe: 'סדנת גרפיטי', productNameEn: 'Graffiti Workshop' },
        ],
        missingSummaries: [
          { tourDate: '2026-07-30', tourStartMs: 0, customerName: 'עיריית תל אביב', productNameHe: 'סיור וסדנת גרפיטי', productNameEn: 'Graffiti Tour & Workshop', formUrl: 'https://app.grafitiyul.co.il/f/SUMMARYTOKEN' },
        ],
      },
    }),
  },

  {
    number: 12,
    key: 'guide_coordination_call_due',
    nameHe: 'זמן לשיחת תיאום (למדריך)',
    nameEn: 'Time for the coordination call (to the guide)',
    group: 'coordination',
    audience: 'guides',
    triggerHe:
      'יומיים לפני הסיור, ב-08:00 (שעון ישראל). אם התאריך נופל בשבת, בחג או בערב חג — ההודעה מוקדמת יום אחורה בכל פעם עד ליום פנוי. '
      + 'יום שישי נחשב יום שליחה תקין, אלא אם הוא עצמו ערב חג.',
    dataHe:
      'נשלח למדריך הראשי; אם אין מדריך ראשי — לכל המדריכים המשובצים. הודעה נפרדת לכל לקוח (הזמנה), עם טופס התיאום שלו — '
      + 'גם בסיור פתוח, כך שכמות המשתתפים היא של אותו לקוח בלבד. עיר מוצגת רק כשהיא אינה מיקום הבית.',
    render: (ctx) => coordinationBody(ctx, 'he', '📟 זמן לשיחת תיאום!'),
    renderEn: (ctx) => coordinationBody(ctx, 'en', '📟 Time for a Coordination Call!'),
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideNotice: {
        contactName: 'דנה לוי', orgName: 'עיריית תל אביב',
        productNameHe: 'סיור וסדנת גרפיטי', productNameEn: 'Graffiti Tour & Workshop',
        cityNameHe: 'ירושלים', cityNameEn: 'Jerusalem', cityIsHome: false,
        participants: 24, tourDate: '2026-08-04', tourTime: '10:00',
        formUrl: 'https://app.grafitiyul.co.il/f/SCOPEDTOKEN',
      },
    }),
  },

  {
    number: 13,
    key: 'guide_open_tour_new_participant',
    nameHe: 'הצטרף משתתף חדש לסיור פתוח (למדריך)',
    nameEn: 'A new participant joined an open tour (to the guide)',
    group: 'coordination',
    audience: 'guides',
    triggerHe:
      'משתתף חדש נרשם לסיור פתוח — ורק אם הודעת שיחת התיאום לאותו סיור כבר נשלחה למדריך. לפני כן אין מה לעדכן: הרשימה המלאה תגיע בהודעה הרשמית.',
    dataHe:
      'נשלח למדריך הראשי (או לכל המדריכים המשובצים), פעם אחת לכל הרשמה. הכמות והטופס הם של ההזמנה החדשה בלבד — '
      + 'אותו מבנה בדיוק כמו הודעת שיחת התיאום.',
    render: (ctx) => coordinationBody(ctx, 'he', '➕ הצטרף משתתף חדש לסיור פתוח'),
    renderEn: (ctx) => coordinationBody(ctx, 'en', '➕ New Participant Joined an Open Tour'),
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideNotice: {
        newCustomerName: 'משפחת כהן', newCustomerCount: 2,
        contactName: 'משפחת כהן', orgName: null, participants: 2,
        productNameHe: 'סיור גרפיטי', productNameEn: 'Graffiti Tour',
        cityNameHe: 'תל אביב', cityNameEn: 'Tel Aviv', cityIsHome: true,
        tourDate: '2026-08-04', tourTime: '10:00',
        formUrl: 'https://app.grafitiyul.co.il/f/SCOPEDTOKEN',
      },
    }),
  },

  {
    number: 14,
    key: 'guide_summary_due',
    nameHe: 'הגיע הזמן למלא סיכום סיור (למדריך)',
    nameEn: 'Time to fill in the tour summary (to the guide)',
    group: 'tour_summary',
    audience: 'guides',
    triggerHe:
      'מיד עם סיום הסיור — לפי שעת הסיום המחושבת (שעת התחלה + משך הפעילות, כולל משך מיוחד לסיור פתוח).',
    dataHe: 'נשלח לכל מדריך שחייב סיכום ועדיין לא הגיש. מדריך שהגיש כבר לא מקבל את התזכורות הבאות.',
    // Layout (owner spec 2026-08-03): greeting + reminder + customer + when as
    // one tight block, then the photo section, then the summary-form section —
    // one blank line between blocks, none inside them.
    render: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        `היי ${guideFirst(ctx)}`,
        '👋 הגיע הזמן למלא סיכום סיור',
        `מקווים שהיה סיור מוצלח עם ${f.customerName || '—'}.`,
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'he'),
      ]);
    },
    renderEn: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        `Hi ${guideFirstEn(ctx)}`,
        '👋 Time to fill in the tour summary',
        `We hope the tour with ${f.customerName || '—'} went well.`,
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'en'),
      ]);
    },
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideNotice: {
        customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00',
        formUrl: 'https://app.grafitiyul.co.il/f/SCOPEDTOKEN',
        photoUploadUrl: 'https://app.grafitiyul.co.il/g/GALLERYTOKEN',
      },
    }),
  },

  {
    number: 15,
    key: 'guide_summary_reminder_1',
    nameHe: 'תזכורת ראשונה לסיכום סיור (למדריך)',
    nameEn: 'First tour-summary reminder (to the guide)',
    group: 'tour_summary',
    audience: 'guides',
    triggerHe: '3 שעות אחרי סיום הסיור, ורק אם עדיין לא הוגש סיכום.',
    dataHe: 'נשלח למדריך שחייב סיכום ולא הגיש. מי שהגיש בינתיים לא מקבל.',
    // Layout (owner spec 2026-08-03): no greeting; title, then the reminder
    // lines + when as one tight block, then the two link sections. Wording of
    // the existing lines is unchanged on purpose.
    render: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        '⏰ תזכורת למילוי סיכום סיור',
        '',
        `עדיין לא קיבלנו את סיכום הסיור של ${f.customerName || '—'}.`,
        'יאללה, עכשיו כשזה עדיין חם 😊',
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'he'),
      ]);
    },
    renderEn: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        '⏰ Reminder: the tour summary',
        '',
        `We have not received your summary for ${f.customerName || '—'} yet.`,
        'Best to do it now, while it is still fresh 😊',
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'en'),
      ]);
    },
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideNotice: {
        customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00',
        formUrl: 'https://app.grafitiyul.co.il/f/SCOPEDTOKEN',
        photoUploadUrl: 'https://app.grafitiyul.co.il/g/GALLERYTOKEN',
      },
    }),
  },

  {
    number: 16,
    key: 'guide_summary_reminder_2',
    nameHe: 'תזכורת שנייה לסיכום סיור (למדריך)',
    nameEn: 'Second tour-summary reminder (to the guide)',
    group: 'tour_summary',
    audience: 'guides',
    triggerHe: '6 שעות אחרי סיום הסיור, ורק אם הסיכום עדיין חסר.',
    dataHe: 'נשלח למדריך שחייב סיכום ולא הגיש. מי שהגיש בינתיים לא מקבל.',
    // Same layout contract as #15; the warning line rides in the tight block.
    render: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        '⚠️ סיכום הסיור עדיין ממתין',
        '',
        `עדיין לא קיבלנו את סיכום הסיור של ${f.customerName || '—'}.`,
        'בלי הסיכום - הסיור עוד לא באמת הסתיים 🙏',
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'he'),
      ]);
    },
    renderEn: (ctx) => {
      const f = ctx.guideNotice || {};
      return lines([
        '⚠️ The tour summary is still waiting',
        '',
        `We have not received your summary for ${f.customerName || '—'} yet.`,
        'Without the summary, the tour is not really finished 🙏',
        `📅 ${dateTimeLine(f)}`,
        ...summaryLinkSections(ctx, 'en'),
      ]);
    },
    sample: () => ({
      recipient: { name: 'יואב כהן', firstName: 'יואב' },
      guideNotice: {
        customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00',
        formUrl: 'https://app.grafitiyul.co.il/f/SCOPEDTOKEN',
        photoUploadUrl: 'https://app.grafitiyul.co.il/g/GALLERYTOKEN',
      },
    }),
  },
];
