# GOS Legacy Migration — Phase 2A Readiness Report (Connectivity & Dry Run)

**Slice 2, Phase 2A.** Read-only. No snapshots, no bucket writes, no destination
writes. Run live against production via `railway run --service Grafitiyul-OS node
scripts/migration/phase2a-readiness.mjs` on **2026-07-14**.

**VERDICT: READY** — 0 blocking issues, 1 informational warning (normal live
drift). Full machine output: `server/scripts/migration/output/phase2a-readiness.json`
(gitignored — contains legacy structure).

> Phase 2B (bucket provisioning + snapshot infrastructure) is **gated on an
> owner/ops step**: the private snapshot bucket + `MIGRATION_R2_*` credentials do
> not yet exist. See §7. I cannot create or validate the bucket without them.

---

## 1. Connectivity · Authentication · Permissions

| System | Result | Detail |
|---|---|---|
| **Pipedrive** | ✅ authenticated | `GET /users/me` → user **Elinoy**, `is_admin=1`, active. Full-account visibility confirmed (admin token). Company domain reachable, API v1. |
| **Airtable** | ✅ authenticated | `GET /meta/bases` → **2 bases** accessible. Both configured base IDs resolve to their expected bases with schema-read + record-read permission. |

Both tokens work read-only. No secret value was printed, logged, or written.

## 2. Rate-limit information

| System | Signal | Observed | Pacing used | Headroom |
|---|---|---|---|---|
| **Pipedrive** | `x-ratelimit-limit` / `-remaining` / `-reset` | limit **80**, remaining 79, reset 2s (per-~2s burst budget) | 130 ms between calls (~1 req / 2 s effective) | Wide — never approached the burst ceiling across ~2,600 requests |
| **Airtable** | 5 req/sec/base | no `429` encountered | 220 ms between calls + automatic `retry-after` backoff | Comfortable |

Conclusion: the extraction can run comfortably within both providers' limits with
the current conservative pacing. Snapshot #1 will reuse the same throttle + a
resumable cursor so a rate-limit pause never loses progress.

## 3. Pagination & entity enumeration

Every required entity was enumerated end-to-end (multi-page pagination proven):

| Entity | Mechanism | Pages | Enumerable |
|---|---|---|---|
| Pipedrive deals (all / archived / non-archived) | v1 `archived_status` + `start/limit` | 49 (all) | ✅ |
| Pipedrive persons | v1 `start/limit` | 65 | ✅ |
| Pipedrive organizations | v1 `start/limit` | 6 | ✅ |
| Pipedrive notes | v1 `start/limit` | 148 | ✅ |
| Pipedrive activities (all users) | v1 `start/limit` | 310 | ✅ |
| Pipedrive deal products + product fields | `/deals/{id}/products`, `/productFields` | probe | ✅ |
| Pipedrive files (attachment metadata) | v1 `start/limit` | 1,705 | ✅ |
| Airtable tables (both bases) | Meta API | — | ✅ |
| Airtable operational records | `offset` paging, 1-field projection | — | ✅ |
| Airtable attachment fields | `offset` paging, single-field projection | — | ✅ |

## 4. Count reconciliation vs frozen audit

| Metric | Audited (M1/M1b) | Phase 2A (live) | Δ | Note |
|---|---:|---:|---:|---|
| Deals — total | 24,356 | **24,356** | 0 | ✅ exact |
| Deals — archived | 19,448 | **19,448** | 0 | ✅ exact |
| Deals — non-archived | 4,908 | 4,910 | +2 | live drift |
| — open / won / lost | 70 / 1,620 / 3,218 | 69 / 1,622 / 3,219 | small | live drift |
| Persons | 32,470 | 32,472 | +2 | live drift |
| Organizations | 2,905 | **2,905** | 0 | ✅ exact |
| Notes | (unmeasured) | 73,555 | new | now measured |
| Activities | (unmeasured) | 154,687 | new | now measured |
| Airtable main tables | 24 | **24** | 0 | ✅ exact |
| Airtable legacy tables | 16 | **16** | 0 | ✅ exact |

**The small drift (+2 deals, +2 persons, one open→won) is normal** — the business
kept operating in the days since the audit. This is exactly why the strategy
freezes a point-in-time Snapshot #1 and later runs a delta + reconcile before
cutover. Not a blocker.

Airtable operational tables — now counted **exactly** (audit had them capped at
"2000+"), which becomes the Snapshot #1 reconciliation baseline:

| Table | Records |
|---|---:|
| סיורים (tours) | 3,506 |
| משתתפים (participants) | 4,409 |
| מעקב תשלומים (payment tracking) | 1,702 |
| שכר (payroll) | 2,551 |
| לקוחות עסקיים (business customers) | 599 |
| סיכומי סיור (tour summaries) | 294 |

## 5. Attachment census — EXACT counts + sizes (new in 2A)

The prior audits left Pipedrive files **unmeasured**. Now measured exactly.

### Pipedrive files — `170,412 files · 21.07 GiB` (22.62 GB)

| Split | Count | Meaning |
|---|---:|---|
| `remote_location = s3` | 169,544 | **Pipedrive-hosted uploads** — real bytes, downloadable; a file-body copy would move these |
| `remote_location = url` | 868 | external link-type files |
| **Entity-linked** (deal 10,243 · person 139 · org 16) | **10,398** | the operationally-relevant subset |
| **Unlinked** | 160,014 | mostly email/calendar-sync artifacts (see below) |

Type histogram (top): `img` 97,271 · `pdf` 58,747 · `ics` 8,902 (calendar
invites) · `csv` 1,005 · `docx` 929 · `xlsx` 738 · `eml` 395. The `ics`/`eml`
volume + the 160,014 unlinked files strongly indicate **Pipedrive's email &
calendar sync generated most files**, not deliberate deal attachments.

**Implication for scope (not decided here):** only ~10,398 files are attached to
a deal/person/org. The 160,014 unlinked sync artifacts are candidates to skip in
the eventual file-body copy. This is a decision for the dedicated **file slice
(S11)**, which is already gated behind a pre-copy report — this census *is* the
start of that report.

### Airtable attachments — `82 files · 36.73 MB`

| Field | Files | Size |
|---|---:|---:|
| main · מוצרים · נקודת המפגש באימייל אישור | 11 | 6.18 MB |
| legacy · מוצרים · נקודת המפגש באימייל אישור | 40 | 19.15 MB |
| legacy · ✨ניסוחים לקוחות עסקיים · תמונה מצורפת | 31 | 11.40 MB |

Tiny — **but Airtable attachment URLs expire within hours**, so unlike the stable
Pipedrive `s3` files these must be captured **at snapshot time** (bodies), not
deferred. 37 MB is trivial to pull inline in Snapshot #1.

## 6. Google Drive / Google Photos classification

The classifier distinguishes Drive folders, Drive files, Google Photos albums,
and malformed values. Both link fields classify cleanly:

| Field | drive_folder | google_photos | drive_other | malformed |
|---|---:|---:|---:|---:|
| Pipedrive deal · תיקייה בדרייב | 4,440 | 2,157 | 1,922 | 2 |
| Airtable tour · לינק לתיקייה בדרייב | 1,033 | 1,982 | 197 | 10 (not-a-URL) |

Confirms the earlier finding: a large share are **Google Photos albums**, a
distinct class from Drive folders — preserved as **link values only** (never
copied; Photos content is outside both APIs). The malformed handful
("כן"/"לא"/"אין לינק"-type free text) is validated, not preserved as a link.

## 7. Exclusions & archived-deal accessibility

- **Excluded passwords table `גישה, סיסמאות`** — confirmed **present in the legacy
  base schema, records NEVER read** (verified via Meta API only; the census loop
  explicitly skips it). Exclusion holds. ✅
- **Archived deals remain fully accessible without restore** — sample archived
  deal `#8` (`is_archived=true`) returned successfully by-id **and** for every
  sub-resource: products ✅, activities ✅, files ✅, notes ✅. Extraction of the
  19,448 archived deals needs no un-archiving. ✅

## 8. Blocking issues

**None.** One informational warning: non-archived deal count 4,910 vs audited
4,908 (+2) — normal live drift, handled by the snapshot→delta→reconcile model.

---

## 9. Gate before Phase 2B — owner/ops provisioning required

Phase 2B (provision + validate the snapshot bucket, then build the writer /
manifests / checksums / resumable runs) **cannot begin** until the dedicated
private snapshot storage exists. Currently **all 4 vars are unset**:

- `MIGRATION_R2_ACCOUNT_ID`
- `MIGRATION_R2_ACCESS_KEY_ID`
- `MIGRATION_R2_SECRET_ACCESS_KEY`
- `MIGRATION_R2_BUCKET`

**Required (per the approved design):**
1. Create a **new private R2 bucket** `gos-migration-snapshots` — **public access
   OFF** (15 yr of PII; presigned-only). Not the public app bucket.
2. Create a scoped R2 API token (read/write to that bucket only).
3. Set the 4 `MIGRATION_R2_*` vars on the `Grafitiyul-OS` service.

Once set, `GET /api/migration/status` will report
`config.readyForExtraction = true` and I can proceed to 2B → 2C.

## 10. What Snapshot #1 (2C) will and won't contain — design confirmed by 2A

Consistent with the frozen 13-slice roadmap (files are their own gated slice):

- **IN:** all raw **records** — deals (`archived_status=all`), deal products,
  persons, organizations, notes, activities, deal stage-change history, plus
  Airtable operational tables (both bases; passwords excluded). Immutable JSONL +
  manifests + checksums, one write-once `snapshotId`.
- **IN (body):** the **82 Airtable attachments (37 MB)** — captured inline
  because their URLs expire.
- **METADATA ONLY:** the **170,412 Pipedrive file** records (the census above).
  The 21 GiB of file **bodies** are deferred to the dedicated file slice (S11),
  which is gated behind the pre-copy report this census begins.
- **OUT:** nothing imported / transformed / mapped / merged; no LegacyRecord
  writes; no Review Center.

---

*Read-only tooling: `server/scripts/migration/phase2a-readiness.mjs`. Re-runnable
any time; writes only to the gitignored `output/` dir.*
