# GOS — Legacy Mirror architecture

Governed by `GOS-source-ownership-map.md`, which is a **precondition**: no field
is synchronized unless that document declares it, and `src/mirror/ownership.js`
is the executable form of that declaration.

**Status:** COMPLETE and deployed. Core + transport + workers + conflict
resolution, 115 tests. Runs only when `MIRROR_ENABLED=true` (default off).

---

## 1. Shape

```
   Pipedrive ─┐                    ┌─ ownership.js  (may we write this field?)
              ├─→ [adapter] ─→ merge.js  (3-way decision)
   Airtable ──┘                    ├─ baseline.js   (what did the source last say?)
                                   └─ conflicts.js  (surface, never overwrite)
                                          │
                                    בקרה dashboard
```

One-way, always. Nothing in `src/mirror/` may write to Pipedrive or Airtable —
there is a test asserting no merge result can even *describe* such a write.

## 2. Why 3-way and not 2-way

A 2-way merge compares the source against GOS. It cannot tell "a human edited
GOS" from "the source changed", so it must either clobber humans or refuse
everything. The baseline — *what the source said the last time the two systems
agreed* — is the third input that makes the distinction possible, and therefore
the only reason "surface the conflict instead of silently overwriting" is
implementable rather than aspirational.

| base vs source | base vs gos | action |
|---|---|---|
| equal | anything | **NOOP** — the source did not change |
| changed | equal | **MERGE** — GOS untouched, take the source value |
| changed | changed, `gos == source` | **CONVERGED** — advance the baseline only |
| changed | changed, `gos != source` | **CONFLICT** — write nothing |

## 3. The two properties that make conflicts trustworthy

**A conflict advances nothing.** The baseline is stored per FIELD, and a
conflicted field keeps its OLD baseline value. So the same conflict re-raises on
every sync until a human resolves it. A conflict that quietly disappears is
worse than one that nags.

**A convergence advances the baseline without writing.** If both sides
independently reached the same value there is nothing to do, but the baseline
must catch up or the field would be re-evaluated forever.

## 4. Bootstrap — the first-run problem

The first time the mirror sees a record there is no baseline. A naive
implementation would run the 3-way merge anyway, find `base` absent, and declare
a CONFLICT on every field that differs — tens of thousands of conflicts on the
first run, indistinguishable from noise, and therefore ignored.

First contact instead **adopts a baseline and writes nothing**. GOS is left
exactly as it is, legacy is left exactly as it is, and from the second sync
onward every real source change merges correctly. Pre-existing differences are
reported separately as `drift` — visible, but not dressed up as conflicts caused
by an edit nobody made.

This matters concretely here: GOS holds 24,364 deals imported from Pipedrive,
and import-time normalisation (stage mapping, money to minor units, name
cleanup) means many fields legitimately differ from their source. None of that
is a conflict.

## 5. Merge strategies

| Strategy | Used for | Can conflict? |
|---|---|---|
| `three_way` | most fields | yes |
| `append_only` | contact phones/emails | no — only adds |
| `immutable` | first-touch attribution, provenance | yes |
| `latest_wins` | latest-touch attribution | no |
| `never` | GOS-owned and identity fields | n/a — refused |

**Append-only** never reformats, re-primaries or deletes an existing channel. A
phone number the office already uses must not change shape because a sync ran.

**Immutable vs latest-wins** are deliberately opposite and applied to adjacent
fields. Conflating them is the classic attribution bug: every re-touch rewrites
history until every lead appears to have come from the last ad.

## 6. Guards — runtime ownership revocation

A field declared legacy-owned can still be blocked at runtime. There is exactly
one today and it is load-bearing:

> `gosOwnsCommercials` — once GOS has produced the commercial document for a
> deal (`wonQuoteRef`, or a primary Builder version), GOS owns `valueMinor` and
> a stale Pipedrive value can never overwrite a signed quote.

This is the only automatic ownership transfer. Everything else transfers at
retirement, deliberately and per source.

## 7. Transport — BUILT

| Piece | Where | Notes |
|---|---|---|
| Pipedrive webhook | `POST /api/mirror/pipedrive` | HTTP Basic, constant-time compare through the shared helper. Answers **503 until `MIRROR_PIPEDRIVE_WEBHOOK_SECRET` is set** — it never accepts an unauthenticated payload. Subscriptions must still be created in the Pipedrive admin UI. |
| Airtable poller | `sources/airtableMirror.js` | Dependency-injected client: testable without an Airtable account, and the mirror never embeds a second HTTP client. |
| Retry worker | `worker.js` | Claim-based with a TTL, exponential backoff, `dead` after 6 attempts so a permanent fault needs a human instead of retrying forever. |
| Poll ticks | `worker.js` | Per `(system, entity)` cursor with its own claim, so two instances never overlap. |
| Replay | `POST /api/mirror-admin/events/:id/replay` | Re-processes from the stored raw payload — the whole reason it is persisted before processing. |
| Health | `GET /api/mirror-admin/status` | Surfaces the worst failure mode: a poller that silently stopped while the mirror still *looks* live. |

**The kill switch stops PROCESSING, never receipt.** With `MIRROR_ENABLED=false`
payloads still land durably, so nothing is lost while the mirror is paused and
the retry worker drains the backlog when it is switched on.

## 7a. Conflict resolution

`POST /api/mirror-admin/conflicts/:issueId/resolve` with `accept_legacy` or
`keep_gos`. Both resolve the issue **and** advance the baseline in one action:
doing only the first makes the conflict re-raise until the operator stops
trusting the screen; doing only the second hides a decision nobody made.

`keep_gos` still advances the baseline to the **source** value. That is
deliberate: we have SEEN that value and chosen GOS, so it stops nagging — but if
the source changes *again*, `base ≠ source` and GOS still differs, so a new
conflict is raised. That is correct, because it is genuinely new information.

Raw values come from the MirrorEvent, never from the issue card: the card holds
display strings, and `"5,310 ₪"` must never be written into a money column.

## 8. Deletes

A record that disappears from the source is **never** deleted in GOS. It is
marked `sourceDeletedAt` and surfaced. Legacy deletions are frequently
accidental, and GOS is now the system of record for operational history —
payroll, guide-portal state, quotes and gallery media all hang off these
records.

## 9. Source cutover

`src/mirror/sourceRegistry.js` enforces the one rule that neither the mirror nor
the ingress platform can enforce alone, because each behaves correctly in
isolation:

> **No source may have two active writers.**

Each source is `legacy` | `direct` | `off`, switched by a deployment variable so
a cutover is reversible in seconds without a deploy. The default is `legacy` —
forgetting to set a variable must never silently open a second writer. Switching
to `direct` opens the ingress endpoint and makes the mirror ignore that source
in the same switch; a closed endpoint refuses with 409 rather than quietly
creating a duplicate deal.

A source set to `direct` whose credentials are missing is reported as a
**violation**, not a warning: the legacy path is off, the direct path cannot
receive, and leads would fall on the floor silently.

| Source | Variable | Currently |
|---|---|---|
| Meta | `SOURCE_WRITER_META` | legacy |
| Woo old | `SOURCE_WRITER_WOO_OLD` | legacy |
| Woo new | `SOURCE_WRITER_WOO_NEW` | legacy |
| Website forms | `SOURCE_WRITER_WEBSITE_FORMS` | legacy |
