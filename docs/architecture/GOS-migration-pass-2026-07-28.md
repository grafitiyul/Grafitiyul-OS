# Pre-Cutover Migration Pass — 2026-07-28 (evening)

Operator: Claude session. Objective as instructed: migrate approved legacy data,
verify thoroughly, leave GOS production-ready, **do not** switch operational
ownership. Legacy systems left completely untouched.

---

## 0. Headline

**NO PRODUCTION WRITES WERE EXECUTED TONIGHT.**

The data migration proper (Wave 1 + enrichment + builder + task types) was already
**content-complete since 2026-07-21** and is verified intact below. The only work
remaining is the *cutover delta*, and the audited runbook makes that delta
conditional on two things that belong to tomorrow, not tonight:

1. a business freeze with **legacy automations turned off** — explicitly forbidden
   by tonight's constraints; and
2. **your approval of Hash B** — which by your own message happens tomorrow.

Tonight therefore executed the complete *pre-write* half of the runbook
(preflight → fresh snapshot → verify → dry runs → reconciliation) and stopped at
the approval gate, as designed. Two genuine defects were found in the cutover
path that would have caused a failure and a silent data loss tomorrow.

---

## 1. Migration summary — what was done

| Step | Runbook ref | Result |
|---|---|---|
| Cutover preflight | 0.1 | Run twice. All green except one stale bookkeeping row (§7.1) |
| Fresh snapshot | 1.3 | ✅ `snap-20260728T171134Z-65d8` — 325,993 records, 48 entities, 15.8 min |
| Snapshot verification | 1.3 | ✅ **PASS** — 0 blocking, 5 warnings (all legitimate 14-day growth) |
| Identity delta (dry) | 2.1 | ❌ **CRASHES** — defect A (§7.2) |
| Identity delta (execute) | 2.2 | Not run — blocked by defect A |
| Cutover plan → Hash B | 2.3 | ⛔ Blocked by the permission classifier (§7.4) |
| Cutover execute | 3.1 | **Deliberately not run** — see §0 and §9 |
| Calendar hold / release | 2.4 / 3.3 | **Untouched** — calendar sync left live and normal |

Legacy systems: **zero writes, zero configuration changes.** No Pipedrive
automation, Airtable automation, Make.com scenario, or integration was touched.
All access was GET-only.

---

## 2. Imported counts (state of GOS as of tonight — unchanged by this pass)

| Entity | Count | Notes |
|---|---|---|
| Deals | 24,376 | 24,358 legacy-crosswalked + 18 GOS-native |
| Contacts | 20,461 | |
| Organizations | 2,692 | |
| TourEvents | 2,528 | 2,473 migration-owned + 55 native |
| Bookings | 3,582 | |
| TicketRegistrations | 3,629 | |
| QuoteVersion (`pipedrive_import`) | 15,638 | frozen historical pricing |
| LegacyRecord (crosswalk) | 280,965 | |
| Person crosswalk | 21,157 | |
| Organization crosswalk | 2,899 | |

Wave-1 integrity re-verified live: all 2,473 migration tours are `completed` with
`gcalSyncStatus = null`; payroll suppression holding (0 generated lines on
migration tours); one-active-booking-per-deal invariant holds; stage/config
mapping frozen.

---

## 3. The delta that remains (indicative populations for your approval)

Measured from the fresh snapshot against the live crosswalk. **These are not Hash B**
— they were produced by read-only diagnostics using the audited tour normaliser,
because the audited planner could not be run (§7.4).

| Population | Count |
|---|---|
| New deals since Wave 1 | **283** |
| Historical tours completed since Wave 1 | **28** |
| Future/operational tours at reference date | **125** |
| Cancelled tours (permanently excluded, Law 2) | 921 (was 916 → +5) |
| Postponed | 1 |
| Deals present in GOS but **absent from source** | **1** |

**Tour reconciliation closes exactly:**

```
2,473 imported + 921 cancelled + 1 postponed + 125 future + 28 historical-delta
= 3,548 = master tours in final snapshot ✓
```

(Snapshot #1 equivalent: 2,473 + 916 + 1 + 118 = 3,508 ✓)

This is a days-of-business-sized delta, exactly as the runbook predicts.

---

## 4. Skipped counts (identity planner, unchanged rules)

From the dry run against Snapshot #1:

| Reason | Count |
|---|---|
| already imported (crosswalk) | 21,157 |
| shells (no history) | 8,039 |
| spam-pattern names | 3,193 |
| org already imported | 2,683 |
| deleted by decision | 86 |
| org excluded | 6 |
| invalid / no-name / name-excluded | 0 |

---

## 5. Quarantined / needs-a-decision items

| Item | Count | Status |
|---|---|---|
| Pending `exceptional` decisions | 62 | pre-existing backlog, non-blocking |
| Review backlog: name_cleanup | 1,414 | non-blocking, continues post-cutover |
| Review backlog: deals | 1,876 | non-blocking |
| Review backlog: contacts | 777 | non-blocking |
| Review backlog: tours | 4 | non-blocking |
| **Deal in GOS absent from source** | **1** | **NEW — needs a decision** |
| **Cancelled count grew 916 → 921** | **+5** | up to 5 may be retro-cancellations of already-imported tours → would seed `cutover:` conflicts |

Nothing was silently merged. No ambiguous entity was resolved automatically.

---

## 6. Idempotency proof

**Proof 1 — identity import replay.** Re-running the Wave-1 identity importer
against its own source snapshot plans **exactly zero** work:

```
Organizations to create : 0
Units to create         : 0
Contacts to create      : 0
LegacyRecord crosswalk  : 0
skipped: alreadyImported 21,157 · orgAlreadyImported 2,683
```

**Proof 2 — builder import resumption (historical, re-verified tonight).** The
2026-07-18 builder run died after 689 of 15,638 deals. Its successor resumed via
the crosswalk and wrote the remaining 14,949. Live state: 15,638 QuoteVersions =
15,638 crosswalk rows, **zero orphans**, `isWorking` 0, `isSelected` 0 — a real
mid-flight kill that recovered exactly, with no duplication.

Idempotency of the *cutover* import specifically could not be demonstrated, because
the plan run is blocked (§7.4) and the execute step was deliberately not run.

---

## 7. Incidents encountered

### 7.1 Stale `running` MigrationRun (pre-existing, benign) — **UNRESOLVED**
`import.builder` batch `builder-2026-07-18T1645` was left `status='running'` after
its process died. Proven benign by the evidence in §6 Proof 2. It is the **sole**
reason preflight reports `NOT READY`.

A correction script was written and dry-run successfully (it re-proves completeness
before writing, and refuses otherwise). **The write was blocked by the permission
classifier.** I did not work around it. Needs your approval to run:

```powershell
node server/scripts/migration/output/fix-stuck-run.mjs --execute
```

### 7.2 Defect A — identity delta cannot run against a scoped Final Snapshot (**BLOCKING**)
`run-identity-import.mjs:57` streams `pipedrive/files` with **no error handling**.
The runbook's own step 1.3 creates the Final Snapshot with `--omit pipedrive/files`.
Confirmed empirically tonight — the script dies immediately:

```
NoSuchKey: The specified key does not exist.  (HTTP 404)
  at stream (run-identity-import.mjs:29)
```

**Checklist steps 2.1 and 2.2 are broken as written.** This would have stopped the
cutover cold tomorrow evening, after the freeze had already been announced.

### 7.3 Defect B — cutover silently drops deal participants (**SILENT DATA LOSS**)
`pipedrive/deal_participants` is **not part of `pipedrivePlan()`** — it exists only
in Snapshot #1, appended by a separate one-shot script in July. Any new snapshot
lacks it (verified: Snapshot #1 has 10 Pipedrive entities, the new one has 8).

`run-cutover-import.mjs:116` streams it with `.catch(() => {})`, so instead of
failing it silently yields **zero participants**. Every one of the 283 new deals
would be created without its secondary participant Contact links, with no warning.

Impact is bounded (participant links only; `DEAL_DELTA_FIELDS` excludes them, so
there is no false-positive delta storm), but it is silent, and silent is the
problem.

### 7.4 Cutover plan run blocked by the permission classifier
`run-cutover-import.mjs` in its **default read-only plan mode** was refused by the
harness classifier (presumably on the name). This is the single largest gap in
tonight's deliverable: **Hash B was never computed, and determinism across two runs
was never demonstrated.** I did not attempt to circumvent it.

### 7.5 Minor
- `MigrationRun` DB mirror was disabled during the snapshot (connect timeout from
  the workstation). Harmless — R2 is authoritative for snapshot state by design.
- One operator error of mine: first identity dry run used plain `node` instead of
  `railway run`, so R2 vars were absent. No API cost (R2 only). Re-run correctly.
- My reconciliation diagnostic printed a miscomputed "historical not yet imported"
  line (`~0`). The correct figure is **28**; the underlying counts it derives from
  are correct, and §3 states the corrected arithmetic.

---

## 8. API consumption

| System | Used | Ceiling | Notes |
|---|---|---|---|
| Pipedrive | **753** | 900 (hard, persisted in R2) | estimate was 775 — within 3% |
| Airtable | ~500 | no daily budget | rate-limited only (5 req/s per base) |

Breakdown: reference 11 · organizations 6 · persons 66 · deals 50 · notes 150 ·
activities ~310 · products 1 · deal_products ~158.

`pipedrive/files` was omitted, avoiding a ~1,705-request census. Deal products used
the v2 bulk endpoint (100 deal ids/call): 15,689 target deals in ~158 requests
instead of 15,689. Consumption was monitored live from the R2-persisted counter
(checked at 433/900 mid-run). **No 429s, no daily-budget lockout, no retries.**
Company-wide Pipedrive budget was never approached.

Tomorrow's Final Snapshot will cost roughly the same (~750). Pipedrive daily
budgets reset every 24h, so tonight's spend does not constrain tomorrow evening.

---

## 9. Why the cutover import was not executed

Beyond your explicit "do not switch operational ownership", three independent
blockers apply — any one of which is sufficient:

1. **The runbook gates it on your approval of Hash B** (checklist 2.3: "Owner reads
   the populations and approves Hash B — this is the owner sign-off moment"). You
   said you will review tomorrow. Not running it is *following* the architecture.
2. **The freeze is forbidden tonight.** Checklist 1.2 requires Airtable/Make.com
   automations OFF *before* extraction "so nothing mutates mid-snapshot". Tonight's
   constraints forbid that, so tonight's snapshot is a mirror-period snapshot, not a
   frozen Final Snapshot. Any Hash B from it expires the moment the next legacy
   write lands.
3. **It requires disabling live calendar sync overnight.** Execute mode hard-refuses
   unless `TOUR_CALENDAR_SYNC_ENABLED=false`. That pauses *all* calendar convergence
   on production — tours created natively tomorrow morning would get no Google event
   and no guide invitation until it is lifted. That is stopping an existing
   production process, and leaving it stopped unattended overnight.

Additionally, executing it would write 125 future operational tours that legacy
would keep mutating overnight, guaranteeing divergence by morning.

---

## 10. Remaining manual actions before the operational cutover

**Must fix first (development, not cutover steps):**
1. **Defect A** — make `run-identity-import.mjs` tolerate absent optional entities
   (or stop omitting `pipedrive/files`). Without this the cutover fails at step 2.1.
2. **Defect B** — either add `deal_participants` to `pipedrivePlan()`, or re-run
   `extract-deal-participants.mjs` against the Final Snapshot, or make the cutover
   importer **fail loudly** instead of `.catch(() => {})`.
3. Approve the stale-run correction (§7.1) so preflight reads `READY`.
4. Grant permission for `run-cutover-import.mjs` plan mode so Hash B can actually be
   computed and its determinism proven.

**Owner actions on the night (from the checklist, unchanged):**
5. Decide the evening; announce the write-stop (1.1).
6. Turn Airtable automations + Make.com scenarios OFF (1.2) — keep the list; they are never turned back on.
7. Set `WOO_SYNC_BULK_ENABLED=false` (0.2) — still `true` today.
8. Set `TOUR_CALENDAR_SYNC_ENABLED=false` before execute (2.4).
9. Approve Hash B populations (2.3).
10. Joint UI verification (3.2).
11. Lift the calendar hold (3.3) — **the irreversible line**.
12. Generation-collision review vs the 27 native scheduled group slots (4.1).
13. Pipedrive + Airtable to read-only; team announcement (4.3).
14. Decide the 1 source-deleted deal and any retro-cancellations (§5).

---

## 11. Verification discipline

No customer was contacted. No guide was contacted. No business communication was
triggered. No calendar event or invitation was created. Calendar sync was left in
its normal live state and never toggled. All legacy access was read-only.

---

# NOT READY FOR OPERATIONAL CUTOVER

Two defects in the cutover path would cause a hard failure (A) and a silent data
loss (B) tomorrow evening; preflight still reports `NOT READY`; and Hash B has
never been computed or shown to be deterministic. The underlying migrated data is
healthy and fully intact — the blockers are in the delta path, and all four are
fixable well before an evening cutover.
