// THE canonical Tour-assignment eligibility rule — every surface that can
// attach a staff member to a TourEvent (Tour modal picker, Deal → Tour
// popover, the assignment endpoint itself) resolves through here. UI
// filtering is convenience; the POST endpoint enforcement is the gate.
//
// Assignable = currently allowed to work/train:
//   * status must be 'active' (blocked people are out), AND
//   * lifecycleHint is 'trainee' or 'staff' — the two working lifecycles.
//     NULL is ALSO accepted: it marks legacy rows created before the
//     lifecycle sync existed (per schema: "upstream didn't tell us — older
//     guides"), and those are working guides in practice. Every explicit
//     non-working lifecycle ('former', 'none', 'evaluator', anything new)
//     is excluded.
//
// Historical TourAssignment rows are untouched by this rule — it gates the
// CREATION of new assignments only.

export const ASSIGNABLE_LIFECYCLES = ['trainee', 'staff'];

export function isAssignableStaff(person) {
  if (!person) return false;
  if (person.status !== 'active') return false;
  if (person.lifecycleHint == null) return true; // legacy pre-lifecycle rows
  return ASSIGNABLE_LIFECYCLES.includes(person.lifecycleHint);
}

// Prisma WHERE for listing assignable people (same rule, set form).
export const ASSIGNABLE_WHERE = {
  status: 'active',
  OR: [{ lifecycleHint: { in: ASSIGNABLE_LIFECYCLES } }, { lifecycleHint: null }],
};
