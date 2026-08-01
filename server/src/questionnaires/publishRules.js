// Publish-time validation — the safety gate that freezes a draft version
// (blueprint §6, §9, §10). A version that fails any rule is NOT published;
// the errors are returned as a structured 422 list the builder renders inline.
//
// Rules:
//   • at least one section and one answerable-or-static question
//   • every question type is known; option types have ≥ 1 option
//   • option values unique per question (DB also enforces)
//   • default-language completeness: template title, section titles, question
//     labels and option labels all carry the template's defaultLanguage
//   • visibleWhen expressions are structurally valid and reference ONLY
//     answerable questions that appear EARLIER in document order
//     (backward-only ⇒ acyclic by construction)
//   • sections may reference only questions from EARLIER sections
//   • AUTOMATION KEY PROTECTION (see below)
//
// ── Automation key protection ────────────────────────────────────────────────
// Question keys (q_<hex>) and option values (o_<hex>) are generated once and
// preserved across version clones, so wording and ordering are free to change.
// The ONE action that destroys a key is deleting a question/option and adding
// it back — which mints a new random key. Before this gate existed, that would
// silently stop every automation bound to it, with no error anywhere.
//
// Two levels, matching the two independent signals (see automations/references.js):
//   error   — a key a NON-RETIRED automation actually references is gone.
//             Publishing is blocked; the message names the AUT ids.
//   warning — a key the author flagged "משמשת באוטומציות" is gone. No automation
//             depends on it yet, so this is acknowledgeable — but the flag was a
//             deliberate business decision and must not vanish unnoticed.
//
// Callers pass `automation` (see buildAutomationGuardInput in the service); when
// it is omitted the rules below simply do not fire, which keeps this module pure
// and independently testable.

import { validateConditionShape } from '../../../shared/questionnaire/conditions.mjs';
import { hasLanguage } from '../../../shared/questionnaire/localized.mjs';
import { orderedSections } from './structure.js';
import { isKnownType, typeHasOptions, typeIsAnswerable } from './types.js';

// Problem levels. A publish is blocked by 'error' only.
export const PROBLEM_ERROR = 'error';
export const PROBLEM_WARNING = 'warning';

/** Errors block publishing; warnings are surfaced and acknowledgeable. */
export function blockingProblems(problems) {
  return (problems || []).filter((p) => (p.level || PROBLEM_ERROR) === PROBLEM_ERROR);
}

/**
 * Returns [{ code, level, sectionKey?, questionKey?, detail?, automations? }] —
 * no blocking entries = publishable.
 *
 * `automation` (optional):
 *   { referencedQuestions: Map<questionKey, [{autId,nameHe}]>,
 *     referencedOptions:   Map<`${qKey}:${oValue}`, [{autId,nameHe}]>,
 *     flaggedQuestionKeys: Set<questionKey> }   ← from the CURRENT PUBLISHED version
 */
export function validateVersionForPublish({ template, structure, automation = null }) {
  const errors = [];
  const lang = template.defaultLanguage || 'he';
  const sections = orderedSections(structure);

  if (!hasLanguage(template.title, lang)) {
    errors.push({ code: 'template_title_missing_default_language' });
  }
  if (sections.length === 0) {
    errors.push({ code: 'no_sections' });
    return errors;
  }

  const totalQuestions = sections.reduce((n, s) => n + s.questions.length, 0);
  if (totalQuestions === 0) errors.push({ code: 'no_questions' });

  // Keys of ANSWERABLE questions seen so far, in document order — the only
  // legal condition targets for anything that comes after them.
  const seenAnswerable = new Set();
  const allKeys = new Set();
  // `${questionKey}:${optionValue}` for every option present in this draft —
  // the automation guard compares against these.
  const allOptionValues = new Set();

  for (const section of sections) {
    if (!hasLanguage(section.title, lang)) {
      errors.push({ code: 'section_title_missing_default_language', sectionKey: section.key });
    }
    if (section.visibleWhen !== null && section.visibleWhen !== undefined) {
      // A section may reference only questions from EARLIER sections (its own
      // questions can't gate it — they don't exist for the filler until the
      // section shows).
      for (const p of validateConditionShape(section.visibleWhen, seenAnswerable)) {
        errors.push({ code: 'invalid_condition', sectionKey: section.key, detail: p });
      }
    }

    for (const q of section.questions) {
      if (allKeys.has(q.key)) {
        errors.push({ code: 'duplicate_question_key', questionKey: q.key });
      }
      allKeys.add(q.key);

      if (!isKnownType(q.type)) {
        errors.push({ code: 'unknown_question_type', questionKey: q.key });
        continue;
      }
      if (!hasLanguage(q.label, lang)) {
        errors.push({ code: 'question_label_missing_default_language', questionKey: q.key });
      }
      if (typeHasOptions(q.type)) {
        if (!q.options || q.options.length === 0) {
          errors.push({ code: 'options_required', questionKey: q.key });
        } else {
          const values = new Set();
          for (const o of q.options) {
            if (values.has(o.value)) {
              errors.push({ code: 'duplicate_option_value', questionKey: q.key, detail: o.value });
            }
            values.add(o.value);
            allOptionValues.add(`${q.key}:${o.value}`);
            if (!hasLanguage(o.label, lang)) {
              errors.push({ code: 'option_label_missing_default_language', questionKey: q.key, detail: o.value });
            }
          }
        }
      }
      if (q.config?.regex) {
        try {
          new RegExp(q.config.regex); // eslint-disable-line no-new
        } catch {
          errors.push({ code: 'invalid_regex', questionKey: q.key });
        }
      }
      if (q.visibleWhen !== null && q.visibleWhen !== undefined) {
        for (const p of validateConditionShape(q.visibleWhen, seenAnswerable)) {
          errors.push({ code: 'invalid_condition', questionKey: q.key, detail: p });
        }
      }
      // Only AFTER its own condition check: a question may not reference itself.
      if (typeIsAnswerable(q.type)) seenAnswerable.add(q.key);
    }
  }

  errors.push(...automationProblems({ automation, allKeys, allOptionValues }));

  // Everything above is blocking unless it says otherwise.
  return errors.map((e) => ({ level: PROBLEM_ERROR, ...e }));
}

/**
 * Automation key protection. Pure over the draft's key sets — the caller
 * supplies what the registry references and what the CURRENT PUBLISHED version
 * had flagged.
 */
function automationProblems({ automation, allKeys, allOptionValues }) {
  if (!automation) return [];
  const problems = [];
  const {
    referencedQuestions = new Map(),
    referencedOptions = new Map(),
    flaggedQuestionKeys = new Set(),
  } = automation;

  // BLOCKING — a key a live automation actually depends on is gone.
  for (const [questionKey, automations] of referencedQuestions) {
    if (allKeys.has(questionKey)) continue;
    problems.push({
      code: 'automation_question_removed',
      level: PROBLEM_ERROR,
      questionKey,
      automations,
      detail: automations.map((a) => a.autId).join(', '),
    });
  }

  for (const [composite, automations] of referencedOptions) {
    if (allOptionValues.has(composite)) continue;
    const [questionKey, optionValue] = composite.split(':');
    // A missing question is already reported above — don't report it twice as
    // a missing option, which would read like two separate faults.
    if (!allKeys.has(questionKey)) continue;
    problems.push({
      code: 'automation_option_removed',
      level: PROBLEM_ERROR,
      questionKey,
      optionValue,
      automations,
      detail: automations.map((a) => a.autId).join(', '),
    });
  }

  // WARNING — a key the author deliberately marked as an automation extension
  // point is gone, but nothing depends on it yet.
  for (const questionKey of flaggedQuestionKeys) {
    if (allKeys.has(questionKey)) continue;
    if (referencedQuestions.has(questionKey)) continue; // already blocking
    problems.push({
      code: 'automation_flagged_question_removed',
      level: PROBLEM_WARNING,
      questionKey,
    });
  }

  return problems;
}
