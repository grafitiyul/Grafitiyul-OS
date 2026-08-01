// THE composed trigger catalog — built-in triggers plus one derived entry per
// registered automation.
//
// Why this module exists at all: `triggers.js` is the static list of business
// triggers and must stay import-free (the automation registry reads it). The
// automation bridge needs the opposite direction — a registered automation must
// APPEAR as a trigger the Communication Center can be configured against. Having
// triggers.js import the automation registry would be a cycle
// (triggers → registry → dependencies → triggers), so registration is INVERTED:
// the automation registry pushes its trigger in, exactly like control detectors
// register their own issue types.
//
// The bridge in one sentence:
//
//   A registered automation appears in the Communication Center's trigger
//   picker as `automation:AUT-001`, and everything downstream is unchanged.
//
// That is what keeps automations from becoming a second messaging system. The
// operator builds the message in the Communication Center exactly as they do
// today — channel, audience, timing, sending window, variables, versioning,
// delivery log, retries. The automation only ever says "this happened".
//
// Every consumer (the picker endpoint, publish/activation validation, the
// registry's "which rules does this invoke" lookup) must import triggerByType /
// allTriggers FROM HERE, never from triggers.js, or automation triggers will
// look invalid to half the system.

import {
  TRIGGERS as BUILT_IN, CATEGORY_LABELS as BUILT_IN_CATEGORIES, KIND_LABELS,
} from './triggers.js';

export { KIND_LABELS };

export const AUTOMATION_CATEGORY = 'automations';

export const CATEGORY_LABELS = {
  ...BUILT_IN_CATEGORIES,
  [AUTOMATION_CATEGORY]: 'אוטומציות',
};

// type → derived trigger entry. Populated at boot by the automation registry.
const DERIVED = new Map();

/**
 * Register (or refresh) the trigger for one automation. Idempotent by type so a
 * hot reload cannot throw. Shape matches a built-in trigger exactly, so nothing
 * downstream needs to know the difference.
 */
export function registerDerivedTrigger(entry) {
  if (!entry?.type) throw new Error('derived trigger requires a type');
  DERIVED.set(entry.type, { ...entry, derived: true });
}

export function unregisterDerivedTrigger(type) {
  DERIVED.delete(type);
}

/** Built-in triggers first, then automations — the picker order operators see. */
export function allTriggers() {
  return [...BUILT_IN, ...DERIVED.values()];
}

/** THE resolver. Built-in wins on a (impossible) collision. */
export function triggerByType(type) {
  return BUILT_IN.find((t) => t.type === type) || DERIVED.get(type) || null;
}

export function allTriggerTypes() {
  return allTriggers().map((t) => t.type);
}

/** Is this trigger type backed by an automation rather than a built-in event? */
export function isDerivedTrigger(type) {
  return DERIVED.has(type);
}
