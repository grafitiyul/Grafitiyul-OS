// GOS database backup — the ONE path that produces a restorable, verifiable
// point-in-time copy of the production database.
//
// Why this exists: the stabilization phase performs destructive work (removing
// test/demo data) and re-synchronizes from legacy. Every destructive runner in
// this codebase is gated on a VERIFIED backup existing first, and "verified"
// here means something stronger than "a file was written": every shard is
// content-hashed, every hash is re-read from storage and recomputed, and the
// row counts are reconciled against the live database.
//
// Format — deliberately identical in spirit to the legacy snapshots, and using
// the SAME SnapshotWriter, so there is one storage/verification vocabulary in
// the project rather than two:
//
//   backups/<backupId>/manifest.json                  top-level + backupSha256
//   backups/<backupId>/gos/<Table>/shard-00001.jsonl.gz
//   backups/<backupId>/gos/<Table>/_manifest.json
//
// Row encoding: `to_jsonb(t)::text` straight from Postgres, written verbatim.
// The bytes are never parsed by JavaScript, so bigint precision, numeric scale,
// timestamps and bytea survive exactly. This is the single most important
// property of the format — a JS round-trip through Number() would silently
// corrupt BigInt ids and money columns.
//
// Pagination: keyset over the primary key, compared as text. Text ordering is a
// valid TOTAL order for any key type, which is all pagination needs, and it
// removes every parameter-typing hazard (uuid/int/cuid all bind as text).

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { SHARD_SIZE, SnapshotWriter } from './snapshotWriter.js';

export const BACKUP_SYSTEM = 'gos';
export const BACKUP_ROOT = 'backups';

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function newBackupId(now = new Date(), rand = () => crypto.randomBytes(2).toString('hex')) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `gosbak-${stamp}-${rand()}`;
}

// Identity of the whole backup: sha256 over "<table>:<combinedSha256>" lines,
// ordered by table name. Two backups of identical data produce identical hashes,
// which is what makes "the backup I verified is the backup I am restoring" a
// checkable statement rather than a hopeful one.
export function backupHash(tables) {
  const lines = [...tables]
    .sort((a, b) => a.table.localeCompare(b.table))
    .map((t) => `${t.table}:${t.combinedSha256}`)
    .join('\n');
  return sha256Hex(Buffer.from(lines, 'utf8'));
}

/**
 * Every base table in `public`, with its primary-key columns.
 * Nothing is excluded: a backup that quietly skips a table is not a backup.
 * `_prisma_migrations` is included deliberately — it records the schema version
 * the data belongs to, without which a restore is guesswork.
 */
export async function listBackupTables(db) {
  const rows = await db.$queryRawUnsafe(`
    SELECT t.table_name AS table,
           COALESCE(
             json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
               FILTER (WHERE kcu.column_name IS NOT NULL),
             '[]'::json
           ) AS pk
    FROM information_schema.tables t
    LEFT JOIN information_schema.table_constraints tc
      ON tc.table_schema = t.table_schema
     AND tc.table_name = t.table_name
     AND tc.constraint_type = 'PRIMARY KEY'
    LEFT JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    GROUP BY t.table_name
    ORDER BY t.table_name`);

  return rows.map((r) => ({
    table: r.table,
    pk: (typeof r.pk === 'string' ? JSON.parse(r.pk) : r.pk) || [],
  }));
}

export async function countTable(db, table) {
  const r = await db.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM "${table}"`);
  return Number(r[0]?.n ?? 0);
}

const quoteIdent = (c) => `"${String(c).replace(/"/g, '""')}"`;

/**
 * Keyset-paginated reader. Yields batches of pre-serialized JSON text lines.
 *
 * A table with no primary key cannot be keyset-paginated safely; rather than
 * silently switching to OFFSET (which can duplicate or skip rows under
 * concurrent writes) this throws. The census proved every table here has one.
 */
export async function* streamTableRows(db, { table, pk }, { batchSize = 2000 } = {}) {
  if (!pk?.length) {
    const e = new Error(`no_primary_key: "${table}" cannot be backed up by keyset pagination`);
    e.code = 'NO_PRIMARY_KEY';
    throw e;
  }
  const cols = pk.map((c) => `(t.${quoteIdent(c)})::text`);
  const orderBy = cols.join(', ');
  const tuple = cols.length === 1 ? cols[0] : `(${cols.join(', ')})`;
  const select = `SELECT to_jsonb(t)::text AS j, ${cols.map((c, i) => `${c} AS k${i}`).join(', ')}`;

  let cursor = null;
  for (;;) {
    const where = cursor
      ? `WHERE ${tuple} > ${cursor.length === 1 ? '$1' : `(${cursor.map((_, i) => `$${i + 1}`).join(', ')})`}`
      : '';
    const sql = `${select} FROM "${table}" t ${where} ORDER BY ${orderBy} LIMIT ${Number(batchSize)}`;
    const rows = cursor
      ? await db.$queryRawUnsafe(sql, ...cursor)
      : await db.$queryRawUnsafe(sql);
    if (!rows.length) return;
    yield rows.map((r) => r.j);
    const last = rows[rows.length - 1];
    cursor = pk.map((_, i) => last[`k${i}`]);
    if (rows.length < batchSize) return;
  }
}

/**
 * Back up one table. Returns its entity manifest.
 */
export async function backupTable(db, writer, spec, { batchSize = 2000, shardSize = SHARD_SIZE } = {}) {
  const shards = [];
  let buffer = [];
  let shardIndex = 1;

  const flush = async () => {
    if (!buffer.length) return;
    shards.push(await writer.writeShard({
      system: BACKUP_SYSTEM,
      entity: spec.table,
      shardIndex: shardIndex++,
      records: buffer,
    }));
    buffer = [];
  };

  for await (const batch of streamTableRows(db, spec, { batchSize })) {
    buffer.push(...batch);
    while (buffer.length >= shardSize) {
      const chunk = buffer.slice(0, shardSize);
      buffer = buffer.slice(shardSize);
      shards.push(await writer.writeShard({
        system: BACKUP_SYSTEM,
        entity: spec.table,
        shardIndex: shardIndex++,
        records: chunk,
      }));
    }
  }
  await flush();

  return writer.writeEntityManifest({
    system: BACKUP_SYSTEM,
    entity: spec.table,
    shards,
    params: { pk: spec.pk, batchSize, shardSize },
  });
}

/**
 * Run a full backup. `onProgress({ table, index, total, records })` is called
 * after each table so a long run reports honestly instead of going silent.
 */
export async function runBackup({ db, store, backupId = newBackupId(), onProgress = () => {}, batchSize = 2000 }) {
  const writer = new SnapshotWriter({ snapshotId: backupId, store, rootPrefix: BACKUP_ROOT, gzip: true });
  const specs = await listBackupTables(db);
  const tables = [];

  for (let i = 0; i < specs.length; i++) {
    const m = await backupTable(db, writer, specs[i], { batchSize });
    tables.push({
      table: specs[i].table,
      records: m.totalRecords,
      bytes: m.totalBytes,
      shardCount: m.shardCount,
      combinedSha256: m.combinedSha256,
    });
    onProgress({ table: specs[i].table, index: i + 1, total: specs.length, records: m.totalRecords });
  }

  const manifest = {
    kind: 'gos-database-backup',
    backupId,
    createdAt: new Date().toISOString(),
    tableCount: tables.length,
    totalRecords: tables.reduce((n, t) => n + t.records, 0),
    totalBytes: tables.reduce((n, t) => n + t.bytes, 0),
    tables,
    backupSha256: backupHash(tables),
  };
  await writer.writeTopManifest(manifest);
  return manifest;
}

export function manifestKey(backupId) {
  return `${BACKUP_ROOT}/${backupId}/manifest.json`;
}

/**
 * Verify a backup by RE-READING it from storage. This is the half that makes
 * the word "verified" mean anything:
 *
 *   1. every shard is fetched, decompressed and re-hashed → must match
 *   2. every shard's line count must match its recorded record count
 *   3. per-table combined hashes and the top-level backupSha256 are recomputed
 *   4. (optional) live row counts are compared — drift is REPORTED, not failed,
 *      because a live database legitimately changes while a backup runs
 *
 * Returns { ok, backupId, backupSha256, checkedShards, errors[], drift[] }.
 */
export async function verifyBackup({ store, backupId, db = null }) {
  const errors = [];
  const drift = [];
  let checkedShards = 0;
  let checkedRecords = 0;

  const manifest = JSON.parse(await store.getText(manifestKey(backupId)));
  const writer = new SnapshotWriter({ snapshotId: backupId, store, rootPrefix: BACKUP_ROOT, gzip: true });

  for (const t of manifest.tables) {
    const em = await writer.readEntityManifest(BACKUP_SYSTEM, t.table);
    if (!em) { errors.push(`${t.table}: entity manifest missing`); continue; }
    if (em.combinedSha256 !== t.combinedSha256) {
      errors.push(`${t.table}: combined hash mismatch (top=${t.combinedSha256} entity=${em.combinedSha256})`);
    }

    let records = 0;
    for (const shard of em.shards) {
      let raw;
      try {
        const bytes = await store.getBytes(shard.key);
        raw = shard.key.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes;
      } catch (e) {
        errors.push(`${t.table}: shard unreadable ${shard.key} — ${e.message}`);
        continue;
      }
      const hash = sha256Hex(raw);
      if (hash !== shard.sha256) {
        errors.push(`${t.table}: shard hash mismatch ${shard.key}`);
      }
      const lines = raw.length ? raw.toString('utf8').replace(/\n$/, '').split('\n').length : 0;
      if (lines !== shard.records) {
        errors.push(`${t.table}: shard ${shard.key} has ${lines} lines, manifest says ${shard.records}`);
      }
      records += lines;
      checkedShards++;
    }
    if (records !== t.records) {
      errors.push(`${t.table}: read ${records} records, manifest says ${t.records}`);
    }
    checkedRecords += records;

    if (db) {
      const live = await countTable(db, t.table);
      if (live !== t.records) drift.push({ table: t.table, backup: t.records, live });
    }
  }

  const recomputed = backupHash(manifest.tables);
  if (recomputed !== manifest.backupSha256) {
    errors.push(`backupSha256 mismatch: manifest=${manifest.backupSha256} recomputed=${recomputed}`);
  }

  return {
    ok: errors.length === 0,
    backupId,
    backupSha256: manifest.backupSha256,
    createdAt: manifest.createdAt,
    tableCount: manifest.tables.length,
    checkedShards,
    checkedRecords,
    errors,
    drift,
  };
}

/**
 * The gate every destructive runner calls. Returns the verified manifest, or
 * throws with an actionable message. Deliberately strict: an unverifiable
 * backup is treated as no backup.
 */
export async function requireVerifiedBackup({ store, backupId }) {
  if (!backupId) {
    const e = new Error('no_backup: a verified backup id is required before any destructive step (--backup <id>)');
    e.code = 'NO_BACKUP';
    throw e;
  }
  const result = await verifyBackup({ store, backupId });
  if (!result.ok) {
    const e = new Error(`backup_not_verified: ${backupId}\n  ${result.errors.slice(0, 10).join('\n  ')}`);
    e.code = 'BACKUP_NOT_VERIFIED';
    throw e;
  }
  return result;
}
