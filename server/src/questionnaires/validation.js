// Server-side submission validation pipeline — the AUTHORITY (blueprint §9).
// The client mirrors these rules for UX; this module decides.
//
// Pipeline (on draft → submitted):
//   1. Evaluate section+question visibility against the submitted answer map
//      (shared evaluator — same semantics the client used while filling).
//   2. Hidden questions: never required, answers silently DROPPED.
//   3. Visible questions: required check, then per-type validation
//      (types.js registry), including option membership.
//   4. Unknown answer keys are dropped (never an error — a stale client must
//      not brick a customer submission over a question that no longer exists).
//
// Result: { errors: [{ questionKey, code }], cleanAnswers: [{ key, value }],
//           visibleKeys: string[] } — errors non-empty → HTTP 422.

import { evaluateCondition, isEmptyAnswer } from '../../../shared/questionnaire/conditions.mjs';
import { orderedSections } from './structure.js';
import { validateAnswerValue, typeIsAnswerable, QUESTION_TYPES } from './types.js';

// Compute the visible question set for a given answer map. Sections evaluate
// first — a hidden section hides all its questions regardless of their own
// conditions. Document order + backward-only references (enforced at publish)
// make a single forward pass sufficient and deterministic.
export function computeVisibility(structure, answers) {
  const getAnswer = (key) => answers[key];
  const visible = [];
  for (const section of orderedSections(structure)) {
    if (!evaluateCondition(section.visibleWhen, getAnswer)) continue;
    for (const q of section.questions) {
      if (!evaluateCondition(q.visibleWhen, getAnswer)) continue;
      visible.push(q.key);
    }
  }
  return new Set(visible);
}

export function validateSubmissionAnswers(structure, answers) {
  const answerMap = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const visibleKeys = computeVisibility(structure, answerMap);
  const errors = [];
  const cleanAnswers = [];

  for (const section of orderedSections(structure)) {
    for (const question of section.questions) {
      if (!typeIsAnswerable(question.type)) continue; // static blocks never validate/store
      if (!visibleKeys.has(question.key)) continue; // hidden → dropped, never enforced
      const value = answerMap[question.key];
      if (isEmptyAnswer(value)) {
        if (question.required) errors.push({ questionKey: question.key, code: 'required' });
        continue;
      }
      const code = validateAnswerValue(value, question);
      if (code) {
        errors.push({ questionKey: question.key, code });
        continue;
      }
      cleanAnswers.push({ key: question.key, value });
    }
  }

  return { errors, cleanAnswers, visibleKeys: [...visibleKeys] };
}

// Light draft-save sanity (drafts skip required + full validation, but we
// refuse values that could never be valid JSON answer shapes and drop keys
// that don't exist in the version). Returns { accepted: {key: value},
// removed: string[] } — empty values mean "delete this draft answer".
export function sanitizeDraftAnswers(structure, answers) {
  const known = new Map();
  for (const s of orderedSections(structure)) {
    for (const q of s.questions) if (typeIsAnswerable(q.type)) known.set(q.key, q);
  }
  const accepted = {};
  const removed = [];
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { accepted, removed };
  for (const [key, value] of Object.entries(answers)) {
    if (!known.has(key)) continue;
    if (isEmptyAnswer(value)) {
      removed.push(key);
      continue;
    }
    const t = typeof value;
    // Plain objects are legal ONLY for object-valued types (uploads).
    if (t === 'object' && !Array.isArray(value)) {
      const kind = QUESTION_TYPES[known.get(key).type]?.valueKind;
      if (kind !== 'object') continue;
      accepted[key] = value;
      continue;
    }
    if (t !== 'string' && t !== 'number' && t !== 'boolean' && !Array.isArray(value)) continue;
    if (Array.isArray(value) && value.some((x) => typeof x !== 'string')) continue;
    accepted[key] = value;
  }
  return { accepted, removed };
}
