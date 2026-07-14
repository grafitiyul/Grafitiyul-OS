# Legacy migration — read-only audit tooling (ONE-TIME)

Single-purpose scripts for the Pipedrive + Airtable → GOS migration. **Not** a reusable import
framework — just the read-only audit probes for this one migration.

## Safety contract

- **GET/read only.** These scripts never write to Pipedrive, Airtable, or the GOS database.
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
