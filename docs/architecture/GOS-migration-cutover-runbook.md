# GOS Migration — Cutover Lifecycle Runbook (v2 — owner amendments 2026-07-17)

**The official migration runbook. Architecture only.** v2 supersedes v1 with
nine binding owner corrections; the load-bearing changes: **cancelled tours are
excluded from the migration entirely**, and **Wave 1 imports only tours that
actually took place**. Grounded in the live state:

- Imported and verified: 20,454 Contacts · 2,691 Organizations · 24,358 Deals.
  Crosswalk: 48,414 LegacyRecords.
- Tours: rehearsal engine approved; importer NOT built. 4 open-slot duplicates
  pending (blanket rule approved — see §Duplicates).
- **Two legacy systems still operational**: Pipedrive (CRM intake) and Airtable
  (tour operations). Snapshot #1 (2026-07-14) drifts daily.

---

## The lifecycle

```
Stage 0 — Preparation
Stage 1 — WAVE 1: completed historical tours only
Stage 2 — Mirror Period (legacy fully operational)
Stage 3 — Freeze + FINAL SNAPSHOT + reclassification
Stage 4 — CUTOVER IMPORT (delta history + future operational tours)
Stage 5 — Cutover Switch
Stage 6 — Post-Cutover
```

The two governing laws, stated once:

> **Law 1 — Wave 1 is strictly historical.** A tour qualifies only when its
> actual date is in the past, it was not cancelled, it genuinely took place,
> and its relationships reconcile safely through the crosswalk. Future tours,
> cancelled tours, postponed tours, and anything still operationally editable
> in Airtable do NOT exist in GOS before cutover.
>
> **Law 2 — Cancelled tours never become TourEvents.** They are deliberate,
> audited exclusions (`cancelled_tour_not_migrated`) — never rows, never
> bookings, never registrations, never assignments, never payroll, never
> calendar. Evidence proves intent; absence is the design.

## Wave 1 inclusion rule (exact)

Import a TourEvent for an Airtable master tour **iff**:
`date < wave1_date` **AND** `status ≠ מבוטל` **AND** `status ≠ נדחה` **AND**
its bookings resolve through the deal crosswalk (unresolvable links degrade to
card evidence, never placeholders).

With it: its historical Bookings, historical TicketRegistrations (linked deal +
seat count), historical guide assignments (PersonRef where resolvable, external
identity otherwise), frozen payroll evidence, and legacy cards.

**Excluded from Wave 1:** the 916 cancelled (Law 2, permanent), the 123
currently-future (deferred to cutover), the 1 postponed (never took place —
reclassified at freeze; if still unresolved then, it is excluded like a
cancellation and recorded as such), and any tour completing between Snapshot #1
and the wave (it arrives in the cutover delta).

**Expected Wave 1 populations** (from the approved rehearsal's measured splits;
the Wave-1 rehearsal pins exact numbers and Hash A):
completed tours **≈ 2,468** · their bookings/registrations/assignments/payroll
are the historical subsets of 3,697 / 3,682 / 2,234 / 1,305+1,923 after
removing future-tour and cancelled-tour attachments — exact counts are a
required Wave-1 rehearsal output, reconciling to `3,508 = wave1_imported +
cancelled_excluded + postponed_excluded + deferred_future (+already_imported)`.

**Wave 1 triggers no live behavior** — by construction, not by suppression
alone: completed tours sit outside the midnight worker, capacity sweeps and
booking-driven detectors; calendar/Woo flags stay null ("never considered");
payroll lazy-ensure is blocked for crosswalk-owned tours; nothing appears as
future workload in the guide portal. History browsing only.

## Cancelled-tour audit evidence (exact)

- The import plan and `MigrationRun.counters` record the exclusion population:
  count, rule (`cancelled_tour_not_migrated`), and the plan hash they were
  excluded under.
- Snapshot #1 remains the immutable full record of every cancelled tour.
- A `LegacyRecord` row (entity null, exclusion reason in cardData) is created
  **only** where a linked record needs explaining — e.g. a payroll row attached
  to a cancelled tour imports as **legacy-only evidence** (month-level, card
  form) rather than minting a cancelled TourEvent. Nothing cancelled is ever
  exposed as a real tour.

## Stage 2 — Mirror Period

Airtable remains the operational source of truth for ALL current and future
tours. GOS serves imported history + its native operations. GOS must not hold
any Airtable-editable tour (structurally true — none were imported), must not
generate payroll for crosswalk-owned tours, must not message anyone about
imported data, and never refreshes ad-hoc — the only refresh is the freeze
snapshot. Migration ownership remains **the crosswalk itself**; no new flags.
Mirror length costs only delta size.

## Stage 3 — Freeze + Final Snapshot + reclassification (one evening)

1. Owner announces the stop; Airtable + Pipedrive writes end.
2. Legacy automations OFF (before extraction, so nothing mutates mid-snapshot).
3. **Final Snapshot** captured with the existing budget-gated machinery.
4. **All populations recalculated from the final snapshot** — the Wave-1
   rehearsal numbers are explicitly not reused.
5. **Reclassification at that exact moment**:
   - completed since Wave 1 → import as historical completed
   - future at freeze time → import as operational TourEvents
   - cancelled (including newly-cancelled) → excluded (Law 2)
   - changed bookings/participants/assignments/payroll → final source state
   - **owner decisions are never overwritten**; a legacy change touching a
     decided field is a conflict for owner review.

Delta law per domain (unchanged from v1): Replace only derived artifacts
(cards, frozen payroll evidence) · Merge mapped source columns · Ignore
legacy-only identifiers (all 77 future-tour calendar ids are measured
non-adoptable — evidence only, GOS creates its own events) · nothing is ever
deleted in GOS by a delta.

## Stage 4 — Cutover import: future tours become GOS-operational

Future-at-freeze tours import as genuine operational TourEvents, immediately
receiving: canonical Bookings, current participants/TicketRegistrations,
current guide assignments, correct capacity and operational location, current
status, **GOS-owned Google Calendar events** (marked pending at this stage
only; the sync worker creates them once, invitations fire once via
`sendUpdates=all`), and normal guide-portal visibility + reconciliation
behavior. **There is no mirror period for future tours: before cutover they
belong only to Airtable; after cutover only to GOS.**

**Templates (owner amendment):** imported future open tours are **NOT attached
to templates**. They import as manual canonical TourEvents — fully GOS-
controlled (editing, guides, registrations, capacity, calendar, Woo,
cancellation, reconciliation all work identically; template-origin is
irrelevant to operations). Only the four native GOS slots retain their real
template relationship. ⚠ Consequence the owner must resolve at cutover: the
open-tour generation worker generates from templates on its rolling horizon,
and the slot-identity unique index only guards template-linked rows — so a
template whose horizon reaches a date already covered by an imported manual
slot would mint a twin. Cutover checklist therefore includes a **generation-
collision review**: for each template × imported-manual-slot date/time
collision, the owner either trims the template occurrence or explicitly adopts
that one slot. This is a listed owner decision, never automatic.

## The four native open-tour duplicates

The approved rule is preserved: the **native GOS TourEvent survives**, the
Airtable twin is **not created**, the twin's bookings / participants /
assignments / reliable missing data are **redirected into the native slot**,
and the Airtable tour receives a **crosswalk to the native TourEvent**. These
four are **re-evaluated against the final snapshot** — their bookings may
change during the mirror, and the duplicate population itself may grow or
shrink as native slots and Airtable tours evolve; the current rehearsal payload
is explicitly not the cutover payload.

## Payroll (amended)

Wave 1 imports frozen historical payroll evidence for **completed imported
tours only** — never regenerated, never recalculated. Payroll attached to
cancelled tours → legacy-only evidence (no TourEvent, no PayrollActivity).
At cutover: the final Airtable payroll delta imports (already-paid/approved
history preserved verbatim), then **GOS is activated as the sole payroll
generator** for future operations — one recorded epoch decision, suppression
by crosswalk ends there.

## Two plans, two hashes (amended rehearsal strategy)

The current rehearsal hash (`07695d1f…`) is **void as an executable plan** —
it includes cancelled and future tours. The runbook now requires:

- **Hash A — Historical Wave**: completed, non-cancelled historical tours only,
  computed by the updated Wave-1 rehearsal ×2 (deterministic), reconciling
  exactly to the Snapshot #1 population split. Pins the Wave-1 executor.
- **Hash B — Final Cutover**: computed freeze night from the Final Snapshot —
  delta history + future-at-freeze operational tours + final bookings/
  participants/guides/payroll, cancelled excluded, the four duplicates
  re-resolved. Pins the cutover executor. Approved by the owner that evening
  against the reconciliation gates before execution.

Both plans must reconcile exactly to their respective source populations.

## Worker activation matrix (v2)

| Worker | Stages 0–2 | Stage 3 freeze | Stage 4–5 | Post-cutover |
|---|---|---|---|---|
| Google Calendar sync | native tours only; Wave-1 imports null-flagged | native | imported FUTURE tours pending → events created once | fully ON |
| Woo sync | OFF (gated) | OFF | OFF | separate controlled activation |
| Payroll | native ON; crosswalk-owned suppressed | same | same until switch | epoch recorded → fully ON |
| Notifications / WhatsApp | native flows | ON | ON | ON |
| Guide Portal | history visible (desired); zero imported future workload | same | future tours appear (desired) | ON |
| Tasks / Timeline / Questionnaires / completion worker | native; imported history untouchable (already completed) | ON | future imports in scope (desired) | ON |
| Open-tour generation | templates → native slots | ON | **generation-collision review** vs imported manual slots | ON |
| Control detectors | booking-driven; history invisible | ON | field-consistent import keeps them quiet | ON |
| Airtable automations | ON | **OFF forever** | OFF | OFF |

## Cutover switch, rollback, checklists

**The moment**: legacy goes read-only against a verified, reconciled GOS
(Stage 5 switch #2). Before it, everything is additive, batch-tagged and
reversible; Airtable/Pipedrive are untouched and resuming costs only an
announcement. **The rollback horizon is the first business write into GOS
after cutover** — beyond it, forward-correction through the Review Center
(which survives cutover) replaces rollback. Never reversible: calendar
invitations (fired once, inside the freeze) and anything customers were told.

**Before cutover — every box required:**
- [ ] 4 duplicate decisions recorded (blanket rule) — re-confirmed on Hash B
- [ ] Wave-1 rehearsal ×2 → **Hash A** approved; executor built and pinned
- [ ] Wave 1 executed + verified: reconciliation exact (imported + cancelled-
      excluded + postponed-excluded + deferred-future = 3,508-equivalent),
      side-effect tables unchanged, idempotent rerun = 0
- [ ] Zero cancelled TourEvents exist; exclusion evidence recorded
- [ ] Payroll suppression proven; cancelled-tour payroll is card evidence only
- [ ] Freeze executed; automations OFF; Final Snapshot verified (checksums)
- [ ] Populations recalculated; reclassification report reviewed
- [ ] **Hash B** approved freeze night; cutover import executed + verified
- [ ] Generation-collision review completed (template × imported-slot)
- [ ] Calendar events created once; correct guides; zero duplicates
- [ ] Legacy access read-only; team announcement; owner sign-off

**After cutover (first two weeks):** day-1 tour runs fully from GOS · payment
collects on an imported deal · first post-cutover payroll generates · weekly
reconciliation (every future tour has exactly one source; no orphan bookings;
no duplicate slots incl. template collisions) · guide-portal feedback pass ·
old shared calendar manually cleaned · Review Center retired per its deletion
boundary (LegacyRecord + MigrationDecision permanent) · remaining slices
scheduled: timeline, collection, files (gated), archive payload backfill.

---
*v2 — cancelled tours excluded by design; Wave 1 strictly historical; future
tours cross only at the freeze; two hashes, two approvals; owner decisions are
never overwritten.*
