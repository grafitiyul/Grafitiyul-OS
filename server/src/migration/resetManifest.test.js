import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPACT_PROBES,
  PROTECTED_TABLES,
  buildResetManifest,
  executeResetManifest,
  manifestHash,
  matchTestPattern,
  probeDealImpact,
} from './resetManifest.js';

// ── the pattern rule ──────────────────────────────────────────────────────────

test('test patterns match the real QA titles found in production', () => {
  for (const t of [
    'בדיקה1', 'בדיקה2', 'בדיקה3', 'בדיקה 4',
    'בדיקת מערכת — קבוצה 1', 'בדיקת מערכת — קבוצה 2',
    'QA שפה — EN (בדיקה אוטומטית)', 'QA UX — English group', 'QA EN label parity',
    'test run', 'Demo account',
  ]) {
    assert.ok(matchTestPattern(t), `expected a match for "${t}"`);
  }
});

test('test patterns do NOT match real business titles', () => {
  for (const t of [
    'ציפי 2', 'שירות לקוחות גרפיטיול', 'ענת גרינברג', 'אלינוי קיסלוב',
    'גיא קורן', 'משפחת רוזנברג',
    'בדיקת התאמה ללקוח',          // contains בדיקת but is not "בדיקת מערכת"
    'סיור בדיקה של הלקוח',        // בדיקה is not at the start
    'Protest group',              // "test" inside a word
    'Pandemonium QA',             // QA not at the start
    '', null, undefined,
  ]) {
    assert.equal(matchTestPattern(t), null, `expected NO match for "${t}"`);
  }
});

// ── impact probing ────────────────────────────────────────────────────────────

function probeDb({ rows = {}, missingTables = [] } = {}) {
  return {
    async $queryRawUnsafe(sql, ...params) {
      if (sql.includes('information_schema.tables')) {
        return missingTables.includes(params[0]) ? [] : [{ ok: 1 }];
      }
      const m = sql.match(/FROM "([^"]+)" WHERE "([^"]+)" = \$1/);
      if (m) return [{ n: BigInt(rows[m[1]] ?? 0) }];
      return [];
    },
  };
}

test('a clean deal probes zero across every signal', async () => {
  const { blockers, counts } = await probeDealImpact(probeDb(), 'd1');
  assert.deepEqual(blockers, []);
  assert.equal(Object.keys(counts).length, IMPACT_PROBES.length);
});

test('every impact signal individually blocks removal', async () => {
  for (const p of IMPACT_PROBES) {
    const { blockers } = await probeDealImpact(probeDb({ rows: { [p.table]: 1 } }), 'd1');
    assert.equal(blockers.length, 1, `${p.table} should block`);
    assert.ok(blockers[0].includes(p.why));
  }
});

test('loose (non-FK) references are probed — a cascade would never reveal them', async () => {
  const loose = IMPACT_PROBES.filter((p) => p.loose).map((p) => p.table);
  assert.ok(loose.includes('CommunicationDelivery'));
  assert.ok(loose.includes('IngressEvent'));
  const { blockers } = await probeDealImpact(probeDb({ rows: { CommunicationDelivery: 3 } }), 'd1');
  assert.match(blockers[0], /sent communications \(3\)/);
});

test('a table absent from this schema version is reported as skipped, not assumed empty', async () => {
  const { skipped, counts } = await probeDealImpact(probeDb({ missingTables: ['ReservationGroup'] }), 'd1');
  assert.deepEqual(skipped, ['ReservationGroup']);
  assert.equal(counts.reservations, undefined);
});

// ── manifest construction ─────────────────────────────────────────────────────

function manifestDb({ natives = [], impact = {}, orphans = [], sessions = {}, qaOrgs = [] } = {}) {
  return {
    async $queryRawUnsafe(sql, ...params) {
      if (sql.includes('information_schema.tables')) return [{ ok: 1 }];
      // Order matters: the tier-2 org query embeds `FROM "Deal" d` in a NOT
      // EXISTS subquery, so it must be matched before the natives branch.
      if (sql.includes('FROM "Organization" o')) return qaOrgs;
      if (sql.includes('FROM "ReservationGroup" g')) return sessions[params[0]] || [];
      if (sql.includes('FROM "Contact" c')) return orphans;
      if (sql.includes('FROM "Deal" d')) return natives;
      const m = sql.match(/FROM "([^"]+)" WHERE "([^"]+)" = \$1/);
      if (m) return [{ n: BigInt(impact[params[0]]?.[m[1]] ?? 0) }];
      return [];
    },
  };
}

const qaSession = (o) => ({
  sessionId: o.sessionId || 's1', sessionNo: o.sessionNo || 1000,
  signerName: o.signerName ?? null, orgName: o.orgName ?? null,
});

const deal = (o) => ({
  id: `d${o.orderNo}`, orderNo: o.orderNo, title: o.title, status: o.status || 'open',
  createdAt: new Date('2026-07-24T00:00:00Z'), valueMinor: o.valueMinor ?? '0',
});

test('manifest removes clean test deals and keeps real ones', async () => {
  const db = manifestDb({
    natives: [
      deal({ orderNo: 27009, title: 'בדיקה1' }),
      deal({ orderNo: 27019, title: 'גיא קורן' }),
      deal({ orderNo: 27011, title: 'QA שפה — EN (בדיקה אוטומטית)' }),
    ],
  });
  const m = await buildResetManifest(db);
  assert.deepEqual(m.remove.deals.map((d) => d.orderNo).sort(), [27009, 27011]);
  assert.deepEqual(m.keep.map((d) => d.orderNo), [27019]);
  assert.match(m.keep[0].reason, /no test pattern/);
});

test('real-world impact beats the test pattern — a QA deal with a payment is KEPT', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה1' })],
    impact: { d27009: { PaymentRequest: 1 } },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.remove.deals.length, 0);
  assert.equal(m.keep.length, 1);
  assert.match(m.keep[0].reason, /real-world impact: has payment requests \(1\)/);
});

test('a test-titled deal carrying money is KEPT even with no other impact', async () => {
  const db = manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1', valueMinor: '150000' })] });
  const m = await buildResetManifest(db);
  assert.equal(m.remove.deals.length, 0);
  assert.match(m.keep[0].reason, /non-zero value/);
});

test('orphan contacts are removed only when linked exclusively to removable deals', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה1' })],
    orphans: [{ id: 'c1', firstNameHe: 'בדיקה', lastNameHe: 'אוטומטית' }],
  });
  const m = await buildResetManifest(db);
  assert.equal(m.remove.contacts.length, 1);
  assert.equal(m.remove.contacts[0].id, 'c1');
});

test('no orphan-contact query runs when nothing is removable', async () => {
  let contactQueried = false;
  const db = {
    async $queryRawUnsafe(sql) {
      if (sql.includes('information_schema.tables')) return [{ ok: 1 }];
      if (sql.includes('FROM "Deal" d')) return [deal({ orderNo: 27019, title: 'גיא קורן' })];
      if (sql.includes('FROM "Contact" c')) { contactQueried = true; return []; }
      return [{ n: 0n }];
    },
  };
  await buildResetManifest(db);
  assert.equal(contactQueried, false);
});

// ── tier 2: provably-QA reservations ──────────────────────────────────────────

test('a test deal whose ONLY impact is a test-agency reservation lands in tier 2', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX — English group' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת — סוכנות נסיעות (זמני)' })] },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.remove.deals.length, 0, 'never tier 1');
  assert.equal(m.removeQaReservations.deals.length, 1);
  assert.match(m.removeQaReservations.deals[0].reason, /test agency org/);
  assert.equal(m.removeQaReservations.sessions.length, 1);
});

test('a QA signer is also sufficient evidence', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27013, title: 'QA Legal Freeze run' })],
    impact: { d27013: { ReservationGroup: 1 } },
    sessions: { d27013: [qaSession({ orgName: 'גרפיטיול', signerName: 'QA Automated Test' })] },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.removeQaReservations.deals.length, 1);
  assert.match(m.removeQaReservations.deals[0].reason, /test signer/);
});

test('a reservation through a REAL org with no signer is NOT qualified — it stays in keep', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה1' })],
    impact: { d27009: { ReservationGroup: 1 } },
    sessions: { d27009: [qaSession({ orgName: 'גרפיטיול', signerName: null })] },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.removeQaReservations.deals.length, 0);
  assert.equal(m.keep.length, 1);
  assert.match(m.keep[0].reason, /no QA evidence/);
  assert.match(m.keep[0].reason, /needs a manual decision/);
});

test('one non-QA session among several disqualifies the whole deal', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA mixed' })],
    impact: { d27011: { ReservationGroup: 2 } },
    sessions: {
      d27011: [
        qaSession({ sessionId: 's1', orgName: 'בדיקת מערכת — סוכנות' }),
        qaSession({ sessionId: 's2', sessionNo: 1001, orgName: 'גרפיטיול', signerName: null }),
      ],
    },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.removeQaReservations.deals.length, 0);
  assert.match(m.keep[0].reason, /no QA evidence/);
});

test('an engine-computed value does NOT block tier 2 — the QA session is stronger evidence', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX — English group', valueMinor: '531000' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת — סוכנות נסיעות (זמני)' })] },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.removeQaReservations.deals.length, 1);
  assert.match(m.removeQaReservations.deals[0].reason, /QA artefact, not real money/);
});

test('but a non-zero value still blocks TIER 1, which has no corroborating evidence', async () => {
  const db = manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1', valueMinor: '531000' })] });
  const m = await buildResetManifest(db);
  assert.equal(m.remove.deals.length, 0);
  assert.match(m.keep[0].reason, /non-zero value/);
});

test('a QA reservation does NOT excuse any other impact (a payment still keeps it)', async () => {
  const db = manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1, PaymentRequest: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת' })] },
  });
  const m = await buildResetManifest(db);
  assert.equal(m.removeQaReservations.deals.length, 0);
  assert.equal(m.remove.deals.length, 0);
  assert.match(m.keep[0].reason, /real-world impact/);
});

test('tier 2 hashes separately from tier 1 and both are stable', async () => {
  const opts = {
    natives: [deal({ orderNo: 27009, title: 'בדיקה9' }), deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת' })] },
  };
  const a = await buildResetManifest(manifestDb(opts));
  const b = await buildResetManifest(manifestDb(opts));
  assert.equal(a.manifestSha256, b.manifestSha256);
  assert.equal(a.qaReservationsSha256, b.qaReservationsSha256);
  assert.notEqual(a.manifestSha256, a.qaReservationsSha256);
  assert.equal(a.remove.deals.length, 1);
  assert.equal(a.removeQaReservations.deals.length, 1);
});

test('approving tier 1 alone NEVER deletes tier 2', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה9' }), deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת' })] },
  }));
  const deleted = [];
  const tx = probeDb();
  tx.$executeRawUnsafe = async (sql, id) => { deleted.push(`${sql.match(/FROM "(\w+)"/)[1]}:${id}`); };
  const res = await executeResetManifest({ $transaction: async (fn) => fn(tx) }, m, {
    approvedHash: m.manifestSha256, dryRun: false,
  });
  assert.equal(res.includeQa, false);
  assert.deepEqual(deleted, ['Deal:d27009']);
  assert.equal(res.sessions, 0);
});

test('approving both tiers deletes deals, then sessions (which cascade documents), then orgs', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ sessionId: 'sess1', orgName: 'בדיקת מערכת' })] },
    qaOrgs: [{ id: 'org1', name: 'בדיקת מערכת — סוכנות נסיעות (זמני)' }],
  }));
  assert.equal(m.removeQaReservations.organizations.length, 1);

  const deleted = [];
  const tx = probeDb({ rows: { ReservationGroup: 1 } });
  tx.$executeRawUnsafe = async (sql, id) => { deleted.push(`${sql.match(/FROM "(\w+)"/)[1]}:${id}`); };
  const res = await executeResetManifest({ $transaction: async (fn) => fn(tx) }, m, {
    approvedHash: m.manifestSha256, approvedQaHash: m.qaReservationsSha256, dryRun: false,
  });
  assert.equal(res.includeQa, true);
  assert.deepEqual(deleted, ['Deal:d27011', 'ReservationSession:sess1', 'Organization:org1']);
});

test('a stale tier-2 approval is refused independently of tier 1', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת' })] },
  }));
  await assert.rejects(
    () => executeResetManifest(manifestDb(), m, {
      approvedHash: m.manifestSha256, approvedQaHash: 'yesterdays-qa-hash', dryRun: false,
    }),
    (e) => e.code === 'QA_MANIFEST_CHANGED',
  );
});

test('a tier-2 deal that gains NON-reservation impact still aborts the run', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27011, title: 'QA UX' })],
    impact: { d27011: { ReservationGroup: 1 } },
    sessions: { d27011: [qaSession({ orgName: 'בדיקת מערכת' })] },
  }));
  const tx = probeDb({ rows: { ReservationGroup: 1, IcountDocument: 1 } });
  tx.$executeRawUnsafe = async () => { throw new Error('must not delete'); };
  await assert.rejects(
    () => executeResetManifest({ $transaction: async (fn) => fn(tx) }, m, {
      approvedHash: m.manifestSha256, approvedQaHash: m.qaReservationsSha256, dryRun: false,
    }),
    (e) => e.code === 'IMPACT_APPEARED',
  );
});

// ── hashing + approval gate ───────────────────────────────────────────────────

test('manifest hash depends on the removal set, not on when it was built', async () => {
  const natives = [deal({ orderNo: 27009, title: 'בדיקה1' }), deal({ orderNo: 27019, title: 'גיא קורן' })];
  const a = await buildResetManifest(manifestDb({ natives }), { now: new Date('2026-07-29T10:00:00Z') });
  const b = await buildResetManifest(manifestDb({ natives }), { now: new Date('2026-07-30T22:00:00Z') });
  assert.equal(a.manifestSha256, b.manifestSha256);
  assert.notEqual(a.builtAt, b.builtAt);
});

test('adding one record to the removal set changes the hash', () => {
  const base = { remove: { deals: [{ id: 'a' }], contacts: [] } };
  const more = { remove: { deals: [{ id: 'a' }, { id: 'b' }], contacts: [] } };
  assert.notEqual(manifestHash(base), manifestHash(more));
});

test('execution refuses without an approved hash', async () => {
  const m = await buildResetManifest(manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1' })] }));
  await assert.rejects(
    () => executeResetManifest(manifestDb(), m, { approvedHash: null }),
    (e) => e.code === 'NO_APPROVED_HASH',
  );
});

test('execution refuses when the manifest changed since approval', async () => {
  const m = await buildResetManifest(manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1' })] }));
  await assert.rejects(
    () => executeResetManifest(manifestDb(), m, { approvedHash: 'stale-hash-from-yesterday' }),
    (e) => e.code === 'MANIFEST_CHANGED',
  );
});

test('dry run reports the set and writes nothing', async () => {
  const m = await buildResetManifest(manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1' })] }));
  let wrote = false;
  const db = { $transaction: async () => { wrote = true; } };
  const res = await executeResetManifest(db, m, { approvedHash: m.manifestSha256, dryRun: true });
  assert.equal(wrote, false);
  assert.equal(res.deals, 1);
  assert.deepEqual(res.dealIds, ['d27009']);
});

test('execution aborts if impact appeared between approval and the transaction', async () => {
  const m = await buildResetManifest(manifestDb({ natives: [deal({ orderNo: 27009, title: 'בדיקה1' })] }));
  const tx = probeDb({ rows: { PaymentRequest: 1 } });
  tx.$executeRawUnsafe = async () => { throw new Error('must not delete'); };
  const db = { $transaction: async (fn) => fn(tx) };
  await assert.rejects(
    () => executeResetManifest(db, m, { approvedHash: m.manifestSha256, dryRun: false }),
    (e) => e.code === 'IMPACT_APPEARED',
  );
});

test('execution deletes exactly the approved set inside one transaction', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה1' })],
    orphans: [{ id: 'c1', firstNameHe: 'x', lastNameHe: 'y' }],
  }));
  const deleted = [];
  const tx = probeDb();
  tx.$executeRawUnsafe = async (sql, id) => { deleted.push(`${sql.match(/FROM "(\w+)"/)[1]}:${id}`); };
  let inTx = false;
  const db = { $transaction: async (fn) => { inTx = true; await fn(tx); } };

  const res = await executeResetManifest(db, m, { approvedHash: m.manifestSha256, dryRun: false });
  assert.equal(inTx, true);
  assert.deepEqual(deleted, ['Deal:d27009', 'Contact:c1']);
  assert.equal(res.deals, 1);
  assert.equal(res.contacts, 1);
});

// ── protection ────────────────────────────────────────────────────────────────

test('configuration and system entities are on the protected list', () => {
  for (const t of [
    'DealStage', 'DealSource', 'Product', 'ProductVariant', 'Location', 'PriceRule',
    'AdminUser', 'PersonRef', 'PersonProfile', 'OpenTourTemplate', 'CommunicationTemplate',
    'TaskType', 'WhatsAppAccount', 'LegacyRecord', 'MigrationDecision', '_prisma_migrations',
  ]) {
    assert.ok(PROTECTED_TABLES.includes(t), `${t} must be protected`);
  }
});

test('the manifest can only ever name Deal and Contact rows', async () => {
  const m = await buildResetManifest(manifestDb({
    natives: [deal({ orderNo: 27009, title: 'בדיקה1' })],
    orphans: [{ id: 'c1', firstNameHe: 'x', lastNameHe: 'y' }],
  }));
  const entities = new Set([...m.remove.deals, ...m.remove.contacts].map((r) => r.entity));
  assert.deepEqual([...entities].sort(), ['Contact', 'Deal']);
  for (const e of entities) assert.ok(!PROTECTED_TABLES.includes(e));
});
