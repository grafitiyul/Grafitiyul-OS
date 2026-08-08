// The safety summary — what the agent CAN and CANNOT do right now.
//
// Every line is DERIVED from real configuration: the settings row, the resolved
// capability modes, the code ceilings, the tool registry and the V1 send switch.
// Nothing here is a reassuring constant. If automatic sending is ever granted,
// this panel starts saying so on the very next read, with no code change.
//
// That property is the whole point: a safety panel that can lie once is worse
// than no safety panel at all.

import { autoSendPermitted } from './authority.js';
import { listTools } from './tools/registry.js';
import { MODE_RANK } from './capabilities/registry.js';

/**
 * @param {object} settings AgentSettings row (or defaults)
 * @param {Array}  matrix   loadCapabilityMatrix() output — modes already clamped
 * @returns {{ facts: Array, canAutoSend: boolean, canExecuteWithoutApproval: boolean, headline: object }}
 */
export function safetySummary(settings, matrix) {
  const enabled = !!settings?.enabled;
  const caps = matrix || [];

  const observing = caps.filter((c) => MODE_RANK[c.mode] >= MODE_RANK.shadow);
  const proposing = caps.filter((c) => MODE_RANK[c.mode] >= MODE_RANK.approval);
  const autoCaps = caps.filter((c) => c.mode === 'auto');

  // The two questions that decide whether anything can happen without a human.
  const canAutoSend = enabled && autoCaps.length > 0 && autoSendPermitted();
  const executableAutoTools = listTools().filter(
    (t) => t.implemented && t.readWrite === 'write' && t.maxMode === 'auto',
  );
  const canExecuteWithoutApproval = enabled && executableAutoTools.length > 0 && autoSendPermitted();

  const facts = [
    {
      key: 'analyses',
      yes: enabled && observing.length > 0,
      textHe: 'קורא שיחות ומנתח אותן',
      detailHe: enabled
        ? `${observing.length} מתוך ${caps.length} סוגי מצבים פעילים לניתוח`
        : 'הסוכן כבוי — הוא לא קורא כלום',
    },
    {
      key: 'drafts',
      yes: enabled && observing.length > 0,
      textHe: 'מכין טיוטות תשובה',
      detailHe: proposing.length
        ? `${proposing.length} סוגי מצבים יציגו לך הצעה בתוך השיחה`
        : 'הטיוטות נרשמות בלבד — אף אחת לא מוצעת לך לשליחה (מצב צל)',
    },
    {
      key: 'shows_for_approval',
      yes: enabled && proposing.length > 0,
      // Neither good nor bad: having no capability at approval is the CORRECT
      // shadow state, not a fault. Rendering it as an alarm would train the
      // operator to ignore the red marks that do matter.
      neutral: true,
      textHe: 'מציג לך הצעות לאישור בתוך השיחה',
      detailHe: proposing.length
        ? proposing.map((c) => c.labelHe).join(', ')
        : 'אין כרגע אף קטגוריה במצב "דורש אישור"',
    },
    {
      key: 'auto_send',
      yes: canAutoSend,
      negative: true,
      textHe: 'שולח הודעות ללקוחות בעצמו',
      detailHe: canAutoSend
        ? `${autoCaps.length} קטגוריות מוגדרות כאוטומטיות`
        : 'שליחה אוטומטית חסומה בקוד — כל הודעה יוצאת רק אחרי לחיצה שלך',
    },
    {
      key: 'auto_action',
      yes: canExecuteWithoutApproval,
      negative: true,
      textHe: 'מבצע פעולות במערכת בלי אישור',
      detailHe: canExecuteWithoutApproval
        ? `כלים שיכולים לרוץ לבד: ${executableAutoTools.map((t) => t.labelHe).join(', ')}`
        : 'כל פעולה שמשנה נתונים דורשת אישור נפרד, עם תצוגה מקדימה של מה ישתנה',
    },
    {
      key: 'refunds',
      yes: false,
      negative: true,
      textHe: 'מטפל בהחזרים כספיים',
      detailHe: refundCeilingText(caps),
    },
    {
      key: 'prices',
      yes: canChangePrices(caps),
      negative: true,
      textHe: 'משנה מחירים',
      detailHe: canChangePrices(caps)
        ? 'קיימת קטגוריה מסחרית בסמכות אוטומטית'
        : 'הסוכן לא מוסמך לקבוע או לשנות מחיר, וגם לא לומר מחיר שלא מאושר במערכת',
    },
  ];

  // The one-line headline the home screen leads with.
  const headline = !enabled
    ? { tone: 'off', titleHe: 'הסוכן כבוי', bodyHe: 'הוא לא קורא שיחות ולא מכין שום דבר.' }
    : canAutoSend
      ? { tone: 'live', titleHe: 'הסוכן פעיל ורשאי לשלוח', bodyHe: 'חלק מהתשובות נשלחות ללקוחות בלי שתראה אותן מראש.' }
      : proposing.length
        ? { tone: 'approval', titleHe: 'הסוכן פעיל — מצב אישור', bodyHe: 'הוא מכין תשובות ומציג לך אותן לאישור. שום הודעה לא נשלחת בלי לחיצה שלך.' }
        : { tone: 'shadow', titleHe: 'הסוכן פעיל — מצב למידה', bodyHe: 'הוא קורא שיחות ורושם מה היה עונה, אבל לא מציע ולא שולח כלום.' };

  return {
    facts,
    canAutoSend,
    canExecuteWithoutApproval,
    headline,
    counts: {
      total: caps.length,
      disabled: caps.filter((c) => c.mode === 'disabled').length,
      shadow: caps.filter((c) => c.mode === 'shadow').length,
      approval: caps.filter((c) => c.mode === 'approval').length,
      auto: autoCaps.length,
    },
  };
}

function refundCeilingText(caps) {
  const refund = caps.find((c) => c.key === 'refund_request');
  if (!refund) return 'אין קטגוריית החזרים.';
  if (refund.mode === 'disabled') return 'הקטגוריה כבויה, והתקרה בקוד לא מאפשרת לה בכלל להציע תשובה לשליחה.';
  return 'גם כשהקטגוריה פעילה, התקרה בקוד מגבילה אותה לרישום בלבד — היא לעולם לא תציע תשובה לשליחה.';
}

function canChangePrices(caps) {
  return caps.some((c) => ['pricing_discussion', 'discount_request'].includes(c.key) && c.mode === 'auto');
}
