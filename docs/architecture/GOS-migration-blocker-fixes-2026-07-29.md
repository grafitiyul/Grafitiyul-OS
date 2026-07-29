# Cutover Blocker Removal — 2026-07-29

Follow-up to `GOS-migration-pass-2026-07-28.md`. Objective: eliminate every blocker
found in the rehearsal so the cutover evening holds no surprises. No production
writes, no operational cutover, legacy systems untouched.

---

## 1. Defect A — identity import vs the scoped Final Snapshot

**The disagreement.** Checklist 1.3 creates the Final Snapshot with
`--omit pipedrive/files`; `run-identity-import.mjs` then streamed that entity with
no error handling and died on a raw `NoSuchKey`.

**Which side was wrong: the importer.** `pipedrive/files` was being read for one
reason only — to increment a per-person `history` counter whose sole use is the
boolean `importable = history > 0`. The importer streamed **deals + activities +
notes + files + deal_participants (~430,000 records)** to derive that boolean, and
in doing so took a hard dependency on the one entity the runbook omits.

Pipedrive already publishes those aggregates **on the person record**
(`files_count`, `notes_count`, `activities_count`, `open_deals_count`,
`participant_*_count`, …). That is the authoritative source for exactly this question.

**Equivalence was proven, not assumed.** Both derivations were computed over all
**32,475** persons of Snapshot #1:

```
agree                      : 32475
importable by STREAMS only : 0   (none lost)
importable by COUNTS  only : 0   (none gained)
→ behaviour-identical: YES
```

This matters because the naive alternative — "just accept the omission" — would
have silently dropped real people: measured, **2** persons are importable *only*
via files and **31** *only* via participant links.

`related_*` counters are deliberately excluded: they count the person's
*organization's* deals, and would make colleagues importable on someone else's history.

**Result.** The identity import now reads only `pipedrive/persons` +
`pipedrive/organizations`. It runs in seconds instead of minutes, and
`--omit pipedrive/files` is now genuinely correct rather than accidentally fatal.

## 2. Defect B — silently dropped deal participants

`pipedrive/deal_participants` existed only in Snapshot #1, appended by the one-shot
`extract-deal-participants.mjs`. It was never in `pipedrivePlan()`, so every new
snapshot lacked it — and `run-cutover-import.mjs` read it behind `.catch(() => {})`,
turning a missing entity into **zero participants** with no warning.

Three changes, per the requirement that this must never silently succeed:

1. **`pipedrive/deal_participants` is now a canonical plan entity.** New extractor
   kind `pdDealParticipants`: targets (`participants_count > 1`) are read from the
   already-snapshotted deals shards, so discovery costs **zero** API calls; one v1
   GET per target deal (no bulk endpoint exists); resumable at shard boundaries.
   Record shape is byte-compatible with the 2026-07-16 append
   (`{ deal_id, person_id, participant }`), so every existing consumer reads it unchanged.
2. **The silent catch is gone.** A read failure now surfaces.
3. **Explicit contract validation** (below) refuses a snapshot missing the entity.

## 3. The structural fix — snapshot input contract

New `server/src/migration/snapshotContract.js`. Each importer declares its required
entities and validates them **before any work**:

| Step | Requires |
|---|---|
| identity (2.1/2.2) | `pipedrive/persons`, `pipedrive/organizations` |
| cutover (2.3/3.1) | `pipedrive/reference`, `pipedrive/deals`, `pipedrive/deal_participants` |

A scoped snapshot missing a required entity now fails immediately with a message
naming the snapshot, every missing entity, and the remedy. Missing input is never a
silent zero and never a raw S3 error. `pipedrive/files` is required by nothing on
cutover night — which is precisely why omitting it is legitimate.

## 4. Woo bulk sweep — investigated, not assumed

The preflight warned that the bulk sweep "could mark imported tours for Woo".
**Measured: it cannot.** `sweepUnsyncedWooTours` filters on
`openTourTemplateId IN (mapped templates)`, and imported tours are created without a
template — **0 of 2,473** Wave-1 tours carry one.

The real residual risk is narrower and still worth acting on: while bulk is ON the
worker's first-publication gate is open, so any later *mutation* of an imported tour
(edit/cancel/registration marks it pending) could publish it to Woo. With bulk OFF
such a tour is parked back to `null` and never published.

- **Truly unsafe before cutover?** Not for the stated reason; yes for the narrower one.
- **Application or deployment config?** Correctly deployment config (Railway env) —
  it is an operational kill switch that must flip without a code change. Note it costs
  a service restart.
- **Change now or tomorrow?** **Tomorrow**, immediately before Phase 3, and restore
  right after: while off, newly generated open-tour occurrences are not auto-published
  for sale. Current exposure is nil (all 27 native slots already `synced`, 0 sweepable).

The misleading preflight wording has been corrected in place.

## 5. Rehearsal results (2026-07-29)

Snapshot `snap-20260728T171134Z-65d8`, resumed to add the new entity:
49 entities · 326,969 records · verification **PASS** (0 blocking).

**Hash B — generated and deterministic:**

```
7cda010da89a707d56b76fdc53bf154b016201a82cf83d11718379b468ecb495
```

Identical across two independent runs, every population identical, `GATES: PASS ✓`.

| Population | Count |
|---|---|
| historical delta tours | 28 |
| future operational tours | 123 created + 2 redirected (of 125) |
| future bookings / seats / assignments | 60 / 918 / 61 |
| new deals | 282 |
| deal merges | 61 (192 fields) |
| deal conflicts | 1 |
| retro-cancellation conflicts | 0 |
| Wave-1 delta | 16 tours touched · 2 seat updates · +9 payroll · 8 replaced |

**Reconciliation closes exactly:** `28 + 2,473 + 921 + 1 + 125 = 3,548 = master ✓`

**Participants now flow** (the direct proof Defect B is fixed): 478 deals in
Snapshot #1, 481 in the final snapshot, 976 links. Before the fix the final snapshot
reported zero.

**Identity delta** against a still-files-omitted snapshot: contract satisfied,
8 organizations · 245 contacts · 481 phones · 202 emails.

**Idempotency:** replaying identity against Snapshot #1 plans exactly 0 creates.
Hash B reproduces byte-identically. Snapshot resume re-fetched nothing
(48/49 entities skipped, 0 requests).

**Preflight: `READY ✓`** — 0 failures, 2 non-blocking warnings (Woo flag, review backlog).

## 6. API consumption

| System | Used | Ceiling |
|---|---|---|
| Pipedrive (cumulative on this snapshot) | **1,234** | 1,400 |
| — of which participants extraction | 481 | — |
| Airtable | ~500 | no daily budget |

No 429s, no daily-budget lockout, no retries. Ceiling was raised from 900 → 1,400
as an explicit approved decision, exactly as the budget guard requires. Tomorrow's
Final Snapshot should be budgeted at **~1,250 requests** (the checklist now says so).

## 7. Tests

`node --test` full server suite: **2,173 pass / 0 fail.**
New coverage: 5 snapshot-contract tests (including "an omitted-but-unrequired entity
does not fail the contract"), 6 person-history tests (including the files-only and
participants-only cases, and that `related_*` is excluded), 5 deal_participants
extractor tests (canonical presence, targeting + zero-cost discovery, record shape,
resume makes zero calls, deliberate omission is never silently re-added).

## 8. Bookkeeping

The stale `running` `import.builder` MigrationRun was corrected to `failed
(superseded)` after re-proving its work complete (15,638 = 15,638, zero orphans).
Preflight now reports no stuck runs.
