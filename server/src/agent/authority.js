// THE authority resolver — the one place that answers "what may the agent do
// about THIS situation, right now".
//
// Two concepts kept deliberately apart (§9 of the spec):
//
//   CONFIDENCE — how sure the model is. Comes from the model. Advisory only.
//   AUTHORITY  — what the operator granted. Comes from configuration + code.
//
// A model can be extremely confident and still have no permission. Confidence
// never raises authority here; it can only LOWER the outcome (a weak-confidence
// answer escalates even in an auto-capable category).
//
// Resolution order, strongest constraint first:
//   1. the analysis kill switch (AgentSettings.enabled)
//   2. the capability's CODE ceiling (registry maxMode) — unbeatable
//   3. the operator's stored mode
//   4. operator conditions (amount caps, deal-state gates)
//   5. confidence floor
// Anything that fails 3–5 degrades to an escalation with a stated reason, never
// to a silent no-op.

import { capabilityDef, clampMode, MODE_RANK } from './capabilities/registry.js';

/** Minimum model confidence required before a mode above `shadow` applies. */
const CONFIDENCE_RANK = { weak: 0, moderate: 1, strong: 2 };
const AUTO_MIN_CONFIDENCE = 'strong';
const APPROVAL_MIN_CONFIDENCE = 'weak'; // approval always shows — a human decides

export const DEGRADE_REASONS = Object.freeze({
  agent_disabled: 'הסוכן כבוי בהגדרות',
  unknown_capability: 'הסוכן לא זיהה קטגוריה מוכרת למצב הזה',
  capability_disabled: 'הקטגוריה הזו מוגדרת ככבויה',
  low_confidence: 'רמת הוודאות של הסוכן נמוכה מכדי לפעול לבד',
  missing_canonical_data: 'חסר נתון קנוני שנדרש כדי לענות (מחיר/זמינות/תשלום)',
  condition_amount: 'הסכום בעסקה חורג מהתקרה שהוגדרה לקטגוריה',
  condition_deal_status: 'מצב הדיל לא נכלל בתנאים שהוגדרו לקטגוריה',
  guard_blocked: 'בדיקת בטיחות אוטומטית חסמה את התשובה',
});

/**
 * Resolve the EFFECTIVE mode for one classified situation.
 *
 * @param {object} p
 *   enabled        AgentSettings.enabled
 *   capabilityKey  what the classifier decided
 *   storedModes    Map<key, {mode, conditions}> from AgentCapabilityState
 *   confidence     'weak' | 'moderate' | 'strong'
 *   contextPack    the bounded context (for canonical-data + condition checks)
 * @returns {{ mode: string, degraded: boolean, reason: string|null, configuredMode: string }}
 */
export function resolveAuthority({
  enabled,
  capabilityKey,
  storedModes,
  confidence = 'weak',
  contextPack = null,
}) {
  const def = capabilityDef(capabilityKey);
  if (!def) {
    return { mode: 'disabled', configuredMode: 'disabled', degraded: true, reason: 'unknown_capability' };
  }

  // The operator's choice, clamped by the code ceiling. clampMode is what makes
  // "refund can never be automatic" an invariant rather than a hope.
  const stored = storedModes?.get?.(capabilityKey) || null;
  const configuredMode = clampMode(capabilityKey, stored?.mode || def.defaultMode) || def.defaultMode;

  if (!enabled) {
    return { mode: 'disabled', configuredMode, degraded: true, reason: 'agent_disabled' };
  }
  if (configuredMode === 'disabled') {
    return { mode: 'disabled', configuredMode, degraded: true, reason: 'capability_disabled' };
  }

  // Canonical data the capability declares it cannot answer without. Missing →
  // the agent may still THINK (shadow), but never act.
  const missing = (def.needsCanonicalData || []).filter((k) => !hasCanonical(contextPack, k));
  if (missing.length && MODE_RANK[configuredMode] > MODE_RANK.shadow) {
    return { mode: 'shadow', configuredMode, degraded: true, reason: 'missing_canonical_data' };
  }

  // Operator conditions.
  const cond = stored?.conditions || null;
  if (cond && MODE_RANK[configuredMode] > MODE_RANK.shadow) {
    const failure = checkConditions(cond, contextPack);
    if (failure) return { mode: 'shadow', configuredMode, degraded: true, reason: failure };
  }

  // Confidence floor. Never raises authority — only lowers the outcome.
  const rank = CONFIDENCE_RANK[confidence] ?? 0;
  if (configuredMode === 'auto' && rank < CONFIDENCE_RANK[AUTO_MIN_CONFIDENCE]) {
    return { mode: 'approval', configuredMode, degraded: true, reason: 'low_confidence' };
  }
  if (configuredMode === 'approval' && rank < CONFIDENCE_RANK[APPROVAL_MIN_CONFIDENCE]) {
    return { mode: 'shadow', configuredMode, degraded: true, reason: 'low_confidence' };
  }

  return { mode: configuredMode, configuredMode, degraded: false, reason: null };
}

// Whether the context pack actually carries the canonical fact a capability
// needs. Deliberately strict: an absent/unknown value is "missing", never "0".
function hasCanonical(pack, kind) {
  if (!pack) return false;
  if (kind === 'pricing') return !!pack.pricing?.hasQuote || !!pack.pricing?.totalText;
  if (kind === 'payment') return !!pack.payment && pack.payment.state !== 'unknown';
  if (kind === 'availability') return !!pack.tour?.date || !!pack.availability?.known;
  return false;
}

function checkConditions(cond, pack) {
  if (cond.maxAmountMinor != null) {
    const amount = pack?.pricing?.totalMinor;
    if (amount == null || amount > cond.maxAmountMinor) return 'condition_amount';
  }
  if (Array.isArray(cond.dealStatuses) && cond.dealStatuses.length) {
    const status = pack?.deal?.status;
    if (!status || !cond.dealStatuses.includes(status)) return 'condition_deal_status';
  }
  return null;
}

/** True when the effective mode may surface anything to an operator at all. */
export function offersToOperator(mode) {
  return mode === 'approval' || mode === 'auto';
}

/**
 * V1 SAFETY INVARIANT.
 *
 * There is exactly one place in this codebase that decides whether an agent
 * message may leave without a human, and it is this function. It returns false
 * unconditionally: `auto` is fully modelled end-to-end (storage, resolution,
 * UI, audit) so granting it later is a configuration change rather than a
 * rebuild — but no code path can act on it in V1.
 *
 * Flipping this is a deliberate, reviewed decision that must come with: an
 * agreed Shadow-data threshold per capability, a rate limit, and an audited
 * kill switch. It is guarded by agent/noAutoSend.test.js.
 */
export function autoSendPermitted() {
  return false;
}
