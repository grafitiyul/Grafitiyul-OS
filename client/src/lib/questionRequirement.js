// Shared question-requirement logic.
//
// Source of truth for:
//   * which requirement values make sense given a question's shape
//     (the editor uses this to render only sensible radio options)
//   * coercing a stored requirement to a valid one when the shape
//     changes (e.g. choices are removed but `requirement` still says
//     'choice' — we fall back rather than showing a contradictory UI)
//   * validating a learner's answer against a question's requirement
//
// The SERVER mirrors this file at server/src/services/questionRequirement.js
// with identical logic. Any change here MUST be mirrored there. The
// function is small and has zero dependencies, so duplication is
// cheaper than setting up a shared workspace package.

export const REQUIREMENTS = Object.freeze({
  OPTIONAL: 'optional',
  CHOICE: 'choice',
  TEXT: 'text',
  ANY: 'any',
  BOTH: 'both',
});

// UI labels for the editor radio group. Keep alongside the enum so
// label-by-key is the single pattern.
export const REQUIREMENT_LABELS = Object.freeze({
  [REQUIREMENTS.OPTIONAL]: 'לא חובה',
  [REQUIREMENTS.CHOICE]: 'חובה לבחור אפשרות',
  [REQUIREMENTS.TEXT]: 'חובה לכתוב טקסט',
  [REQUIREMENTS.ANY]: 'אחד מהשניים — בחירה או טקסט',
  [REQUIREMENTS.BOTH]: 'גם בחירה וגם טקסט',
});

// The set of requirement values that make sense for a question with
// this shape. Used by the editor to filter the radio options and by
// `coerceRequirement` to fall back when a stored value is no longer
// applicable.
export function validRequirementsFor({ options, allowTextAnswer }) {
  const hasChoices = Array.isArray(options) && options.length > 0;
  const hasText = !!allowTextAnswer;
  const valid = new Set([REQUIREMENTS.OPTIONAL]);
  if (hasChoices) valid.add(REQUIREMENTS.CHOICE);
  if (hasText) valid.add(REQUIREMENTS.TEXT);
  if (hasChoices && hasText) {
    valid.add(REQUIREMENTS.ANY);
    valid.add(REQUIREMENTS.BOTH);
  }
  return valid;
}

// Coerce a question's `requirement` to one that matches its current
// shape. If the stored value is still valid, returns it unchanged;
// otherwise falls back to 'optional' (the most permissive state, can
// never be contradictory).
export function coerceRequirement(question) {
  const valid = validRequirementsFor(question);
  if (valid.has(question.requirement)) return question.requirement;
  return REQUIREMENTS.OPTIONAL;
}

// Is a value considered "filled" for validation purposes?
function hasValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0;
}

// Validate a learner's answer against a question's requirement.
// Returns { ok: true } on success, or { ok: false, reason: <string> }
// on failure. The reason is a stable machine key — the UI maps it to
// a localized message.
//
// `answer` shape:
//   { choice: string|null, text: string|null }
//
// Note: this validates the SHAPE of the answer vs the question's
// requirement. It does NOT check that `choice` is actually in the
// question's `options` array — that's a separate concern (the UI only
// lets the learner pick from `options`, and on write the server can
// cross-check if it wants a stricter guarantee).
export function validateAnswer(question, answer) {
  const requirement = coerceRequirement(question);
  const choiceFilled = hasValue(answer?.choice);
  const textFilled = hasValue(answer?.text);

  switch (requirement) {
    case REQUIREMENTS.OPTIONAL:
      return { ok: true };
    case REQUIREMENTS.CHOICE:
      if (!choiceFilled) return { ok: false, reason: 'choice_required' };
      return { ok: true };
    case REQUIREMENTS.TEXT:
      if (!textFilled) return { ok: false, reason: 'text_required' };
      return { ok: true };
    case REQUIREMENTS.ANY:
      if (!choiceFilled && !textFilled) {
        return { ok: false, reason: 'any_required' };
      }
      return { ok: true };
    case REQUIREMENTS.BOTH:
      if (!choiceFilled) return { ok: false, reason: 'choice_required' };
      if (!textFilled) return { ok: false, reason: 'text_required' };
      return { ok: true };
    default:
      return { ok: true };
  }
}

// Human-readable message for a validation failure reason. The UI can
// use these directly or map to its own copy.
export const VALIDATION_MESSAGES = Object.freeze({
  choice_required: 'יש לבחור אפשרות',
  text_required: 'יש להזין טקסט',
  any_required: 'יש לבחור אפשרות או להזין טקסט',
});
