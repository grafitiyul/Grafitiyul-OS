// Shared helpers for the ONE-TIME Pipedrive/Airtable read-only migration audit.
// NOT an import framework — just the tiny plumbing both audit scripts reuse
// (env loading, secret-safe logging, rate-limit capture, JSON output).
//
// SAFETY CONTRACT (enforced by every caller):
//   * GET/read requests ONLY — these scripts never POST/PUT/PATCH/DELETE.
//   * Token values are NEVER printed, logged, or written to output files.
//   * Nothing here writes to Pipedrive, Airtable, or the GOS database.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUTPUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'output',
);

// Read required env vars; return { ok, missing }. NEVER echoes a value.
export function requireEnv(names) {
  const missing = names.filter((n) => !String(process.env[n] || '').trim());
  return { ok: missing.length === 0, missing };
}

// Redact anything that looks like a token/secret from a string before logging.
// Belt-and-suspenders: callers already avoid logging secrets, but any accidental
// URL/error string with `api_token=...` or a Bearer header is scrubbed here.
export function redact(s) {
  return String(s == null ? '' : s)
    .replace(/api_token=[^&\s]+/gi, 'api_token=***REDACTED***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***REDACTED***')
    .replace(/(pat[A-Za-z0-9]{6})[A-Za-z0-9.]+/g, '$1***REDACTED***');
}

export function log(...args) {
  console.log(...args.map((a) => (typeof a === 'string' ? redact(a) : a)));
}

// A read-only fetch that captures rate-limit headers and enforces GET-only.
// Returns { status, ok, json, headers, rate }. Throws only on network failure;
// HTTP errors are returned so the caller can report them per endpoint.
export async function getJson(url, { headers = {}, label } = {}) {
  const res = await fetch(url, { method: 'GET', headers });
  const rate = captureRate(res.headers);
  let json = null;
  let text = null;
  try {
    text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null; // non-JSON body (rare for these APIs) — leave as null
  }
  return {
    status: res.status,
    ok: res.ok,
    label: label || null,
    json,
    // Only a short, non-sensitive slice of a raw error body, redacted.
    errorText: res.ok ? null : redact((text || '').slice(0, 300)),
    rate,
  };
}

// Pull the rate-limit signals both providers expose (names differ; capture all).
function captureRate(h) {
  const out = {};
  const keys = [
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-daily-requests-left', // Pipedrive daily token budget
    'retry-after',
  ];
  for (const k of keys) {
    const v = h.get(k);
    if (v != null) out[k] = v;
  }
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Write the full raw inventory to a gitignored output dir (audit data, NOT
// secrets). Returns the path written.
export function writeOutput(filename, data) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const p = path.join(OUTPUT_DIR, filename);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
}

// Standard "credentials not reachable" exit used by both scripts. Prints the
// exact remediation and exits non-zero WITHOUT making any network call.
export function failMissing(missing, system) {
  log(`\n[${system}] BLOCKED — required variables not reachable:`);
  for (const m of missing) log(`  - ${m}`);
  log(
    '\nThis audit is read-only and needs the tokens present in the process env.',
  );
  log('Run it as a controlled one-off, either:');
  log('  A) local one-off (no deploy): put the 5 vars in a gitignored server/.env, then');
  log(`     node scripts/migration/${system}-audit.mjs`);
  log('  B) via Railway (vars must be APPLIED to a service first):');
  log(`     railway run --service Grafitiyul-OS node scripts/migration/${system}-audit.mjs`);
  process.exit(2);
}
