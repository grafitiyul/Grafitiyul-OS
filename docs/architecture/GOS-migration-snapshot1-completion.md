# Snapshot #1 — Completion & Verification Report (Slice 2)

**Snapshot id:** `snap-20260714T125052Z-aaaa`
**Status:** COMPLETE · **Verification verdict: PASS (0 blocking, 0 warnings)**
**Bucket:** `gos-migration-snapshots` (private, presigned-only)
**Completed:** 2026-07-15 · final run 14.1 min · **1,414 / 1,800** Pipedrive requests

Immutable, read-only raw landing zone. **Nothing imported. No LegacyRecords
(count = 0). No production-entity writes. No Pipedrive file bodies.**

---

## 1. Contents — 493,506 records across 49 entities

### Pipedrive (8 entities)

| Entity | Records | Audited | Δ | Shards |
|---|---:|---:|---:|---:|
| organizations | 2,905 | 2,905 | **0** | 1 |
| persons | 32,475 | 32,470 | +5 | 7 |
| deals (`archived_status=all`) | 24,359 | 24,356 | +3 | 5 |
| notes | 73,566 | 73,555 | +11 | 15 |
| activities | 154,705 | 154,687 | +18 | 31 |
| **files (METADATA only)** | 170,421 | 170,412 | +9 | 35 |
| **deal_products (v2 bulk)** | 15,639 | 15,639 | **0** | 16 |
| products (catalog) | 131 | — | new | 1 |
| reference bundle | 1 | — | — | 1 |

All Δ are small **live drift** — the business kept operating between the audit and
the snapshot. This is exactly what the snapshot → delta → reconcile model absorbs.

### Airtable (39 tables + attachments)

Main base 24 tables · legacy base 15 tables (**16 minus the hard-excluded
`גישה, סיסמאות` passwords table — never read**).

| Key table | Records | Audited |
|---|---:|---:|
| סיורים (tours) | 3,508 | 3,506 |
| משתתפים (participants) | 4,413 | 4,409 |
| מעקב תשלומים | 1,702 | **1,702** |
| שכר | 2,559 | 2,551 |
| לקוחות עסקיים | 599 | **599** |
| סיכומי סיור | 294 | **294** |
| guides | 77 | 77 |

**Attachments: 82 bodies / 36.73 MB — 82/82 present, 0 missing.** Downloaded at
extraction time (Airtable URLs expire within hours).

## 2. Verification (read-only, R2 only)

| Check | Result |
|---|---|
| Run state | `_run.json` status **complete**, 49/49 entities, cursor cleared |
| Top manifest | finalized — 493,506 records |
| Shard sums == manifest totals | ✅ every entity |
| Shard objects exist, byte sizes match | ✅ all |
| Combined hash recomputed from ordered shard hashes | ✅ all |
| Sample shard content re-hashed (sha256) | ✅ all `sampleHashOk: true` |
| Attachment bodies | 82/82 present, sizes match |
| **Pipedrive file bodies present** | **0** ✅ (metadata only, as designed) |
| Excluded passwords table | never planned, never read, no objects |
| **LegacyRecord count** | **0** ✅ nothing imported |
| Storage | **285 objects · 782.7 MB** |

## 3. The optimization (Option C) — measured

| | Before | After | Reduction |
|---|---:|---:|---:|
| deal_products requests | 15,639 (1/deal) | **202** (v2 bulk, 100 ids/call) | **98.7%** |
| Target-list discovery | 49 (`/deals` re-page) | **0** (read from R2 snapshot) | 100% |
| Total remaining Pipedrive | ~16,894 | **1,414 actual** | **~92%** |
| Calendar time | ~8.7 days | **14.1 min** | — |
| Cost | top-up considered | **€0** | — |

**Field parity verified live** — the v2 bulk response carried every frozen-spec
field, so the v1→v2 switch is lossless:
`deal_id, product_id, name, quantity, item_price, sum, currency, discount,
discount_type, tax, tax_method, comments, order_nr, add_time, update_time,
is_enabled, product_variation_id, billing_*`.
`comments` (HTML pricing wording — package semantics live only there) and
`order_nr` (line ordering) both present. The gate would have aborted **before
writing** had any been missing.

## 4. Scope boundaries (unchanged)

- **IN:** all raw records (both systems) + 82 Airtable attachment bodies + Pipedrive
  file **metadata** + product catalog + config/reference bundle.
- **METADATA ONLY:** 170,421 Pipedrive files (~21 GiB of bodies **not** copied).
  Bodies remain gated behind the Files slice, which must first produce the
  classification report and a copy plan for owner approval. **No exclusions are
  hardcoded.**
- **DEFERRED:** deal stage-change flow → native-timeline slice.
- **OUT:** no import, no transform, no mapping, no merge, no LegacyRecord writes,
  no production-entity writes. Drive/Photos preserved as **links only**.

## 5. Safety layer (live)

- `MIGRATION_EXTRACTION_ENABLED=false` by default — set **shell-only** for the one
  approved run; **never** on the Railway service.
- `MIGRATION_MAX_REQUESTS` mandatory hard **cumulative** ceiling, checked before
  every request. The Pipedrive client cannot be constructed without a budget guard.
- Counter persisted to R2 → a process restart cannot reset the allowance.
- Daily-budget 429 → immediate pause, no hidden retry, checkpoint preserved.
- No auto-resume, no cron, no scheduler. `/api/migration/status.latestRun` reports
  requests-vs-ceiling and pause reason.

## 6. Rollback

The snapshot is immutable and inert: nothing reads it yet. To discard, delete the
`snapshots/snap-20260714T125052Z-aaaa/` prefix and the MigrationRun row. No GOS
production data exists to roll back — LegacyRecord is 0.
