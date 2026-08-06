// Communication trigger registry — the ONE list of business triggers the
// Communication Center reacts to. Adding a trigger is: (1) an entry here,
// (2) one `fireCommunicationTrigger(...)` call at the business site, AFTER the
// owning transaction commits. Never a new worker, never a bespoke engine.
//
// Structure:
//   `category` — business grouping for the picker (CATEGORY_LABELS below).
//   `kind`     — what activates it, surfaced explicitly in the UI:
//       'event'  — something happened in the system (fires automatically),
//       'anchor' — a scheduling anchor: communication timed relative to the
//                  canonical tour datetime (לפני / במועד / אחרי),
//       'action' — an explicit staff action that INVOKES the Communication
//                  Center as the sending authority (nothing fires by itself).
//   `hintHe`   — one short Hebrew sentence: exactly what activates it.
//   `contexts` — which business branches the trigger provides; drives which
//                variables/documents are valid for its messages.
//   `anchors`  — allowed anchorType values for events on this trigger.

export const CATEGORY_LABELS = {
  crm: 'CRM',
  quotes: 'הצעות מחיר ותשלומים',
  tours: 'סיורים',
};

export const KIND_LABELS = {
  event: 'אירוע שמתרחש',
  anchor: 'עוגן תזמון',
  action: 'פעולה יזומה',
};

export const TRIGGERS = [
  // ── CRM ──
  {
    type: 'deal_created',
    labelHe: 'ליד חדש נוצר',
    category: 'crm',
    kind: 'event',
    hintHe: 'נורה פעם אחת כשליד/דיל חדש נוצר — יצירה ידנית או פתיחת דיל משיחת מייל/WhatsApp. עריכות מאוחרות לא מפעילות שוב.',
    contexts: ['deal', 'contact', 'org'],
    anchors: ['trigger_time'],
  },
  {
    type: 'deal_won',
    labelHe: 'דיל נסגר (WON)',
    category: 'crm',
    kind: 'event',
    hintHe: 'נורה כשדיל עובר ל-WON — ידנית או דרך תשלום מאומת.',
    // 'reservation' included: a WON deal born from an agent reservation carries
    // its session (context.js derives it via reservationGroup), so the
    // canonical reservation PDF is attachable; deals without one resolve the
    // document as missing and the delivery policy handles it.
    contexts: ['deal', 'contact', 'org', 'tour', 'payment', 'quote', 'reservation'],
    anchors: ['trigger_time', 'tour_datetime'],
  },
  {
    type: 'deal_lost',
    labelHe: 'דיל LOST',
    category: 'crm',
    kind: 'event',
    hintHe: 'נורה כשדיל מסומן LOST עם סיבת אובדן.',
    contexts: ['deal', 'contact', 'org'],
    anchors: ['trigger_time'],
  },

  // ── הצעות מחיר ותשלומים ──
  {
    type: 'quote_send',
    labelHe: 'שליחת הצעת מחיר',
    category: 'quotes',
    kind: 'action',
    hintHe: 'פעולה יזומה: לחיצה על "שלח הצעת מחיר" בדיל מפעילה את המסרים המוגדרים כאן — מרכז התקשורת הוא ששולח בפועל (מייל / WhatsApp / עדכון פנימי). שמירת טיוטה או הפקה לבדן לא שולחות דבר.',
    contexts: ['deal', 'contact', 'org', 'quote', 'payment'],
    anchors: ['trigger_time'],
  },
  {
    type: 'reservation_submitted',
    labelHe: 'הזמנת סוכן נקלטה',
    category: 'quotes',
    kind: 'event',
    hintHe: 'נורה כשטופס הזמנת סוכן עובד בהצלחה והדילים נוצרו (כולל ה-PDF הקנוני).',
    contexts: ['deal', 'contact', 'org', 'reservation', 'payment'],
    anchors: ['trigger_time'],
  },
  {
    type: 'payment_received',
    labelHe: 'התקבל תשלום',
    category: 'quotes',
    kind: 'event',
    hintHe: 'נורה כשמתקבל מסמך תשלום מאומת (קבלה / חשבונית מס קבלה) מ-iCount.',
    contexts: ['deal', 'contact', 'org', 'tour', 'payment'],
    anchors: ['trigger_time'],
  },

  // ── סיורים ──
  {
    type: 'tour_datetime',
    labelHe: 'מועד הסיור',
    category: 'tours',
    kind: 'anchor',
    hintHe: 'תזמון יחסית למועד הסיור: לפני / במועד / אחרי (דקות עד חודשים). נקבע כשדיל משויך לסיור עם מועד; אם המועד זז — התזמון מתעדכן, ואם הסיור בוטל — ההודעה מבוטלת.',
    contexts: ['deal', 'contact', 'org', 'tour', 'payment'],
    anchors: ['tour_datetime'],
  },
  {
    type: 'tour_datetime_changed',
    labelHe: 'מועד הסיור השתנה',
    category: 'tours',
    kind: 'event',
    hintHe: 'נורה כשתאריך או שעת סיור חי משתנים בפועל (כולל החלפת מועד לסיור עם רשומים). חושף מועד קודם, מועד חדש ותיאור השינוי. עריכות שאינן משנות את המועד לא מפעילות.',
    contexts: ['deal', 'contact', 'org', 'tour', 'change'],
    anchors: ['trigger_time'],
  },
  {
    type: 'tour_cancelled',
    labelHe: 'סיור בוטל',
    category: 'tours',
    kind: 'event',
    hintHe: 'נורה כשסיור מבוטל ידנית ממסך הסיורים.',
    contexts: ['deal', 'contact', 'org', 'tour'],
    anchors: ['trigger_time'],
  },
];

export const TRIGGER_TYPES = TRIGGERS.map((t) => t.type);

export function triggerByType(type) {
  return TRIGGERS.find((t) => t.type === type) || null;
}

export const TIMING_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];
export const TIMING_MODES = ['immediate', 'before', 'after'];
export const ANCHOR_TYPES = ['trigger_time', 'tour_datetime'];
export const EVENT_STATUSES = ['draft', 'active', 'disabled', 'archived'];
export const MESSAGE_STATUSES = ['draft', 'active', 'disabled'];
export const CHANNELS = ['whatsapp', 'email'];
export const AUDIENCE_TYPES = [
  'primary_contact',
  'field_contact',
  'assigned_guides',
  'explicit_contact',
  'explicit_staff',
  'wa_group',
];
