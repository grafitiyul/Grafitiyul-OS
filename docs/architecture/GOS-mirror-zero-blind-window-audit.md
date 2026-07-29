# Mirror — zero-blind-window cutover: pre-implementation audit

**Read-only audit.** No source API calls were made against Pipedrive or Airtable
to produce it: all figures come from the existing snapshot
`snap-20260728T171134Z-65d8` in R2, from production Postgres, and from one
bounded drift probe run earlier (8 calls).

**Nothing was enabled. No baselines were written.**

---

## Part 5 — the thirteen questions

### 1. Does the architecture already support durable capture while apply is disabled?

**Partly — and the gap is a single flag.**

`MIRROR_ENABLED` currently controls **two different things at once**:

| It gates | Where |
|---|---|
| whether the webhook route *processes* (vs merely receives) | `routes/mirror.js` |
| whether the workers *start at all* | `mirror/worker.js` |

So `false` gives capture-without-apply **for webhooks only** — the poller never
runs, because the workers never start. And `true` turns on capture *and* apply
together, which is exactly the sequence you rejected.

**Smallest canonical change:** split the flag in two.

```
MIRROR_CAPTURE_ENABLED   receive + poll + persist events        (Phase A)
MIRROR_APPLY_ENABLED     let processEvent write to GOS          (Phase D)
```

One extra gate at the top of `processEvent` makes *every* path — webhook, poll,
retry worker, replay — obey the same switch. That is one condition in one
function, not a second code path, so there is no second truth.

### 2. Can Pipedrive webhook events be buffered safely before the cutover?

**Yes — already true today, and deployed.** With apply off the route calls
`receive()` only: the raw payload is persisted with `status='pending'`, keyed by
`(system, idempotencyKey)`. Missing today: `MIRROR_PIPEDRIVE_WEBHOOK_SECRET`
(the endpoint answers 503 until it is set) and the subscription in Pipedrive.

### 3. Can Airtable changes be buffered safely?

**No — not yet.** There is no Airtable client, and `startMirrorWorkers` is
called with **no `pollTargets`**, so `buildPollTargets` returns an empty list.
The poller is not dormant; it does not exist as a running thing. This is Slice 3.

### 4. What if the same entity changes several times during the window?

Each change is a separate `MirrorEvent` with its own version marker. Replay
applies them in `receivedAt` order. Because every step is a 3-way merge against
the *evolving* baseline, intermediate states converge on the final one, and
re-running any prefix is a no-op. Coalescing is therefore an optimisation, never
a correctness requirement — and it is deliberately **not** applied to status
transitions, where order carries meaning.

### 5. What if an entity is deleted during the window?

The delete is captured as an event. On replay it sets `sourceDeletedAt` and
raises an issue. **GOS never deletes on a source signal** — legacy deletions are
frequently accidental and GOS now owns operational history hanging off those
records.

### 6. What is the exact snapshot boundary?

The snapshot's own manifest `createdAt`, per source. But see §7: the design
deliberately does **not depend** on that boundary being exact.

### 7. How will replay know which events are after the boundary?

**It does not need to, and that is the point.** After the fix in §8, an event
whose payload matches the snapshot state produces `base == source` → **NOOP**.
A pre-boundary event is therefore harmless *by the merge algebra*, not by
timestamp bookkeeping. Timestamp filtering is fragile (clock skew, webhook
delivery lag, retries); value comparison is not.

That also answers "prove no pre-snapshot event was applied twice": applying it
twice is indistinguishable from applying it zero times.

### 8. How will you prevent bootstrap silently accepting missing changes as baseline?

**This is the most important finding of the audit, and it is a real defect in
the current plan.**

Today the cutover import writes GOS records but does **not** write
`syncBaseline`. So the first mirror event for each record would hit BOOTSTRAP —
adopt the current source value as baseline and **write nothing**. Every one of
the 462 already-changed Pipedrive deals would be silently accepted as "the way
things are". No error, no conflict, no missing-data signal.

**Fix: the cutover import seeds `syncBaseline` from the snapshot values it
imported.** Then:

- `base` is never null for an imported record → bootstrap cannot fire;
- a buffered event carrying a post-snapshot change is a genuine merge, and gets
  **applied**;
- a buffered event carrying the snapshot state is a NOOP.

This is one write inside the importer that already has both the snapshot values
and the crosswalk row in hand. Bootstrap remains, correctly, for records the
mirror meets that the import never saw.

### 9. How will you verify there is no blind window?

Three checks, all mechanical:

1. **Capture precedes snapshot.** The first `MirrorEvent.receivedAt` must be
   *earlier* than the snapshot manifest `createdAt`, per source. If capture
   started after the snapshot, a window existed.
2. **Continuity.** No gap in capture between the two: for Pipedrive, the webhook
   subscription's creation time; for Airtable, the first poll cursor.
3. **Convergence.** After replay, re-run a bounded diff of a sample against the
   live source and require zero unexplained differences.

### 10. What code changes are required?

| # | Change | Size |
|---|---|---|
| 1 | Split `MIRROR_ENABLED` → `MIRROR_CAPTURE_ENABLED` + `MIRROR_APPLY_ENABLED`; gate `processEvent` | small |
| 2 | Cutover import seeds `syncBaseline` from snapshot values | small, critical |
| 3 | Airtable client + cursor-based poll target, wired into `startMirrorWorkers` | medium |
| 4 | Pipedrive follow-up fetch for webhooks that arrive without full `current` | small |
| 5 | API budget guard + metrics (`MirrorApiUsage`) with a hard per-run ceiling | small |
| 6 | Replay-in-order runner + the three §9 verifications | medium |

None of these introduces a second truth: 1 and 5 are gates, 2 seeds data the
importer already holds, 3 is a new transport into the existing pipeline, 4 is a
data-completeness step inside the existing adapter, 6 reuses `processEvent`.

### 11–12. Projected API usage

Measured, not estimated, where a real run exists.

| Operation | Pipedrive | Airtable | Basis |
|---|---|---|---|
| Fresh snapshot | **~1,250** | **~500** | measured 1,234 on the 2026-07-29 rehearsal |
| Cutover import | **0** | **0** | reads R2 + Postgres only |
| Buffered replay | **0** | **0** | replays stored payloads |
| Normal daily — webhooks | **0** inbound | n/a | pushed to us |
| Normal daily — follow-up fetch | **~30–60** | n/a | 462 deals changed in 15 days ≈ 31/day |
| Normal daily — Airtable poll | n/a | **~290/table/day** | 1 request per 5-min cycle, +1 page only when changes exist |

At a 5-minute interval and 3 polled tables that is **~870 Airtable requests/day**
against a 5-req/sec-per-base limit — under 0.02% of capacity.

**Recommended Airtable interval: 5 minutes.** Worst-case latency for an
operational tour change is therefore 5 minutes plus processing. Tighter is not
justified: no GOS workflow reacts to an Airtable edit faster than a human does.

### 13. What safety limits prevent usage exhaustion?

Already present for the migration (`MIGRATION_MAX_REQUESTS`, a hard cumulative
ceiling persisted in R2, added after a run once exhausted the company-wide
Pipedrive budget). The mirror needs the same discipline:

- a per-run hard ceiling that **stops and reports** rather than continuing;
- one poller instance per (system, entity), enforced by the existing cursor
  claim — no parallel snapshot jobs against one source;
- exponential backoff with jitter; permanent 4xx → `failed`, never retried;
- `dead` after 6 attempts so a broken mapping needs a human instead of burning
  quota forever;
- request/retry/rate-limit counters exposed on `/api/mirror-admin/status`.

---

## Part 3 — field coverage matrix

Proven against the real schemas in the snapshot, not asserted.

**Pipedrive object sizes:** deal **108** fields (59 custom) · person **53** (10
custom) · organization **47** (9 custom) · 25 stages · 24 activity types · 14 users.

### Pipedrive → GOS

| Source object | Source field | Destination | Direction | Capture | Conflict | Delete | Status |
|---|---|---|---|---|---|---|---|
| deal | `title` | `Deal.title` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `status` | `Deal.status` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `value` | `Deal.valueMinor` | PD→GOS | webhook+poll | 3-way, guard | mark | **covered** |
| deal | `currency` | `Deal.currency` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `won_time` / `lost_time` | `Deal.wonAt/lostAt` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `lost_reason` | `Deal.lostReason` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `expected_close_date` | `Deal.expectedCloseDate` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| deal | `stage_id` | `Deal.dealStageId` | PD→GOS | webhook+poll | 3-way by key | mark | **MISSING — no stage map exposed as config; adapter declines to guess** |
| deal | `user_id` (owner) | `Deal.ownerUserId` | PD→GOS | webhook+poll | 3-way | mark | **MISSING — declared in ownership map, not implemented in adapter** |
| deal | tour date/time, participants | `Deal.tourDate/tourTime/participants` | PD→GOS | webhook+poll | 3-way | mark | **MISSING — custom-field keys not wired** |
| deal | `מקור-רשימה סגורה`, `מקור`, `קמפיין` | `DealMarketing.*` | PD→GOS | webhook+poll | latest-wins | mark | **MISSING in mirror** (import-only today) |
| deal | `add_time`, `origin` | `DealMarketing.sourceCreatedAt/originalIngressSource` | PD→GOS | import | immutable | — | **covered (import)** |
| deal | 88 other fields | — | — | — | — | — | **intentionally excluded** (computed rollups: Weighted value, MRR/ARR/ACV, activity counters, Probability, Visible to, Pipeline) |
| person | `name` | `Contact.firstNameHe/lastNameHe` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| person | `phone[]` / `email[]` | `ContactPhone/Email` | PD→GOS | webhook+poll | append-only | mark | **MISSING — declared append-only, reconciler not called** |
| person | national id | `Contact.taxId` | PD→GOS | webhook+poll | 3-way | mark | **MISSING — custom key not wired** |
| organization | `name`, `address` | `Organization.name/address` | PD→GOS | webhook+poll | 3-way | mark | **covered** |
| organization | `סוג העסק`, tax id | `Organization.organizationTypeId/taxId` | PD→GOS | webhook+poll | 3-way | mark | **MISSING — custom keys not wired** |
| activity | subject/due/done/type/owner | `Task.*` | PD→GOS | webhook+poll | 3-way | mark | **MISSING — declared, no adapter** |
| note | body/author/time | `TimelineEntry` | PD→GOS | webhook+poll | append-only immutable | — | **MISSING — declared, no adapter** |

### Airtable → GOS

| Source table | Source field | Destination | Direction | Capture | Conflict | Delete | Status |
|---|---|---|---|---|---|---|---|
| tours `tblTI7iaGm6qsQA4a` | `DATE` | `TourEvent.date` | AT→GOS | poll | 3-way + date gate | mark | **adapter built, NOT WIRED** |
| tours | `שעת התחלה` | `TourEvent.startTime` | AT→GOS | poll | 3-way | mark | **adapter built, NOT WIRED** |
| tours | `סטטוס` | `TourEvent.status` | AT→GOS | poll | 3-way + Law 2 | mark | **adapter built, NOT WIRED** |
| tours | `משתתפים בסיור` | `TourEvent.capacity` | AT→GOS | poll | 3-way | mark | **adapter built, NOT WIRED** |
| tours | notes | `TourEvent.notes` | AT→GOS | poll | 3-way | mark | **adapter built, NOT WIRED** |
| coordination `tbl1JaGS5oKRIkJ9z` (4,455) | deal link, seats | `Booking`, `TicketRegistration` | AT→GOS | poll | quantity reconcile | mark | **MISSING — no adapter** |
| participants `tbll83BjS4kLMRNuh` (5,117) | per-person rows | registrations | AT→GOS | poll | reconcile | mark | **MISSING — no adapter** |
| payroll/guides `tbli0eBDJ6CgCj4iJ` (2,603) | guide links | `TourAssignment` | AT→GOS | poll | set-reconcile by `externalPersonId` | mark | **MISSING — no adapter** |
| tours | linked records | products/locations | AT→GOS | poll | derived | — | **MISSING** |
| `גישה, סיסמאות` | — | — | — | — | — | — | **excluded by policy** (never snapshotted) |

**Honest summary: the mirror currently live-syncs 15 of ~108 deal fields, and
covers 1 of 4 operational Airtable tables — and that one is not wired.**
Everything marked MISSING is Slice 4 work and must close before go-live.

---

## Revised rollout (your Phase A→D, with the corrections above)

| Phase | Gate |
|---|---|
| **A** capture only | needs flag split (§1) + Airtable client (§3) + webhook secret/subscription |
| **B** fresh snapshot + cutover | needs baseline seeding (§8) — **without it Phase C silently does nothing** |
| **C** replay | needs the ordered replay runner + §9 verifications |
| **D** enable apply | `MIRROR_APPLY_ENABLED=true`, your explicit approval only |

The dependency worth stating plainly: **§8 is what makes Phase C meaningful.**
Without baseline seeding, every buffered event would be swallowed as bootstrap
and the whole zero-blind-window design would appear to work while changing
nothing.
