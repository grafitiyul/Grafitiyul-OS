import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotStorageConfigured,
  snapshotBucketName,
  pipedriveConfigured,
  airtableConfigured,
  migrationConfigStatus,
} from './config.js';

const SNAPSHOT = ['MIGRATION_R2_ACCOUNT_ID', 'MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY', 'MIGRATION_R2_BUCKET'];
const PIPEDRIVE = ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN'];
const AIRTABLE = ['AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID', 'AIRTABLE_LEGACY_BASE_ID'];
const ALL = [...SNAPSHOT, ...PIPEDRIVE, ...AIRTABLE];

// Snapshot + restore the relevant env so tests don't leak into each other or the
// real process env.
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ALL) saved[k] = process.env[k];
  try {
    for (const k of ALL) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of ALL) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const fill = (names) => Object.fromEntries(names.map((n) => [n, `val-${n}`]));

test('nothing configured → all guards false, missing lists complete', () => {
  withEnv({}, () => {
    assert.equal(snapshotStorageConfigured(), false);
    assert.equal(pipedriveConfigured(), false);
    assert.equal(airtableConfigured(), false);
    const s = migrationConfigStatus();
    assert.equal(s.readyForExtraction, false);
    assert.deepEqual(s.snapshotStorage.missing, SNAPSHOT);
    assert.deepEqual(s.sources.pipedrive.missing, PIPEDRIVE);
    assert.equal(s.snapshotStorage.bucket, null);
  });
});

test('snapshot storage requires ALL four vars', () => {
  withEnv(fill(SNAPSHOT.slice(0, 3)), () => {
    assert.equal(snapshotStorageConfigured(), false);
    assert.deepEqual(migrationConfigStatus().snapshotStorage.missing, ['MIGRATION_R2_BUCKET']);
  });
  withEnv(fill(SNAPSHOT), () => {
    assert.equal(snapshotStorageConfigured(), true);
    assert.equal(snapshotBucketName(), 'val-MIGRATION_R2_BUCKET');
  });
});

test('blank/whitespace values do not count as configured', () => {
  withEnv({ ...fill(SNAPSHOT), MIGRATION_R2_ACCESS_KEY_ID: '   ' }, () => {
    assert.equal(snapshotStorageConfigured(), false);
    assert.deepEqual(migrationConfigStatus().snapshotStorage.missing, ['MIGRATION_R2_ACCESS_KEY_ID']);
  });
});

test('readyForExtraction only when storage + both sources present', () => {
  withEnv({ ...fill(SNAPSHOT), ...fill(PIPEDRIVE) }, () => {
    assert.equal(migrationConfigStatus().readyForExtraction, false); // airtable missing
  });
  withEnv({ ...fill(SNAPSHOT), ...fill(PIPEDRIVE), ...fill(AIRTABLE) }, () => {
    const s = migrationConfigStatus();
    assert.equal(s.readyForExtraction, true);
    assert.equal(s.sources.airtable.configured, true);
  });
});

test('config status NEVER leaks a secret value', () => {
  withEnv(fill(ALL), () => {
    const serialized = JSON.stringify(migrationConfigStatus());
    // The only value that may appear is the (non-secret) bucket name.
    for (const k of [...PIPEDRIVE, ...AIRTABLE, 'MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY', 'MIGRATION_R2_ACCOUNT_ID']) {
      assert.equal(serialized.includes(`val-${k}`), false, `leaked value of ${k}`);
    }
    assert.equal(serialized.includes('val-MIGRATION_R2_BUCKET'), true); // bucket name is allowed
  });
});
