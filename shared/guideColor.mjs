// THE canonical tour guide-color rule — every compact tour surface (admin
// table, calendar when it lands, deal popover, portal cards) derives its
// accent through this ONE resolver; no per-surface variations.
//
// Rule (product decision):
//   1. exactly one RELEVANT guide (lead_guide | guide) → that guide's color
//   2. multiple relevant guides with a lead → the LEAD's color
//   3. multiple relevant guides, no lead → null (neutral/default)
//   4. workshop assistants never determine the color
//   5. a selected guide WITHOUT a color → null (predictable: no fallback to
//      another guide's color)
//
// Input: assignment-like rows [{ role, color }] where `color` is the
// person's canonical palette key (or null). Output: palette key | null.

export function resolveTourGuideColor(assignments) {
  const relevant = (assignments || []).filter(
    (a) => a && (a.role === 'lead_guide' || a.role === 'guide'),
  );
  if (relevant.length === 0) return null;
  if (relevant.length === 1) return relevant[0].color || null;
  const lead = relevant.find((a) => a.role === 'lead_guide');
  return lead ? lead.color || null : null;
}
