// Review card: Tour Summary (סיכום סיור).
//
// EVERY submitted tour summary produces one of these — there is no condition.
// The card carries the five narrative answers a manager actually reads, frozen
// at creation so a later questionnaire edit never rewrites what was reviewed.
//
// ── Why the answers are addressed by ROLE, not by key ────────────────────────
// A card definition must not hardcode `q_9f3a12bd`: that key belongs to one
// template version and the whole point of the architecture is that questionnaire
// content stays editable. Instead each narrative slot declares its ROLE, and the
// role is matched to a question via the template's automation flags + a
// conventional config key (`summaryRole`). A form author picks the role in the
// builder; nothing here depends on wording, order, or a specific key.
//
// When a role has no question mapped, the slot is simply absent — the card
// still renders with whatever the guide did answer, and the manager sees an
// honest gap rather than a broken template.

import { registerReviewKind } from '../registry.js';

export const TOUR_SUMMARY_KIND = 'tour_summary';

/**
 * The five narrative slots, in the order a manager reads them.
 * `role` is matched against QuestionnaireQuestion.config.summaryRole.
 */
export const SUMMARY_ROLES = [
  { role: 'overall', labelHe: 'איך היה הסיור בכללי?' },
  { role: 'positive', labelHe: 'משהו חיובי / ייחודי' },
  { role: 'challenge', labelHe: 'משהו מאתגר ומה נעשה' },
  { role: 'incidents', labelHe: 'אירועים חריגים' },
  { role: 'suggestions', labelHe: 'הצעות לשימור / שיפור' },
];

registerReviewKind(TOUR_SUMMARY_KIND, {
  labelHe: 'סיכום סיור',
  tone: 'default',
  descriptionHe: 'נוצר עבור כל סיכום סיור שהוגש, לקריאה ואישור של ההנהלה.',
  buildLink: (item) => (item.tourEventId ? `/admin/tours/${item.tourEventId}` : null),
});

/**
 * Extract the narrative answers for the card.
 *
 * `questions` is the published structure (key, config, label); `answers` is the
 * frozen answer map. Returns [{ role, labelHe, questionKey, value }] for every
 * role that has BOTH a mapped question and a non-empty answer.
 */
export function buildSummaryDetails({ questions = [], answers = {} }) {
  const byRole = new Map();
  for (const q of questions) {
    const role = q?.config?.summaryRole;
    if (role && !byRole.has(role)) byRole.set(role, q);
  }

  const out = [];
  for (const slot of SUMMARY_ROLES) {
    const q = byRole.get(slot.role);
    if (!q) continue;
    const value = answers[q.key];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    out.push({ role: slot.role, labelHe: slot.labelHe, questionKey: q.key, value });
  }
  return out;
}

/** The one-line summary shown on the collapsed card: the overall answer. */
export function summaryHeadline(details) {
  const overall = details.find((d) => d.role === 'overall');
  return overall ? String(overall.value).slice(0, 200) : null;
}
