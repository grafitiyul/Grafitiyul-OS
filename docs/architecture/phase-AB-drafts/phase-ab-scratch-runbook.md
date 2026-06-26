# GOS — Phase A+B Scratch-DB Validation Runbook

**Status:** Runbook (documentation). Describes how to validate Phase A+B on a **scratch / cloned**
database. Nothing here has been run. **Never point any step at production.**
**Artifacts used:** `phase-a-models.prisma`, `phase-b-backfill.draft.mjs`, `phase-ab-verification.sql`
(same folder).
**Last updated:** 2026-06-24

---

## 1) Goal

Prove, on a **disposable scratch copy of the production database**, that:
- Phase A DDL applies cleanly (new tables + `citext` + partial indexes + the one additive
  `PersonRef.teamMemberId` column),
- the Phase B backfill is correct and **idempotent**,
- and **nothing that production depends on changes** — admin auth and guide-portal tokens are
  byte-for-byte preserved, and `/admin` setup stays **locked**.

This runbook never touches production, the live schema, or the deploy path.

---

## 2) Preconditions

### 2.1 Use a CLONE with real data
For parity and the portal-token fingerprint to mean anything, the scratch DB must be a **data clone
of production**, produced from a backup/dump — never by connecting tooling to prod.

```bash
# Take a dump from a READ replica or an existing backup (not live prod if avoidable):
pg_dump "$PROD_READONLY_URL" --no-owner --no-privileges -Fc -f ./scratch-prod.dump
# Restore into a fresh scratch database you control:
createdb gos_scratch
pg_restore --no-owner --no-privileges -d "$SCRATCH_DATABASE_URL" ./scratch-prod.dump
```
> An EMPTY scratch DB only validates DDL + idempotency. Parity/fingerprint checks (STEP 2/5 of the
> verification SQL) require cloned data. Do the full run with a clone.

### 2.2 Required environment variables
Set **only** the scratch URL. Do **not** export production's `DATABASE_URL` in this shell.

```bash
export SCRATCH_DATABASE_URL='postgresql://USER:PASS@localhost:5432/gos_scratch'
export SHADOW_DATABASE_URL='postgresql://USER:PASS@localhost:5432/gos_scratch_shadow'  # for migrate dev
export PROD_HOST_FRAGMENT='rlwy.net'   # <-- put YOUR real prod host fragment here so the guard can catch it
```
PowerShell equivalents:
```powershell
$env:SCRATCH_DATABASE_URL = 'postgresql://USER:PASS@localhost:5432/gos_scratch'
$env:SHADOW_DATABASE_URL  = 'postgresql://USER:PASS@localhost:5432/gos_scratch_shadow'
$env:PROD_HOST_FRAGMENT   = 'rlwy.net'
```

### 2.3 Railway / DB setup assumptions
- The scratch DB is a **separate instance/database** from the Railway production DB. Ideally local
  Postgres or a throwaway Railway DB — never the production database, never the production branch.
- You have `psql`, `pg_dump`/`pg_restore`, Node ≥ 20, and the repo's Prisma 5.22 toolchain.
- The scratch role can create databases and extensions (see 2.4).

### 2.4 citext privilege check (must pass before Phase A)
```bash
psql "$SCRATCH_DATABASE_URL" -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;"
psql "$SCRATCH_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS citext;" && \
psql "$SCRATCH_DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname='citext';"
```
EXPECT: the extension row returns. If `CREATE EXTENSION` is denied, **stop** — the production role
must be confirmed able to create `citext` *before* Phase A is ever scheduled (record this as a prod
prerequisite).

### 2.5 Backup / clone requirement
- The scratch DB is disposable; you may drop/recreate it freely.
- The **source** must come from a dump/backup. Never run mutation tooling against production to
  produce the clone.

---

## 3) Exact command sequence

> Run from a normal dev shell, **not** the project deploy terminal. Every Prisma/psql command below
> targets `--schema "$SCRATCH_SCHEMA"` and `$SCRATCH_DATABASE_URL` explicitly.

### 3.0 Create an isolated scratch working copy (keeps server/prisma untouched)
```bash
export SCRATCH_DIR="$(mktemp -d)/gos-scratch-prisma"
mkdir -p "$SCRATCH_DIR"
cp server/prisma/schema.prisma "$SCRATCH_DIR/schema.prisma"
export SCRATCH_SCHEMA="$SCRATCH_DIR/schema.prisma"
echo "Scratch schema: $SCRATCH_SCHEMA"
```
PowerShell:
```powershell
$env:SCRATCH_DIR = Join-Path $env:TEMP 'gos-scratch-prisma'
New-Item -ItemType Directory -Force $env:SCRATCH_DIR | Out-Null
Copy-Item server\prisma\schema.prisma (Join-Path $env:SCRATCH_DIR 'schema.prisma')
$env:SCRATCH_SCHEMA = Join-Path $env:SCRATCH_DIR 'schema.prisma'
```

### 3.1 Merge Phase A models into the scratch schema
Manually edit `$SCRATCH_SCHEMA`:
- Append the enums + 7 models from `phase-a-models.prisma`.
- Add the two `PersonRef` lines (`teamMemberId` + relation) and `@@index([teamMemberId])` to the
  **existing** `PersonRef` model.
- Add `personRefs PersonRef[]` to `TeamMember` (already in the fragment).
> This edits the **scratch copy only**. `server/prisma/schema.prisma` is not touched.

### 3.2 Validate
```bash
npx prisma validate --schema "$SCRATCH_SCHEMA"
```
EXPECT: "The schema is valid". (Fixes any relation/casing issues before generating SQL.)

### 3.3 Generate the migration on scratch — WITHOUT applying
```bash
# guard first (see §4), then:
DATABASE_URL="$SCRATCH_DATABASE_URL" \
npx prisma migrate dev --schema "$SCRATCH_SCHEMA" \
  --name phase_a_foundation --create-only
```
`--create-only` writes the migration SQL but does **not** apply it.

### 3.4 Inspect the generated SQL (human review)
```bash
ls "$SCRATCH_DIR/migrations"/*_phase_a_foundation/
cat "$SCRATCH_DIR/migrations"/*_phase_a_foundation/migration.sql
```
EXPECT: only `CREATE TABLE` for the 7 new tables, new enums, indexes, FKs, and a single
`ALTER TABLE "PersonRef" ADD COLUMN "teamMemberId"`. **Confirm exact column casing** here, then
update `phase-ab-verification.sql` / raw SQL if casing differs.

### 3.5 Apply the migration to scratch
```bash
# guard first, then:
DATABASE_URL="$SCRATCH_DATABASE_URL" \
npx prisma migrate dev --schema "$SCRATCH_SCHEMA"
```

### 3.6 Apply raw SQL (extension + partial unique indexes)
```bash
psql "$SCRATCH_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS citext;"
psql "$SCRATCH_DATABASE_URL" <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS user_username_active_uq
  ON "User" (username) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_email_active_uq
  ON "User" (email) WHERE "deletedAt" IS NULL AND email IS NOT NULL;
SQL
```

### 3.7 Generate the Prisma client for the scratch schema
```bash
npx prisma generate --schema "$SCRATCH_SCHEMA"
```

### 3.8 Capture STEP 0 baselines (BEFORE backfill)
```bash
psql "$SCRATCH_DATABASE_URL" -f docs/architecture/phase-AB-drafts/phase-ab-verification.sql \
  > scratch-step0.txt   # run only the STEP 0 section, or capture all and read STEP 0
```
Record especially **0.3 `token_fingerprint`** and the admin/person counts.

### 3.9 Backfill — DRY RUN first
```bash
# guard first, then:
DATABASE_URL="$SCRATCH_DATABASE_URL" \
node docs/architecture/phase-AB-drafts/phase-b-backfill.draft.mjs --dry-run
```
EXPECT: log lines describing intended upserts; **no writes**.

### 3.10 Backfill — REAL (scratch)
```bash
# guard first, then:
DATABASE_URL="$SCRATCH_DATABASE_URL" \
node docs/architecture/phase-AB-drafts/phase-b-backfill.draft.mjs
```

### 3.11 Backfill AGAIN — idempotency
```bash
DATABASE_URL="$SCRATCH_DATABASE_URL" \
node docs/architecture/phase-AB-drafts/phase-b-backfill.draft.mjs
```
EXPECT: completes with no new rows (STEP 7 confirms equal counts).

### 3.12 Run the full verification SQL
```bash
psql "$SCRATCH_DATABASE_URL" -f docs/architecture/phase-AB-drafts/phase-ab-verification.sql \
  > scratch-verify.txt
```
Read every `EXPECT` (see §5).

---

## 4) Safety guard — run before EVERY write step (3.3, 3.5, 3.9-real, 3.10, 3.11)

Paste this function once, then call `assert_scratch` immediately before each dangerous command.

```bash
assert_scratch() {
  if [ -z "$SCRATCH_DATABASE_URL" ]; then echo "ABORT: SCRATCH_DATABASE_URL unset"; return 1; fi
  if [ -n "$PROD_HOST_FRAGMENT" ] && printf '%s' "$SCRATCH_DATABASE_URL" | grep -qi "$PROD_HOST_FRAGMENT"; then
    echo "ABORT: SCRATCH_DATABASE_URL contains prod fragment '$PROD_HOST_FRAGMENT'"; return 1; fi
  # Confirm what we are actually connected to:
  echo "Target DB:"; psql "$SCRATCH_DATABASE_URL" -tAc \
    "SELECT current_database() || ' @ ' || COALESCE(host(inet_server_addr()),'local');"
  case "$(psql "$SCRATCH_DATABASE_URL" -tAc 'SELECT current_database();')" in
    *prod*|*production*) echo "ABORT: database name looks like production"; return 1;;
  esac
  echo "Guard passed (scratch)."
}
```
PowerShell variant:
```powershell
function Assert-Scratch {
  if (-not $env:SCRATCH_DATABASE_URL) { throw "ABORT: SCRATCH_DATABASE_URL unset" }
  if ($env:PROD_HOST_FRAGMENT -and $env:SCRATCH_DATABASE_URL -match [regex]::Escape($env:PROD_HOST_FRAGMENT)) {
    throw "ABORT: scratch URL contains prod fragment" }
  $db = (& psql $env:SCRATCH_DATABASE_URL -tAc "SELECT current_database();").Trim()
  if ($db -match 'prod') { throw "ABORT: database name looks like production" }
  Write-Host "Guard passed (scratch): $db"
}
```
Rule: **if the guard prints anything resembling the production host or database name, stop and fix
the env before continuing.** Never override the guard.

---

## 5) Expected outputs / pass conditions

| Check (verification SQL) | Pass condition |
|---|---|
| 1.1 new tables | 7 rows |
| 1.2 `PersonRef.teamMemberId` | exists, `is_nullable = YES` |
| 1.3 partial unique indexes | both present |
| 1.4 citext | installed |
| 2.1 admin parity | `admin_active == mirrored_active_admins` |
| 2.2 team parity | `distinct_external_ids == mirrored_team_members` |
| 2.3 profile parity | equal |
| 3.1 admin completeness | **0 rows** |
| 3.2 team completeness | **0 rows** |
| 3.3 link completeness | **0** (or explained allow-list) |
| 3.4 no orphan TeamMember | **0 rows** |
| 4.1 passwordHash verbatim | **0 rows** |
| 4.2–4.4 duplicates | **0 rows** each |
| 4.5 link cross-wiring | **0 rows** |
| 4.6 phone data-quality | recorded (non-blocking) |
| **5.1 portal-token fingerprint** | **identical to STEP 0.3** (token_fingerprint, counts) |
| 5.2 portalEnabled count | identical to baseline |
| 5.3 broken portal rows | **0** |
| **6.1 bootstrap union count** | **> 0** ⇒ setup **LOCKED** |
| 6.2 new-table admin term | **> 0** |
| 7.1 idempotency counts | unchanged across 2nd backfill run |

**Three non-negotiables:** 5.1 (portal tokens byte-identical), 6.1 (setup locked), and 7.1
(idempotent). If any of these fail, Phase A+B is **not** validated.

---

## 6) Failure handling

- **`prisma validate` fails (3.2):** fix the scratch schema (usually a relation back-reference or
  casing). Re-run. Update `phase-a-models.prisma` so the source artifact matches.
- **Migration generation fails (3.3):** read the error; common causes are enum/relation conflicts
  with existing live models. Fix the scratch schema, delete the half-written
  `migrations/*_phase_a_foundation` dir, regenerate. Never hand-edit applied migrations.
- **Migration apply fails (3.5):** inspect partial state. Because it's scratch, the cleanest fix is
  **drop and recreate** the scratch DB (see below) and start from 3.6/clone again.
- **Backfill fails (3.10/3.11):** the script is idempotent — fix the cause and **re-run**; upserts
  resume safely. If data looks wrong, drop/recreate scratch and re-clone.
- **Verification fails (3.12):**
  - 5.1 fingerprint changed → the backfill touched portal tokens. **Stop**; this is a correctness
    bug in the script. Do not proceed to any prod planning.
  - 6.1 returns 0 → bootstrap would re-open setup. **Stop**; re-examine the union condition and the
    role/status mapping.
  - parity/completeness off → inspect the offending rows (the queries return them); usually a
    mapping or clone-data issue.
- **Drop & recreate scratch** (whenever state is uncertain):
  ```bash
  dropdb gos_scratch && createdb gos_scratch
  pg_restore --no-owner --no-privileges -d "$SCRATCH_DATABASE_URL" ./scratch-prod.dump
  ```

---

## 7) Explicitly forbidden actions

- ❌ **No `prisma migrate deploy` (or `dev`, `db push`) against production** or the production
  `DATABASE_URL`. Scratch only.
- ❌ **No editing `server/prisma/schema.prisma`** — all schema edits happen in the scratch copy.
- ❌ **No committing** anything (drafts or schema) before human review.
- ❌ **No Railway deploy from this branch.** Merging Phase A into the live schema = a production
  apply on next deploy; that is a separate, gated decision (§8), not part of validation.
- ❌ **No running the backfill against production**, even read-mostly. It writes the new tables and
  the `PersonRef` link column.
- ❌ **No overriding the §4 guard.**

---

## 8) Final "ready for production Phase A" gate

Production Phase A may be scheduled **only when ALL** hold:

1. Full scratch run completed on a **data clone**, with **every** §5 pass condition green —
   especially the three non-negotiables (token fingerprint identical, setup locked, idempotent).
2. Generated `migration.sql` reviewed by a human; it contains **only** the 7 additive tables, new
   enums, indexes, FKs, and the single nullable `PersonRef.teamMemberId` column — nothing
   destructive.
3. **citext privilege confirmed** on the production DB role (2.4) — or a fallback plan agreed.
4. Column-name casing in the verification SQL and raw-SQL indexes **reconciled** with the actual
   generated migration.
5. Rollback rehearsed on scratch (drop new tables + drop the `PersonRef.teamMemberId` column;
   confirm the app still behaves).
6. Sign-off that Phase A ships **DDL only**; the Phase B backfill runs as a **separate out-of-band
   script** (never inside the migration) so it cannot block `prisma migrate deploy`.
7. Sign-off that **no writer flips** in Phase A+B — auth stays on `AdminUser`, portal stays on
   `PersonRef`. (Writer flips are Phase C, separately gated.)

Until all seven are satisfied, **no one touches production.**
