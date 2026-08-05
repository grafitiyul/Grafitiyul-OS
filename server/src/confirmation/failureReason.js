// Confirmation Email — truthful operator-facing failure wording.
//
// THE one formatter behind every server-side report of a blocked/failed
// automatic confirmation send (review card summary, deal-timeline errorHe,
// recovery retries). Production #27074: `send_blocked` used to collapse every
// blocking warning into one generic label ("חסר תוכן או משתנה בשפת השליחה"),
// so a missing booked tour read as a translation problem and the office
// hunted the wrong cause. The rule now: when the composer said WHY (warnings),
// the operator reads that exact why; the generic label survives only as the
// last-resort fallback when no warnings accompanied the block.
//
// Wording is kept aligned with the client's preview labels
// (ConfirmationEmailModal WARNING_TEXT / DealDetail) so the card, the feed and
// the preview all name the same problem the same way.

// Terminal error codes (sendService/composer business outcomes) → Hebrew.
export const AUTO_FAIL_LABELS = {
  send_blocked: 'חסר תוכן או משתנה בשפת השליחה',
  no_recipient_email: 'לאיש הקשר אין כתובת מייל',
  missing_subject: 'חסר נושא לשפת השליחה בתבנית',
  no_confirmation_template: 'לא הוגדרה תבנית מייל אישור',
  ambiguous_confirmation_template: 'תבניות חופפות בהגדרות מייל אישור',
  no_connected_account: 'אין חשבון Gmail מחובר',
  duplicate_send: 'מייל אישור נשלח ממש עכשיו',
  empty_body: 'גוף המייל ריק',
};

// Blocking-warning codes → sentence builder. `labels` is the deduped list the
// composer attached (section names, variable labels) — already operator Hebrew.
// Order = display order: the operational blocker first, content gaps after.
const WARNING_SENTENCES = [
  ['no_tour', () => 'אין סיור משובץ — נקודת המפגש חסרה'],
  ['missing_content', (labels) => labels.length
    ? `חסר תוכן בשפת השליחה: ${labels.join(', ')}`
    : 'חסר תוכן בשפת השליחה'],
  ['missing_policy', (labels) => labels.length
    ? `הנוסח שנבחר אינו זמין עוד: ${labels.join(', ')}`
    : 'הנוסח שנבחר אינו זמין עוד'],
  ['missing_variable', (labels) => labels.length
    ? `משתנים ללא ערך בעסקה זו: ${labels.join(', ')}`
    : 'משתנה ללא ערך בעסקה זו'],
  ['unknown_variable', (labels) => labels.length
    ? `משתנה לא מוכר: ${labels.join(', ')}`
    : 'משתנה לא מוכר'],
];

/**
 * The Hebrew reason an operator reads for a failed automatic send.
 * `warnings` is `composed.warnings` as returned by sendService on
 * `send_blocked` ([{ code, label, ... }]); ignored for every other error.
 */
export function autoSendFailureReasonHe(error, warnings = null) {
  if (error === 'send_blocked' && Array.isArray(warnings) && warnings.length) {
    const parts = [];
    for (const [code, sentence] of WARNING_SENTENCES) {
      const matching = warnings.filter((w) => w?.code === code);
      if (!matching.length) continue;
      const labels = [...new Set(matching.map((w) => w.label).filter(Boolean))];
      parts.push(sentence(labels));
    }
    if (parts.length) return parts.join(' · ');
  }
  return AUTO_FAIL_LABELS[error] || String(error);
}
