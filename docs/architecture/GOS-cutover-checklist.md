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

**Snapshot contract (since 2026-07-29).** Every importer declares the snapshot
entities it requires and validates them UP FRONT
(`server/src/migration/snapshotContract.js`). A scoped snapshot that lacks a
required entity is refused immediately with a message naming the gap and the fix.
Missing input is never a silent zero and never a raw S3 error. Required entities:

| Step | Requires |
|---|---|
| 2.1 / 2.2 identity | `pipedrive/persons`, `pipedrive/organizations` |
| 2.3 / 3.1 cutover | `pipedrive/reference`, `pipedrive/deals`, `pipedrive/deal_participants` |

`pipedrive/files` is required by NOTHING on cutover night — which is why omitting
it in 1.3 is correct.

---

## Phase 0 — afternoon before the freeze (no business impact)

**0.1 Preflight**
- Purpose: prove every dependency is green before announcing anything.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/cutover-preflight.mjs`
- Expected: `READY ✓`. Warnings allowed only: Woo bulk flag (handled in 0.2), review backlog.
- Verification: exit code 0.
- Rollback: none needed (read-only). **If NOT READY — postpone; nothing announced yet.**

**0.2 Woo bulk sweep off** — ~~step~~ **WITHDRAWN 2026-07-31. Do not perform.**

> This step's rationale did not survive being checked against the code, and the
> step is retired rather than corrected — there is nothing left for it to do.
>
> It claimed: *"while bulk is ON the worker's first-publication gate is open, so
> any later mutation of an imported tour could publish it to Woo."* That is not
> what happens. `reconcileTourWoo` resolves sellable cards
> ([syncWorker.js:305](../../server/src/tours/woo/syncWorker.js#L305)) **before**
> it evaluates the first-publication gate at line 326, and
> `resolveSellableCards` begins `if (!templateId) return []`
> ([mapping.js:40](../../server/src/tours/woo/mapping.js#L40)). A legacy-imported
> tour has no template → no cards → it parks as `skipped` at line 308 and
> returns, 21 lines before the gate the flag controls is ever reached. An
> imported tour cannot publish to Woo under **any** value of `WOO_SYNC_BULK_ENABLED`.
>
> Measured in production 2026-07-31, after the cutover: turning bulk on would
> mark **0** tours pending; the 3 future group slots at `wooSyncStatus = null`
> are all template-less legacy imports; and `first_publication_blocked` had
> fired **0 times ever** — the gate never blocked anything.
>
> One factual correction to the 2026-07-29 note above it: **3** imported tours do
> carry a template, not "0 of 2,473". They are Tel Aviv slots deliberately
> adopted into the mapped template, already `synced`, already on the website.
>
> **`WOO_SYNC_BULK_ENABLED=true` is now the normal permanent operating mode**
> (owner ruling 2026-07-31): the website must always be an exact reflection of
> the Open Tours in GOS. New occurrences publish automatically, and card/template
> changes propagate automatically to future sellable slots via
> `markCardSlotsPending`. Leave `WOO_SYNC_ENABLED` as is.

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
  Note the printed snapshot id → `<FINAL>`. `--omit pipedrive/files` skips the files census (~1,700 requests). This is CORRECT and stays: since 2026-07-29 nothing on cutover night reads `pipedrive/files` — the identity import derives its history signal from the person record's own aggregate counters (proven equivalent over all 32,475 persons of Snapshot #1). Do **not** omit anything else. If Pipedrive's daily budget trips: the run pauses resumably — resume with `--snapshot <FINAL>` after reset; the freeze simply holds longer.
- Expected: run completes; ~1,250 Pipedrive requests + Airtable tables + attachments.
  Measured on the 2026-07-28 rehearsal: **1,234** requests — reference 11 · organizations 6 · persons 66 · deals 50 · notes 150 · activities ~310 · products 1 · deal_products ~158 · **deal_participants 481** (one v1 GET per deal with `participants_count > 1`; no bulk endpoint exists).
- `pipedrive/deal_participants` is a CANONICAL plan entity (since 2026-07-29). It used to exist only in Snapshot #1 via a one-shot append script, so new snapshots silently lacked it and the cutover importer created deals with no participant links. Every fresh snapshot now contains it by construction, and the importers refuse a snapshot that does not (see "snapshot contract" below).
- Verification: `railway run --service Grafitiyul-OS node server/scripts/migration/verify-snapshot.mjs --snapshot <FINAL>` → PASS, 0 blocking.
- Rollback: none needed — read-only against legacy; the snapshot is additive in R2.
- **Then unset `MIGRATION_EXTRACTION_ENABLED`.**

## Phase 2 — plan + approval (same evening)

**2.1 Identity delta (dry)**
- Purpose: new persons/orgs created during the mirror.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/run-identity-import.mjs --snapshot <FINAL>`
- Expected: small create counts (days of drift); crosswalk skips everything already imported. Runs in seconds — it reads only `pipedrive/persons` + `pipedrive/organizations`.
- Verification: plan numbers look like days-of-business, not thousands. It first prints `snapshot contract satisfied: …`; if a required entity is absent it refuses immediately with the remedy, instead of dying on a raw `NoSuchKey` (that failure was found and fixed on 2026-07-29).
- Measured on the 2026-07-28 rehearsal (14 days of drift): 8 organizations · 245 contacts · 481 phones · 202 emails.
- Rollback point: nothing written yet.

**2.2 Identity delta (execute)**
- Command: same + `--execute`.
- Verification: post-import verification block in the output; re-run plans 0.
- Rollback: batch-tagged (`identity-<ts>`); additive only.

**2.3 Cutover plan → Hash B** (run TWICE)
- Purpose: the one plan covering historical-delta tours, future operational tours, duplicate redirects, Wave-1 tour delta, deal merges/conflicts, new deals.
- Command: `railway run --service Grafitiyul-OS node server/scripts/migration/run-cutover-import.mjs --final <FINAL> --snap1 snap-20260714T125052Z-aaaa --freeze-date <FREEZE>`
- Expected: `GATES: PASS ✓`; identical `HASH B` across the two runs; tour reconciliation line shows ✓. It also prints `snapshot contract OK` for BOTH snapshots and the participant counts per snapshot — if either line is missing or participants read 0, stop.
- Verification: **Owner reads the populations and approves Hash B** — this is the owner sign-off moment of the runbook.
- Rehearsed 2026-07-29 against `snap-20260728T171134Z-65d8` (freeze-date 2026-07-29), Hash B
  `7cda010da89a707d56b76fdc53bf154b016201a82cf83d11718379b468ecb495`, identical across two runs:
  historical delta 28 · future create 123 + 2 redirected · new deals 282 · merges 61 (192 fields) · conflicts 1 ·
  reconciliation `28+2473+921+1+125 = 3548 = master ✓`. **Tomorrow's real numbers will differ** (a fresh Final Snapshot after the freeze) — these are the shape to sanity-check against, not values to match.
- Rollback point: nothing written yet. If populations look wrong — stop here, legacy still authoritative, resume tomorrow.

**2.3a Unusable source dates — read the block, do NOT reach for the flag**

The plan prints a `── REJECTED SOURCE DATES ──` block for every master tour whose
Airtable `DATE` could not be validated. Those tours are neither imported nor
silently dropped.

- Expected on the night: `reviewed & accepted 2026-07-30: 45 (historical 34, empty_shell 9, cancelled 1, unknown 1)`
  and `GATES: PASS ✓`. Those 45 were audited record-by-record and accepted by the
  owner — evidence in [GOS-rejected-tour-dates-review.md](GOS-rejected-tour-dates-review.md).
- **If the block shows `⚠ UNREVIEWED` or `⚠ CHANGED SINCE REVIEW`, the gate refuses and that is correct.**
  A record nobody has looked at must not ride in on an old approval. Audit it:
  `railway run --service Grafitiyul-OS node server/scripts/migration/audit-rejected-tour-dates.mjs --final <FINAL> --md <out.md>`
  (read-only, sourced from the snapshot — zero Airtable API requests), then add the
  reviewed ids to `server/src/migration/import/reviewedRejectedDates.js`.
- **Do NOT pass `--accept-rejected-dates` to get past this.** It is a blanket
  override that also silences the gate for the unreviewed record. Owner decision,
  2026-07-30: the gate stays strict; only individually reviewed ids are cleared.
- Root cause for the known 45: the `DATE` formula's input field `ת.סיור` is empty,
  so `DATE` and ~12 formulas chained off it all error. Airtable is deliberately NOT
  being changed.
- Carried forward: `recSX9jmU0r1EnhuH` (Tour_ID 1711 / deal 20383) is the one record
  with real content — one participant, and a Pipedrive deal that no longer exists.
  It does not block the cutover; execute seeds it into the `exceptional` review
  queue as `cutover:rejected_date:recSX9jmU0r1EnhuH` for a later manual decision.
- Separate open item, NOT a cutover blocker: 34 of the 45 hold guides' written tour
  summaries that no cutover option carries into GOS. Historical data-quality, to be
  evaluated later.

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

## Parallel open item — WhatsApp number migration (NOT part of the legacy cutover)

Tracked separately because it has its own trigger (a QR scan), but it is an open
deployment obligation and must not be lost between runbooks.

**After both numbers are paired, the migration is NOT complete until the
post-pairing checklist is done:** re-select the 10 manager-report group
destinations, verify each resolves to the CORRECT group, and run one end-to-end
test send per report family.

→ **`GOS-whatsapp-number-migration-audit.md` §1** holds the authoritative
checkbox list. Do not close the WhatsApp migration from this document.

Why it cannot be pre-done: the destination groups live on the WhatsApp accounts,
so they do not exist until pairing and group sync complete. The 10 stale group
ids were cleared deliberately, so until they are re-picked reports #1–#10 skip
with a visible *"לא הוגדר יעד"* reason rather than failing against a dead id.

---

## Abort matrix

| Failure at | State | Action |
|---|---|---|
| 0.x / 1.3 | nothing written, legacy live | fix/postpone freely |
| 2.x | identity delta possibly written (additive) | safe to stop; re-announce later; rerun is idempotent |
| 3.1 | partial cutover batch (additive, tagged) | rerun same command (resumes); or stop — GOS holds extra future tours but legacy still authoritative until 4.3; delete-by-batch remains possible via `importBatchId` |
| after 3.3 | invitations sent | forward-correction only (Review Center); do not attempt rollback |
