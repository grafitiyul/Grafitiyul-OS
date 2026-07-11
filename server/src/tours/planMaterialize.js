import { isAssignableStaff } from '../people/eligibility.js';

// PURE decision logic for materializing a DealTourPlan into a real tour at the
// WON transition (DB glue lives in tourFromDeal.js — the ONE deal⇄tour
// lifecycle module). Kept DB-free so it unit-tests like wonGate/eligibility.

// Which PLANNED guides become REAL TourAssignments. A planned guide may have
// become ineligible between planning and WON (departed/blocked — the canonical
// eligibility rule re-applies at materialization time) or their PersonRef may
// be gone entirely; those are SKIPPED and reported, never silently invited.
export function splitPlanAssignments(planAssignments = []) {
  const create = [];
  const skipped = [];
  for (const a of planAssignments) {
    if (a.personRef && isAssignableStaff(a.personRef)) create.push(a);
    else skipped.push(a);
  }
  return { create, skipped };
}

// TourEventActivityComponent rows to create for the new tour, or NULL when the
// plan still FOLLOWS the variant defaults (caller seeds from the variant —
// identical to a deal that never opened the planning card). A customized plan
// is authoritative, including an intentionally-empty list ([]).
export function planComponentRows(plan, tourEventId) {
  if (!plan?.componentsCustomized) return null;
  return (plan.activityComponents || []).map((r, i) => ({
    tourEventId,
    activityComponentId: r.activityComponentId,
    workshopLocationId: r.workshopLocationId ?? null,
    sortOrder: i,
  }));
}
