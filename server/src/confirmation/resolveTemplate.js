// Confirmation Email — template resolution. Pure, no DB (the pricing-engine
// pattern, src/pricing/engine.js).
//
// EXACTLY ONE template must resolve per deal:
//   1. Candidates = active templates whose every NON-EMPTY scope list contains
//      the deal's value. Empty list = wildcard. Scopes: productIds /
//      activityTypes / orgTypeIds.
//   2. Most specific wins (count of constrained dimensions), then `priority`.
//   3. A tie at the top REFUSES with `ambiguous_confirmation_template` —
//      never silently choose between equally specific templates (approved
//      decision D4).
//   4. Nothing matches → `no_confirmation_template`. The API guarantees an
//      all-wildcard default template exists, which matches everything, so this
//      only fires on an unconfigured system.
//
// findTemplateConflicts() is the PREVENTIVE settings-side check: it flags
// template pairs that would tie for at least one possible deal, so overlaps
// are caught at save time — before an operator ever reaches send.

import { effectiveOrgTypeId } from '../deals/classification.js';
import { effectiveActivityType } from '../../../shared/dealActivity.mjs';

export const CONFIRMATION_ACTIVITY_TYPES = ['group', 'private', 'business'];

export class ConfirmationTemplateError extends Error {
  constructor(code, meta = {}) {
    super(code);
    this.code = code;
    this.meta = meta;
  }
}

// Scope dimension ↔ deal-context key. Adding a future dimension = one row here
// (+ the schema column + the ctx derivation below).
const SCOPES = [
  { field: 'productIds', ctxKey: 'productId' },
  { field: 'activityTypes', ctxKey: 'activityType' },
  { field: 'orgTypeIds', ctxKey: 'orgTypeId' },
];

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/** How many dimensions this template constrains (0 = all-wildcard/default). */
export function templateSpecificity(t) {
  return SCOPES.reduce((n, s) => n + (list(t?.[s.field]).length ? 1 : 0), 0);
}

/** Every non-empty scope list must contain the deal's value; empty = wildcard. */
export function templateMatches(t, ctx = {}) {
  return SCOPES.every((s) => {
    const scope = list(t?.[s.field]);
    if (!scope.length) return true;
    const v = ctx[s.ctxKey];
    return v != null && scope.includes(v);
  });
}

// Deal → matching context.
//
// activityType comes from THE shared resolver (shared/dealActivity.mjs): an
// explicit activity type is authoritative, and a linked organization answers
// only for a deal that has none. This used to read the org link as an OVERRIDE,
// which sent the BUSINESS confirmation email — wrong date wording, wrong
// framing — to a company that had deliberately booked a private tour.
//
// orgTypeId still comes from the organization, unchanged: the ORGANIZATION TYPE
// half of the classification SSOT (src/deals/classification.js) was always
// correct and is untouched. Language, guide and org-subtype deliberately play
// no part here.
export function confirmationCtxFromDeal(deal) {
  return {
    productId: deal?.productId || null,
    activityType: effectiveActivityType(deal),
    orgTypeId: effectiveOrgTypeId(deal),
  };
}

/**
 * Resolve THE template for a deal context. Throws ConfirmationTemplateError
 * (`no_confirmation_template` | `ambiguous_confirmation_template` with the
 * tied template ids in meta) — callers surface the Hebrew operator message.
 */
export function selectConfirmationTemplate(templates, ctx) {
  const candidates = (templates || []).filter(
    (t) => t && t.active !== false && templateMatches(t, ctx),
  );
  if (!candidates.length) throw new ConfirmationTemplateError('no_confirmation_template');

  const ranked = candidates
    .map((t) => ({ t, spec: templateSpecificity(t), prio: Number(t.priority) || 0 }))
    .sort((a, b) => b.spec - a.spec || b.prio - a.prio);

  const top = ranked[0];
  const tied = ranked.filter((r) => r.spec === top.spec && r.prio === top.prio);
  if (tied.length > 1) {
    throw new ConfirmationTemplateError('ambiguous_confirmation_template', {
      templateIds: tied.map((r) => r.t.id),
      specificity: top.spec,
      priority: top.prio,
    });
  }
  return { template: top.t, specificity: top.spec, candidateCount: candidates.length };
}

// Two scope lists can serve the same deal when either side is a wildcard or
// they share a value — per dimension; a pair overlaps only if EVERY dimension
// intersects (otherwise no single deal matches both).
function scopesIntersect(a, b) {
  return SCOPES.every((s) => {
    const la = list(a?.[s.field]);
    const lb = list(b?.[s.field]);
    if (!la.length || !lb.length) return true;
    return la.some((v) => lb.includes(v));
  });
}

/**
 * Preventive settings validation: pairs of ACTIVE templates that would tie
 * (equal specificity AND equal priority AND overlapping scopes) for at least
 * one possible deal — i.e. exactly the pairs selectConfirmationTemplate would
 * refuse. Returns [] when the configuration is safe.
 */
export function findTemplateConflicts(templates) {
  const act = (templates || []).filter((t) => t && t.active !== false);
  const out = [];
  for (let i = 0; i < act.length; i += 1) {
    for (let j = i + 1; j < act.length; j += 1) {
      const a = act[i];
      const b = act[j];
      const spec = templateSpecificity(a);
      if (spec !== templateSpecificity(b)) continue;
      if ((Number(a.priority) || 0) !== (Number(b.priority) || 0)) continue;
      if (!scopesIntersect(a, b)) continue;
      out.push({ aId: a.id, bId: b.id, specificity: spec, priority: Number(a.priority) || 0 });
    }
  }
  return out;
}

/**
 * Per-template shape errors for saves: the default template must stay
 * all-wildcard (it is the guaranteed fallback), activity values must be known.
 */
export function templateShapeErrors(t) {
  const errs = [];
  if (t?.isDefault && templateSpecificity(t) > 0) errs.push('default_must_be_wildcard');
  if (list(t?.activityTypes).some((v) => !CONFIRMATION_ACTIVITY_TYPES.includes(v))) {
    errs.push('invalid_activity_type');
  }
  return errs;
}
