# GOS — Legacy Data Migration Preparation Plan (Pipedrive + Airtable)

**Status:** Governing preparation document. No migration code, no external-system audit performed,
no schema assumptions about Pipedrive/Airtable. Written before any API access is requested.
**Role:** Migration Architect preparation output — the contract for how the migration project runs.
**Builds on:** `GOS-source-of-truth-register.md` (concept → owner mapping, sync-direction rules),
`GOS-legacy-reconciliation-plan.md` + `GOS-phase-AB-migration-design.md` (this repo's proven
additive/mirror/flip discipline).
**Last updated:** 2026-07-14

---

## 0) What this migration is — and is not

GOS is already the operational source of truth. Pipedrive and Airtable are being **retired**, not
recreated. The migration moves ~15 years of business knowledge into the **existing canonical GOS
model** — it does not add a parallel model shaped like the legacy systems.

Two different goals, deliberately separated:

- **Goal A — Go Live:** everything daily operations need (active deals, open leads, future tours,
  future registrations, pending tasks, active organizations). Must be **structured** in the
  canonical model, correct, and verified.
- **Goal B — Historical archive:** ~15 years of context. Valuable, but not needed tomorrow
  morning. May be **archived** (attached raw) rather than structurally modeled.

Absolute rules (restated as the project contract):

1. GOS remains the only source of truth; single-writer invariant per the register.
2. No duplicate business logic; no recreated obsolete structures.
3. Prefer structural simplification over compatibility.
4. Every step idempotent. Every step verifiable. Every step reversible until final cutover.
5. Unknown/ambiguous data is **never silently discarded** — it lands in the Legacy Archive.

---

## 1) Overall migration strategy

### 1.1 Snapshot-first (the single most important decision)

We never migrate "from the live API into GOS" in one motion. The pipeline is:

```
Pipedrive / Airtable  →  RAW SNAPSHOT (immutable, complete, local)  →  AUDIT  →  MAPPING SPEC
                                                                     →  TRANSFORM  →  LOAD into GOS
```

- **Extraction** pulls *everything* (all entities, all fields, all metadata, schema definitions,
  users, pipelines/stages, files) into an immutable raw landing zone, exactly as the API returns
  it (raw JSON), stamped with `sourceSystem`, `sourceType`, `sourceId`, `snapshotAt`.
- All auditing, mapping, transformation, verification, and re-runs work **from the snapshot**,
  never from the live APIs. Benefits: reproducible, idempotent, immune to rate limits and to
  legacy-side edits mid-analysis, diffable across snapshots, and it doubles as an insurance
  backup before decommission.
- Multiple snapshots over time are expected (early audit snapshot → pre-cutover final snapshot →
  post-freeze delta). Each is a distinct, labeled batch.

### 1.2 Crosswalk keys (idempotency + reversibility + verification)

Every GOS row created or touched by migration carries a **legacy reference**:
(`sourceSystem`, `sourceType`, `sourceId`, `importBatchId`). This one mechanism buys:

- **Idempotency** — loads are upserts keyed on the legacy reference; re-running is safe.
- **Reversibility** — until cutover, any import batch can be rolled back by batch id
  (delete rows created by the batch; restore fields overwritten by it from the snapshot).
- **Verification** — counts and field checksums reconcile snapshot ↔ GOS per entity type.
- **Traceability** — from any migrated GOS record, one click back to the raw legacy payload.

This follows the existing GOS precedent (`PersonRef.externalPersonId`,
`TeamMember.recruitmentExternalId` pattern, `WooProductMapping`) — it is not a new invention.

### 1.3 Legacy Archive (the "don't model everything" mechanism)

A single generic store (working name **`LegacyRecord`** — exact schema designed later, not now):
raw JSON payload + source identifiers + optional link (`entityType`, `entityId`) to the GOS entity
it was migrated into. It serves three duties with one structure:

1. **Landing zone** for raw snapshots.
2. **Archive attachment** — a migrated Deal/Contact/Org can show "legacy data" (read-only raw
   view) without those fields polluting the canonical model.
3. **Unmapped-data guarantee** — every source record either maps into GOS **or** remains fully
   retrievable here. Nothing is silently dropped, ever; "drop" decisions only mean *not
   structurally modeled*, the raw stays.

### 1.4 Per-field disposition: map / merge / archive / drop

For every legacy entity, the audit produces a **field census** (which fields exist, how often
populated, sample values), and the mapping spec assigns each field exactly one disposition:

- **map** — has a canonical GOS home; transformed and loaded.
- **merge** — combined with data from the other system or with existing GOS rows
  (identity resolution; see 1.5).
- **archive** — kept only in `LegacyRecord`, visible as legacy context, not modeled.
- **drop** — not modeled and not surfaced (but raw snapshot still retains it — "drop" is a UI/
  modeling decision, never a data-destruction decision before decommission).

Dispositions are proposed by the architect with evidence (populated %, last-used date, sample
values) and **approved by the product owner** before any load runs.

### 1.5 Identity resolution is the hardest problem — treat it as its own phase

GOS already has **live** Organizations, Contacts, and Deals created since GOS went operational
(WhatsApp mirror, deal flow, iCount, group registrations). Imported legacy contacts/orgs WILL
collide with them. Rules:

- Match keys: normalized phone (E.164), normalized email, org registration number if present,
  then fuzzy name — in that priority order.
- **Auto-merge only on exact strong-key match** (same normalized phone or email). Everything
  fuzzy goes to a human review queue — the product owner (or delegate) decides merge vs create.
- Existing GOS rows always win on conflict (GOS is the writer); legacy values that differ go to
  the archive attachment, never overwrite live data.
- A contact who is also a guide stays a `Contact` + separate staff identity (register rule) —
  never unified.

### 1.6 Goal A vs Goal B as separate phases — confirmed, with one shared spine

The two-goal split is correct, with one architectural refinement: **identity (Organizations +
Contacts) is migrated once, up front, as a shared spine serving both goals.** Reasons: Goal A
deals and Goal B history both hang off the same customers; deduplicating identity twice would be
double work and double risk; and identity is where merge decisions live.

So the shape is: **Spine (identity) → Goal A (operational go-live) → cutover → Goal B (historical
backfill at leisure, after legacy systems are already read-only).** Goal B running *after* cutover
is deliberate: it removes all time pressure from the historical work and shrinks the
freeze/drift window for Goal A to days, not weeks.

### 1.7 Drift control & the rehearsal→delta→cutover model (UPDATED after M1)

Pipedrive and Airtable **remain the active working systems until the formal cutover**. Therefore
any early import is a **rehearsal/dry run**, never the final operational import. The cutover is
built as six explicit steps:

1. **Initial immutable snapshot + rehearsal import** — Snapshot #1 → dry-run load into GOS
   (idempotent, crosswalk-keyed, fully reversible). Proves the pipeline end-to-end; discards or
   keeps the result as a rehearsal only.
2. **Continued operation** — the business keeps working in Pipedrive + Airtable. GOS is not yet
   the operational system.
3. **Final delta extraction** — at cutover time, extract everything **created or changed since
   Snapshot #1**, plus a deletion sweep (below).
4. **Final reconciliation** — counts/sums/spot-checks snapshot+delta ↔ GOS; go/no-go.
5. **Cutover** — legacy → read-only; Make scenarios retired/re-pointed.
6. **Switch operational work to GOS.**

**Reliable change-detection fields (verified in M1):**
- **Pipedrive:** every deal/person/organization carries `update_time` and `add_time`
  (timestamped). Delta = records with `update_time > snapshot1.startedAt`. A whole-account delta
  can also use `GET /recents?since_timestamp=…` (all changed items across types). **Deletion
  detection:** deleted deals leave the `all_not_deleted` set and appear under `status=deleted`
  for ~30 days (verified: 9 currently) — so a delta run within the freeze window catches
  deletions; deletions older than ~30 days are unrecoverable, which is fine (snapshot #1 already
  captured them).
- **Airtable:** there is **no reliable table-wide updated-at** unless a `Last Modified Time`
  (all-fields) field exists — only scattered field-specific `lastModifiedTime` columns exist
  today (e.g. on `משתתפים`). Two options, decided in M3: (a) add an all-fields `Last Modified
  Time` field to the operational tables (`סיורים`, `משתתפים`) before the delta window, or
  (b) — cheaper and recommended given the small operational set (**94 future tours**) —
  **re-snapshot the operational tables and diff by record id**; deletions = record ids present in
  Snapshot #1 but absent in the delta snapshot. Airtable has no API deletion log, so id-diff is
  the deletion-detection mechanism.

**Make.com:** every scenario touching Pipedrive/Airtable must be inventoried **before** Goal A and
explicitly retired/re-pointed at cutover — an automation still writing to a legacy system after
cutover would silently fork the truth.

### 1.8 "Operationally active" — measured definition (from M1; see M1 deep-audit §2)

Goal A's scope is **not** `status=open` alone. Verified candidate signals over all 4,908 deals:
open (70), won-with-future-tour (82), any-future-tour (107), future next-activity (28), has-open-
activity (612), plus wider signals lost-recent-90d (503) / modified-30d (387).

**Recommended measurable definition (Tier 2 = 699 deals):**
`open ∪ (won & future tour) ∪ any future tour ∪ future next-activity ∪ has-open-activity`.
Tier 1 (~150–180, tightest live-scheduling set) and Tier 3 (~1,200–1,400, adds recent/lost) are
the alternatives. **Owner selects the tier before the Goal A load** — not implemented until
approved. Cross-checked against Airtable: 94 future tours, 100% linked to a Pipedrive deal id.

---

## 2) Recommended migration phases

| Phase | Name | Goal | Output |
|---|---|---|---|
| **M0** | Preparation & governance | This document; answers to open questions (§10); access provisioning (§4–6) | Signed-off scope + access |
| **M1** | Full raw extraction | Snapshot both systems completely (data + schema metadata + users + files inventory) into the landing zone | Immutable Snapshot #1 |
| **M2** | Audit & inventory | From the snapshot only: entity/field census, record counts, populated %, pipelines/stages/tables map, cross-system linkage discovery, data-quality report | Audit report |
| **M3** | Mapping specification | Per entity + per field: map/merge/archive/drop, with target GOS models and transforms; identity-resolution rules; edge-case catalog | Mapping spec — **product-owner approved** |
| **M4** | Identity spine load | Organizations + Contacts (+ phones/emails/org links), dedup against live GOS, human review queue for ambiguous merges | Canonical customer base with crosswalk |
| **M5** | Goal A operational load | Active deals, open leads, future tours/registrations, pending tasks/activities — into Deal/DealStage/Task/TourEvent/Booking etc. | GOS operationally complete |
| **M6** | Verification & parallel window | Reconciliation reports (counts, sums, spot samples), staff spot-checks, short dual-visibility window with legacy read-only | Go/no-go evidence |
| **M7** | **Cutover** | Legacy systems become read-only for operations; Make scenarios retired/re-pointed; team works only in GOS | Reversibility window ends here |
| **M8** | Goal B historical backfill | Won/lost deals history, past tours, notes, activity history, files, old orgs/contacts not already in spine — mostly archive-attached, selectively structured | Historical context in GOS |
| **M9** | Decommission | Final full export archived (R2), retention window, cancel Pipedrive/Airtable subscriptions | Legacy retired |

Phases M1–M3 are cheap and safe (read-only, no GOS writes). M4 is the first GOS write and the
riskiest phase. M5–M7 are schedule-driven (freeze window). M8 has no time pressure at all.

> **Status (2026-07-14):** M1 external read-only audit is **complete**, including the M1b
> corrections round — see `GOS-migration-M1b-corrections-audit.md` (the Pipedrive archive holds
> **19,448 additional deals**, mass-archived 2026-03; true accessible population **24,356**;
> extraction must use `archived_status=all`; archived deals are fully extractable without
> restore and carry update timestamps for delta), plus `GOS-migration-M1-deep-audit.md` and
> `GOS-migration-external-readiness-audit.md`. The mapping package draft
> (`GOS-migration-mapping-package.md`) and the Org+Unit review report
> (`GOS-migration-org-unit-review.md`) are awaiting owner approval. The rehearsal→delta→cutover
> model (§1.7) maps onto phases M4 (rehearsal load) → freeze → delta → M6 reconciliation → M7
> cutover. No snapshot has been stored and no GOS write has occurred yet.

---

## 3) Required external systems

Primary (in scope for extraction):

1. **Pipedrive** — CRM: organizations, persons, deals, pipelines/stages, activities, notes,
   files, users, custom-field definitions, (possibly) email threads, lost reasons, products.
2. **Airtable** — operations: bases/tables/views unknown until audit; expected: tours, guide
   scheduling/assignments, locations, operational tasks, catalogs. Includes schema metadata
   (field types, linked records, formulas) and attachments.

Satellite (must be inventoried, mostly not extracted):

3. **Make.com** — scenario inventory only: everything reading/writing Pipedrive or Airtable.
   These define the cutover checklist. (Some flows already migrated per prior GOS work.)
4. **iCount** — already integrated with GOS; **not** re-migrated. Only relevance: whether legacy
   deals reference iCount document numbers worth carrying into the crosswalk.
5. **Cognito Forms / Google Workspace / WhatsApp tools** — already handled by prior GOS modules
   or separately tracked in the register; out of scope here unless the audit finds legacy links.

## 4) Required API access

| System | Access | Notes / to verify during M0 |
|---|---|---|
| Pipedrive | API token of a **dedicated read-only user** (Pipedrive tokens inherit the user's permissions — create a user with read-only permission set rather than using the owner's token) | Verify current rate-limit model (Pipedrive moved to a daily token-budget model — affects how long a full 15-year extraction takes); verify API access to: notes, activities, files (download URLs), email threads (mail API is limited — may need manual export), deleted-item behavior |
| Airtable | **Personal Access Token** scoped to only the relevant bases, with **read-only scopes**: `data.records:read`, `schema.bases:read` | Legacy "API keys" are deprecated — PAT is required. **Critical known trap:** Airtable attachment URLs returned by the API **expire within hours** — attachment download must happen immediately at extraction time, streamed into our storage (R2), never "collect URLs now, download later" |
| Make.com | Dashboard access (view scenarios) — no API needed; manual inventory is fine | Read-only human review |
| Storage for snapshots/files | Existing R2 account (already used for Tour Gallery) — a dedicated bucket/prefix for migration snapshots and legacy files | Estimate volume during M2 before mass file download |

## 5) Required permissions

- Pipedrive: read on organizations, persons, deals (all pipelines, incl. archived/lost), activities,
  notes, files, products, users, custom-field definitions, lost reasons. Export permission if we
  fall back to bulk export for anything the API serves poorly (e.g. mail).
- Airtable: read records + read schema on every in-scope base (base list itself is an M0 question).
- Make.com: view scenarios (no run/edit).
- GOS/Railway: no new permissions — loads run with existing DB access, gated per phase.

## 6) Which permissions should be Read-Only

**All of them, for the entire project.** There is no phase in which we write to Pipedrive or
Airtable. Cutover is enforced organizationally (people + Make scenarios stop writing) and by
downgrading legacy accounts to read-only — not by us writing "migrated" markers into legacy
systems. If a marker inside a legacy system ever seems necessary, that is a product-owner decision
and would be the *only* write ever requested.

---

## 7) Existing GOS models to inspect (before mapping, phase M3)

Target-side homework — read the Prisma schema + service layer for the actual invariants:

| Legacy concept (expected) | GOS target models to inspect |
|---|---|
| Organizations | `Organization`, `OrganizationType`, `OrganizationSubtype`, `OrganizationUnit` (+ Deal-classification SSOT rule: linked org owns business/org-type) |
| People / contacts | `Contact`, `ContactPhone`, `ContactEmail`, `ContactOrganization` (dedup invariants: one Contact many numbers, number → ≤1 active Contact) |
| Deals / leads / pipelines | `Deal`, `DealStage`, `DealSource`, `LostReason`, `DealContact`, `orderNo` sequence (@27000 — imported deals need a numbering decision) |
| Activities / tasks | `Task`, `TaskType`, `TimelineEntry`, `TimelineComment` (timeline event kinds; changelog conventions) |
| Notes / files | `TimelineEntry`, `DealFile`, `MediaFile` (+ R2 storage patterns from Tour Gallery) |
| Tours / scheduling | `TourEvent`, `Tour` (content templates), `TourAssignment`, `Booking`, `TicketRegistration`, `OpenTourTemplate` + schedule rules, `Location`, `WorkshopLocation`, `ActivityComponent`, `DealTourPlan` |
| Guides / staff | `PersonRef`, `PersonProfile`, `TeamRef` (staff SSOT already in GOS — legacy guide references map to existing people, they do NOT create identities) |
| Quotes / money | `QuoteOffer/Version/Line`, `IcountDocument`, `PaymentRequest`, minor-units money convention (legacy floats/strings → integer minor units) |
| Payroll | `PayrollEntry` + related (historical guide pay is likely **archive**, not structured — payroll is live-only) |
| Products / catalog | `Product`, `ProductVariant`, `ActivityType`, price models (legacy "tour types" may map to catalog or archive) |
| Cross-cutting | crosswalk-pattern precedents (`externalPersonId`, `WooProductMapping`), migration validation gate (pre-commit), `OperationalIssue` (candidate surface for migration anomalies) |

Also inspect: which GOS models the register expects but that don't exist yet (e.g. `TeamMember`,
`User/Role`, `ConsentRecord`) — the migration plan must target **what exists**, and any schema gap
found in M3 becomes an explicit pre-M4 schema task, not an improvisation during load.

## 8) Information to gather before auditing (phase M0 inputs)

From the product owner / business — no API needed:

1. **Airtable scope list**: which bases (and roughly which tables) are operationally real vs
   abandoned experiments.
2. **Pipedrive shape**: how many pipelines, which are active, what the stages roughly mean, and
   what "an open lead" means in practice.
3. **The cross-system link**: when a deal in Pipedrive became a tour in Airtable, was any shared
   key written (deal id in an Airtable field? name+date convention? nothing)? This single answer
   determines whether Deal↔Tour linkage for historical data is mechanical or heuristic.
4. **Make.com inventory**: list of scenarios touching either system (owner walks through the
   dashboard with me; I catalog).
5. **Who else writes**: which humans still enter data into each system today, and for what.
6. **Already-in-GOS boundary**: since which date have deals/tours been natively created in GOS,
   and were they dual-entered into legacy during that period (→ expected duplicates to reconcile).
7. **Volume ballparks**: rough counts (deals, contacts, orgs, tours, attachments GBs) — sets
   extraction time and storage expectations.
8. **User mapping**: list of Pipedrive users (past and present) → who maps to current GOS admins
   vs "historical person, label only".
9. **Retention/privacy stance**: any categories of 15-year-old personal data the business prefers
   NOT to carry over (privacy hygiene decision, cheaper to decide now than after import).
10. **Cutover appetite**: acceptable freeze-window length (a weekend? a day?) and target season
    (avoid peak booking periods).

## 9) Risks that could invalidate the migration if discovered too late

Ordered by (likelihood × damage):

1. **Ongoing legacy writes during/after migration** (humans or Make) → forked truth after
   cutover. *Mitigation:* Make inventory in M0, freeze window + delta pass, read-only downgrade
   of legacy accounts at cutover.
2. **Identity collisions with live GOS data** — the same customer existing as a live GOS Contact
   and a legacy contact; naive import doubles the CRM. *Mitigation:* M4 dedup phase with strong-key
   auto-merge + human review queue; GOS always wins.
3. **No reliable Pipedrive↔Airtable linkage** — if there's no shared key, historical Deal↔Tour
   joins are heuristic; discovering this after designing a linkage-dependent model would force
   redesign. *Mitigation:* M0 question 3 + explicit M2 linkage-discovery step; design M3 to
   tolerate "unlinked historical tour" as a first-class outcome.
4. **Airtable attachment URL expiry** — collecting URLs for later download yields dead links and
   an unrecoverable gap after decommission. *Mitigation:* download-at-extraction into R2, checksums
   recorded, verified counts before decommission.
5. **API coverage gaps** — data visible in the legacy UIs but not served by their APIs (Pipedrive
   email threads are the classic case; Airtable comments/revision history another). *Mitigation:*
   M2 explicitly reconciles UI-visible entity types vs API-extractable ones; fall back to native
   bulk exports where APIs fall short — before cutover, while exports are still possible.
6. **Rate limits / volume vs calendar** — 15 years of activities/notes could be hundreds of
   thousands of API calls under a daily token budget; a "quick final snapshot before freeze"
   might take days. *Mitigation:* measure real throughput in M1; design final-delta pass to be
   incremental (modified-since), not full re-pull.
7. **Field semantics drift** — 15-year-old custom fields repurposed over time (same field, three
   historical meanings). *Mitigation:* field census with time-bucketed samples in M2; when in
   doubt → archive, don't map.
8. **Stage/pipeline semantics mismatch** — legacy stages don't map 1:1 onto live GOS `DealStage`s;
   forcing them corrupts live pipeline reporting. *Mitigation:* explicit stage-mapping table in M3
   approved by owner; historical deals may land in terminal states (won/lost) without needing
   stage fidelity.
9. **Deleted/archived legacy data silently out of reach** (Pipedrive purges deleted items after a
   retention window). *Mitigation:* snapshot early (M1 is cheap insurance even before mapping).
10. **Load-time performance/production impact** — M4/M5 writing large volumes into the production
    Railway DB while the business operates. *Mitigation:* batched loads, off-hours, and the
    proven out-of-band-script rule (never inside `prisma migrate`; a failed backfill must never
    block deploys).
11. **Legal/tax document references lost** — legacy deals referencing iCount docs; if the
    reference isn't carried, the paper trail from customer to invoice breaks. *Mitigation:*
    crosswalk captures legacy doc references; iCount itself stays untouched (register rule).
12. **Scope creep into rebuilding legacy** — pressure to model "that one Airtable view" as a GOS
    feature. *Mitigation:* the disposition framework (map/merge/archive/drop) + owner sign-off is
    the firewall; default answer for old structures is **archive**.

## 10) Questions needing answers before implementation

Product-owner decisions (blocking):

1. Which Airtable bases are in scope? (list)
2. What is the operational definition of "active" for Goal A — deals in non-terminal stages?
   activities due after date X? tours after date X? (one crisp rule per entity)
3. Is there a shared key between Pipedrive deals and Airtable tour rows? (§8.3)
4. Acceptable freeze window length + target cutover period?
5. Historical deals: do you need their **amounts** structured (revenue-over-time queries in GOS),
   or is archive-attached raw sufficient? (This is the single biggest Goal B modeling decision.)
6. Lost/junk leads from years ago: import as archived contacts, or archive-only without Contact
   rows? (CRM hygiene vs completeness)
7. Pipedrive email history: needed in GOS, or is Gmail (already integrated) the canonical email
   archive, with Pipedrive mail archived raw only?
8. Legacy files: import everything to R2, or size-gate / type-gate? (cost + noise)
9. Who performs the human dedup review queue in M4 (you? office staff?), and what daily volume is
   tolerable?
10. Deal numbering: do imported historical deals get `orderNo`s (they'd consume the sequence), or
    live without one / with a legacy-number display? (recommendation prepared in M3)
11. Any data categories to deliberately NOT bring (privacy/retention)?
12. Post-decommission retention: how long do we keep the raw snapshot archive, and does anyone
    other than admins need to see legacy-archive payloads in the UI?

Technical unknowns (I answer these during M1–M2, listed so they're tracked, not assumed):
current Pipedrive rate-limit budget and v1/v2 endpoint coverage; Airtable PAT scope granularity
per base; attachment volume; API coverage of notes/emails/comments; actual custom-field census;
Airtable linked-record graph shape; whether Airtable revision history matters (API doesn't expose
it — export-or-lose decision).

## 11) Recommended execution order (whole project)

1. **M0** — answer §10 questions; provision read-only access (§4); inventory Make scenarios;
   pick snapshot storage location (R2 prefix). *Owner + architect, ~days.*
2. **M1** — build the extractor (read-only, snapshot-first, resumable); run full Snapshot #1
   including attachment download; record throughput numbers. *No GOS schema or data touched.*
3. **M2** — audit from snapshot: entity/field census, counts, populated %, linkage discovery,
   data-quality report, volume/throughput report. Deliverable: audit report to owner.
4. **M3** — mapping specification per entity/field with dispositions + identity-resolution rules
   + stage mapping + `LegacyRecord`/crosswalk schema design. Deliverable: mapping spec → **owner
   sign-off gate**.
5. **Pre-M4 schema slice** — add `LegacyRecord` + crosswalk fields (additive-only migration, per
   phase-A discipline: DDL separate from data, validated by the migration gate).
6. **M4** — identity spine load: orgs + contacts, dedup vs live GOS, review queue, verification
   report (counts, merges, unresolved). Rollback-able by batch.
7. **M5** — Goal A load from a **fresh snapshot**: active deals, open activities/tasks, future
   tours/registrations. Idempotent upserts by crosswalk key.
8. **M6** — verification: reconciliation reports, owner + staff spot-checks against legacy UI,
   fix-and-rerun loop (idempotency makes reruns free).
9. **Freeze → delta → M7 cutover** — short freeze, incremental delta pass, final verification,
   legacy accounts to read-only, Make scenarios retired/re-pointed. **Reversibility window ends.**
10. **M8** — Goal B historical backfill, zero time pressure: historical deals/tours/notes/files,
    mostly archive-attached; structured only where §10.5 said so.
11. **M9** — final full export archived to R2, retention window per §10.12, subscriptions
    cancelled. Project closed with a completion report.

## 12) Division of responsibility

**Executed by Claude (architect/implementer):** extractor + snapshot infra; audit reports and
field censuses; mapping-spec *proposals* with evidence; `LegacyRecord`/crosswalk schema design;
all transform/load scripts (idempotent, batched, out-of-band); verification/reconciliation
harness and reports; review-queue tooling; rollback tooling; documentation of every phase.

**Decided by the product owner (blocking gates):** everything in §10; approval of the M3 mapping
spec (each map/merge/archive/drop disposition); ambiguous identity merges (via review queue);
freeze window + cutover date; go/no-go at M6 (on presented evidence); Make scenario
retirement order; decommission timing and retention.

**Jointly:** the M2 audit walkthrough (owner explains what fields *meant* across 15 years — the
census says what's populated; only the owner knows what it meant in 2013).

---

## Appendix — guiding defaults when in doubt

- When unsure whether to model: **archive**.
- When unsure whether two records are the same person: **don't auto-merge** — queue for review.
- When unsure whether data is reachable later: **snapshot it now**.
- When a legacy structure has no GOS home: that is a *finding for the owner*, not a license to
  add a model.
- Nothing is "done" until the reconciliation report says so.
