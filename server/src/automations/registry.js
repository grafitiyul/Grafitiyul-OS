// THE Automation Registry — the one place that knows which automations exist.
//
// Automations are CODE. A definition module is simultaneously:
//   * what the runtime executes, and
//   * what the registry screen renders.
// There is no third artifact. That is the whole architectural point: a
// documentation layer would be free to drift from the implementation, and the
// first time it did, the registry would start lying about production.
//
// Everything the registry displays therefore comes from exactly one of:
//   1. the definition module itself (trigger, conditions, actions, notes);
//   2. live reads of the owning subsystem (dependencies — dependencies.js);
//   3. execution facts written by the runtime (AutomationRun / AutomationChange).
// No field is hand-maintained prose describing behaviour, and the API exposes
// no way to write one.
//
// Adding an automation is: allocate an id in ledger.js, add a definition file,
// add one import line to definitions/index.js. Nothing else changes.

import crypto from 'node:crypto';
import { ALLOCATED, RETIRED, AUT_ID_PATTERN, isAllocated, isRetired } from './ledger.js';
import { isKnownActionKind } from './actionKinds.js';
import { isKnownDependencyKind } from './dependencies.js';
import { referencedKeys } from '../../../shared/questionnaire/conditions.mjs';

const DEFS = new Map();

// ONE trigger kind, by approved scope. `domain_event` and `schedule` existed
// only to adopt existing GOS behaviour into a general engine; that programme was
// declined, and the workers keep owning their own scheduling.
export const TRIGGER_KINDS = ['questionnaire_submitted'];

export const CATEGORIES = {
  tours: 'סיורים',
  crm: 'CRM',
  finance: 'כספים',
  operations: 'תפעול',
};

// ── registration ─────────────────────────────────────────────────────────────

/**
 * Register one automation definition. Throws on anything that would make the
 * registry untrustworthy — a bad definition must fail at BOOT, loudly, not at
 * 3am when the trigger finally fires.
 */
export function registerAutomation(def) {
  const problems = validateDefinition(def);
  if (problems.length) {
    throw new Error(`invalid automation definition ${def?.id || '(no id)'}: ${problems.join('; ')}`);
  }
  if (DEFS.has(def.id)) throw new Error(`automation already registered: ${def.id}`);
  DEFS.set(def.id, Object.freeze({ ...def }));
  return def;
}

/**
 * Structural validation of ONE definition. Pure — the guard test calls it
 * directly with hand-built objects.
 */
export function validateDefinition(def) {
  const p = [];
  if (!def || typeof def !== 'object') return ['not_an_object'];

  // ── identity ──
  if (!AUT_ID_PATTERN.test(def.id || '')) p.push('id_must_match_AUT-NNN');
  else {
    if (!isAllocated(def.id)) p.push(`id_not_in_ledger:${def.id}`);
    // A retired id is a tombstone. Reviving it would make "AUT-014" mean two
    // different things across time — the one thing an AUT id must never do.
    if (isRetired(def.id)) p.push(`id_is_retired:${def.id}`);
  }
  if (!def.slug || !/^[a-z0-9_]+$/.test(def.slug)) p.push('slug_must_be_snake_case');
  if (!def.nameHe) p.push('nameHe_required');
  if (!def.descriptionHe) p.push('descriptionHe_required');
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, def.category)) p.push(`unknown_category:${def.category}`);
  if (typeof def.defaultEnabled !== 'boolean') p.push('defaultEnabled_must_be_boolean');

  // ── trigger ──
  const trigger = def.trigger || {};
  if (!TRIGGER_KINDS.includes(trigger.kind)) p.push(`unknown_trigger_kind:${trigger.kind}`);
  if (trigger.kind === 'questionnaire_submitted' && !trigger.templateKey) {
    p.push('questionnaire_trigger_requires_templateKey');
  }

  // ── answer conditions: STABLE KEYS ONLY ──
  // The single rule that keeps content and logic separate. A condition that
  // referenced a label would break the moment someone reworded a question —
  // which is exactly the freedom the questionnaire is supposed to keep.
  for (const key of referencedKeys(def.when)) {
    if (!/^q_[0-9a-f]{8}$/.test(key)) p.push(`condition_must_reference_question_key:${key}`);
  }
  for (const value of optionValuesIn(def.when)) {
    if (!/^o_[0-9a-f]{8}$/.test(value)) p.push(`condition_value_must_be_option_key:${value}`);
  }

  // ── actions ──
  if (!Array.isArray(def.actions) || def.actions.length === 0) p.push('actions_required');
  else {
    def.actions.forEach((a, i) => {
      if (!isKnownActionKind(a?.kind)) p.push(`unknown_action_kind[${i}]:${a?.kind}`);
    });
  }

  // ── dependencies ──
  if (def.dependsOn !== undefined) {
    if (!Array.isArray(def.dependsOn)) p.push('dependsOn_must_be_array');
    else {
      def.dependsOn.forEach((d, i) => {
        if (!isKnownDependencyKind(d?.kind)) p.push(`unknown_dependency_kind[${i}]:${d?.kind}`);
        if (d?.severity && !['hard', 'soft'].includes(d.severity)) {
          p.push(`unknown_dependency_severity[${i}]:${d.severity}`);
        }
      });
    }
  }

  // ── idempotency ──
  // Without it a replayed trigger acts twice. Every other subsystem in GOS
  // already keys on business identity; automations are not the exception.
  if (typeof def.idempotency !== 'function') p.push('idempotency_function_required');

  return p;
}

// Option keys referenced as condition VALUES (eq/neq take a scalar, in/nin an
// array). Used to enforce that answer conditions never hardcode answer text.
function optionValuesIn(expr) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Array.isArray(node.all)) return node.all.forEach(walk);
    if (Array.isArray(node.any)) return node.any.forEach(walk);
    if (node.not !== undefined) return walk(node.not);
    if (typeof node.q !== 'string') return;
    // Only option-shaped values are checked: numeric/boolean comparisons and
    // free-text `contains` are legitimately not option keys.
    const vals = Array.isArray(node.value) ? node.value : [node.value];
    for (const v of vals) if (typeof v === 'string' && v.startsWith('o_')) out.push(v);
  };
  walk(expr);
  return out;
}

// ── reads ────────────────────────────────────────────────────────────────────

export function automationById(id) {
  return DEFS.get(id) || null;
}

/** Live definitions, in ledger (allocation) order. */
export function listAutomations() {
  return ALLOCATED.map((id) => DEFS.get(id)).filter(Boolean);
}

/**
 * Every id the registry must account for — live AND retired. The list screen
 * shows both, so a removed automation is visible as "הוסרה" with its history
 * rather than silently disappearing.
 */
export function listRegistryEntries() {
  return ALLOCATED.map((id) => ({
    id,
    def: DEFS.get(id) || null,
    retired: RETIRED[id] || null,
  }));
}

/** Definitions whose trigger matches an incoming event (runtime + tests). */
export function automationsForTrigger({ kind, templateKey = null, purpose = null, eventType = null }) {
  return listAutomations().filter((def) => {
    const t = def.trigger;
    if (t.kind !== kind) return false;
    if (t.templateKey !== templateKey) return false;
    if (t.purpose && t.purpose !== purpose) return false;
    return true;
  });
}

/**
 * The Communication Center trigger type an automation fires. ONE derivation,
 * used by the definition, the runtime, the CC trigger catalog and the registry's
 * "which rules does this invoke" lookup — so all four can never disagree.
 */
export function automationTriggerType(autId) {
  return `automation:${autId}`;
}

/** The AUT id behind a communication trigger type, or null if it isn't one. */
export function autIdFromTriggerType(triggerType) {
  const m = /^automation:(AUT-\d{3,})$/.exec(String(triggerType || ''));
  return m ? m[1] : null;
}

// ── definition drift ─────────────────────────────────────────────────────────

/**
 * A stable hash of a definition's DECLARED BEHAVIOUR — trigger, conditions,
 * action shape, dependencies. Deliberately excludes prose (nameHe,
 * descriptionHe, notesHe) so that rewording documentation is not reported as a
 * behaviour change, and functions are represented by their source so a changed
 * idempotency rule or buildData IS caught.
 *
 * At boot the registry compares this against the last recorded hash and writes
 * an AutomationChange row when it moves. That is what makes "updated date" and
 * the change log facts about the code instead of hand-maintained prose.
 */
export function definitionHash(def) {
  const shape = {
    trigger: def.trigger,
    when: def.when ?? null,
    guards: (def.guards || []).map((g) => g.code),
    actions: (def.actions || []).map((a) => ({
      kind: a.kind,
      ...Object.fromEntries(
        Object.entries(a)
          .filter(([k]) => k !== 'kind')
          .map(([k, v]) => [k, typeof v === 'function' ? fnSource(v) : v]),
      ),
    })),
    dependsOn: def.dependsOn || [],
    defaultEnabled: def.defaultEnabled,
    idempotency: fnSource(def.idempotency),
  };
  return crypto.createHash('sha256').update(stableStringify(shape)).digest('hex').slice(0, 16);
}

// Whitespace-normalised so reformatting is not reported as a behaviour change.
const fnSource = (fn) => (typeof fn === 'function' ? String(fn).replace(/\s+/g, ' ').trim() : null);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

// ── registry-wide validation (boot + guard test) ─────────────────────────────

/**
 * Invariants across the WHOLE registry. Returns problem strings ([] = healthy).
 * Called at boot (fatal) and by the guard test, so "if an automation exists in
 * production it appears in the registry" is a test rather than a promise.
 */
export function validateRegistry() {
  const problems = [];

  const seen = new Set();
  for (const id of ALLOCATED) {
    if (seen.has(id)) problems.push(`duplicate_id_in_ledger:${id}`);
    seen.add(id);
    if (!AUT_ID_PATTERN.test(id)) problems.push(`malformed_id_in_ledger:${id}`);
  }

  // Every allocated id must resolve to EITHER a live definition or a retirement
  // record. An id that is neither is a definition someone deleted without
  // retiring it — the registry would silently lose an automation.
  for (const id of ALLOCATED) {
    const live = DEFS.has(id);
    const retired = isRetired(id);
    if (!live && !retired) problems.push(`allocated_id_has_no_definition_and_no_retirement:${id}`);
    if (live && retired) problems.push(`id_is_both_live_and_retired:${id}`);
  }

  // A retirement record for an id that was never allocated is a typo.
  for (const id of Object.keys(RETIRED)) {
    if (!isAllocated(id)) problems.push(`retired_id_not_in_ledger:${id}`);
    const entry = RETIRED[id];
    if (!entry?.retiredOn || !entry?.reasonHe) problems.push(`retirement_requires_date_and_reason:${id}`);
  }

  // A registered definition outside the ledger cannot be referred to safely.
  for (const id of DEFS.keys()) {
    if (!isAllocated(id)) problems.push(`registered_id_not_in_ledger:${id}`);
  }

  // Slugs are used in logs and must stay unambiguous.
  const slugs = new Map();
  for (const def of DEFS.values()) {
    if (slugs.has(def.slug)) problems.push(`duplicate_slug:${def.slug}`);
    slugs.set(def.slug, def.id);
  }

  return problems;
}

/** Test-only reset — the module registry is process-global by design. */
export function __resetRegistry() {
  DEFS.clear();
}
