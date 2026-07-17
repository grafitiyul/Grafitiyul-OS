# GOS Migration — Cutover Lifecycle Runbook

**The official migration runbook. Architecture only — no code implied beyond
what already exists.** Grounded in the live state as of 2026-07-17:

- Imported and verified: 20,454 Contacts · 2,691 Organizations · 24,358 Deals
  (hash-gated, side-effect-free, idempotent). Crosswalk: 48,414 LegacyRecords.
- Tours: rehearsal approved (hash `07695d1f…`), importer NOT built. 4 open-slot
  duplicate decisions pending in the review queue.
- **Two legacy systems are still operational**: Pipedrive (CRM intake — GOS has
  only 4 native deals) and Airtable (tour operations — 134 future tours vs 49
  native GOS tours). Snapshot #1 is dated 2026-07-14 and is already drifting.
- GOS is *partially* live: native tours, payroll for native tours, guide
  portal, calendar sync, WhatsApp, quotes/payments run in production today.

The question this document answers: **how the business safely stops being an
Airtable/Pipedrive company and becomes a GOS company** — without a day of lost
work, a duplicated tour, or a guide getting a wrong invitation.

---

## The lifecycle

```
Stage 0 — Preparation            (done / in progress)
Stage 1 — Initial Import: HISTORY ONLY        ← the next implementation step
Stage 2 — Mirror Period          (days–weeks; legacy stays operational)
Stage 3 — Freeze + Delta         (one evening)
Stage 4 — Operational Import     (future tours; same evening)
Stage 5 — Cutover Switch         (same evening; the moment of truth)
Stage 6 — Post-Cutover           (first two weeks in GOS)
```

The single most important design decision, stated once:

> **Future operational data crosses in Stage 4, inside the freeze — never
> earlier.** History (completed/cancelled tours, frozen payroll, past
> registrations) imports in Stage 1 because it cannot collide with live
> operations. Future tours, future bookings and guide-facing artifacts import
> only after Airtable stops changing. This removes the entire class of
> "two systems both think they own Thursday's tour" problems, and removes any
> need for special UI marking machinery during the mirror period.

---

## Stage 0 — Preparation *(current stage)*

**Owner:** decides the 4 open-slot duplicates (recommended blanket rule: *use
the native GOS slot; the importer redirects the Airtable twin's bookings onto
it*). Confirms this runbook.
**GOS:** tour importer gets built and tested against the approved rehearsal
hash. The payroll-suppression gate (migration-ownership = crosswalk row) is
implemented and pinned by tests.
**Airtable/Pipedrive:** fully authoritative for everything operational.
**Workers:** unchanged — everything that runs today keeps running for NATIVE
GOS entities only.

## Stage 1 — Initial Import: history only

**What imports:** the 3,381 historical tours (completed 2,468 · cancelled 916 ·
postponed 1, minus already-imported), their bookings, historical
TicketRegistrations (3,682 / 37,513 seats), guide assignments, frozen payroll
evidence (1,305 activities / 1,923 entries), legacy cards. Hash-gated against
the approved rehearsal, chunked, idempotent — the proven executor pattern.
**What does NOT import:** the 123 future scheduled tours and the 4 duplicates.
They stay in Airtable until Stage 4.
**Owner does:** approves execution; spot-checks history in GOS (past tours in
the guide portal, participant lists, payroll history views).
**Airtable owns:** every future tour, all ongoing coordination and payroll.
**Authoritative:** Airtable/Pipedrive for operations; GOS for everything
already imported (history is now GOS-truth — Airtable history becomes
reference-only from this point).
**Workers:** no change. Historical tours are `completed`/`cancelled` — outside
every sweep (midnight worker, capacity, sync). Payroll lazy-ensure is blocked
for crosswalk-owned tours. Calendar/Woo flags are null (= never considered).

## Stage 2 — Mirror Period *(the dangerous one)*

Airtable is STILL the operational system. People work there. Tours change,
participants change, guides change, payroll accrues, cancellations happen.

**GOS is allowed to:**
- serve all imported history (read/search/report);
- continue running its NATIVE operations exactly as today (native tours,
  their payroll, their calendar events, the portal);
- accept new native work if the team chooses to start some flows in GOS early
  (each such flow must be *fully* in GOS — never half-and-half for one tour).

**GOS must NOT:**
- hold any future tour that Airtable also holds (structurally impossible —
  they weren't imported);
- generate payroll for any crosswalk-owned tour;
- send anything to guides/customers about imported data;
- create calendar events for imported data;
- re-import or "refresh" from Airtable ad-hoc — the only refresh is the
  Stage 3 delta.

**How imported entities are marked:** migration ownership **is the crosswalk**
(`LegacyRecord` row → the entity). No new flags, no UI paint: every suppression
gate (payroll, and any future one) queries the same single fact. Because no
operational future data exists in GOS during the mirror, there is nothing a
user could accidentally treat as production — the confusion class is designed
out rather than warned about.

**Duration:** as short as the owner wants. Every mirror day increases the
Stage 3 delta, nothing else.

## Stage 3 — Freeze + Delta *(one announced evening)*

**Freeze:** the owner announces the stop; Airtable and Pipedrive editing ends
(remove edit grants where possible; the announcement is the real control).
Airtable automations (calendar event creation, WhatsApp reminders, forms) are
switched OFF now — before the delta, so nothing mutates mid-extraction.

**Delta = Snapshot #2**, using the existing extraction machinery
(budget-gated: `MIGRATION_EXTRACTION_ENABLED`, request ceiling, the
post-incident rules). Scope is *changed-since-2026-07-14* — thousands of
records, not hundreds of thousands. Then the delta planners run with these
per-domain rules:

| Domain | New in legacy | Changed in legacy | Deleted in legacy | Owner-decided in GOS |
|---|---|---|---|---|
| Deals | **Create** (same planner; new ids > 26311) | **Merge**: refresh mapped columns (status, wonAt, value, stage…) | **Report** — never delete in GOS | **Never overwritten** — a decision (correction/exclude/deleted) always wins; a legacy change to a decided field → **Conflict → owner review** |
| Contacts/Orgs | Create (through the same decision engines; new duplicates → review) | Merge identity fields *unless* an identity correction exists → correction wins | Report | Never overwritten |
| Tours (history that changed) | Create | Merge (a tour completed/cancelled during the mirror updates its status) | Report | Duplicate decisions preserved |
| Bookings/Participants | Create/Merge seats | Merge | Report | — |
| Guides (assignments) | Merge per tour | Merge | Report | — |
| Payroll | **Create/Replace rows wholesale** — frozen evidence has no GOS-side edits to protect, so the delta simply re-freezes the final Airtable truth | same | Report | n/a |
| Calendar references | **Ignore** — measured 0/77 adoptable; legacy ids are card evidence only, refreshed with the card | | | |
| Legacy cards | **Replace** — cards are derived views of source data, never edited in GOS | | | |

General law: **Replace** applies only to derived artifacts (cards, frozen
payroll evidence). **Merge** applies to mapped source columns. **Ignore**
applies to legacy-only identifiers. **Conflict → owner review** applies the
moment a legacy change touches anything an owner decision governs. Nothing is
ever deleted in GOS by a delta.

## Stage 4 — Operational Import *(same evening)*

The 123 future tours import as fully operational TourEvents, plus the 4
duplicate resolutions (bookings redirected onto native slots), future
bookings/registrations, and guide assignments.

Two mechanical requirements from the approved policies:
1. **Template adoption for future open slots**: imported open slots get their
   `openTourTemplateId` (+ canonical date/time) stamped at import, so the
   generation worker recognizes them and the partial-unique slot index prevents
   twin generation. This is what makes "origin becomes irrelevant" true.
2. **Calendar**: imported future tours are marked `gcalSyncStatus='pending'` —
   deliberately, at this stage only — so the sync worker creates GOS-owned
   events (invitations go out via `sendUpdates=all`, which is now *desired*:
   guides receive the canonical invites exactly once, from the system that
   owns them from now on). The old Airtable-created events live on a different
   calendar; they are cleaned up manually there (outside GOS) after cutover.

## Stage 5 — Cutover Switch

**Preconditions (must already be true):** delta verified and reconciled; Stage
4 import verified; the success checklist below fully green.

**The switches, in order:**
1. Payroll generation for migration-owned tours: **enabled** (one recorded
   decision — a stage_config-style row, not an env toggle — "payroll epoch
   begins now"). From here lazy-ensure treats imported future tours like any
   native tour.
2. Airtable/Pipedrive: **read-only, permanently** (reference access retained).
3. The team's operational home becomes GOS — announced as such.
4. Woo sync stays under its existing gate (`WOO_SYNC_ENABLED`) — enabling it is
   its own controlled activation, not part of cutover night.

**The moment GOS becomes the Single Source of Truth** is switch #2: the instant
legacy editing ends with a verified, reconciled GOS holding both history and
future. Everything before it is reversible; everything after it accumulates
GOS-only work.

**How we know it succeeded:** the post-cutover checklist queries below, plus
three business proofs on day one — a real tour runs from GOS end-to-end
(portal, attendance, summary), a real payment collects against an imported
deal, and payroll generates for a post-cutover tour.

## Worker activation matrix

| Worker | Today (Stage 0–2) | Stage 3 (freeze) | Stage 4–5 | Post-cutover |
|---|---|---|---|---|
| Google Calendar sync | ON for native tours only (imported = null flag) | ON (native) | imported future tours marked pending → events created | fully ON, all tours |
| Woo sync | OFF (gated) | OFF | OFF | separate controlled activation |
| Payroll (lazy-ensure + hooks) | ON for native; **suppressed for crosswalk-owned** | same | same | **fully ON** (epoch decision recorded) |
| Notifications / WhatsApp worker | ON for native flows | ON | ON | ON |
| Guide Portal | ON — imported history visible (desired); no imported future exists | ON | imported future tours appear (desired) | ON |
| Task generation | native only | ON | ON | ON |
| Timeline | native events; imported history arrives in the timeline slice | ON | ON | ON |
| Questionnaires / completion (IL-midnight) | ON — cannot touch imported history (imported as completed) | ON | ON — future imported tours now in scope (desired) | ON |
| Open-tour generation worker | ON for templates (native slots) | ON | imported slots template-adopted → no twins | ON |
| Control detectors | ON — booking-driven, so imported history invisible | ON | field-consistent import keeps deal_tour_out_of_sync quiet | ON |
| Airtable automations (legacy side) | ON | **OFF forever** (before the delta) | OFF | OFF |

## Rollback

**Reversible at any point before Stage 5 switch #2:** every import is additive
and batch-tagged (`importBatchId`); an aborted stage is corrected forward or,
at worst, a batch's rows are identifiable for surgical removal. Airtable and
Pipedrive are untouched throughout — resuming work there costs nothing but the
announcement.

**The rollback horizon is the first business write into GOS after cutover.**
From that moment, reverting to Airtable means losing real work, and rollback
stops being a tool. The design compensates with **forward-correction**: the
Review Center decision model, the crosswalk, and the impact engine all survive
cutover precisely so that any discovered import defect is fixed *in GOS, with
an audit trail* — never by going back.

**Never reversible:** calendar invitations sent at Stage 4 (Google emails
cannot be unsent — which is why they fire only inside the freeze, once), and
anything customers were told.

## Success checklist

**Before cutover (all required):**
- [ ] The 4 duplicate decisions recorded
- [ ] Tour importer built; rehearsal hash matches the approved `07695d1f…`
      (re-pinned after the delta — the delta changes the hash by definition,
      so the freeze-night rehearsal produces the FINAL hash the executor pins)
- [ ] Stage 1 history import executed + verified (reconciliation exact,
      side-effect tables unchanged, idempotent rerun = 0)
- [ ] Payroll suppression proven (no PayrollActivity exists for any
      crosswalk-owned tour)
- [ ] Delta Snapshot #2 extracted within budget, verified (checksums), planners
      reconciled; conflicts (owner-decided fields changed in legacy) resolved
- [ ] Stage 4 operational import verified: 123 future tours + 4 resolutions;
      template adoption confirmed (no generatable twin possible)
- [ ] Calendar events created once, correct guides invited, zero duplicates
- [ ] Airtable automations OFF; legacy access flipped to read-only
- [ ] Team announcement made; owner sign-off recorded

**After cutover (first two weeks):**
- [ ] Day 1: a tour runs fully from GOS (portal → attendance → summary)
- [ ] Day 1: payment collected against an imported deal
- [ ] First post-cutover tour generates payroll normally
- [ ] Weekly reconciliation query: every future tour in GOS has exactly one
      source (native or crosswalked), no orphan bookings, no duplicate slots
- [ ] Guide feedback pass: portal shows correct history + future
- [ ] Old shared calendar cleaned manually (legacy events removed)
- [ ] Migration Review Center retired per its deletion boundary; LegacyRecord
      and MigrationDecision remain permanently (the archive and the audit)
- [ ] Remaining slices scheduled: timeline (notes/activities/files-metadata),
      collection, files bodies (still gated on the classification report),
      archive payload backfill

---

*With every checkbox green, the migration is complete: GOS is the operating
system of the business, and 15 years of history are inside it — every record
imported, deliberately excluded, or owner-deleted, with the decision trail to
prove it.*
