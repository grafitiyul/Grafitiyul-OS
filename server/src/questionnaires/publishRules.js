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

import { validateConditionShape } from '../../../shared/questionnaire/conditions.mjs';
import { hasLanguage } from '../../../shared/questionnaire/localized.mjs';
import { orderedSections } from './structure.js';
import { isKnownType, typeHasOptions, typeIsAnswerable } from './types.js';

// Returns [{ code, sectionKey?, questionKey?, detail? }] — empty = publishable.
export function validateVersionForPublish({ template, structure }) {
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

  return errors;
}
