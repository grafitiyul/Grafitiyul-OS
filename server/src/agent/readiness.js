// Promotion readiness — "is this capability ready for more authority, and WHY".
//
// The rule itself already existed in metrics.js. What was missing is the half
// that matters to an operator: a SENTENCE. A capability that says "not ready"
// without saying what is missing is just a locked door.
//
// Two hard rules this module keeps:
//   • never a percentage without its denominator,
//   • never a recommendation the code then acts on. This produces advice for a
//     human; nothing anywhere reads `ready` and changes a mode.

import { MODE_RANK } from './capabilities/registry.js';

export const READINESS_RULE = Object.freeze({
  minSamples: 30,
  minUnchangedRate: 0.9,
  maxRejectRate: 0.05,
  textHe: 'לפחות 30 מקרים שהוכרעו, מעל 90% שנשלחו בלי עריכה, ופחות מ-5% שנדחו.',
});

/**
 * @param {object} def    capability definition (registry)
 * @param {object} counts { unchanged, edited, rejected, bypassed, shadow, open, observed }
 * @param {string} mode   the capability's current mode
 */
export function readinessFor(def, counts, mode) {
  const handled = (counts.unchanged || 0) + (counts.edited || 0)
    + (counts.rejected || 0) + (counts.bypassed || 0);
  const unchangedRate = handled ? counts.unchanged / handled : null;
  const rejectRate = handled ? (counts.rejected + counts.bypassed) / handled : null;

  const meetsBar = handled >= READINESS_RULE.minSamples
    && unchangedRate != null && unchangedRate >= READINESS_RULE.minUnchangedRate
    && rejectRate != null && rejectRate <= READINESS_RULE.maxRejectRate;

  // The next mode up, capped by the code ceiling. null = already at the top of
  // what this capability may ever be.
  const ladder = ['disabled', 'shadow', 'approval', 'auto'];
  const currentRank = MODE_RANK[mode] ?? 0;
  const nextMode = currentRank < MODE_RANK[def.maxMode] ? ladder[currentRank + 1] : null;

  let state;
  let reasonHe;

  if (!nextMode) {
    state = 'at_ceiling';
    reasonHe = mode === def.maxMode && def.maxMode !== 'auto'
      ? `הקטגוריה כבר בסמכות המרבית שמותרת לה. ${def.ceilingHe || ''}`.trim()
      : 'הקטגוריה כבר בסמכות המרבית.';
  } else if (mode === 'disabled') {
    state = 'not_observing';
    reasonHe = 'הקטגוריה כבויה, ולכן לא נצבר עליה שום מידע. כדי לשקול הרחבת סמכות בעתיד — העבירו אותה קודם למצב צל.';
  } else if (handled === 0) {
    state = 'no_evidence';
    reasonHe = counts.shadow > 0
      ? `נרשמו ${counts.shadow} ניתוחים במצב צל, אבל עדיין לא הכרעת באף הצעה. כדי למדוד איכות צריך שתאשר או תדחה הצעות בפועל.`
      : 'עדיין לא היו שיחות מהסוג הזה, ולכן אין על מה להתבסס.';
  } else if (handled < READINESS_RULE.minSamples) {
    state = 'gathering';
    reasonHe = `נצברו ${handled} מקרים שהוכרעו מתוך ${READINESS_RULE.minSamples} שנדרשים. `
      + `מתוכם ${counts.unchanged} נשלחו ללא שינוי ו-${counts.rejected + counts.bypassed} לא שימשו.`;
  } else if (!meetsBar) {
    const bits = [];
    if (unchangedRate < READINESS_RULE.minUnchangedRate) {
      bits.push(`רק ${counts.unchanged} מתוך ${handled} נשלחו בלי עריכה`);
    }
    if (rejectRate > READINESS_RULE.maxRejectRate) {
      bits.push(`${counts.rejected + counts.bypassed} מתוך ${handled} לא שימשו בכלל`);
    }
    state = 'not_good_enough';
    reasonHe = `יש מספיק מקרים (${handled}), אבל האיכות עדיין לא מספקת: ${bits.join(', ')}. `
      + 'כדאי לבדוק מה נערך בפועל ולהוסיף ידע או כלל עבודה שיסגור את הפער.';
  } else {
    state = 'ready';
    reasonHe = `${counts.unchanged} מתוך ${handled} מקרים נשלחו בדיוק כפי שהסוכן הציע. `
      + 'זה מספיק כדי לשקול הרחבת סמכות — ההחלטה שלך בלבד.';
  }

  return {
    state,
    reasonHe,
    ready: state === 'ready',
    nextMode,
    handled,
    unchanged: counts.unchanged || 0,
    edited: counts.edited || 0,
    rejected: counts.rejected || 0,
    bypassed: counts.bypassed || 0,
    shadowOnly: counts.shadow || 0,
    // Rates travel WITH their denominator so no consumer can render a bare %.
    unchangedRate,
    rejectRate,
    denominator: handled,
  };
}

export const READINESS_STATE_LABELS = Object.freeze({
  at_ceiling: 'בסמכות המרבית',
  not_observing: 'לא נאסף מידע',
  no_evidence: 'אין עדיין ראיות',
  gathering: 'אוסף ראיות',
  not_good_enough: 'האיכות עדיין לא מספקת',
  ready: 'מוכן לשיקולך',
});
