# GOS Cutover — Operational Checklist (executable line by line)

Governed by `GOS-migration-cutover-runbook.md` v2. Every step: purpose →
command → expected → verification → rollback point. Owner = business actions;
Operator = runs the commands (Claude session). **Nothing here is development —
if any step fails in a way a command can't fix, stop and reassess; do not
patch code mid-cutover.**

Shell preamble for EVERY DB-touching command (PowerShell, repo root):

```powershell
$env:MIGRATION_DB_URL = (railway variables --service Postgres --json | ConvertFrom-Json).DATABASE_PUBLIC_URL
```

`<FREEZE>` below = the freeze date `YYYY-MM-DD` (the evening's date, IL time).

---

## Phase 0 — afternoon before the freeze (no business impact)

**0.1 Preflight**
- Purpose: prove every dependency is green before announcing anything.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/cutover-preflight.mjs`
- Expected: `READY ✓`. Warnings allowed only: Woo bulk flag (handled in 0.2), review backlog.
- Verification: exit code 0.
- Rollback: none needed (read-only). **If NOT READY — postpone; nothing announced yet.**

**0.2 Woo bulk sweep off** (Owner or Operator, Railway dashboard)
- Purpose: the bulk sweep must not mark imported tours for Woo.
- Action: set `WOO_SYNC_BULK_ENABLED=false` on the Grafitiyul-OS service (leave `WOO_SYNC_ENABLED` as is — native tours keep syncing).
- Verification: preflight rerun shows the Woo line as ✓.
- Rollback: restore the previous value any time.

## Phase 1 — freeze (business stop; evening)

**1.1 Owner announces the stop** — Airtable + Pipedrive writes end. (Owner, manual)

**1.2 Owner disables legacy automations** — Airtable automations + Make.com scenarios OFF, **before** extraction so nothing mutates mid-snapshot. (Owner, manual; keep a list of what was turned off — it is never turned back on.)

**1.3 Final Snapshot**
- Purpose: the immutable source for Hash B.
- Command (extraction gates deliberately opened for this one run):
```powershell
$env:MIGRATION_EXTRACTION_ENABLED="true"; $env:MIGRATION_MAX_REQUESTS="1800"
railway run --service Grafitiyul-OS node server/scripts/migration/run-snapshot.mjs --new --omit pipedrive/files
```
  Note the printed snapshot id → `<FINAL>`. `--omit pipedrive/files` skips the 1,255-request files census (files are a separate gated slice; not needed for cutover). If Pipedrive's daily budget trips: the run pauses resumably — resume with `--snapshot <FINAL>` after reset; the freeze simply holds longer.
- Expected: run completes; ~600 Pipedrive requests + Airtable tables + attachments.
- Verification: `railway run --service Grafitiyul-OS node server/scripts/migration/verify-snapshot.mjs --snapshot <FINAL>` → PASS, 0 blocking.
- Rollback: none needed — read-only against legacy; the snapshot is additive in R2.
- **Then unset `MIGRATION_EXTRACTION_ENABLED`.**

## Phase 2 — plan + approval (same evening)

**2.1 Identity delta (dry)**
- Purpose: new persons/orgs created during the mirror.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/run-identity-import.mjs --snapshot <FINAL>`
- Expected: small create counts (days of drift); crosswalk skips everything already imported.
- Verification: plan numbers look like days-of-business, not thousands.
- Rollback point: nothing written yet.

**2.2 Identity delta (execute)**
- Command: same + `--execute`.
- Verification: post-import verification block in the output; re-run plans 0.
- Rollback: batch-tagged (`identity-<ts>`); additive only.

**2.3 Cutover plan → Hash B** (run TWICE)
- Purpose: the one plan covering historical-delta tours, future operational tours, duplicate redirects, Wave-1 tour delta, deal merges/conflicts, new deals.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/run-cutover-import.mjs --final <FINAL> --snap1 snap-20260714T125052Z-aaaa --freeze-date <FREEZE>`
- Expected: `GATES: PASS ✓`; identical `HASH B` across the two runs; tour reconciliation line shows ✓.
- Verification: **Owner reads the populations and approves Hash B** — this is the owner sign-off moment of the runbook.
- Rollback point: nothing written yet. If populations look wrong — stop here, legacy still authoritative, resume tomorrow.

**2.4 Calendar hold ON** (Railway dashboard)
- Purpose: imported future tours must be verifiable before invitations fire.
- Action: set `TOUR_CALENDAR_SYNC_ENABLED=false` on Grafitiyul-OS (service restarts).
- Verification: the execute step refuses to run without it (built-in gate), so simply proceed.
- Rollback: removing the var restores normal sync.

## Phase 3 — execute (point of records being written)

**3.1 Cutover import**
- Command: step 2.3's command + `--execute --expect-hash <HASH B>`
  (the runner itself re-verifies Hash B, the calendar hold, and the payroll component before writing).
- Expected: sections execute in order (new deals → merges → conflicts → historical tours → future tours → redirects → delta); post-run verification block prints; `duplicate-active deals: 0`.
- Verification: the built-in POST-RUN VERIFICATION; then UI spot checks (3.2).
- Rollback: **everything is additive and batch-tagged (`cutover-<ts>`)**; a failure mid-run resumes idempotently by re-running the same command. Until the calendar hold is lifted (3.3) and legacy is retired (4.x), Airtable/Pipedrive are untouched — full stop-and-resume is still possible.

**3.2 UI verification (Owner + Operator together)**
- Admin calendar: future tours appear with correct dates/times/guides; no twin slots next to the native ones.
- A sample imported future private tour, business tour, and open slot each open cleanly; the legacy card ("מידע ממערכת קודמת") renders.
- Guide portal (one guide token): upcoming imported tour visible; nothing bizarre.
- בקרה screen: no unexpected issue storm (tour_change_impact/deal_tour_sync noise means field-inconsistency — investigate before 3.3).
- Review Center → exceptional: walk the `cutover:` conflict rows (retro-cancellations, deal field conflicts) — decide now or defer; they never block.

**3.3 Lift the calendar hold** ← **the irreversible line**
- Purpose: create Google events + invitations, ONCE, for all imported future tours.
- Action: remove `TOUR_CALENDAR_SYNC_ENABLED` from Railway (service restarts; worker sweeps `null`-flagged scheduled future tours → pending → events with `sendUpdates=all`).
- Expected: within ~2 minutes, events appear on the org calendar; guides receive invitations.
- Verification: `gcalSyncStatus='synced'` count rises to cover the imported future tours; org calendar shows them; zero duplicates.
- **Rollback: NONE past this point for invitations** (runbook: never reversible). Everything else remains forward-correctable.

## Phase 4 — switch + closeout

**4.1 Generation-collision review** (Owner)
- Purpose: templates must not mint twins over imported manual slots.
- Action: in Tours settings, compare each template's upcoming horizon against the imported open slots (dates/times printed by the plan run); trim template occurrences or adopt slots — owner decision per collision, never automatic.

**4.2 Payroll epoch** — nothing to run: generation for future operations is
already GOS-native; imported historical tours stay suppressed permanently by
`completedReason='migration'`. Record the epoch in the runbook copy (date + Hash B).

**4.3 Legacy goes read-only** (Owner, manual)
- Pipedrive: downgrade team access to read-only / remove edit seats. Airtable: workspace read-only. Announcement to the team: GOS is the system now.
- Verification: one team member confirms they cannot edit.
- This is Stage-5 switch #2 — after it, the rollback horizon is the first business write into GOS.

**4.4 First-week watch** (from the runbook): day-1 tour runs fully from GOS · a payment collects on an imported deal · first post-cutover payroll generates naturally · weekly reconciliation (every future tour exactly one source; no orphan bookings; no duplicate slots) · old shared calendar manually cleaned.

---

## Abort matrix

| Failure at | State | Action |
|---|---|---|
| 0.x / 1.3 | nothing written, legacy live | fix/postpone freely |
| 2.x | identity delta possibly written (additive) | safe to stop; re-announce later; rerun is idempotent |
| 3.1 | partial cutover batch (additive, tagged) | rerun same command (resumes); or stop — GOS holds extra future tours but legacy still authoritative until 4.3; delete-by-batch remains possible via `importBatchId` |
| after 3.3 | invitations sent | forward-correction only (Review Center); do not attempt rollback |
