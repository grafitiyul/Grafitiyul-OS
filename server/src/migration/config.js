// Legacy-migration configuration guard (Slice 1).
//
// PRESENCE checks only — this module never connects, never creates a bucket,
// never reads a secret's VALUE into any output. It answers "is the migration
// infrastructure configured?" so the status endpoint (and, later, the snapshot/
// extraction slice) can gate safely. All checks read process.env at call time
// so tests and deploys reflect the live environment.
//
// Snapshot storage is a DEDICATED PRIVATE bucket (per the approved design), kept
// separate from the public app bucket — hence its own MIGRATION_R2_* vars. There
// is deliberately no public base URL (private, presigned-only).

const SNAPSHOT_ENV = [
  'MIGRATION_R2_ACCOUNT_ID',
  'MIGRATION_R2_ACCESS_KEY_ID',
  'MIGRATION_R2_SECRET_ACCESS_KEY',
  'MIGRATION_R2_BUCKET',
];
const PIPEDRIVE_ENV = ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN'];
const AIRTABLE_ENV = ['AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID', 'AIRTABLE_LEGACY_BASE_ID'];

// Names of the required vars that are missing/blank. NEVER returns a value.
function missing(names) {
  return names.filter((n) => !String(process.env[n] || '').trim());
}

export function snapshotStorageConfigured() {
  return missing(SNAPSHOT_ENV).length === 0;
}

// Bucket name is not a secret; exposing it aids ops. Empty string when unset.
export function snapshotBucketName() {
  return String(process.env.MIGRATION_R2_BUCKET || '').trim();
}

export function pipedriveConfigured() {
  return missing(PIPEDRIVE_ENV).length === 0;
}

export function airtableConfigured() {
  return missing(AIRTABLE_ENV).length === 0;
}

// ── Extraction safety gate (post-incident) ───────────────────────────────────
// The extraction is OFF unless explicitly enabled, and every approved run must
// declare a hard cumulative request ceiling before launch. These exist because a
// prior run exhausted the COMPANY-WIDE Pipedrive daily budget and throttled live
// integrations. Default-off is deliberate: forgetting to set it means no calls.
export function extractionEnabled() {
  return String(process.env.MIGRATION_EXTRACTION_ENABLED || '').trim().toLowerCase() === 'true';
}

// Hard cumulative ceiling on Pipedrive requests for this snapshot. Null when
// unset/invalid — callers must refuse to run rather than assume a default.
export function maxPipedriveRequests() {
  const raw = String(process.env.MIGRATION_MAX_REQUESTS || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

// A secret-free readiness summary: booleans + the NAMES of any missing vars.
// Safe to serialize into an admin API response or a log line.
export function migrationConfigStatus() {
  return {
    snapshotStorage: {
      configured: snapshotStorageConfigured(),
      bucket: snapshotBucketName() || null,
      missing: missing(SNAPSHOT_ENV),
    },
    sources: {
      pipedrive: { configured: pipedriveConfigured(), missing: missing(PIPEDRIVE_ENV) },
      airtable: { configured: airtableConfigured(), missing: missing(AIRTABLE_ENV) },
    },
    // True only when everything Slice 2 (Snapshot & Extraction) will need is present.
    readyForExtraction:
      snapshotStorageConfigured() && pipedriveConfigured() && airtableConfigured(),
    // Safety gate — configured presence only; both must be set for a run to start.
    extraction: {
      enabled: extractionEnabled(),
      maxPipedriveRequests: maxPipedriveRequests(),
    },
  };
}
