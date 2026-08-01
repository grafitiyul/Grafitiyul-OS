// Action executors — one per kind in actionKinds.js.
//
// The catalog (actionKinds.js) is the VOCABULARY; this is the implementation.
// They are separate so the registry can validate a definition at boot without
// pulling in every executor's dependencies, and so a kind can be declared before
// its executor lands (a definition using it then fails loudly at run time rather
// than silently doing nothing).
//
// Executor contract:
//   run(action, ctx) → { ok, ref?, error? }
// where ctx carries { def, event, refs, log }. An executor NEVER throws into the
// runtime — it reports, and the run row records the outcome.

import { fireCommunicationAction } from './communication.js';

const EXECUTORS = {
  communication: fireCommunicationAction,
};

export function actionExecutor(kind) {
  return EXECUTORS[kind] || null;
}

/** Register an executor (used as later action kinds land). Idempotent by kind. */
export function registerActionExecutor(kind, fn) {
  EXECUTORS[kind] = fn;
}

export function implementedActionKinds() {
  return Object.keys(EXECUTORS);
}
