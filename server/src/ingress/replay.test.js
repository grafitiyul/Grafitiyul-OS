import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedContact, seedOpenDeal } from './testDb.js';
import { receiveEvent, processEvent } from './pipeline.js';
import { rebuildCanonicalEvent, replayEvent } from './replay.js';
import { runIngressRetryTick, CLAIM_TTL_MS } from './worker.js';

const ENV = ['WEBSITE_FORM_SECRET', 'META_PAGE_ACCESS_TOKEN', 'WOO_NEW_BASE_URL', 'WOO_NEW_CONSUMER_KEY', 'WOO_NEW_CONSUMER_SECRET'];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;
  const restore = () => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
  restore();
  return out;
}

// Add the query surface the worker needs to the shared test double.
function workerDb(seed) {
  const db = createTestDb(seed);
  db.ingressEvent.findMany = async ({ where = {}, take = 50 } = {}) => {
    let rows = db._tables.ingressEvent;
    if (where.status) rows = rows.filter((r) => r.status === where.status);
    if (where.source) rows = rows.filter((r) => r.source === where.source);
    if (where.OR) {
      rows = rows.filter((r) =>
        where.OR.some((c) => {
          if ('nextRetryAt' in c && c.nextRetryAt === null) return r.nextRetryAt == null;
          if (c.nextRetryAt?.lte) return r.nextRetryAt && r.nextRetryAt <= c.nextRetryAt.lte;
          return false;
        }),
      );
    }
    if (where.AND) {
      rows = rows.filter((r) =>
        where.AND.every((a) =>
          a.OR.some((c) => {
            if ('claimedAt' in c && c.claimedAt === null) return r.claimedAt == null;
            if (c.claimedAt?.lt) return r.claimedAt && r.claimedAt < c.claimedAt.lt;
            return false;
          }),
        ),
      );
    }
    return rows.slice(0, take).map((r) => ({ id: r.id, claimedAt: r.claimedAt ?? null }));
  };
  db.ingressEvent.updateMany = async ({ where, data }) => {
    const row = db._tables.ingressEvent.find((r) => r.id === where.id);
    if (!row) return { count: 0 };
    if (where.status && row.status !== where.status) return { count: 0 };
    if (where.OR) {
      const ok = where.OR.some((c) => {
        if ('claimedAt' in c && c.claimedAt === null) return row.claimedAt == null;
        if (c.claimedAt?.lt) return row.claimedAt && row.claimedAt < c.claimedAt.lt;
        return false;
      });
      if (!ok) return { count: 0 };
    }
    Object.assign(row, data);
    return { count: 1 };
  };
  return db;
}

const formPayload = { name: 'דור כהן', phone: '050-123-4567', email: 'dor@example.com', url: 'https://g.co/p?utm_source=facebook' };

test('replay: a website form event is rebuilt through the CURRENT adapter code', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent(
    { source: 'website_form', sourceKey: 'contact_page', rawPayload: formPayload },
    db,
  );
  const row = db._tables.ingressEvent.find((r) => r.id === event.id);
  const rebuilt = await rebuildCanonicalEvent(row);
  assert.equal(rebuilt.source, 'website_form');
  assert.equal(rebuilt.sourceKey, 'contact_page');
  assert.equal(rebuilt.person.phone, '050-123-4567');
});

test('replay: an unknown source is a permanent, named failure', async () => {
  await assert.rejects(
    () => rebuildCanonicalEvent({ source: 'martian_forms', rawPayload: {} }),
    (e) => e.code === 'source_unknown' && e.retryable === false,
  );
});

test('replay: a failed event can be retried and then succeeds', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  const original = db.deal.create;
  db.deal.create = async () => { throw new Error('db down'); };
  const first = await processEvent(event.id, { db, canonicalEvent: await rebuildCanonicalEvent(db._tables.ingressEvent[0]) });
  assert.equal(first.status, 'pending');
  assert.equal(db._tables.deal.length, 0);

  db.deal.create = original;
  const second = await replayEvent(event.id, { db });
  assert.equal(second.status, 'processed');
  assert.equal(db._tables.deal.length, 1);
});

test('replay: retrying an already-processed event never creates a second deal', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  await replayEvent(event.id, { db });
  assert.equal(db._tables.deal.length, 1);
  const again = await replayEvent(event.id, { db });
  assert.equal(again.skipped, true);
  assert.equal(db._tables.deal.length, 1);
});

test('replay: dry-run inspection does not disturb the stored event', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  await replayEvent(event.id, { db }); // process for real
  const before = { ...db._tables.ingressEvent[0] };

  const probe = await replayEvent(event.id, { db, asDryRun: true });
  const after = db._tables.ingressEvent[0];
  assert.equal(after.status, before.status, 'stored status untouched by inspection');
  assert.equal(after.outcome, before.outcome);
  assert.equal(db._tables.deal.length, 1, 'no extra deal from an inspection');
  assert.ok(probe);
});

test('worker: a due pending event is claimed and processed', async () => {
  const db = workerDb();
  const { event } = await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  db._tables.ingressEvent[0].nextRetryAt = new Date(Date.now() - 1000);
  // A fresh event is claimed by its INLINE processor (worker-race fix); the
  // worker takes over only once that claim is stale — the crashed-mid-flight
  // scenario this test proves.
  db._tables.ingressEvent[0].claimedAt = new Date(Date.now() - CLAIM_TTL_MS - 1000);

  const n = await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(n, 1);
  assert.equal(db._tables.ingressEvent[0].status, 'processed');
  assert.equal(db._tables.deal.length, 1);
  assert.equal(event.id, db._tables.ingressEvent[0].id);
});

test('worker: an event whose retry is not yet due is left alone', async () => {
  const db = workerDb();
  await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  db._tables.ingressEvent[0].nextRetryAt = new Date(Date.now() + 60_000);

  const n = await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(n, 0);
  assert.equal(db._tables.deal.length, 0);
});

test('worker: a freshly claimed event is not stolen by a second worker', async () => {
  const db = workerDb();
  await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  db._tables.ingressEvent[0].claimedAt = new Date(); // claimed moments ago
  db._tables.ingressEvent[0].claimedBy = 'other-worker';

  const n = await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(n, 0, 'live claim respected');
});

test('worker: a stale claim past the TTL is reclaimed', async () => {
  const db = workerDb();
  await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  db._tables.ingressEvent[0].claimedAt = new Date(Date.now() - CLAIM_TTL_MS - 1000);
  db._tables.ingressEvent[0].claimedBy = 'crashed-worker';

  const n = await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(n, 1, 'crashed worker does not wedge the event forever');
});

test('worker: permanently failed and dead events are never auto-retried', async () => {
  const db = workerDb();
  await receiveEvent({ source: 'website_form', sourceKey: 'a', rawPayload: formPayload }, db);
  await receiveEvent({ source: 'website_form', sourceKey: 'b', rawPayload: { ...formPayload, phone: '1' } }, db);
  db._tables.ingressEvent[0].status = 'failed';
  db._tables.ingressEvent[1].status = 'dead';

  const n = await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(n, 0, 'these need a human or a code fix, not a silent retry');
});

test('worker: a duplicate-suppressed repeat lead still resolves through the worker', async () => {
  const db = workerDb();
  const contactId = seedContact(db, { phone: '050-123-4567' });
  const dealId = seedOpenDeal(db, contactId);
  await receiveEvent({ source: 'website_form', sourceKey: 'f', rawPayload: formPayload }, db);
  // Stale inline claim → the worker may recover it (see the claim-at-birth fix).
  db._tables.ingressEvent[0].claimedAt = new Date(Date.now() - CLAIM_TTL_MS - 1000);

  await runIngressRetryTick(db, { log() {}, error() {} });
  assert.equal(db._tables.ingressEvent[0].outcome, 'annotated_deal');
  assert.equal(db._tables.ingressEvent[0].dealId, dealId);
  assert.equal(db._tables.deal.length, 1);
});

test('replay: a Meta event with no stored details re-fetches on replay', async () => {
  await withEnv({ META_PAGE_ACCESS_TOKEN: 'tok' }, async () => {
    const row = {
      source: 'meta_lead_ads',
      sourceKey: 'f1',
      externalId: 'l1',
      rawPayload: { notification: { leadgenId: 'l1', formId: 'f1' }, fetchError: 'provider_unavailable' },
    };
    const rebuilt = await rebuildCanonicalEvent(row, {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ id: 'l1', field_data: [{ name: 'phone_number', values: ['0501234567'] }] }),
      }),
    });
    assert.equal(rebuilt.person.phone, '0501234567');
    assert.equal(rebuilt.externalId, 'l1');
  });
});

test('replay: a Woo event stored id-only re-fetches the order', async () => {
  await withEnv(
    { WOO_NEW_BASE_URL: 'https://new.example', WOO_NEW_CONSUMER_KEY: 'ck', WOO_NEW_CONSUMER_SECRET: 'cs' },
    async () => {
      const row = { source: 'woocommerce', sourceKey: 'secondary', externalId: '77', rawPayload: { orderId: '77' } };
      const rebuilt = await rebuildCanonicalEvent(row, {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ id: 77, status: 'processing', total: '100.00', billing: { email: 'a@b.co', first_name: 'א' }, line_items: [] }),
        }),
      });
      assert.equal(rebuilt.kind, 'order');
      assert.equal(rebuilt.externalId, '77');
      assert.equal(rebuilt.person.email, 'a@b.co');
    },
  );
});
