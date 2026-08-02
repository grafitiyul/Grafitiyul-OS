// Manager reports about the review inbox (משימות הנהלה).
//
// Both are CODE-DEFINED, like every other admin report — that is the deliberate
// exception documented in registry.js, bought for exact formatting control.
// Nothing here is hardcoded except LAYOUT: every value comes from the canonical
// context or the frozen trigger payload.
//
// #17 fires once per submitted tour summary (WhatsApp, to the office).
// #18 is the daily digest (email) — "you have X summaries and Y logistics
//     reports waiting", with a link straight into Management Tasks.

import { formatDateHe } from '../communication/format.js';

const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

/** Deep link to the REVIEW ITEM, not to the tour — the card is what to act on. */
const reviewLink = (ctx, itemId) =>
  (ctx.links?.origin ? `${ctx.links.origin}/admin/management-tasks${itemId ? `?item=${itemId}` : ''}` : '—');

export const REVIEW_REPORTS = [
  {
    number: 17,
    key: 'tour_summary_submitted',
    nameHe: 'סיכום סיור הוגש',
    triggerHe:
      'נורה פעם אחת לכל סיכום סיור שמוגש. עריכה מאוחרת של הסיכום אינה מפעילה דיווח נוסף.',
    dataHe:
      'הנתונים מוקפאים ברגע ההגשה מהסיכום עצמו ומהסיור: מדריך, לקוח וארגון, מוצר '
      + '(ווריאציה רק כשהיא רלוונטית ואינה מיקום הבית), ותשובת "איך היה הסיור בכללי?". '
      + 'הקישור מפנה לכרטיס הבקרה במשימות הנהלה — לא לסיור.',
    render: (ctx) => {
      const r = ctx.summaryReview || {};
      const party = [r.customerName, r.orgName].filter(Boolean).join(' - ') || '—';
      const product = [r.productName, r.variantName].filter(Boolean).join(' · ') || '—';
      return lines([
        '📝 סיכום סיור חדש 📝',
        '',
        `מדריך: ${r.guideName || '—'}`,
        `לקוח: ${party}`,
        `מוצר: ${product}`,
        `מועד הסיור: ${formatDateHe(r.tourDate) || '—'} ${r.tourTime || ''}`.trim(),
        '',
        `איך היה הסיור בכללי: ${r.overall || '—'}`,
        r.hasLogistics ? '' : null,
        r.hasLogistics ? '⚠ נוצר גם דו״ח לוגיסטי' : null,
        '',
        'לקריאה ואישור:',
        reviewLink(ctx, r.reviewItemId),
      ]);
    },
    sample: () => ({
      links: { origin: 'https://app.grafitiyul.co.il' },
      summaryReview: {
        guideName: 'יואב כהן',
        customerName: 'דנה לוי',
        orgName: 'עיריית תל אביב',
        productName: 'סיור וסדנת גרפיטי',
        variantName: 'פלורנטין',
        tourDate: '2026-09-16',
        tourTime: '10:00',
        overall: 'קבוצה מעולה, כולם השתתפו וסיימנו בזמן.',
        hasLogistics: true,
        reviewItemId: 'ri_sample',
      },
    }),
  },

  {
    number: 18,
    key: 'review_inbox_digest',
    nameHe: 'סיכום יומי — משימות הנהלה',
    channel: 'email',
    schedule: { hour: 7, minute: 0 },
    aggregate: true,
    emptyHe: 'אין משימות הנהלה שממתינות לטיפול',
    triggerHe:
      'דיווח יומי ב-07:00 (שעון ישראל) במייל: כל סיכומי הסיור והדוחות הלוגיסטיים '
      + 'שממתינים לטיפול. נשלח רק כשיש מה לדווח.',
    dataHe:
      'הרשימה נגזרת מהכרטיסים הפתוחים במשימות הנהלה. כרטיס שטופל אינו מופיע. '
      + 'שורה אחת לכל סיור, עם סימון כשקיים גם דו״ח לוגיסטי.',
    // Email reports render a subject as well as a body.
    renderSubject: (ctx) => {
      const a = ctx.aggregate || {};
      return `יש ${a.summaryCount ?? 0} סיכומי סיור ו-${a.logisticsCount ?? 0} דוחות לוגיסטיים שממתינים לך לטיפול`;
    },
    // English lives BESIDE the Hebrew renderer — a second function, never a
    // second definition and never editable database content.
    renderSubjectEn: (ctx) => {
      const a = ctx.aggregate || {};
      return `You have ${a.summaryCount ?? 0} tour summaries and ${a.logisticsCount ?? 0} logistics reports waiting for review`;
    },
    renderEn: (ctx) => {
      const a = ctx.aggregate || {};
      const items = a.items || [];
      return lines([
        `You have ${a.summaryCount ?? 0} tour summaries and ${a.logisticsCount ?? 0} logistics reports waiting for review.`,
        '',
        ...items.map((i) => {
          const party = [i.customerName, i.orgName].filter(Boolean).join(' - ') || '—';
          const when = `${i.tourDate || '—'} ${i.tourTime || ''}`.trim();
          const logistics = i.hasLogistics ? ' · includes a logistics report' : '';
          return `• ${party} · ${i.guideName || '—'} · ${when}${logistics}`;
        }),
        '',
        'Open Management Tasks:',
        reviewLink(ctx),
      ]);
    },
    render: (ctx) => {
      const a = ctx.aggregate || {};
      const items = a.items || [];
      return lines([
        `יש ${a.summaryCount ?? 0} סיכומי סיור ו-${a.logisticsCount ?? 0} דוחות לוגיסטיים שממתינים לטיפול.`,
        '',
        ...items.map((i) => {
          const party = [i.customerName, i.orgName].filter(Boolean).join(' - ') || '—';
          const when = `${formatDateHe(i.tourDate) || '—'} ${i.tourTime || ''}`.trim();
          const logistics = i.hasLogistics ? ' · כולל דו״ח לוגיסטי' : '';
          return `• ${party} · ${i.guideName || '—'} · ${when}${logistics}`;
        }),
        '',
        'למעבר למשימות הנהלה:',
        reviewLink(ctx),
      ]);
    },
    sample: () => ({
      links: { origin: 'https://app.grafitiyul.co.il' },
      aggregate: {
        summaryCount: 3,
        logisticsCount: 1,
        items: [
          { customerName: 'דנה לוי', orgName: 'עיריית תל אביב', guideName: 'יואב כהן', tourDate: '2026-09-15', tourTime: '10:00', hasLogistics: true },
          { customerName: 'משפחת רוזנברג', orgName: null, guideName: 'מיכל ברק', tourDate: '2026-09-15', tourTime: '17:00', hasLogistics: false },
          { customerName: 'בית ספר אלון', orgName: null, guideName: 'נועה בר', tourDate: '2026-09-14', tourTime: '09:30', hasLogistics: false },
        ],
      },
    }),
  },
];
