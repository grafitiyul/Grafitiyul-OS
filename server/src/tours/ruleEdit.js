// Pure reconciliation planner for a weekly-rule EDIT. Given the NEW rule shape
// and the rule's already-materialized FUTURE slots, it computes what should be
// created / retimed / cancelled to bring reality in line with the new pattern —
// classifying each affected occurrence so the caller can protect registered and
// manually-overridden slots. No IO, so the rules below are unit-tested directly.
//
// Invariants encoded here:
//   * the PAST is never in scope (caller only passes future slots; we also guard
//     on `today`);
//   * a slot that still matches the new pattern but at a different time → retime;
//   * a slot that no longer matches (weekday/validity changed) → cancel (orphan);
//   * seats>0 (active/held registrations) → flagged requiresConfirmation, never
//     silently moved/cancelled;
//   * pinned (manual override) → flagged preserved, skipped unless overwrite;
//   * creation is idempotent by (rule,date): we only propose dates not already
//     materialized, so no duplicate TourEvents.

import { addDays, weekdayOf } from './slotGeneration.js';

export function planRuleReconcile({
  newRule,
  slots = [],
  today,
  target,
  cancelDates = new Set(),
  timeOverrides = new Map(),
}) {
  const inValidity = (d) =>
    d >= today &&
    (!newRule.validFrom || d >= newRule.validFrom) &&
    (!newRule.validUntil || d <= newRule.validUntil);
  const matchesNew = (d) => weekdayOf(d) === newRule.weekday && inValidity(d) && !cancelDates.has(d);
  const effectiveTime = (d) => timeOverrides.get(d) || newRule.startTime;

  const retime = [];
  const cancel = [];
  const existingDates = new Set(slots.map((s) => s.date));

  for (const s of slots) {
    const base = { id: s.id, date: s.date, seats: s.seats || 0, pinned: Boolean(s.pinned) };
    if (matchesNew(s.date)) {
      const toTime = effectiveTime(s.date);
      if (s.startTime !== toTime) retime.push({ ...base, fromTime: s.startTime, toTime });
    } else {
      cancel.push({ ...base, fromTime: s.startTime });
    }
  }

  // New-pattern dates not yet materialized → create (idempotent by rule,date).
  const create = [];
  if (target >= today) {
    for (let d = today; d <= target; d = addDays(d, 1)) {
      if (!matchesNew(d) || existingDates.has(d)) continue;
      create.push({ date: d, startTime: effectiveTime(d) });
    }
  }

  return { create, retime, cancel };
}

// Split a plan into an impact summary + the actions that are safe to apply now.
// `overwritePinned` and `confirmRegistered` gate the protected classes.
export function classifyRulePlan(plan, { overwritePinned = false, confirmRegistered = false } = {}) {
  const affected = [...plan.retime, ...plan.cancel];
  const requiresConfirmation = affected.filter((a) => a.seats > 0);
  const preserved = affected.filter((a) => a.pinned && !overwritePinned);
  const preservedIds = new Set(preserved.map((a) => a.id));

  const canApply = (a) => {
    if (a.pinned && !overwritePinned) return false; // manual override preserved
    if (a.seats > 0 && !confirmRegistered) return false; // needs explicit confirm
    return true;
  };

  return {
    summary: {
      willCreate: plan.create.length,
      willUpdate: plan.retime.length,
      willCancel: plan.cancel.length,
      requiresConfirmation, // occurrences with registrations
      preserved, // pinned/manual occurrences skipped
    },
    apply: {
      create: plan.create,
      retime: plan.retime.filter(canApply),
      cancel: plan.cancel.filter(canApply),
      // Registered occurrences we DID move/cancel (with confirm) — the caller
      // emits a canonical impact record for each so the office can notify.
      impacted: [...plan.retime, ...plan.cancel].filter((a) => a.seats > 0 && canApply(a) && !preservedIds.has(a.id)),
      // Occurrences we could NOT safely reconcile (pinned, or registered w/o
      // confirm) — surfaced so nothing is silently skipped.
      blocked: affected.filter((a) => !canApply(a)),
    },
  };
}
