// Pre-deploy validation for Prisma migrations. Catches the class of error that
// took production down (P3009 / SQLSTATE 42601 "INSERT has more target columns
// than expressions") BEFORE a migration is committed, plus obvious SQL syntax
// issues, then runs `prisma validate` + `prisma generate`.
//
// SQL is checked with the REAL PostgreSQL grammar via pg-query-emscripten (the
// libpg-query parser compiled to wasm) — not a hand-rolled parser. On top of the
// parser's AST we do one catalog-free check: for every INSERT with an explicit
// column list, the number of columns must equal the number of values (per VALUES
// row, or the SELECT target-list length). That is exactly the mismatch Postgres
// rejects at parse-analysis, which a raw parse alone does not catch.
//
// Usage:
//   node scripts/validate-migrations.mjs [file...]   // default: all migrations
// Exit code 0 = OK, 1 = problems found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import PgQuery from 'pg-query-emscripten';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'prisma', 'migrations');

// A FRESH parser instance per call: the emscripten module accumulates internal
// state and corrupts after repeated parses of large inputs (verified: reusing one
// instance fails on ~60% of real migrations; fresh-per-file → 0 failures). Init is
// cheap (~tens of ms) and a hook validates only the staged migration(s).
async function parser() {
  return typeof PgQuery === 'function' ? PgQuery() : PgQuery;
}

// Count the "values" a SELECT/VALUES source produces, or null if it can't be
// determined offline (e.g. SELECT *, set operations) — in which case we skip.
function valueArity(selectStmt) {
  const sel = selectStmt?.SelectStmt;
  if (!sel) return { skip: true };
  if (Array.isArray(sel.valuesLists)) {
    // INSERT ... VALUES (...), (...): every row must match; return the row lengths.
    const rows = sel.valuesLists.map((r) => (r.List?.items || r.items || []).length);
    return { rows };
  }
  if (sel.op && sel.op !== 'SETOP_NONE') return { skip: true }; // UNION/etc.
  if (Array.isArray(sel.targetList)) {
    const hasStar = sel.targetList.some((t) =>
      (t.ResTarget?.val?.ColumnRef?.fields || []).some((f) => f.A_Star),
    );
    if (hasStar) return { skip: true };
    return { rows: [sel.targetList.length] };
  }
  return { skip: true };
}

// Recursively collect every InsertStmt node (including those inside data-modifying
// CTEs, e.g. WITH x AS (INSERT ... RETURNING ...) INSERT ...).
function collectInserts(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return void node.forEach((n) => collectInserts(n, acc));
  if (node.InsertStmt) acc.push(node.InsertStmt);
  for (const k of Object.keys(node)) collectInserts(node[k], acc);
}

// Validate one SQL string. Returns an array of problem strings (empty = OK).
export async function validateSqlText(sql) {
  const p = await parser();
  let res;
  try {
    res = p.parse(sql);
  } catch (e) {
    return [`SQL parser error: ${String(e.message).split('\n')[0]}`];
  }
  if (res.error) {
    const at = res.error.cursorpos != null ? ` (position ${res.error.cursorpos})` : '';
    return [`SQL syntax error: ${res.error.message}${at}`];
  }
  const problems = [];
  const inserts = [];
  collectInserts(res.parse_tree, inserts);
  for (const ins of inserts) {
    const cols = ins.cols;
    if (!cols || !cols.length) continue; // no explicit column list → nothing to compare
    const table = ins.relation?.RangeVar?.relname || ins.relation?.relname || '(table)';
    const arity = valueArity(ins.selectStmt);
    if (arity.skip) continue;
    for (const n of arity.rows) {
      if (n !== cols.length) {
        problems.push(
          `INSERT INTO "${table}": ${cols.length} target columns but ${n} values ` +
            `(column/value count mismatch — this is the 42601 class).`,
        );
        break;
      }
    }
  }
  return problems;
}

async function validateFiles(files) {
  let failed = false;
  for (const f of files) {
    const rel = path.relative(process.cwd(), f) || f;
    let sql;
    try {
      sql = fs.readFileSync(f, 'utf8');
    } catch (e) {
      console.error(`  ✗ ${rel}: cannot read (${e.message})`);
      failed = true;
      continue;
    }
    const problems = await validateSqlText(sql);
    if (problems.length) {
      failed = true;
      for (const pr of problems) console.error(`  ✗ ${rel}: ${pr}`);
    } else {
      console.log(`  ✓ ${rel}`);
    }
  }
  return !failed;
}

function allMigrationSqlFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((d) => path.join(MIGRATIONS_DIR, d, 'migration.sql'))
    .filter((f) => fs.existsSync(f));
}

function runPrisma(step) {
  try {
    execSync(`npx prisma ${step}`, { cwd: SERVER_ROOT, stdio: 'pipe' });
    console.log(`  ✓ prisma ${step}`);
    return true;
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    console.error(`  ✗ prisma ${step} failed:\n${out.trim()}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = args.length ? args.map((a) => path.resolve(a)) : allMigrationSqlFiles();

  console.log(`\nPrisma migration validation — ${files.length} file(s)`);
  const sqlOk = await validateFiles(files);

  console.log('\nSchema checks');
  const validateOk = runPrisma('validate');
  const generateOk = runPrisma('generate');

  if (!sqlOk || !validateOk || !generateOk) {
    console.error('\n✗ Migration validation FAILED — commit blocked. Fix the issues above.');
    process.exit(1);
  }
  console.log('\n✓ Migration validation passed.');
}

// Run as CLI only (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
