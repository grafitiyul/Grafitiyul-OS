// Mirror configuration — the two independent switches.
//
// The audit found that ONE flag could not express the rollout we need: it gated
// capture and apply together, and when it was off the workers never started, so
// polling never ran. Capture and apply are genuinely separate concerns and now
// have separate switches:
//
//   MIRROR_CAPTURE_ENABLED   receive webhooks, poll sources, persist events
//   MIRROR_APPLY_ENABLED     let processEvent WRITE to GOS records
//
// The rollout is therefore expressible:
//
//   Phase A   capture=true  apply=false   buffer everything, change nothing
//   Phase B   capture=true  apply=false   snapshot + cutover import (seeds baselines)
//   Phase C   capture=true  apply=false   replay runs with an explicit override
//   Phase D   capture=true  apply=true    normal live mirror
//
// Both default to FALSE. The mirror writes to production CRM records; it must
// never start because someone forgot a variable.

const flag = (name, env = process.env) => String(env[name] || '').trim().toLowerCase() === 'true';

export const captureEnabled = (env = process.env) => flag('MIRROR_CAPTURE_ENABLED', env);
export const applyEnabled = (env = process.env) => flag('MIRROR_APPLY_ENABLED', env);

/**
 * Legacy single switch. Kept ONLY so an existing deployment that still sets
 * MIRROR_ENABLED=true behaves as before (both on) rather than silently going
 * dark. New deployments should set the two specific flags.
 */
export const legacyMirrorEnabled = (env = process.env) => flag('MIRROR_ENABLED', env);

export function mirrorMode(env = process.env) {
  const legacy = legacyMirrorEnabled(env);
  const capture = captureEnabled(env) || legacy;
  const apply = applyEnabled(env) || legacy;
  return {
    capture,
    apply,
    // A configuration that applies without capturing is incoherent: it would
    // write whatever happened to be buffered and then go blind. Reported so it
    // is visible rather than mysterious.
    incoherent: apply && !capture,
    legacy,
  };
}

export function pollIntervalMs(env = process.env) {
  const n = parseInt(String(env.MIRROR_POLL_INTERVAL_MS || ''), 10);
  // Floor of 30s: tighter polling buys no business value here (no GOS workflow
  // reacts to an Airtable edit faster than a human does) and only spends quota.
  return Number.isFinite(n) && n >= 30_000 ? n : 5 * 60 * 1000;
}

/**
 * Hard ceiling on source API requests per run. A bug must not be able to
 * exhaust the provider quota — this is the same discipline the migration
 * snapshot already enforces after a run once drained the company-wide
 * Pipedrive budget.
 */
export function apiCeiling(env = process.env) {
  const n = parseInt(String(env.MIRROR_MAX_API_CALLS_PER_RUN || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}
