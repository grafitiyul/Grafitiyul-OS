// Coordination follow-ups: what a submitted coordination call sets in motion.
//
// Four code-defined reports, two audiences:
//
//   #21 participant count changed   → manager WhatsApp
//   #22 participant count changed   → manager email
//   #23 meeting point               → THE CUSTOMER of that booking
//   #24 restaurant recommendations  → THE CUSTOMER of that booking
//
// #23 and #24 are the first CUSTOMER-audience reports. They are here rather
// than in the Communication Center for the reason that governs this whole
// module: their content is operational and code-owned. What they DO reuse is
// every piece of shared infrastructure — the queue, customer sending windows,
// connection deferral, retries, delivery logging, the media path — via
// customerDelivery.js. Content is code; transport is shared.
//
// Cardinality: every one of these fires from ONE booking's submission, so an
// open tour with four unrelated customers produces four independent decisions
// and, at most, four independent customer messages. Nothing here ever sees a
// tour-wide recipient list.

import { formatDateHe } from '../communication/format.js';

const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

const dealLink = (ctx, orderNo) =>
  (orderNo != null && ctx.links?.origin ? `${ctx.links.origin}/admin/crm/deals/${orderNo}` : '—');
const taskLink = (ctx, itemId) =>
  (ctx.links?.origin ? `${ctx.links.origin}/admin/management-tasks${itemId ? `?item=${itemId}` : ''}` : '—');
// The submitted coordination form, read-only, on the admin surface. Never the
// staff form token: that is a capability, and a manager report is not the place
// to hand one out.
const formLink = (ctx, submissionId) =>
  (submissionId && ctx.links?.origin ? `${ctx.links.origin}/admin/questionnaires/submissions/${submissionId}` : null);

/** The signed difference, written the way a manager reads it. */
const deltaLabel = (d) => (d == null ? '—' : (d > 0 ? `+${d}` : String(d)));

const participantBody = (ctx, lang) => {
  const r = ctx.participantChange || {};
  const party = [r.customerName, r.orgName].filter(Boolean).join(' - ') || '—';
  const product = [r.productName, r.variantName].filter(Boolean).join(' · ') || '—';
  const he = lang !== 'en';
  const form = formLink(ctx, r.submissionId);
  return lines([
    he ? '👥 שינוי בכמות המשתתפים 👥' : '👥 Participant count changed 👥',
    '',
    `${he ? 'לקוח' : 'Customer'}: ${party}`,
    // Frozen from the canonical TourEvent staff assignments at fire time —
    // each language shows the canonical staff name for that language.
    `${he ? 'מדריך' : 'Guide'}: ${(he ? r.guideNameHe : r.guideNameEn) || '—'}`,
    `${he ? 'מוצר' : 'Product'}: ${product}`,
    `${he ? 'מועד הסיור' : 'Tour'}: ${formatDateHe(r.tourDate) || '—'} ${r.tourTime || ''}`.trim(),
    '',
    `${he ? 'כמות רשומה' : 'Registered'}: ${r.registered ?? '—'}`,
    `${he ? 'כמות מעודכנת' : 'Updated'}: ${r.corrected ?? '—'}`,
    `${he ? 'הפרש' : 'Difference'}: ${deltaLabel(r.delta)}`,
    r.note ? '' : null,
    r.note ? `${he ? 'הערת המדריך' : 'Guide note'}: ${r.note}` : null,
    '',
    `${he ? 'לינק לדיל' : 'Deal'}: ${dealLink(ctx, r.dealOrderNo)}`,
    `${he ? 'למשימת הבקרה' : 'Management task'}: ${taskLink(ctx, r.reviewItemId)}`,
    form ? `${he ? 'לשיחת התיאום' : 'Coordination form'}: ${form}` : null,
    '',
    he
      ? 'שום דבר לא עודכן אוטומטית — הכמות, המחיר והקיבולת ממתינים להחלטה.'
      : 'Nothing was updated automatically — the count, price and capacity await a decision.',
  ]);
};

const participantSample = () => ({
  links: { origin: 'https://app.grafitiyul.co.il' },
  participantChange: {
    customerName: 'דנה לוי',
    orgName: 'עיריית תל אביב',
    guideNameHe: 'יואב כהן',
    guideNameEn: 'Yoav Cohen',
    productName: 'סיור וסדנת גרפיטי',
    variantName: 'פלורנטין',
    tourDate: '2026-09-16',
    tourTime: '10:00',
    registered: 13,
    corrected: 18,
    delta: 5,
    note: 'הצטרפו שתי משפחות נוספות',
    dealOrderNo: 27184,
    reviewItemId: 'ri_sample',
    submissionId: 'sub_sample',
  },
});

export const COORDINATION_FOLLOWUP_REPORTS = [
  {
    number: 21,
    key: 'participant_count_changed',
    nameHe: 'שינוי בכמות משתתפים',
    nameEn: 'Participant count changed',
    triggerHe:
      'נורה כששיחת תיאום מוגשת והמדריך מדווח שכמות המשתתפים שונה מהרשום, עם מספר תקין '
      + 'ושונה בפועל. פעם אחת לכל הגשה. תשובה "כן", תשובה ריקה או מספר זהה אינם מפעילים דיווח.',
    dataHe:
      'הכמות הרשומה מגיעה מהרישומים הקנוניים של ההזמנה הזו (TicketRegistration) — לא מסך '
      + 'הסיור, שבסיור פתוח מאגד לקוחות שאינם קשורים. שם המדריך נקרא משיבוצי הצוות של '
      + 'האירוע (המקור הקנוני בכל המערכת). הדיווח אינו מעדכן דבר: לא הזמנה, '
      + 'לא מחיר, לא קיבולת ולא שיבוץ.',
    render: (ctx) => participantBody(ctx, 'he'),
    renderEn: (ctx) => participantBody(ctx, 'en'),
    sample: participantSample,
  },

  {
    number: 22,
    key: 'participant_count_changed_email',
    nameHe: 'שינוי בכמות משתתפים — מייל',
    nameEn: 'Participant count changed — email',
    channel: 'email',
    triggerHe:
      'אותו אירוע כמו דיווח #21, בערוץ המייל. שני הדיווחים נורים יחד ומוגדרים בנפרד, '
      + 'כך שאפשר לכבות אחד מהם בלי לאבד את השני.',
    dataHe: 'זהה לדיווח #21.',
    renderSubject: (ctx) => {
      const r = ctx.participantChange || {};
      const party = [r.customerName, r.orgName].filter(Boolean).join(' - ') || 'לקוח';
      return `שינוי בכמות משתתפים — ${party} · ${r.registered ?? '—'} → ${r.corrected ?? '—'}`;
    },
    renderSubjectEn: (ctx) => {
      const r = ctx.participantChange || {};
      const party = [r.customerName, r.orgName].filter(Boolean).join(' - ') || 'customer';
      return `Participant count changed — ${party} · ${r.registered ?? '—'} → ${r.corrected ?? '—'}`;
    },
    render: (ctx) => participantBody(ctx, 'he'),
    renderEn: (ctx) => participantBody(ctx, 'en'),
    sample: participantSample,
  },

  // ── customer-audience ──────────────────────────────────────────────────────

  {
    number: 23,
    key: 'customer_meeting_point',
    nameHe: 'נקודת מפגש ללקוח',
    nameEn: 'Meeting point to the customer',
    audience: 'customer',
    triggerHe:
      'נורה כשמדריך מסמן בשיחת התיאום שצריך לשלוח ללקוח את נקודת המפגש שוב. נשלח ללקוח '
      + 'של ההזמנה הזו בלבד — בסיור פתוח כל לקוח מקבל רק אם ביקשו זאת בטופס שלו.',
    dataHe:
      'הטקסט והתמונה מגיעים מתוכן נקודת המפגש הקנוני (תוכן משותף → וריאציה → מיקום), '
      + 'אותו מקור שממנו מופקת ההצעה — כך שהלקוח לא יכול לקבל נקודת מפגש הסותרת את זו '
      + 'שבהצעה שלו. אין תוכן — השאלה לא זמינה ולא נשלחת הודעה ריקה.',
    render: (ctx) => lines([
      'היי, הנה שוב נקודת המפגש:',
      '',
      ctx.meetingPoint?.text || '',
    ]),
    renderEn: (ctx) => lines([
      'Hi, here is the meeting point again:',
      '',
      ctx.meetingPoint?.text || '',
    ]),
    sample: () => ({
      meetingPoint: {
        text: 'נפגש בגן אליפלט, אליפלט 17, תל אביב\nממול בית הספר, בצד של הפארק עם המדשאה',
      },
    }),
  },

  {
    number: 24,
    key: 'customer_restaurant_recommendations',
    nameHe: 'המלצות מסעדות ללקוח',
    nameEn: 'Restaurant recommendations to the customer',
    audience: 'customer',
    triggerHe:
      'נורה כשמדריך מסמן בשיחת התיאום שצריך לשלוח ללקוח המלצות למסעדות. נשלח ללקוח של '
      + 'ההזמנה הזו בלבד, הודעה אחת, ללא כפילות בניסיון חוזר.',
    dataHe:
      'הקישור הוא קישור ציבורי קבוע של האתר, מוגדר במקום אחד (publicLinks.js) ולא מפוזר '
      + 'בין הדיווחים.',
    render: (ctx) => lines([
      'היי, הנה רשימת מסעדות מומלצות באיזור של הסיור:',
      ctx.publicLinks?.restaurantRecommendations || '',
    ]),
    renderEn: (ctx) => lines([
      'Hi, here is a list of recommended restaurants near the tour:',
      ctx.publicLinks?.restaurantRecommendations || '',
    ]),
    sample: () => ({
      publicLinks: { restaurantRecommendations: 'https://grafitiyul.co.il/restaurant-recommendations/' },
    }),
  },
];
