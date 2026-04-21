// Server mirror of client/src/lib/questionRequirement.js — identical
// logic for validating learner answers against a question's
// `requirement` flag. The function is small and dependency-free, so
// duplicating it is cheaper than setting up a shared workspace
// package. ANY CHANGE HERE MUST BE MIRRORED on the client side.

export const REQUIREMENTS = Object.freeze({
  OPTIONAL: 'optional',
  CHOICE: 'choice',
  TEXT: 'text',
  ANY: 'any',
  BOTH: 'both',
});

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

export function coerceRequirement(question) {
  const valid = validRequirementsFor(question);
  if (valid.has(question.requirement)) return question.requirement;
  return REQUIREMENTS.OPTIONAL;
}

function hasValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0;
}

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
