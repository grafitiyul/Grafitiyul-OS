# GOS — External Read-Only Readiness Audit (Pipedrive + Airtable)

**Status:** First external audit. READ-ONLY tooling built and verified; live connection tests are
**BLOCKED** — the five migration variables are not reachable by any read path yet (details below).
No writes to Pipedrive, Airtable, or GOS. No full extraction. No deployment triggered.
**Companion to:** `GOS-migration-preparation-plan.md`, `GOS-migration-readiness-audit.md`.
**Tooling:** `server/scripts/migration/{lib,pipedrive-audit,airtable-audit}.mjs` (this commit).
**Last updated:** 2026-07-14

---

## 0) Headline

The audit **cannot run yet**, for one concrete reason: the configured tokens
(`PIPEDRIVE_*`, `AIRTABLE_*`) exist nowhere the audit can read them — not in Railway's applied
config for **any** service in the project, and not in a local `.env`. This was verified, not
assumed. The read-only audit scripts are written, syntax-checked, and their safety guard is
proven (they make **zero** network calls without credentials). The moment the tokens are made
reachable, one command per system produces the full inventory.

I did **not** deploy anything to expose the variables (per the explicit instruction).

## 1) STEP 1 — Configuration verification

### 1a) Are the env-var names appropriate? — YES, no rename needed.

| Variable | Verdict | Note |
|---|---|---|
| `PIPEDRIVE_API_TOKEN` | ✅ appropriate | Matches Pipedrive's personal API-token auth (v1 `api_token`). |
| `PIPEDRIVE_COMPANY_DOMAIN` | ✅ appropriate | The API host is `{domain}.pipedrive.com`. The script normalizes a bare subdomain, a `*.pipedrive.com` value, or a full URL, so either form works. |
| `AIRTABLE_PERSONAL_ACCESS_TOKEN` | ✅ appropriate | Airtable deprecated API keys; PAT is the current mechanism. |
| `AIRTABLE_MAIN_BASE_ID` | ✅ appropriate | Base IDs are `app…`; role-named clearly. |
| `AIRTABLE_LEGACY_BASE_ID` | ✅ appropriate | Distinguishes the second base. |

They follow existing GOS env conventions (compare `R2_*`, `WOOCOMMERCE_*`, `EMAIL_TOKEN_KEY`).

### 1b) Is a deployment required? — NO.

The audit is a **local, read-only, one-off command**. It does not belong in the running app and
must not trigger a production redeploy. Two credential paths make the tokens reachable to the
one-off; both are supported by the scripts (`import 'dotenv/config'` + plain `process.env`):

- **Path A — local gitignored `.env` (recommended; ZERO production impact).** Put the five
  variables in `server/.env` (already covered by `.gitignore`), then run the scripts directly.
  Nothing on Railway changes; no deploy; delete the `.env` after the audit.
- **Path B — `railway run` injection.** Requires the variables to be **applied** to a Railway
  service's config first (which may queue a redeploy of that service). More production impact
  for no audit benefit — hence Path A is preferred for a pure read-only audit.

### 1c) Current blocker — verified, not assumed.

| Check | Result |
|---|---|
| `railway run` against linked **production / Grafitiyul-OS** (43 vars) | migration vars: **none** |
| `gos-whatsapp-main` (18 vars), `gos-whatsapp-office` (18), `Postgres` (34) | migration vars: **none** |
| Local `server/.env` / `.env` | **absent** (no local env files at all) |
| `railway run node …pipedrive-audit.mjs` | script correctly reports **BLOCKED**, exits 2, **no network call** |

Interpretation: the variables were configured in the Railway dashboard but are **not in the
applied environment config** the CLI reads — matching the note "they have not yet been deployed."
Railway's staged-changes model means dashboard edits stay pending until applied. R2 credentials
(also on the service) **are** present via `railway run`, confirming the CLI path works and the
migration vars are genuinely still pending. (Var **names + value lengths** were the only things
inspected; no secret value was ever printed, logged, or written.)

## 2) STEP 2 — Connection-test results

**Both: NOT YET EXECUTED (blocked on §1c).** Reporting these as "successful" would be
fabrication. What exists and is verified instead:

- ✅ Read-only connection tests written for both systems (`getJson` is GET-only by construction).
- ✅ Syntax-checked (`node --check` clean on all three files).
- ✅ Safety guard proven: with no credentials, each script prints the remediation and exits
  **without touching the network**.
- ✅ Secret hygiene: tokens never enter logs/output; `lib.redact()` scrubs `api_token=`,
  `Bearer …`, and `pat…` patterns as a backstop; raw inventory writes to a **gitignored** dir.

When unblocked, each script reports exactly what Step 2 asks for:
**Pipedrive** (`GET /users/me`) → connection ok, authenticated user + company name/id/country,
API v1, admin flag, `access[]` app grants, and captured `x-ratelimit-*` / `x-daily-requests-left`
headers. **Airtable** (`GET /meta/bases`) → connection ok, list of PAT-accessible bases, and
per-configured-base validation (in accessible list? schema readable? base name? permission level?)
for **both** `AIRTABLE_MAIN_BASE_ID` and `AIRTABLE_LEGACY_BASE_ID`.

## 3) STEP 3 — External structure inventory

**NOT YET EXECUTED (blocked).** The scripts are built to collect, on first authorized run:

- **Pipedrive:** pipelines; stages (with pipeline + probability); deal/person/organization/
  activity **field definitions** split standard-vs-custom (names + types only, with option-set
  labels for status/stage mapping); activity types; deal **counts + status distribution**
  (open/won/lost) via `GET /deals/summary` (no paging); and read-minimal presence probes for
  persons, organizations, activities (done/undone), notes, files, products. Full JSON →
  `server/scripts/migration/output/pipedrive-audit.json`.
- **Airtable (both bases):** base identity (name + permission level); every table with fields +
  field types; linked-record fields (with target table id); formula / rollup / lookup fields;
  attachment fields; views; and — with `--counts` — a **bounded** record count per table
  (capped at 2,000/table, never a full extraction). Full JSON →
  `server/scripts/migration/output/airtable-audit.json`.

## 4) STEP 4 — Discovery (deal↔tour linkage, operational scope, duplication)

**Deferred to the first authorized run** — these are questions the data answers, and the
inventory scripts surface exactly the evidence needed:

- Operational Pipedrive pipelines/stages → from `pipelines`/`stages` + per-status deal counts
  (a pipeline with recent open deals is live; an empty/archived one is not).
- **Deal↔Tour shared key** → cross-reference Pipedrive custom-field **names** against Airtable
  linked-record and field names for a common id/order-number/date/phone/email; the field
  censuses on both sides are printed side by side for this exact comparison.
- Airtable tables holding **future tours** → table names + (with `--counts`) volumes; a date
  field census in M1 confirms which hold forward-dated rows.
- Overlap/duplication and any Make.com integration fields → visible as custom-field names
  (e.g. a "Make"/"scenario"/"sync id" field) in either census.

No product-owner questions will be asked that these API pulls can answer.

## 5) STEP 5 — Immutable snapshot storage recommendation

**Recommendation: a DEDICATED, PRIVATE R2 bucket** (reusing the existing R2 account/credentials
infrastructure — not a new product, not a generalized subsystem), e.g. `gos-migration-snapshots`,
with **public access DISABLED**.

**Why not a prefix in the existing app bucket:** the live bucket is configured for **public
serving** (`R2_PUBLIC_BASE_URL` is set and used for MediaFile images, tour-gallery customer pages,
and quote images). Raw legacy snapshots are ~15 years of **customer PII**; they must never sit in
a bucket that serves objects publicly by key. A private, separate bucket is the isolated, secure
choice and is still pure reuse of existing R2 infrastructure.

Proposed layout (write-once / immutable):

```
gos-migration-snapshots/            (private bucket, no public domain)
  pipedrive/<snapshotId>/…          (raw JSON per entity type + attachments)
  airtable/<baseRole>/<snapshotId>/…
  _manifests/<snapshotId>.json      (counts, checksums, startedAt/finishedAt)
```

- `snapshotId` is time-stamped + immutable; new pulls never overwrite prior snapshots.
- Objects are never deleted before final decommission (insurance backup).
- Attachments are streamed in **at extraction time** (Airtable URL-expiry trap), with checksums
  recorded in the manifest.

If a separate bucket is undesirable, the only safe alternative in the shared bucket is a prefix
**plus a bucket policy/lifecycle proven to block public reads for that prefix** — verify the
bucket's public setting before choosing this. The separate private bucket avoids that risk
entirely and is recommended.

## 6) STEP 6 — Report items

1. **Connection tests:** built + verified read-only; **not executed** — blocked on §1c.
2. **Accessible legacy systems/bases:** unknown until run; both Airtable base IDs are validated
   automatically on first run.
3. **Pipedrive structure summary:** pending first run (scope defined in §3).
4. **Airtable structure summary:** pending first run (scope defined in §3).
5. **Likely Deal↔Tour linking:** pending; discovery method defined in §4.
6. **Data volumes:** pending; deal counts (exact, via summary) + bounded Airtable counts on run.
7. **Attachment risks:** Airtable attachment URLs **expire within hours** — extractor must
   download at pull time (already a locked design point); Pipedrive files need per-file GETs.
   Volume unknown until §3 runs.
8. **Questions genuinely needing the product owner** (nothing the API can answer):
   - a) Make the tokens reachable via **Path A (local `.env`)** or apply them on Railway
     (**Path B**)? Path A recommended — no deploy.
   - b) Approve a **dedicated private R2 bucket** for snapshots (§5)?
   - c) Airtable "legacy" base — the owner's one-line intent (what era/purpose) to sanity-check
     against the discovered schema.
   - d) Are both Airtable bases the **complete** operational scope, or do other bases exist?
9. **Recommended immutable snapshot location:** dedicated private R2 bucket, layout in §5.
10. **Exact next step for the first controlled snapshot extraction:**
    1. Make credentials reachable (Path A: create gitignored `server/.env` with the 5 vars).
    2. Run `node server/scripts/migration/pipedrive-audit.mjs` and
       `node server/scripts/migration/airtable-audit.mjs --counts` (read-only; produces the §3
       inventory).
    3. Review the two inventories + complete §4 discovery from the printed censuses.
    4. Provision the private snapshot bucket (§5).
    5. **Only then** build the extractor (M1) targeting that bucket — not before the inventory
       is reviewed. Snapshot extraction itself is a separate, later, approved step.

---

## Appendix — safety posture of this step (all upheld)

- No writes to Pipedrive / Airtable / GOS. GET-only by construction.
- No full extraction. No business records created/updated/merged/deleted.
- No tokens exposed: only variable **names** + value **lengths** inspected; nothing printed,
  logged, or committed. Raw audit output dir is gitignored.
- No deployment triggered to expose variables.
- Blocker reported honestly rather than papered over with a plausible-looking result.
