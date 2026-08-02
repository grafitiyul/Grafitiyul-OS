// Review card: Logistics Report (דו״ח לוגיסטי).
//
// DERIVED from the tour summary, not a copy of it. A logistics card exists ONLY
// when at least one logistics answer needs attention, and it is an INDEPENDENT
// row: handling the summary card does not handle this one, and vice versa.
//
// ── Attention rules ──────────────────────────────────────────────────────────
// Each logistics slot declares HOW an answer becomes "needs attention", because
// the rule genuinely differs per slot:
//
//   'affirmative'  a yes/true answer is the problem (studio dirty, stencil
//                  thrown away, vinyl low, new spray can opened)
//   'nonEmpty'     any substantive answer is the problem (equipment shortage,
//                  technical issue) — these are free text, so "there is text"
//                  IS the signal
//
// Roles again, never hardcoded keys: the form author maps a question to a role
// in the builder (`config.logisticsRole`), so rewording or reordering questions
// cannot break this.

import { registerReviewKind } from '../registry.js';

export const LOGISTICS_KIND = 'logistics_report';

export const LOGISTICS_ROLES = [
  { role: 'studio_dirty', labelHe: 'הסטודיו הושאר מלוכלך', rule: 'affirmative' },
  { role: 'stencil_discarded', labelHe: 'נזרק סטנסיל', rule: 'affirmative' },
  { role: 'vinyl_low', labelHe: 'מלאי ויניל נמוך', rule: 'affirmative' },
  // Free TEXT in the live form ('איזה ספריי הוצאת') — 'there is an answer' is
  // the signal, exactly like the equipment slot.
  { role: 'new_spray_can', labelHe: 'נפתחה פחית ספריי חדשה', rule: 'nonEmpty' },
  // The live form asks about equipment shortages and technical problems in ONE
  // question, so technical_issue stays registered but unmapped — a future form
  // may split them, and an unmapped role is simply absent from the card.
  { role: 'equipment_shortage', labelHe: 'חוסרים בציוד או תקלה טכנית', rule: 'nonEmpty' },
  { role: 'technical_issue', labelHe: 'תקלה טכנית', rule: 'nonEmpty' },
];

registerReviewKind(LOGISTICS_KIND, {
  labelHe: 'דו״ח לוגיסטי',
  // Rendered red: this is the card that means someone has to go do something.
  tone: 'alert',
  descriptionHe: 'נוצר רק כשסיכום סיור מדווח על בעיה לוגיסטית — ניקיון, מלאי, ציוד או תקלה טכנית.',
  buildLink: (item) => (item.tourEventId ? `/admin/tours/${item.tourEventId}` : null),
});

/** Is this answer an affirmative? Handles the several shapes a yes can take. */
function isAffirmative(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return false;
  // 'o_*' option keys are resolved by the caller into their option meaning;
  // raw truthy tokens are accepted for yes/no question types.
  return ['true', 'yes', 'y', '1', 'כן'].includes(s);
}

const isNonEmpty = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  return String(value).trim() !== '';
};

/**
 * Which logistics answers need attention.
 *
 * `affirmativeOptionValues` is the set of option keys (o_*) the form author
 * marked as the "yes" side, passed in by the caller — so even affirmative
 * detection never depends on the Hebrew text of an option.
 *
 * Returns [{ role, labelHe, questionKey, value }] — empty means NO card.
 */
export function buildLogisticsFindings({ questions = [], answers = {}, affirmativeOptionValues = new Set() }) {
  const byRole = new Map();
  for (const q of questions) {
    const role = q?.config?.logisticsRole;
    if (role && !byRole.has(role)) byRole.set(role, q);
  }

  const findings = [];
  for (const slot of LOGISTICS_ROLES) {
    const q = byRole.get(slot.role);
    if (!q) continue;
    const value = answers[q.key];

    let flagged = false;
    if (slot.rule === 'affirmative') {
      // An option-keyed answer counts when the author marked that option as
      // the affirmative side; otherwise fall back to literal truthiness.
      flagged = (typeof value === 'string' && affirmativeOptionValues.has(value)) || isAffirmative(value);
    } else {
      flagged = isNonEmpty(value);
    }
    if (flagged) findings.push({ role: slot.role, labelHe: slot.labelHe, questionKey: q.key, value });
  }
  return findings;
}

/** One line for the collapsed card and the digest email. */
export function logisticsHeadline(findings) {
  return findings.map((f) => f.labelHe).join(' · ');
}
