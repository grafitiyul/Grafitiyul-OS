// Pure helpers over a version STRUCTURE — the plain-object shape every layer
// (validation, publish rules, runtime payload, snapshots, clone) works with:
//
//   structure = {
//     sections: [{ id, key, title, description, sortOrder, collapsible,
//                  collapsedByDefault, visibleWhen,
//                  questions: [{ id, key, type, label, helpText, placeholder,
//                                required, sortOrder, config, visibleWhen,
//                                options: [{ id, value, label, sortOrder }] }] }]
//   }
//
// No DB access here — the service loads/persists, these functions reason.

import crypto from 'node:crypto';
import { resolveLocalized } from '../../../shared/questionnaire/localized.mjs';

// Stable machine keys. Generated once at creation and preserved across version
// clones — they are the identity answers + conditions bind to (blueprint §2).
export function newKey(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function bySort(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

// Sections and questions in canonical document order.
export function orderedSections(structure) {
  return [...(structure.sections || [])].sort(bySort).map((s) => ({
    ...s,
    questions: [...(s.questions || [])].sort(bySort).map((q) => ({
      ...q,
      options: [...(q.options || [])].sort(bySort),
    })),
  }));
}

// Flat question list in document order, each annotated with its section.
export function flatQuestions(structure) {
  const out = [];
  for (const s of orderedSections(structure)) {
    for (const q of s.questions) out.push({ ...q, section: s });
  }
  return out;
}

export function questionByKey(structure, key) {
  return flatQuestions(structure).find((q) => q.key === key) || null;
}

// The per-answer frozen snapshot (blueprint §7 layer 2): the resolved,
// single-language view the responder actually saw. Rendering a historical
// submission never touches the version tree.
export function buildQuestionSnapshot(question, lang, defaultLanguage) {
  const r = (map) => resolveLocalized(map, lang, defaultLanguage);
  return {
    key: question.key,
    type: question.type,
    label: r(question.label),
    helpText: r(question.helpText) || null,
    placeholder: r(question.placeholder) || null,
    required: !!question.required,
    config: question.config ?? null,
    sectionKey: question.section?.key ?? null,
    sectionTitle: question.section ? r(question.section.title) : null,
    options: (question.options || []).map((o) => ({ value: o.value, label: r(o.label) })),
  };
}

// Deep-clone a structure for a NEW draft version: new row ids (DB assigns),
// same stable keys, same order/config/conditions. Returns nested createMany-
// ready plain objects (no ids).
export function cloneStructureForNewVersion(structure) {
  return orderedSections(structure).map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description ?? null,
    sortOrder: s.sortOrder ?? 0,
    collapsible: !!s.collapsible,
    collapsedByDefault: !!s.collapsedByDefault,
    visibleWhen: s.visibleWhen ?? null,
    questions: s.questions.map((q) => ({
      key: q.key,
      type: q.type,
      label: q.label,
      helpText: q.helpText ?? null,
      placeholder: q.placeholder ?? null,
      required: !!q.required,
      sortOrder: q.sortOrder ?? 0,
      config: q.config ?? null,
      visibleWhen: q.visibleWhen ?? null,
      options: q.options.map((o) => ({
        value: o.value,
        label: o.label,
        sortOrder: o.sortOrder ?? 0,
      })),
    })),
  }));
}

// Singleton identity of an active submission (blueprint §2): DB-unique via
// QuestionnaireSubmission.singletonKey. Set only when the template enforces
// one-active-per-subject; cleared when a submission is voided.
export function buildSingletonKey({ subjectType, subjectId, purpose, actorScope }) {
  if (!subjectType || !subjectId) return null;
  const base = `${subjectType}:${subjectId}:${purpose}`;
  // perActor purposes (tour_summary): one active submission per subject PER
  // GUIDE — the scope joins the key so guides never collide.
  return actorScope ? `${base}:${actorScope}` : base;
}
