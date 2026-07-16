# Deals Review Module — Design (pre-implementation)

Owner directive (2026-07-16): the Migration Review Center is the owner's **final
authority** over migration decisions — the place to intentionally improve 15
years of CRM history before GOS becomes the permanent system of record. It is
not a validation screen.

## The governing principle

**A legacy foreign key never blocks a legitimate owner decision.** The system's
job is to compute the exact graph consequence of a decision, present it, and —
once approved — execute the change safely. Blocking is reserved for **GOS-side
impossibilities only** (e.g. a Contact that cannot satisfy the schema).

This principle is already live (foundation shipped with this design):

- `dealImpact.js` — the pure graph-consequence engine. `computeDealDeletionImpact`
  returns consequences and an always-empty `blocking` list.
- Queue `deals` in the registry; deal decisions stored in `MigrationDecision`
  (`deal:<id>`), auditable and reversible until the deals import.
- **The cascade**: `getDeadDealIds()` — deals deleted as historical junk protect
  nothing. The contact-deletion boundary subtracts them (fail-safe: only deals
  visible in the capped detail lists are subtracted; an unlisted deal keeps
  blocking). Proven end-to-end on Deal #7086 → vmxfhv.

## Canonical deal decisions (`decision.treatment`)

| treatment | meaning | extra payload |
|---|---|---|
| `import` | import unchanged | — |
| `import_corrected` | import with owner edits | `corrections: { contactRef?, organizationRef?, stage?, status?, values? }` — each an explicit override consumed verbatim by the importer |
| `merge` | fold into another deal | `mergeIntoDealId` + impact report |
| `exclude` | do not import; archive keeps it (still protects its contacts) | — |
| `deleted` | historical junk; protects nothing; hidden from normal archive UI | `deleted: { impact, evidence, deletedAt, deletedBy }` |

Undecided deals import unchanged (the default is the honest one: no decision →
faithful import), except where a blocking validation exists — those surface in a
mandatory section exactly like Name Cleanup's ⛔.

## Screens / flows

1. **Sections by business impact** (the proven pattern): open → future-tour →
   recent WON → historical, plus the ⛔ mandatory chip (deals whose import would
   fail: dangling contact refs, unknown stage, the 8 archived-open, the 62
   exceptional records fold in here).
2. **Decision panel per deal**: source facts (title/value/status/dates/contact/
   org/products), the five treatments, correction editors (contact picker and
   org picker reuse `TargetCombobox` + the crosswalk), and for destructive or
   graph-changing choices — the **impact report**, rendered as the consequence
   list, with one inline confirmation.
3. **Stage & status mapping**: Pipedrive pipeline/stage → GOS deal stages is a
   frozen `stage_config`-style mapping decided once, not per deal.

## Entities

- Reuses `MigrationDecision` (queue `deals`) — no schema change.
- Import consumes decisions only; crosswalk rows `LegacyRecord(pipedrive, deal,
  <id>)` → `Deal` entity, `importBatchId` per run, idempotent like identity.
- Contact/org resolution at import: `deal.person_id` → person crosswalk (already
  populated); corrected refs override; deleted persons/deals are terminal.

## Risks

- **Cascade correctness**: every guard that reads deal facts must subtract dead
  deals through ONE shared path (`getDeadDealIds` + the subtract helper) — no
  per-queue reimplementations.
- **Post-identity edits**: contacts are already imported; deal corrections must
  reference GOS entities via the crosswalk, never re-create identity.
- **Merge semantics** (deal into deal) need value/product/timeline union rules —
  specify before implementing `merge`.
- **Airtable tours** reconcile to deals in a later slice; deal decisions must not
  orphan tour links silently — the impact engine gains a tours dimension then.

## Explicitly deferred

Full proposal seeding for 24,359 deals, the tab UI, stage-mapping freeze, the
merge executor, and the deals import runner — next slices, in that order.
