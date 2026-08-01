// Mirror ↔ Operations Control registration.
//
// ── RETIRED 2026-08-01 ───────────────────────────────────────────────────────
// Both issue families this module used to register are obsolete:
//
//   legacy_sync_conflict          "a field changed in BOTH Pipedrive and GOS —
//                                  decide which value is right"
//   legacy_tour_product_unmatched "an imported tour's activity name matches no
//                                  CRM product"
//
// They belonged to the mirror period, when Airtable/Pipedrive still held
// operational authority and a two-way conflict was a real question. Since the
// legacy cutover (2026-07-31) GOS is the single source of truth and Pipedrive is
// create-only lead ingress, so "which system is right?" has one permanent
// answer: GOS. The mirror no longer runs, which means these issues could never
// auto-resolve either — they would sit open forever, and a dashboard nobody
// trusts is worse than one with fewer rows.
//
// The function is KEPT (rather than deleted along with its call site) so the
// retirement is visible where the registration used to be, instead of becoming
// an unexplained absence. The two rows that were open in production on
// 2026-08-01 are closed by the accompanying migration.
//
// Break-glass: if LEGACY_MIRROR_MODE=full_mirror is ever used again, conflict
// detection must be re-registered here alongside it.

export function registerMirrorIssueTypes() {
  // Intentionally empty — see the retirement note above.
}
