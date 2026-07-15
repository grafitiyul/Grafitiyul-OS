// Snapshot #1 run executor — resumable, read-only extraction into the immutable
// bucket. Authoritative progress lives in R2 (`_run.json` + per-entity
// `_manifest.json`); the MigrationRun table is a best-effort observability mirror
// (never the source of truth), so a DB hiccup can never corrupt a snapshot.
//
// Resumability contract: run state is persisted ONLY at shard-flush boundaries,
// where the in-memory buffer is empty and the saved cursor points exactly at the
// next unread page. On resume, a completed entity (its `_manifest.json` present)
// is skipped; the in-progress entity continues from its saved cursor.
//
// Cost contract (post-incident): deal products come from the v2 BULK endpoint
// using deal ids read from the ALREADY-SNAPSHOTTED deals shards — Pipedrive is
// never re-paged to discover them. Completed entities make zero calls.
import { SnapshotWriter } from './snapshotWriter.js';
import { EXCLUDED_TABLE_NAME } from './sources/airtable.js';
import { DEAL_IDS_PER_BULK_CALL } from './sources/pipedrive.js';

const BULK_SHARD = 5000;
const PRODUCTS_SHARD = 1000;

// Frozen-spec fields that MUST survive the v1→v2 switch. The first bulk response
// is inspected and the run ABORTS before writing if any is absent — `comments`
// carries the historical pricing wording (package semantics live only there).
const REQUIRED_PRODUCT_FIELDS = ['deal_id', 'product_id', 'quantity', 'item_price', 'comments'];

const slug = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
const nowIso = () => new Date().toISOString();

// The fixed Pipedrive plan (cheap → expensive; long pole last). Airtable tables
// are appended dynamically after their schema is read.
function pipedrivePlan() {
  return [
    { key: 'pipedrive/reference', system: 'pipedrive', entity: 'reference', kind: 'pdReference' },
    { key: 'pipedrive/organizations', system: 'pipedrive', entity: 'organizations', kind: 'pdBulk', path: '/organizations', params: {}, limit: 500, shardSize: BULK_SHARD },
    { key: 'pipedrive/persons', system: 'pipedrive', entity: 'persons', kind: 'pdBulk', path: '/persons', params: {}, limit: 500, shardSize: BULK_SHARD },
    { key: 'pipedrive/deals', system: 'pipedrive', entity: 'deals', kind: 'pdBulk', path: '/deals', params: { archived_status: 'all', status: 'all_not_deleted' }, limit: 500, shardSize: BULK_SHARD },
    { key: 'pipedrive/notes', system: 'pipedrive', entity: 'notes', kind: 'pdBulk', path: '/notes', params: {}, limit: 500, shardSize: BULK_SHARD },
    { key: 'pipedrive/activities', system: 'pipedrive', entity: 'activities', kind: 'pdBulk', path: '/activities', params: { user_id: 0 }, limit: 500, shardSize: BULK_SHARD },
    // /files hard-caps at 100 per page (v1 only; no v2 files endpoint).
    { key: 'pipedrive/files', system: 'pipedrive', entity: 'files', kind: 'pdBulk', path: '/files', params: {}, limit: 100, shardSize: BULK_SHARD, note: 'file METADATA only — bodies deferred to the gated Files slice' },
    // Product catalog: resolves product_id → name if v2 line rows omit the name.
    { key: 'pipedrive/products', system: 'pipedrive', entity: 'products', kind: 'pdBulk', path: '/products', params: {}, limit: 500, shardSize: BULK_SHARD, note: 'product catalog (name resolution for historical line items)' },
    { key: 'pipedrive/deal_products', system: 'pipedrive', entity: 'deal_products', kind: 'pdBulkProducts', shardSize: PRODUCTS_SHARD },
  ];
}

export async function runSnapshot({ snapshotId, store, pd, at, log = () => {}, mirror = null, budget = null }) {
  const writer = new SnapshotWriter({ snapshotId, store });

  // ── load or initialize run state (R2 is authoritative) ─────────────────────
  let state = await writer.readRunState();
  if (!state || state.snapshotId !== snapshotId) {
    const plan = pipedrivePlan();
    for (const b of at.bases) {
      const tables = await at.tables(b.id);
      for (const t of tables) {
        if (t.name === EXCLUDED_TABLE_NAME) continue; // never read the passwords table
        plan.push({
          key: `airtable/${b.role}/${t.id}`, system: 'airtable', entity: `${b.role}/${t.id}`,
          kind: 'atTable', baseId: b.id, tableId: t.id, tableName: t.name, primaryFieldId: t.primaryFieldId,
          shardSize: BULK_SHARD,
        });
      }
    }
    plan.push({ key: 'airtable/attachments', system: 'airtable', entity: 'attachments', kind: 'atAttachments' });
    state = {
      snapshotId, kind: 'snapshot', status: 'running', startedAt: nowIso(), updatedAt: nowIso(),
      excludedTables: [EXCLUDED_TABLE_NAME], plan: plan.map((p) => p.key), planDetail: plan,
      completed: {}, current: null, counters: {},
    };
    await persist();
    log(`initialized snapshot ${snapshotId} — ${plan.length} entities planned`);
  } else {
    state.status = 'running'; // flip a previously paused run back to running
    delete state.pausedReason; delete state.retryAfter;
    // Refresh INCOMPLETE Pipedrive descriptors from current code, and append any
    // newly-planned Pipedrive entities. Completed entities and their manifests are
    // never touched — an implementation change must NEVER fork a second snapshot.
    const fixed = new Map(pipedrivePlan().map((p) => [p.key, p]));
    state.planDetail = state.planDetail.map((p) => (fixed.has(p.key) && !state.completed[p.key] ? fixed.get(p.key) : p));
    for (const [key, desc] of fixed) {
      if (!state.plan.includes(key)) { state.plan.push(key); state.planDetail.push(desc); log(`plan: + ${key} (new)`); }
    }
    log(`resuming snapshot ${snapshotId} — ${Object.keys(state.completed).length}/${state.plan.length} entities already complete`);
  }
  if (budget) state.requestBudget = budget.snapshot();

  async function persist() {
    state.updatedAt = nowIso();
    if (budget) state.requestBudget = budget.snapshot();
    await writer.writeRunState(state);
    if (mirror) { try { await mirror(state); } catch (e) { log(`[mirror] warn: ${e?.message || e}`); } }
  }
  // Budget checkpoints go straight to R2 so a hard kill cannot reset the allowance.
  if (budget) budget.onPersist = async () => { state.updatedAt = nowIso(); state.requestBudget = budget.snapshot(); await writer.writeRunState(state); };

  const planByKey = Object.fromEntries(state.planDetail.map((p) => [p.key, p]));

  async function flush(system, entity, shardIndex, buffer, shards) {
    if (!buffer.length) return shardIndex;
    const d = await writer.writeShard({ system, entity, shardIndex, records: buffer });
    shards.push(d);
    buffer.length = 0;
    return shardIndex + 1;
  }

  // ── execute entities in order ──────────────────────────────────────────────
  for (const key of state.plan) {
    if (state.completed[key]) continue; // ← completed entities make ZERO calls
    const desc = planByKey[key];
    const resuming = state.current && state.current.key === key;
    if (!resuming) state.current = { key, cursor: null, shardIndex: 0, shards: [] };
    log(`▶ ${key}${resuming ? ' (resume)' : ''}`);
    let manifest;
    try {
      if (desc.kind === 'pdReference') manifest = await extractReference(desc);
      else if (desc.kind === 'pdBulk') manifest = await extractPdBulk(desc);
      else if (desc.kind === 'pdBulkProducts') manifest = await extractPdBulkProducts(desc);
      else if (desc.kind === 'atTable') manifest = await extractAtTable(desc);
      else if (desc.kind === 'atAttachments') manifest = await extractAtAttachments(desc);
      else throw new Error(`unknown entity kind: ${desc.kind}`);
    } catch (e) {
      // Rate-budget lockout or run-limit stop: pause cleanly (cursor + shards are
      // already persisted at the last boundary) so a later resume continues here.
      if (e?.code === 'RATE_BUDGET_EXCEEDED' || e?.code === 'RUN_LIMIT_REACHED') {
        state.status = 'paused'; state.pausedReason = e.message; state.retryAfter = e.retryAfter ?? null; state.pausedAt = nowIso();
        await persist();
        log(`⏸ paused on ${key}: ${e.message}`);
      }
      throw e;
    }
    state.completed[key] = { records: manifest.totalRecords ?? manifest.fileCount ?? 0, bytes: manifest.totalBytes ?? 0, combinedSha256: manifest.combinedSha256 || null };
    state.counters[key] = manifest.totalRecords ?? manifest.fileCount ?? 0;
    state.current = null;
    await persist();
    log(`  ✓ ${key}: ${state.completed[key].records} records`);
  }

  const topManifest = {
    snapshotId, kind: 'snapshot', status: 'complete',
    startedAt: state.startedAt, finishedAt: nowIso(),
    excludedTables: state.excludedTables,
    entities: state.completed,
    counters: state.counters,
    requestBudget: state.requestBudget ?? null,
    totals: {
      entities: Object.keys(state.completed).length,
      records: Object.values(state.counters).reduce((n, v) => n + (Number(v) || 0), 0),
    },
    scope: {
      pipedriveFiles: 'METADATA ONLY — bodies deferred to the gated Files slice',
      dealFlow: 'DEFERRED to the native-timeline slice (not in Snapshot #1)',
      dealProducts: 'v2 bulk endpoint (100 deal_ids/call); one record per deal with products_count>0',
      airtableAttachments: 'BODIES captured (URLs expire)',
    },
  };
  await writer.writeTopManifest(topManifest);
  state.status = 'complete';
  await persist();
  log(`✔ snapshot ${snapshotId} complete — ${topManifest.totals.records} records across ${topManifest.totals.entities} entities`);
  return topManifest;

  // ── extractors ─────────────────────────────────────────────────────────────
  async function extractReference(desc) {
    const ref = await pd.reference();
    const body = Buffer.from(JSON.stringify(ref, null, 2), 'utf8');
    const obj = await writer.writeObject({ key: `pipedrive/reference/reference.json`, body, contentType: 'application/json' });
    const counts = Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v ? 1 : 0)]));
    return writer.writeEntityManifest({
      system: 'pipedrive', entity: 'reference',
      shards: [{ key: obj.key, records: 1, bytes: obj.bytes, sha256: obj.sha256 }],
      params: { counts }, note: 'config/reference bundle',
    });
  }

  async function extractPdBulk(desc) {
    const cur = state.current;
    if (!cur.cursor) cur.cursor = { start: 0 };
    const buffer = [];
    const shards = cur.shards;
    let shardIndex = cur.shardIndex;
    for (;;) {
      const { records, nextStart, hasMore } = await pd.page(desc.path, desc.params || {}, cur.cursor.start, desc.limit || 500);
      buffer.push(...records);
      if (buffer.length >= desc.shardSize) {
        shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
        cur.cursor.start = hasMore ? nextStart : cur.cursor.start; // aligned: buffer empty
        cur.shardIndex = shardIndex;
        await persist();
      }
      if (!hasMore) break;
      cur.cursor.start = nextStart;
    }
    shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
    return writer.writeEntityManifest({ system: desc.system, entity: desc.entity, shards, params: desc.params || {}, note: desc.note || null });
  }

  // Deal ids come from the COMPLETED deals snapshot in R2 — zero Pipedrive calls.
  async function readDealTargetsFromSnapshot() {
    const man = await writer.readEntityManifest('pipedrive', 'deals');
    if (!man) throw new Error('deals_entity_not_snapshotted: cannot derive deal_products targets without the deals snapshot');
    const targets = [];
    let scanned = 0;
    for (const shard of man.shards) {
      const text = await store.getText(shard.key);
      for (const line of text.split('\n')) {
        if (!line) continue;
        const d = JSON.parse(line);
        scanned++;
        if ((d.products_count || 0) > 0) targets.push(d.id);
      }
    }
    targets.sort((a, b) => a - b);
    log(`    deal_products targets: ${targets.length} of ${scanned} deals (from R2 snapshot, 0 Pipedrive calls)`);
    return targets;
  }

  async function extractPdBulkProducts(desc) {
    const targets = await readDealTargetsFromSnapshot();
    const cur = state.current;
    if (!cur.cursor) cur.cursor = { index: 0, targetCount: targets.length };
    cur.cursor.targetCount = targets.length;
    const buffer = [];
    const shards = cur.shards;
    let shardIndex = cur.shardIndex;
    let observedFields = cur.observedFields || null;

    for (let i = cur.cursor.index; i < targets.length;) {
      const batch = targets.slice(i, i + DEAL_IDS_PER_BULK_CALL);
      // Pull every page for this batch (a batch can exceed the 500-row page).
      const rows = [];
      let cursor = null;
      do {
        const res = await pd.dealProductsBulk(batch, cursor);
        rows.push(...res.records);
        cursor = res.nextCursor;
      } while (cursor);

      // Field-parity gate — runs once, on the first batch, BEFORE anything is written.
      if (!observedFields) {
        observedFields = [...new Set(rows.flatMap((r) => Object.keys(r || {})))].sort();
        const missing = REQUIRED_PRODUCT_FIELDS.filter((f) => !observedFields.includes(f));
        if (rows.length && missing.length) {
          const err = new Error(`deal_products_field_parity_failed: v2 bulk response is missing required field(s) [${missing.join(', ')}]. Observed: [${observedFields.join(', ')}]. Refusing to write a lossy snapshot.`);
          err.code = 'FIELD_PARITY_FAILED';
          throw err;
        }
        cur.observedFields = observedFields;
        log(`    field parity OK — observed: ${observedFields.join(', ')}`);
      }

      // Group by deal, preserving product-line order (order_nr when present).
      const byDeal = new Map(batch.map((id) => [id, []]));
      for (const r of rows) {
        const arr = byDeal.get(r.deal_id);
        if (arr) arr.push(r); else byDeal.set(r.deal_id, [r]);
      }
      for (const id of batch) {
        const products = byDeal.get(id) || [];
        if (products.length > 1 && products.every((p) => p.order_nr != null)) {
          products.sort((a, b) => Number(a.order_nr) - Number(b.order_nr));
        }
        buffer.push({ deal_id: id, products }); // one record per target deal
      }
      i += batch.length;
      if (buffer.length >= desc.shardSize) {
        shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
        cur.cursor.index = i; cur.shardIndex = shardIndex; await persist();
        log(`    deal_products ${i}/${targets.length}`);
      }
    }
    shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
    return writer.writeEntityManifest({
      system: 'pipedrive', entity: 'deal_products', shards,
      params: { targetDeals: targets.length, batchSize: DEAL_IDS_PER_BULK_CALL, observedFields, endpoint: 'GET /api/v2/deals/products' },
      note: 'v2 BULK: one record per deal with products_count>0 → {deal_id, products[]} (order_nr preserved)',
    });
  }

  async function extractAtTable(desc) {
    const cur = state.current;
    if (!cur.cursor) cur.cursor = { offset: null };
    const buffer = [];
    const shards = cur.shards;
    let shardIndex = cur.shardIndex;
    for (;;) {
      const { records, offset } = await at.recordsPage(desc.baseId, desc.tableId, { offset: cur.cursor.offset });
      buffer.push(...records);
      const done = !offset;
      if (buffer.length >= desc.shardSize) {
        shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
        cur.cursor.offset = offset; cur.shardIndex = shardIndex; await persist();
      }
      if (done) break;
      cur.cursor.offset = offset;
    }
    shardIndex = await flush(desc.system, desc.entity, shardIndex, buffer, shards);
    return writer.writeEntityManifest({ system: 'airtable', entity: desc.entity, shards, params: { base: desc.baseId, tableId: desc.tableId, tableName: desc.tableName } });
  }

  async function extractAtAttachments(desc) {
    const descriptors = [];
    let files = 0, bytes = 0;
    for (const b of at.bases) {
      const tables = await at.tables(b.id);
      for (const t of tables) {
        if (t.name === EXCLUDED_TABLE_NAME) continue;
        for (const field of t.attachmentFields) {
          let offset = null;
          do {
            const { records, offset: next } = await at.recordsPage(b.id, t.id, { offset, fields: [field] });
            for (const rec of records) {
              const arr = rec.fields?.[field];
              if (!Array.isArray(arr)) continue;
              for (let idx = 0; idx < arr.length; idx++) {
                const a = arr[idx];
                if (!a?.url) continue;
                const body = await at.download(a.url);
                const key = `airtable/attachments/${slug(rec.id)}__${slug(field)}__${idx}__${slug(a.filename || 'file')}`;
                const obj = await writer.writeObject({ key, body, contentType: a.type || 'application/octet-stream' });
                descriptors.push({ base: b.role, table: t.name, field, recordId: rec.id, index: idx, filename: a.filename || null, declaredSize: a.size ?? null, storedBytes: obj.bytes, type: a.type || null, key: obj.key, sha256: obj.sha256 });
                files++; bytes += obj.bytes;
              }
            }
            offset = next;
          } while (offset);
        }
      }
    }
    const manifestBody = Buffer.from(JSON.stringify({ snapshotId, fileCount: files, totalBytes: bytes, attachments: descriptors, createdAt: nowIso() }, null, 2), 'utf8');
    await store.put({ key: `snapshots/${snapshotId}/airtable/attachments/_manifest.json`, body: manifestBody, contentType: 'application/json' });
    return { system: 'airtable', entity: 'attachments', fileCount: files, totalBytes: bytes, combinedSha256: null, totalRecords: files };
  }
}
