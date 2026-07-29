// Snapshot input contract.
//
// WHY THIS EXISTS (2026-07-29 rehearsal findings):
//   Snapshots are deliberately SCOPED — the cutover Final Snapshot is taken with
//   `--omit pipedrive/files` to avoid a ~1,700-request census that nothing on
//   cutover night needs. That is legitimate. What was NOT legitimate was how the
//   importers reacted to a scoped snapshot:
//
//     * run-identity-import.mjs streamed an omitted entity with no handling and
//       died on a raw S3 `NoSuchKey` — cryptic, and only after minutes of loading.
//     * run-cutover-import.mjs streamed pipedrive/deal_participants behind a bare
//       `.catch(() => {})`, so a missing entity silently became ZERO participants
//       and every new deal was created without its participant links.
//
//   An importer's required entities are part of its CONTRACT. This module makes
//   that contract explicit and checks it UP FRONT, before any work, so a scoped
//   snapshot fails fast with an actionable message instead of crashing late or
//   corrupting quietly. Missing input is never a silent zero.
//
// Reads only the snapshot's own top manifest (the authoritative entity registry).

export class SnapshotContractError extends Error {
  constructor(snapshotId, missing, present) {
    super(
      `snapshot_contract_unmet: ${snapshotId} is missing required entit${missing.length === 1 ? 'y' : 'ies'} `
      + `[${missing.join(', ')}].\n`
      + `  present: [${present.join(', ')}]\n`
      + `  This snapshot cannot satisfy this importer. Re-run the snapshot WITHOUT omitting the entity above\n`
      + `  (run-snapshot.mjs --snapshot <id> resumes and appends only what is missing — completed entities cost 0 requests).`,
    );
    this.code = 'SNAPSHOT_CONTRACT_UNMET';
    this.snapshotId = snapshotId;
    this.missing = missing;
    this.present = present;
  }
}

/**
 * Assert every required entity key is present in the snapshot's top manifest.
 * @param {object} deps          { getText } — R2-ish reader
 * @param {string} snapshotId
 * @param {string[]} required    entity keys, e.g. ['pipedrive/persons']
 * @returns {Promise<string[]>}  the present entity keys
 * @throws {SnapshotContractError}
 */
export async function requireEntities({ getText }, snapshotId, required) {
  let top;
  try {
    top = JSON.parse(await getText(`snapshots/${snapshotId}/manifest.json`));
  } catch (e) {
    const err = new Error(`snapshot_manifest_unreadable: ${snapshotId} — ${String(e?.message || e).slice(0, 160)}`);
    err.code = 'SNAPSHOT_MANIFEST_UNREADABLE';
    throw err;
  }
  const present = Object.keys(top.entities || {});
  const missing = required.filter((k) => !present.includes(k));
  if (missing.length) throw new SnapshotContractError(snapshotId, missing, present);
  return present;
}
