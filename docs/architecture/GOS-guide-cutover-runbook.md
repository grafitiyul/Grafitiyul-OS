# GOS Guide Cutover — Final Operational Runbook

Supersedes nothing: this is the **execution order for the guide cutover**, layered
on `GOS-cutover-checklist.md`. Owner = business actions. Operator = runs commands.
Nothing here is development — if a step fails in a way a command cannot fix,
**stop and reassess; do not patch code mid-cutover.**

Shell preamble for every DB-touching command (PowerShell, repo root):

```powershell
$env:MIGRATION_DB_URL = (railway variables --service Postgres --json | ConvertFrom-Json).DATABASE_PUBLIC_URL
```

`<FREEZE>` = the evening's date (IL). `<FINAL>` = the new snapshot id.
`<HASHB>` = the hash printed by step 3.

## Decisions already approved (2026-07-29)

| Decision | Resolution |
|---|---|
| 4 contact clusters | Rich record is primary; the bare stub is **not imported**. Verified: **0 deals reference any stub**, so nothing loses a contact. |
| 45 unusable-date rows | **Rejected** — 44 with no business links at all, plus `recSX9jmU0r1EnhuH`. Run the planner with `--accept-rejected-dates`. |
| Deal 26309 title conflict | **GOS keeps `מיטל`.** Already the engine's behaviour (GOS edits are never overwritten). Not a gate. |
| Guide identity | Canonical `PersonRef.externalPersonId` when the legacy email resolves; normalised email otherwise. Wave-1 rows never re-keyed. |
| Freeze date | The **actual** business-freeze date, never the 2026-08-01 guide boundary. |

Rehearsal Hash B (2026-07-29, `snap-20260728T171134Z-65d8`, freeze 2026-07-29):
`3086874bb620bbac49a75d0e2731d0bd4c65a3a58a30a7375bfbf6139a932e90` —
81 future · 79 create + 2 redirects · 60 canonical guide assignments · 1 fallback ·
`28+2473+920+1+81 = 3503 ✓`. **The real night produces a different hash** (fresh
snapshot). These are the *shape* to sanity-check, not values to match.

---

## ⚠ Pre-step — quiet the guide notifications (NEW, do not skip)

Reports #12/#14/#15/#16 are live. The moment imported tours land **with guide
assignments**, the 60-second sweep fires every notification whose due moment has
already passed (up to 3 days back, and after each report's `activatedAt`). On a
2026-07-29 evening cutover that is real: tours dated 07-31 have a coordination
send moment of 07-29 08:00, which is past and after the floor — guides would be
messaged **before** anyone has verified the import.

**Action:** in Settings → סיורים → שיחת תיאום → התראות אוטומטיות, set #12, #14,
#15 and #16 to **inactive**. (#11 is already off.)
**Verify:** all six guide notifications show מושבת.
**Re-enabled at step 8**, after guide verification.

---

## 1. Business freeze (Owner)

1. Announce the stop — Airtable + Pipedrive writes end.
2. Confirm with the team that nobody is mid-edit.
3. Record the freeze timestamp; `<FREEZE>` = today's IL date.

**Rollback:** free — nothing written.

## 2. Final snapshot (Operator)

```powershell
$env:MIGRATION_EXTRACTION_ENABLED="true"; $env:MIGRATION_MAX_REQUESTS="1800"
railway run --service Grafitiyul-OS node server/scripts/migration/run-snapshot.mjs --new --omit pipedrive/files
```

Note the printed id → `<FINAL>`. Omit **only** `pipedrive/files`.
Verify: `verify-snapshot.mjs --snapshot <FINAL>` → PASS, 0 blocking.
**Then unset `MIGRATION_EXTRACTION_ENABLED`.**

Identity delta, dry then execute:
```powershell
railway run --service Grafitiyul-OS node server/scripts/migration/run-identity-import.mjs --snapshot <FINAL>
railway run --service Grafitiyul-OS node server/scripts/migration/run-identity-import.mjs --snapshot <FINAL> --execute
```
Expect days-of-drift counts, not thousands.

**Rollback:** additive, batch-tagged.

## 3. Double planner verification → Hash B (Operator)

Run **twice**, read-only:

```powershell
railway run --service Grafitiyul-OS node server/scripts/migration/run-cutover-import.mjs `
  --final <FINAL> --snap1 snap-20260714T125052Z-aaaa --freeze-date <FREEZE> --accept-rejected-dates
```

**Stop unless all of these hold:**
- `snapshot contract OK` for **both** snapshots, and a non-zero participant count per snapshot.
- `GATES: PASS ✓` and **identical HASH B** across both runs.
- Reconciliation line ends `✓`.
- `REJECTED SOURCE DATES` ≈ 45, all `source_error:#ERROR!`. **A larger or differently-shaped number means new corruption — stop.**
- `guide identity: canonical (PersonRef) N · legacy-email fallback M` — M should be small (rehearsal: 1). A jump means guides exist in legacy who are not in GOS.
- `DEAL CONFLICTS` — read each; they never gate, but you should know what they are.

**Owner reads the populations and approves Hash B.** This is the sign-off moment.
**Rollback:** nothing written. Stop freely.

## 4. Airtable and Make shutdown (Owner)

Do this **after** the snapshot, so nothing mutates mid-extraction, and **before**
execution, so no automation writes into a system that is no longer authoritative.

1. Airtable automations → OFF. 2. Make.com scenarios → OFF.
3. Keep a written list of everything switched off — **it is never switched back on.**
4. `WOO_SYNC_BULK_ENABLED=false` on Grafitiyul-OS (restore after the window).
5. `TOUR_CALENDAR_SYNC_ENABLED=false` — the calendar hold. The execute step
   refuses to run without it.

**Verify:** one team member confirms an Airtable automation no longer fires.

## 5. Migration execution (Operator)

```powershell
railway run --service Grafitiyul-OS node server/scripts/migration/run-cutover-import.mjs `
  --final <FINAL> --snap1 snap-20260714T125052Z-aaaa --freeze-date <FREEZE> `
  --accept-rejected-dates --execute --expect-hash <HASHB>
```

The runner re-verifies Hash B, the calendar hold and the payroll component before
writing. Expect the POST-RUN VERIFICATION block and `duplicate-active deals: 0`.

**Rollback:** additive and batch-tagged (`cutover-<ts>`). A mid-run failure resumes
by re-running the identical command. Delete-by-batch via `importBatchId` remains
possible until step 6.

## 6. Calendar sync enablement ← the irreversible line

**First** verify the import while invitations are still held:
- Admin calendar: imported future tours at correct dates/times, correct guides, **no twin slots** beside native ones.
- Open one imported private tour, one business tour, one open slot — legacy card renders.
- בקרה: no issue storm.

Then remove `TOUR_CALENDAR_SYNC_ENABLED` from Railway.

**Expect:** within ~2 minutes events appear on the org calendar and guides receive
invitations (`sendUpdates=all`).
**Verify:** `gcalSyncStatus='synced'` covers every imported future tour; zero duplicates.
**Rollback: NONE for invitations past this point.** Everything else is forward-correctable.

## 7. Guide Portal verification (Owner + Operator)

Before any guide notification is switched on:

- Every August+ tour has the guide(s) it should have.
- Every assigned guide resolves to a `PersonRef` — check the plan's fallback count; a
  guide keyed by a bare email has **no portal and no invitation**.
- Every assigned guide has `portalEnabled` and a phone.
- Open one guide's portal token: their imported tours are visible and open cleanly.
- Google Calendar shows that guide as a **guest** on their tours.
- Spot-check a tour with two guides: both invited, both see it.

**Any gap here is fixed before step 8.** A guide with no portal or no phone silently
receives nothing.

## 8. Notification #11 enablement (Owner)

Re-enable in Settings → סיורים → שיחת תיאום → התראות אוטומטיות, in this order:

1. #12, #14, #15, #16 back to **פעיל** — each stamps a fresh `activatedAt`, so no
   past event is replayed.
2. **#11** to **פעיל**. Its first run is the next 08:00 Israel. The activation floor
   guarantees it reports **no summary for any tour that ended before this moment** —
   no historical backlog, by construction.

**Verify:** the cards show פעיל with a sending account, and the delivery log records
the run. The 2026-08-01 guide boundary needs no configuration — it is enforced by
these activation stamps.

## 9. Final production verification checklist

| Check | Pass condition |
|---|---|
| Inventory | Every legacy future tour exists once in GOS; `LegacyRecord` crosswalk covers them |
| No twins | No imported slot duplicates a native one; redirect count matches the plan |
| Bookings | Every non-open tour has its booking; `duplicate-active deals: 0` |
| Deals | New-deal count matches the plan; merges applied; conflicts reviewed |
| Guides | Every assignment resolves to a `PersonRef`; fallback count as planned |
| Portal | Each assigned guide opens their tour |
| Calendar | Every future tour `synced` with an event; guides are guests; zero duplicates; `gcalSyncWarning` empty |
| Notifications | Six guide notifications פעיל; delivery log clean; no duplicate recipient for one guide on one tour |
| #11 first run | Sends only forward-looking items; **zero** historical summaries |
| Rejected rows | 45 rejected, none imported, none counted as future |
| Woo | `WOO_SYNC_BULK_ENABLED` restored after the window |

## 10. Roll-forward plan

Past step 6 there is no rollback — only forward correction. By symptom:

**A tour is missing.** Re-run step 5's command; it resumes idempotently and creates
only what the crosswalk lacks.

**A tour is duplicated.** Cancel the wrong one in the UI — cancellation deletes its
Google event and notifies guests. Never delete the row directly; the tombstone path
is what cancels the invitation.

**A guide was not invited.** Add their email to their profile. The fix shipped in
`ef82da3` re-pends all their future tours automatically and the reconciler adds them
as a guest — no duplicate guests, no unnecessary updates. Verify `gcalSyncStatus`
returns to `synced`.

**A guide has no portal.** Enable `portalEnabled` on the person; access is immediate.

**A guide appears twice for one tour.** Two assignment rows with different
`externalPersonId`. Remove the stale row (the email-keyed one). New imports cannot
create this — the mapper writes the canonical identity.

**A notification misfired.** Disable that report immediately; the delivery log holds
the frozen text and recipient. Re-enable after the fix — the activation floor
prevents any replay of what was missed.

**Wrong data on an imported deal/tour.** Correct it in GOS. GOS is authoritative from
step 4; legacy is never edited again.

**Something structural is wrong (wrong hash executed, wrong freeze date).** Stop.
The batch is tagged `cutover-<ts>`; delete-by-batch is possible **only** if step 6
has not run. After step 6, correct forward and record the decision.

## Abort matrix

| Failure at | State | Action |
|---|---|---|
| 1–3 | nothing written, legacy live | fix or postpone freely |
| 2 identity execute | additive identity rows | safe to stop; rerun is idempotent |
| 5 | partial batch (additive, tagged) | rerun the same command, or stop — legacy still authoritative |
| after 6 | invitations sent | forward-correction only |
| after 8 | guides being notified from GOS | disable the report, fix, re-enable |
