# GOS Migration — Implementation Roadmap (production slices)

**Status:** Roadmap for approval. No code yet. Spec frozen per `GOS-migration-decision-workshop.md`
+ `GOS-migration-mapping-package.md` (v2).
**Philosophy:** identical to every GOS module — small slices; each compiles, deploys, is
production-safe, fully verified, leaves main green, and has a clear rollback point. GOS stays the
single source of truth; one canonical path per mutation; idempotent imports; immutable history;
everything resumable and observable.
**Deviation from the suggested slice list (explained):** "Rehearsal import" is split into FOUR
domain slices (identity / deals / timeline / tours) — one combined slice would violate the
small-slice rule. "Snapshot engine" and "Pipedrive extractor" are re-cut so the engine ships with
a small real extraction (an engine with nothing to run can't be honestly verified). A dedicated
"Legacy card UI" slice is added (owner's approved UX is a real deliverable, not a byproduct).
**Last updated:** 2026-07-14

---

## Dependency shape

```
S1 foundation
 ├─► S2 snapshot engine (+reference extraction) ─► S3 Pipedrive extractor ─► S4 Airtable extractor
 └─► S5 Review Center framework ─► S6 Org review ──┐   (S6/S7 proposals read Snapshot #1 → need S3/S4)
                                  └─ S7 Contact review ┤
S3+S4+S6+S7 ─► S8 identity import ─► S9 deals import ─► S10 legacy card UI
S9 ─► S11 timeline import          S8+S9 ─► S12 tours import
S9 ─► S13 files migration (gated)  S8–S13 ─► S14 delta+reconciliation ─► S15 cutover+teardown
```

---

### Slice 1 — Legacy foundation ⛔ writes NO production customer data

**Goal:** the migration's storage + observability skeleton, deployed safely with zero business impact.
**Implemented:** additive Prisma migration — `LegacyRecord` (sourceSystem/sourceType/sourceId
unique triple, snapshotId, batchId, `payload` Json, `cardData` Json (curated card fields),
`entityType`/`entityId` loose refs), `MigrationDecision` (queue, subjectKey unique-per-queue,
proposal Json, decision, decidedBy/At, note), `MigrationRun` (kind, status, counters, error,
claim fields — resumability spine); migration R2 config module (`MIGRATION_R2_*` env, isConfigured
guard, no bucket auto-creation); admin-only `/api/migration/status` (runs + table counts);
validation-gate compliance.
**Dependencies:** none (bucket creation + env vars = owner/ops step alongside).
**Testable after:** deploy green; empty tables queryable; status endpoint returns zeros; R2 guard
reports unconfigured/configured correctly; unit tests for the crosswalk uniqueness.
**Remains:** everything else.
**Complexity:** S.
**Risks:** low — additive DDL only; the one real risk (migration breaking deploy) is covered by
the existing validate-migrations gate + startup smoke.

### Slice 2 — Snapshot engine + reference extraction

**Goal:** the immutable landing zone works end-to-end, proven on tiny real data.
**Implemented:** snapshot writer (JSONL streams → `gos-migration-snapshots`, per-snapshot
manifest with counts+checksums, immutable snapshotId); resumable run executor on `MigrationRun`
(claim-based, restart-safe, progress counters); rate-limit-aware legacy HTTP client (reusing the
audited pacing/redaction patterns); first real extraction: Pipedrive REFERENCE data (pipelines,
stages, field definitions, users, activity types) — small, non-customer, verifies the whole pipe.
**Dependencies:** S1 (+ bucket & env provisioned).
**Testable after:** run a reference snapshot twice → identical manifests, resumable mid-run kill,
objects verifiable in R2, run visible in `/api/migration/status`.
**Remains:** entity extraction.
**Complexity:** M.
**Risks:** R2 credential scoping; manifest/checksum design gets locked here (changing later means
re-snapshotting — reviewed carefully in this slice).

### Slice 3 — Pipedrive entity extractor

**Goal:** complete Pipedrive Snapshot #1.
**Implemented:** extractors for deals (**`archived_status=all`**), persons, organizations, notes,
activities, deal products (15,639 deals), **deal flow/stage-change history** (Decision 8), files
METADATA (bytes deferred to S13); per-entity JSONL + manifest counts cross-checked against the
audited numbers (24,356 / 32,470 / 2,905).
**Dependencies:** S2.
**Testable after:** full Snapshot #1 manifest matches audit counts exactly; spot-decode random
records; re-run = new snapshotId, same counts; throughput measured for delta planning.
**Remains:** Airtable; file bytes.
**Complexity:** M (volume + rate-limit care, logic is simple).
**Risks:** rate-limit budget on ~40k+ calls for products/flow (mitigate: measured pacing,
resumable runs); flow API shape verified early in the slice.

### Slice 4 — Airtable extractor

**Goal:** complete Airtable Snapshot #1 (both bases).
**Implemented:** table extractors for the main base (all 24 tables) + legacy base **excluding
`גישה, סיסמאות` (hard-coded exclusion + test)**; attachment download at pull time (3 fields,
URL-expiry safe) into the snapshot; schema metadata captured; Drive/Photos link classification
(folder/album/invalid) computed into the manifest.
**Dependencies:** S2.
**Testable after:** manifests vs bounded-count audit; passwords-table exclusion proven by test;
attachments verified by checksum.
**Remains:** imports.
**Complexity:** S-M.
**Risks:** low; formula-field values are point-in-time (accepted — they're derived and unmapped).

### Slice 5 — Migration Review Center framework

**Goal:** the temporary module shell + the decision spine, with the first working tab.
**Implemented:** admin route `/admin/migration` (Review Center), tab scaffold, generic queue
framework (list → evidence panel → decision actions → `MigrationDecision` ledger write → progress
%), the **gating computation** ("required queues resolved" — single authority), and the
**Stage & config mapping tab** (the frozen §3a table + org-type enum table rendered for one-click
formal approval into the ledger). Center is behind admin auth; zero effect on normal GOS use.
**Dependencies:** S1 (ledger); parallel to S2-S4.
**Testable after:** approve the stage-mapping config in the UI → ledger row; gating flips when
queues resolve; framework unit tests.
**Remains:** data-driven queues.
**Complexity:** M.
**Risks:** scope discipline (hardcoded tabs, no generic platform — enforced in review); UI is
throwaway-by-design, must not leak patterns into permanent GOS code.

### Slice 6 — Organization review queue

**Goal:** the owner can resolve all 169 org clusters inside GOS.
**Implemented:** proposal builder reading Snapshot #1 (clusters, proposed canonical, proposed
Units, linked deals/contacts, confidence — the 2 tax-id clusters pre-marked safe) seeded as
`MigrationDecision` rows; Organizations tab (candidates side-by-side, actions Approve / Reject /
Edit / Merge-into-other / Create-Unit). **Decisions only — no GOS Organization writes.**
**Dependencies:** S3 (snapshot), S5 (framework).
**Testable after:** full queue populated (169); owner resolves top-25 for real; ledger complete +
exportable summary.
**Remains:** applying decisions (S8).
**Complexity:** M.
**Risks:** proposal quality (mitigated: evidence panels show deals/contacts/addresses so a weak
proposal is still decidable); Edit-action data shape must round-trip losslessly into S8.

### Slice 7 — Contact review queues

**Goal:** contact duplicates, name cleanup, and exceptional records reviewable.
**Implemented:** proposal builders from Snapshot #1 — duplicate clusters (rules R0–R8; 647 safe
pre-marked bulk-approvable, 363+141 with full evidence), name-split proposals (Option C:
original vs proposed He/En first/last), exceptional-records queue (8 archived-open deals, person
23960, 2+6 collection oddities, unresolvable phones/links); three tabs on the framework.
**Dependencies:** S3, S5 (S6 not required — parallel OK).
**Testable after:** queues populated with audited counts; bulk-approve of the safe 647 works;
every decision idempotently re-seedable (re-running the builder never duplicates queue rows).
**Remains:** applying decisions (S8).
**Complexity:** M.
**Risks:** name-split UI must handle RTL/LTR mixing cleanly; queue volume UX (1,177 name rows →
needs pattern-batch approval to be humane).

### Slice 8 — Identity rehearsal import (FIRST destination writes)

**Goal:** organizations + units + contacts land in production GOS — idempotent, batch-tagged,
reversible.
**Implemented:** the canonical import engine (upsert keyed on the LegacyRecord triple; batchId
tagging; **batch rollback tooling**; dry-run mode with diff report; per-run verification report);
appliers for org decisions (merges→canonical+Units), contact decisions (merges, name splits),
phones/emails (raw preserved), org links, legacy-id references; live-GOS-wins conflict rule; spam
exclusion enforced. Runs out-of-band (never in `prisma migrate`).
**Dependencies:** S6+S7 queues resolved (gate) + S3.
**Testable after:** dry-run diff vs approved decisions; real run → counts/spot-sample report
(~2.9k orgs, ~29k contacts); re-run = zero changes (idempotency proof); batch rollback restores
pre-run state exactly.
**Remains:** deals onward.
**Complexity:** L (the riskiest slice — first writes).
**Risks:** collision with live CRM data (mitigated: live-wins rule + review-queue decisions +
rollback); WhatsApp/email auto-matching will start linking to imported contacts immediately —
verified as intended behavior, not a surprise.

### Slice 9 — Deals + pricing-snapshot import

**Goal:** all 24,356 deals in GOS with frozen stage mapping, money, and line snapshots.
**Implemented:** deal applier (orderNo = Pipedrive id; §3a stage map; open/won/lost + timestamps;
Tier-2 active view + future-relevance overrides; the 24 collection-unpaid markers; DealContact/
org links via the imported spine); historical pricing snapshot per deal (structured lines +
verbatim comment HTML, read-only storage per frozen spec); `cardData` curation for the legacy
card; verification: counts, per-status sums vs Pipedrive totals, orderNo uniqueness, spot samples.
**Dependencies:** S8.
**Testable after:** full verification report; a 2019 deal opens in GOS with correct money/stage;
rollback by batch.
**Remains:** timeline, tours, files.
**Complexity:** L.
**Risks:** orderNo collision safety (verified <27000, but the applier asserts it); collection-
unpaid representation touches the Collection module read path — implemented as an additive marker
the Collection screen reads, no change to iCount-derived logic.

### Slice 10 — Legacy card UI («מידע ממערכת קודמת»)

**Goal:** the approved native UX for legacy data.
**Implemented:** permanent card on Deal / Contact / Organization (Tour joins in S12): clean
label→value from `cardData` (owner, legacy stage, meaningful custom fields, pricing notes,
Drive/Photos links — no JSON/ids); **"View complete legacy archive"** action → full readable
record; read-only archive browser for non-entity material (Center tab now; retained screen later).
**Dependencies:** S9 (data to show).
**Testable after:** open migrated records → card renders curated Hebrew labels; complete-archive
view; browser lists legacy-base templates.
**Remains:** —
**Complexity:** S-M.
**Risks:** low; card is read-only. Curation list comes from the frozen mapping, adjustable by
data only (no code) later.

### Slice 11 — Native Timeline import

**Goal:** history feels native (Decision 8).
**Implemented:** timeline appliers — notes (rich HTML sanitized, raw archived), done activities
(typed), **stage-change entries** from deal flow (`kind='change'` convention), won/lost events,
document references; open tasks → real `Task` on active non-archived open/won deals, history
entries on lost/archived (70/683 vs 127 measured); original timestamps + `actorType='import'` +
original actor labels; idempotent via LegacyRecord.
**Dependencies:** S9.
**Testable after:** a 2019 deal's timeline reads chronologically like a native deal; task counts
match the measured split; re-run adds nothing.
**Complexity:** M-L (volume: tens of thousands of entries).
**Risks:** timeline volume vs UI performance on dense deals (paged feed already exists);
double-emitting system events (import path must not trigger live event hooks — single canonical
import writer).

### Slice 12 — Tours import

**Goal:** all historical + future tours with the full operational graph.
**Implemented:** TourEvent applier (historical → completed/cancelled; future 94 → scheduled),
**reconciliation against tours already existing in live GOS** (dedupe by deal/date before
creating — the dual-entry era guard), Bookings via the `פייפ דיל ID` spine, TicketRegistrations
(seats), TourAssignments via PersonRef resolution, validated Drive/Photos links, tour legacy card.
**Dependencies:** S8+S9 (+S4 snapshot).
**Testable after:** 94 future tours reconcile 100% (deal↔booking↔tour↔assignment report);
customer pages show tour history; no duplicate future tours vs live GOS.
**Complexity:** L.
**Risks:** **the highest-subtlety slice** — future-tour dedup against live GOS TourEvents
(wrong = double tours on the calendar; mitigated by reconcile-first + dry-run diff + the existing
tour invariants: Booking partial-unique, cancellation-as-status); guide-name resolution gaps →
exceptional queue, never guessed.

### Slice 13 — Files migration (gated)

**Goal:** legacy files safe in GOS storage.
**Implemented:** **pre-copy report first** (total size, unusually large, broken, inaccessible —
the owner's go/no-go gate); then the copier: Pipedrive file bytes → private R2 under the DealFile
contract (+ file timeline events), Airtable attachments from snapshot → linked records; resumable,
checksum-verified, idempotent.
**Dependencies:** S9 (deals exist); S11 helpful for events ordering.
**Testable after:** report delivered; post-approval copy → per-file checksum verification, spot
downloads via presigned GETs.
**Complexity:** M.
**Risks:** unknown byte volume (that's what the gate is for); Pipedrive download-URL auth
quirks — probed on a sample before the full run.

### Slice 14 — Delta + reconciliation

**Goal:** catch everything created/changed since Snapshot #1; prove the books balance.
**Implemented:** Pipedrive delta extractor (`update_time`-filtered + `/recents`, incl. archived;
deletion sweep via `status=deleted`), Airtable delta (re-snapshot operational tables + record-id
diff for deletions), delta apply through the SAME appliers (idempotency is the mechanism — no
second code path), and the full reconciliation suite (counts, sums, samples, dedup/exclusion
ledgers, future-tour graph) → the go/no-go report.
**Dependencies:** S8–S13.
**Testable after:** rehearsal delta run mid-operation (business still on legacy) applies cleanly;
reconciliation report is green or names every discrepancy.
**Complexity:** M.
**Risks:** the Airtable no-updated-at limitation (accepted design: id-diff + small operational
tables); human edits during the freeze window (procedural: short freeze + final delta).

### Slice 15 — Cutover + teardown

**Goal:** GOS becomes the only operational system; temporary tooling removed.
**Implemented:** cutover checklist execution (freeze → final delta → final reconciliation →
go/no-go → legacy accounts read-only → Make.com scenarios retired per inventory); post-cutover
teardown: **Review Center UI/routes deleted wholesale** (decision ledger, LegacyRecord, legacy
cards, archive browser remain); final full snapshot archived; decommission checklist (retention
window per plan M9).
**Dependencies:** everything; owner go/no-go.
**Testable after:** the business runs a normal day on GOS only; teardown commit leaves main green
with the Center gone and history intact.
**Complexity:** S (code) / L (operational care).
**Risks:** organizational more than technical — a missed Make scenario writing to legacy
(mitigated: inventory checklist + post-cutover write monitoring on legacy for a grace week).

---

## Slice-count note

15 slices vs the suggested ~12: rehearsal import split by domain (8/9/11/12), legacy-card UI
promoted to its own slice (10), engine+first-extraction merged (2). Each slice ends with: commit →
push (deploy) → startup smoke → its own verification checklist → documented rollback point.

**Slice 1 writes no production customer data** — schema + plumbing + observability only, exactly
as required.
