# Legacy migration tooling (ONE-TIME)

Single-purpose scripts for the Pipedrive + Airtable → GOS migration. **Not** a reusable import
framework.

The `*-audit.mjs` / `plan-*.mjs` / `verify-*.mjs` probes are read-only. The `run-*-import.mjs`
runners DO write to the GOS database, but only with `--execute` (dry-run is the default) and
never to Pipedrive or Airtable.

## Snapshot contract

Every importer declares the snapshot entities it requires and validates them before doing any
work (`src/migration/snapshotContract.js`). Snapshots are deliberately scoped — the cutover
Final Snapshot omits `pipedrive/files` — so a missing entity must fail loudly with a remedy,
never crash late on a raw `NoSuchKey` and never degrade to a silent zero. Both of those failure
modes existed and were fixed on 2026-07-29:

- the identity import streamed `pipedrive/files` (an omitted entity) with no handling;
- the cutover import streamed `pipedrive/deal_participants` behind `.catch(() => {})`, so a
  missing entity silently produced deals with no participant links.

`pipedrive/deal_participants` is now a canonical entity in `pipedrivePlan()` — every fresh
snapshot contains it by construction.

## Safety contract

- **Legacy systems are GET-only.** These scripts never write to Pipedrive or Airtable.
- **No secrets in output.** Tokens are never printed/logged/committed; `lib.redact()` is a backstop.
- Raw inventory is written to `output/` (gitignored) — never commit legacy structure/data.

## Scripts

- `lib.mjs` — shared helpers (env loading, secret-safe logging, rate-limit capture, JSON output).
- `pipedrive-audit.mjs` — connection test + structural inventory (pipelines, stages, field
  definitions, activity types, deal counts/status distribution, presence probes).
- `airtable-audit.mjs` — connection test + schema inventory for BOTH bases (tables, field types,
  linked/formula/rollup/lookup/attachment fields, views); `--counts` adds bounded record counts.

## Running (read-only, no deploy)

Requires the tokens in the process env. Preferred: a **gitignored** `server/.env` with
`PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_COMPANY_DOMAIN`, `AIRTABLE_PERSONAL_ACCESS_TOKEN`,
`AIRTABLE_MAIN_BASE_ID`, `AIRTABLE_LEGACY_BASE_ID`. Then, from `server/`:

```
node scripts/migration/pipedrive-audit.mjs
node scripts/migration/airtable-audit.mjs            # schema only
node scripts/migration/airtable-audit.mjs --counts   # + bounded record counts
```

Alternatively via Railway (vars must be applied to a service first):
`railway run --service Grafitiyul-OS node scripts/migration/pipedrive-audit.mjs`

Full findings: `docs/architecture/GOS-migration-external-readiness-audit.md`.
