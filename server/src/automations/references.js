// Which automations reference which questionnaire keys — the DERIVED half of
// the builder's automation panel, and the data the publish guard runs on.
//
// This is deliberately separate from the manual "משמשת באוטומציות" flag
// (QuestionnaireQuestion.automationFlag). They answer different questions:
//
//   automationFlag  — MANUAL business decision: "this question is intended as
//                     an automation extension point." May be true before any
//                     automation exists; that intent is itself a fact.
//   references here — RUNTIME truth: "these automations reference this key
//                     right now." Read live from the registry, never stored.
//
// Neither is derived from the other, so neither can be stale, and the builder
// shows both side by side instead of silently reconciling them.
//
// Everything here is PURE over the registry (no DB) — the publish guard and the
// unit tests call it directly.

import { listAutomations } from './registry.js';
import { referencedKeys } from '../../../shared/questionnaire/conditions.mjs';

/**
 * Every questionnaire key an automation depends on, from BOTH places a
 * definition can name one:
 *   * `when` — the answer conditions it evaluates;
 *   * `dependsOn` — the questionnaire_question / questionnaire_option entries
 *     it declares.
 * Missing either source would let a "healthy" automation depend on a key
 * nothing protects.
 */
export function keysUsedBy(def) {
  const questionKeys = new Set(referencedKeys(def.when));
  const optionValues = new Set(); // `${questionKey}:${optionValue}`

  for (const dep of def.dependsOn || []) {
    if (dep.kind === 'questionnaire_question' && dep.questionKey) {
      questionKeys.add(dep.questionKey);
    }
    if (dep.kind === 'questionnaire_option' && dep.questionKey && dep.optionValue) {
      questionKeys.add(dep.questionKey);
      optionValues.add(`${dep.questionKey}:${dep.optionValue}`);
    }
  }

  // Option keys used as condition values belong to the question the leaf targets.
  collectConditionOptions(def.when, optionValues);

  return {
    templateKey: def.trigger?.templateKey || null,
    questionKeys: [...questionKeys],
    optionValues: [...optionValues],
  };
}

function collectConditionOptions(expr, out) {
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Array.isArray(node.all)) return node.all.forEach(walk);
    if (Array.isArray(node.any)) return node.any.forEach(walk);
    if (node.not !== undefined) return walk(node.not);
    if (typeof node.q !== 'string') return;
    const values = Array.isArray(node.value) ? node.value : [node.value];
    for (const v of values) {
      if (typeof v === 'string' && /^o_[0-9a-f]{8}$/.test(v)) out.add(`${node.q}:${v}`);
    }
  };
  walk(expr);
}

/** A compact automation descriptor for the builder panel and guard messages. */
const descriptor = (def) => ({ autId: def.id, nameHe: def.nameHe, category: def.category });

/**
 * All key references for ONE questionnaire template.
 *
 *   { questions: Map<questionKey, descriptor[]>,
 *     options:   Map<`${questionKey}:${optionValue}`, descriptor[]> }
 *
 * Only automations triggered by THIS template are considered — a key is only
 * stable within its template, so a same-named key elsewhere is unrelated.
 */
export function referencesForTemplate(templateKey) {
  const questions = new Map();
  const options = new Map();
  if (!templateKey) return { questions, options };

  const push = (map, key, def) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(descriptor(def));
  };

  for (const def of listAutomations()) {
    const used = keysUsedBy(def);
    if (used.templateKey !== templateKey) continue;
    for (const k of used.questionKeys) push(questions, k, def);
    for (const v of used.optionValues) push(options, v, def);
  }
  return { questions, options };
}

/**
 * The same data as a JSON-safe object for the builder API. Keyed by question
 * key so the client can look up without scanning.
 */
export function referencePayloadForTemplate(templateKey) {
  const { questions, options } = referencesForTemplate(templateKey);
  const byQuestion = {};
  for (const [key, defs] of questions) {
    byQuestion[key] = { automations: defs, options: {} };
  }
  for (const [composite, defs] of options) {
    const [questionKey, optionValue] = composite.split(':');
    if (!byQuestion[questionKey]) byQuestion[questionKey] = { automations: [], options: {} };
    byQuestion[questionKey].options[optionValue] = defs;
  }
  return byQuestion;
}
