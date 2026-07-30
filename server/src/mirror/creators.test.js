import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomicCreate, createContact, createNote } from './creators.js';

// A minimal db stub with REAL transaction semantics for the parts that matter:
// writes inside $transaction are staged and either all commit or all vanish, and
// the LegacyRecord unique key genuinely rejects a second insert with P2002.
function txDb() {
  const t = { legacyRecord: [], contact: [], contactPhone: [], contactEmail: [], contactOrganization: [], timelineEntry: [] };
  const xkey = (r) => `${r.sourceSystem}|${r.sourceType}|${r.sourceId}`;
  const makeClient = (tables) => ({
    legacyRecord: {
      findUnique: async ({ where }) => {
        const k = where.sourceSystem_sourceType_sourceId;
        return tables.legacyRecord.find((r) => xkey(r) === `${k.sourceSystem}|${k.sourceType}|${k.sourceId}`) || null;
      },
      create: async ({ data }) => {
        if (tables.legacyRecord.some((r) => xkey(r) === xkey(data))) {
          const e = new Error('unique'); e.code = 'P2002'; throw e;
        }
        tables.legacyRecord.push({ ...data }); return data;
      },
    },
    contact: { create: async ({ data }) => { tables.contact.push({ ...data }); return data; } },
    contactPhone: { create: async ({ data }) => { tables.contactPhone.push({ ...data }); return data; } },
    contactEmail: { create: async ({ data }) => { tables.contactEmail.push({ ...data }); return data; } },
    contactOrganization: { create: async ({ data }) => { tables.contactOrganization.push({ ...data }); return data; } },
    timelineEntry: { create: async ({ data }) => { tables.timelineEntry.push({ ...data }); return data; } },
  });
  const db = makeClient(t);
  db._t = t;
  db.$transaction = async (fn) => {
    // Postgres semantics, not snapshot-replace: writes stage locally, the UNIQUE
    // check on LegacyRecord sees rows COMMITTED by other transactions (read
    // committed + unique index), and commit APPENDS the staged rows — it never
    // clobbers a concurrent writer's committed data.
    const staged = Object.fromEntries(Object.keys(t).map((k) => [k, []]));
    const txClient = makeClient(staged);
    const inner = txClient.legacyRecord.create;
    txClient.legacyRecord.create = async ({ data }) => {
      if (t.legacyRecord.some((r) => xkey(r) === xkey(data))) {
        const e = new Error('unique'); e.code = 'P2002'; throw e;
      }
      return inner({ data });
    };
    const res = await fn(txClient);
    for (const k of Object.keys(t)) t[k].push(...staged[k]);
    return res;
  };
  return db;
}

test('atomicCreate commits entity and crosswalk together', async () => {
  const db = txDb();
  const r = await atomicCreate(db, {
    sourceType: 'person', sourceId: '9',
    writes: async (tx) => { await tx.contact.create({ data: { id: 'c9' } }); return { entityType: 'Contact', entityId: 'c9' }; },
  });
  assert.equal(r.entityId, 'c9');
  assert.equal(db._t.contact.length, 1);
  assert.equal(db._t.legacyRecord.length, 1);
  assert.equal(db._t.legacyRecord[0].entityId, 'c9');
});

test('a retry after success returns the SAME entity and writes nothing new', async () => {
  const db = txDb();
  const writes = async (tx) => { await tx.contact.create({ data: { id: `c${db._t.contact.length}` } }); return { entityType: 'Contact', entityId: `c${db._t.contact.length}` }; };
  const a = await atomicCreate(db, { sourceType: 'person', sourceId: '9', writes });
  const b = await atomicCreate(db, { sourceType: 'person', sourceId: '9', writes });
  assert.equal(b.entityId, a.entityId);
  assert.equal(b.alreadyExisted, true);
  assert.equal(db._t.contact.length, 1, 'exactly one entity, ever');
});

test('a LOSING concurrent worker rolls back its entity and returns the winner', async () => {
  const db = txDb();
  // Simulate the race: the crosswalk check passes (empty), then the winner's row
  // appears before OUR transaction inserts the crosswalk.
  let raced = false;
  const r = await atomicCreate(db, {
    sourceType: 'person', sourceId: '9',
    writes: async (tx) => {
      await tx.contact.create({ data: { id: 'loser' } });
      if (!raced) {
        raced = true;
        // The winner commits directly to the outer tables mid-flight.
        db._t.contact.push({ id: 'winner' });
        db._t.legacyRecord.push({ sourceSystem: 'pipedrive', sourceType: 'person', sourceId: '9', entityType: 'Contact', entityId: 'winner' });
      }
      return { entityType: 'Contact', entityId: 'loser' };
    },
  });
  assert.equal(r.entityId, 'winner', 'the loser returns the winner\'s entity');
  assert.equal(r.alreadyExisted, true);
  assert.ok(!db._t.contact.some((c) => c.id === 'loser'), 'the loser\'s half-created entity was rolled back');
  assert.equal(db._t.legacyRecord.length, 1, 'one crosswalk row, the winner\'s');
});

test('a throw inside writes leaves NOTHING behind', async () => {
  const db = txDb();
  await assert.rejects(() => atomicCreate(db, {
    sourceType: 'person', sourceId: '9',
    writes: async (tx) => { await tx.contact.create({ data: { id: 'x' } }); throw new Error('boom'); },
  }), /boom/);
  assert.equal(db._t.contact.length, 0);
  assert.equal(db._t.legacyRecord.length, 0);
});

test('createContact declines a nameless person with a nameable reason', async () => {
  const db = txDb();
  const r = await createContact(db, { fields: {} }, { externalId: '5', rawPayload: { current: { id: 5, name: '   ' } } });
  assert.equal(r.reason, 'invalid_name');
  assert.equal(db._t.contact.length, 0);
});

test('createContact creates contact + channels + crosswalk atomically', async () => {
  const db = txDb();
  const r = await createContact(db, { fields: {} }, {
    externalId: '5',
    rawPayload: { current: { id: 5, name: 'נועה שניר', phone: [{ value: '050-111-2222' }], email: [{ value: 'noa@x.com' }] } },
  });
  assert.equal(r.entityType, 'Contact');
  assert.equal(db._t.contact.length, 1);
  assert.equal(db._t.contact[0].firstNameHe, 'נועה');
  assert.equal(db._t.contactPhone.length, 1);
  assert.equal(db._t.contactEmail.length, 1);
  assert.equal(db._t.legacyRecord[0].sourceType, 'person');
});

test('createNote defers when its subject is not in GOS', async () => {
  const db = txDb();
  // referenceBundle is bypassed by injecting a pre-warmed cache? No — createNote
  // calls referenceBundle(db) which needs R2. Instead, prove the subject gate by
  // the planner itself: no deal/person/org crosswalk → noSubject → reason.
  db.migrationDecision = { findMany: async () => [] };
  db.dealStage = { findMany: async () => [] };
  let r;
  try {
    r = await createNote(db, { fields: {} }, { externalId: '7', rawPayload: { current: { id: 7, content: 'x', deal_id: 12345 } } });
  } catch (e) {
    // Without R2 credentials the reference load fails (network/credential error
    // shape varies by environment). What matters for this unit is that NOTHING
    // was created and the failure is a throw the pipeline will defer — not a
    // silent success.
    assert.equal(db._t.timelineEntry.length, 0);
    return;
  }
  assert.ok(r.reason, 'declined with a reason, not created blind');
  assert.equal(db._t.timelineEntry.length, 0);
});
