// Centralised env loading for the GOS WhatsApp bridge.
//
// Deployment model (per user decision, 2026-07-05): ONE bridge service per
// WhatsApp number — gos-whatsapp-main / gos-whatsapp-office — running the SAME
// code from the same repo against the SAME Postgres. The only thing that makes
// a service "the main number" is its env:
//   WHATSAPP_ACCOUNT_ID     stable account key ('main' | 'office' | ...) —
//                           scopes every DB row this bridge touches
//   WHATSAPP_ACCOUNT_LABEL  optional display name for first boot (the admin
//                           can rename later; never overwritten after create)
// No singleton assumptions, no hardcoded number.

import { fileURLToPath } from 'node:url';

// Local dev convenience: load bridge/.env when present (Node 20.12+ builtin —
// no dotenv dependency). Railway injects real env vars; the file is optional.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env file — fine */
}

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`[bridge] required env var ${name} is missing`);
  return v.trim();
}

function optional(name, defaultValue) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  return defaultValue;
}

function int(name, defaultValue) {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),

  accountId: required('WHATSAPP_ACCOUNT_ID'),
  accountLabel: optional('WHATSAPP_ACCOUNT_LABEL'),

  // '::' (IPv6 wildcard, dual-stacks to IPv4) — REQUIRED for Railway's
  // internal service-to-service network, which routes over IPv6. Binding
  // 0.0.0.0 makes GOS→bridge fetches hang until timeout (proven in the
  // Challenge System production).
  httpHost: optional('BRIDGE_HTTP_HOST', '::'),
  httpPort: int('PORT', int('BRIDGE_HTTP_PORT', 3000)),

  // Shared secret for GOS-server → bridge auth (Authorization: Bearer <secret>).
  internalSecret: required('BRIDGE_INTERNAL_SECRET'),

  // Reconnect backoff tunables: delay = min(max, min * 2^attempt); attempts
  // reset after the connection stays open ≥ healthyMs.
  reconnectMinDelayMs: int('BRIDGE_RECONNECT_MIN_MS', 1000),
  reconnectMaxDelayMs: int('BRIDGE_RECONNECT_MAX_MS', 60_000),
  reconnectHealthyMs: int('BRIDGE_RECONNECT_HEALTHY_MS', 5 * 60_000),

  logLevel: optional('LOG_LEVEL', 'info'),

  // ── Media capture (Slice 2) ────────────────────────────────────────
  // Same var names as the GOS server's r2.js. When unset, ingestion still
  // mirrors message text/metadata; media rows get mediaStatus='disabled'.
  r2AccountId: optional('R2_ACCOUNT_ID'),
  r2AccessKeyId: optional('R2_ACCESS_KEY_ID'),
  r2SecretAccessKey: optional('R2_SECRET_ACCESS_KEY'),
  r2Bucket: optional('R2_BUCKET'),
  // Hard cap per media object — larger files are skipped with
  // mediaStatus='too_large' (recorded, never silently dropped).
  mediaMaxBytes: int('WHATSAPP_MEDIA_MAX_BYTES', 64 * 1024 * 1024),
};
