// Onboarding progress — DERIVED, never stored.
//
// There is deliberately no `onboardingCompleted` column anywhere. Every step is
// computed from the state that actually matters, so the checklist can never
// disagree with reality: an operator who deletes their last knowledge item sees
// that step reopen, and an operator who configured everything through the
// normal screens never sees a wizard demanding they redo it.
//
// It is also not a gate. Nothing in the API or the UI blocks on these steps —
// they describe where you are, not what you are permitted to reach.

import { isEmptyStyle } from './style.js';
import { MODE_RANK } from './capabilities/registry.js';

// "Enough to be useful", not "enough to run". The agent runs with zero
// configuration — it simply escalates everything, which is exactly what the
// first production run did.
const KNOWLEDGE_TARGET = 3;

/**
 * @param {object} p
 *   settings   AgentSettings
 *   matrix     loadCapabilityMatrix()
 *   knowledge  approved knowledge items
 *   playbook   approved playbook rules
 *   styles     all non-archived style profiles
 *   runCount / proposalCount / handledCount / insightCount
 */
export function onboardingState({
  settings, matrix, knowledge, playbook, styles,
  runCount = 0, proposalCount = 0, handledCount = 0, insightCount = 0,
}) {
  const approvedStyles = (styles || []).filter((s) => s.status === 'approved' && !isEmptyStyle(s));
  const approvedKnowledge = (knowledge || []).filter((k) => k.status === 'approved');
  const approvedPlaybook = (playbook || []).filter((r) => r.status === 'approved');
  const anyApproval = (matrix || []).some((c) => MODE_RANK[c.mode] >= MODE_RANK.approval);

  const steps = [
    {
      key: 'enable',
      titleHe: 'הדלקת הסוכן',
      whyHe: 'בלי זה הוא לא קורא שום שיחה.',
      done: !!settings?.enabled,
      statusHe: settings?.enabled ? 'הסוכן דלוק' : 'הסוכן כבוי',
      to: '/admin/ai-agent/authority',
      ctaHe: 'הדלק',
    },
    {
      key: 'style',
      titleHe: 'ללמד אותו איך אנחנו כותבים',
      whyHe: 'בלי סגנון מאושר הוא כותב ניטרלי ומנומס — לא כמוכם.',
      done: approvedStyles.length > 0,
      statusHe: approvedStyles.length
        ? `${approvedStyles.length} פרופילי סגנון מאושרים`
        : 'עדיין לא מולא אף פרופיל סגנון',
      to: '/admin/ai-agent/setup?step=style',
      ctaHe: 'מלא סגנון',
    },
    {
      key: 'knowledge',
      titleHe: 'להזין ידע בסיסי',
      whyHe: 'בלי עובדות מאושרות הוא מעביר כל שאלה עובדתית לאדם — במקום להמציא תשובה.',
      done: approvedKnowledge.length >= KNOWLEDGE_TARGET,
      statusHe: approvedKnowledge.length
        ? `${approvedKnowledge.length} עובדות מאושרות${approvedKnowledge.length < KNOWLEDGE_TARGET ? ` (מומלץ לפחות ${KNOWLEDGE_TARGET})` : ''}`
        : 'עדיין לא הוזנה אף עובדה',
      to: '/admin/ai-agent/setup?step=knowledge',
      ctaHe: 'הוסף ידע',
    },
    {
      key: 'observe',
      titleHe: 'לתת לו לצפות בשיחות אמיתיות',
      whyHe: 'הוא לומד מהשיחות שלכם, לא מדוגמאות.',
      done: runCount > 0,
      statusHe: runCount ? `${runCount} שיחות נותחו` : 'עדיין לא נותחה אף שיחה',
      to: '/admin/ai-agent/history',
      ctaHe: 'ראה מה קרה',
    },
    {
      key: 'review',
      titleHe: 'לעבור על ההצעות שלו',
      whyHe: 'ההכרעות שלכם הן החומר שממנו הוא משתפר.',
      done: handledCount > 0,
      statusHe: handledCount
        ? `${handledCount} הצעות הוכרעו`
        : proposalCount
          ? `${proposalCount} הצעות נרשמו, אף אחת לא הוכרעה`
          : 'עדיין אין הצעות',
      to: '/admin/ai-agent/review',
      ctaHe: 'עבור על הצעות',
    },
    {
      key: 'improve',
      titleHe: 'לשפר את הכללים',
      whyHe: 'מדפוס חוזר בעריכות שלכם נולדת תובנה שאתם מאשרים.',
      done: insightCount > 0 || approvedPlaybook.length > 0,
      statusHe: insightCount
        ? `${insightCount} תובנות נוצרו`
        : approvedPlaybook.length
          ? `${approvedPlaybook.length} כללי עבודה מאושרים`
          : 'עדיין אין תובנות או כללי עבודה',
      to: '/admin/ai-agent/learning',
      ctaHe: 'פתח למידה',
    },
    {
      key: 'authority',
      titleHe: 'להרחיב סמכות בהדרגה',
      whyHe: 'רק אחרי שראיתם שהוא צודק שוב ושוב בקטגוריה מסוימת.',
      done: anyApproval,
      statusHe: anyApproval
        ? 'יש קטגוריות במצב "דורש אישור"'
        : 'כל הקטגוריות עדיין בצפייה בלבד',
      to: '/admin/ai-agent/authority',
      ctaHe: 'פתח הרשאות',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  // The first not-done step is what the operator should do next.
  const next = steps.find((s) => !s.done) || null;

  return {
    steps,
    doneCount,
    total: steps.length,
    next,
    // "Meaningfully configured" = the agent can do more than escalate. This is
    // what decides whether the prominent onboarding card is shown at all.
    configured: !!settings?.enabled && approvedStyles.length > 0 && approvedKnowledge.length > 0,
  };
}
