import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureStaffFormLink, resolveStaffFormLink, staffFormUrl, revokeStaffFormLinks } from './staffLinks.js';

// The security contract for staff form links, stated as tests.
//
// The bug being fixed: operational messages linked guides to
// /p/<portalToken>/tour/<id>, which is the whole-portal token with a path on
// the end. These tests pin the properties that make the replacement safe.

function stubDb({ links = [], template = { id: 'tpl1' } } = {}) {
  let seq = 0;
  const rows = [...links];
  const match = (where) => rows.find((r) => Object.entries(where)
    .every(([k, v]) => (v === undefined ? true : r[k] === v)));
  return {
    rows,
    questionnaireTemplate: { findFirst: async () => template },
    questionnaireLink: {
      findFirst: async ({ where }) => match(where) || null,
      findUnique: async ({ where }) => rows.find((r) => r.token === where.token) || null,
      create: async ({ data }) => {
        const identity = ['purpose', 'subjectType', 'subjectId', 'actorScope', 'audience'];
        if (rows.some((r) => identity.every((k) => r[k] === data[k]))) {
          const e = new Error('unique'); e.code = 'P2002'; throw e;
        }
        const row = { id: `l${++seq}`, isActive: true, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let n = 0;
        for (const r of rows) {
          if (r.subjectType === where.subjectType && r.subjectId === where.subjectId
            && r.audience === where.audience && r.isActive === where.isActive) {
            Object.assign(r, data); n++;
          }
        }
        return { count: n };
      },
    },
  };
}

const coordination = { purpose: 'coordination', subjectType: 'booking', subjectId: 'b1' };
const summary = { purpose: 'tour_summary', subjectType: 'tour_event', subjectId: 't1', actorScope: 'guide-A' };

// ── minting ──────────────────────────────────────────────────────────────────

test('a staff link is minted once and REUSED by every retry', async () => {
  // A reminder that fires three times must not leave three live tokens for one
  // form, and a guide who bookmarked the link must keep working.
  const db = stubDb();
  const a = await ensureStaffFormLink(coordination, { db });
  const b = await ensureStaffFormLink(coordination, { db });
  const c = await ensureStaffFormLink(coordination, { db });
  assert.equal(a.token, b.token);
  assert.equal(b.token, c.token);
  assert.equal(db.rows.length, 1);
});

test('tokens are high-entropy and unguessable', async () => {
  const db = stubDb();
  const a = await ensureStaffFormLink(coordination, { db });
  const b = await ensureStaffFormLink({ ...coordination, subjectId: 'b2' }, { db });
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 32, `token too short: ${a.token.length}`);
  // No business identifier leaks into the token itself.
  assert.equal(a.token.includes('b1'), false);
});

test('every booking gets its OWN link — the open-tour case', async () => {
  // One tour, three customers → three independent forms and three tokens.
  const db = stubDb();
  const tokens = [];
  for (const subjectId of ['bookA', 'bookB', 'bookC']) {
    tokens.push((await ensureStaffFormLink({ ...coordination, subjectId }, { db })).token);
  }
  assert.equal(new Set(tokens).size, 3);
  assert.equal(db.rows.length, 3);
});

test('a per-actor form is scoped to ONE guide', async () => {
  // Guide A's summary link must never be able to open guide B's summary.
  const db = stubDb();
  const a = await ensureStaffFormLink(summary, { db });
  const b = await ensureStaffFormLink({ ...summary, actorScope: 'guide-B' }, { db });
  assert.notEqual(a.token, b.token);
  assert.equal(a.actorScope, 'guide-A');
  assert.equal(b.actorScope, 'guide-B');
});

test('a per-actor purpose refuses a link with no actor scope', async () => {
  // Without this, one unscoped summary link would serve every guide on the tour.
  await assert.rejects(
    () => ensureStaffFormLink({ purpose: 'tour_summary', subjectType: 'tour_event', subjectId: 't1' }, { db: stubDb() }),
    (e) => e.code === 'actor_scope_required',
  );
});

test('a NON-actor purpose ignores a stray actor scope', async () => {
  // Otherwise the same coordination form would mint one link per guide.
  const db = stubDb();
  const a = await ensureStaffFormLink(coordination, { db });
  const b = await ensureStaffFormLink({ ...coordination, actorScope: 'guide-A' }, { db });
  assert.equal(a.token, b.token, 'coordination is per booking, not per guide');
});

test('a public-audience purpose cannot mint a staff link', async () => {
  await assert.rejects(
    () => ensureStaffFormLink({ purpose: 'general', subjectType: 'booking', subjectId: 'b1' }, { db: stubDb() }),
    (e) => e.code === 'purpose_not_staff',
  );
});

// ── resolving: the actual authorization boundary ─────────────────────────────

test('a valid staff token resolves to its ONE form', async () => {
  const db = stubDb();
  const link = await ensureStaffFormLink(coordination, { db });
  link.template = { status: 'active', currentVersionId: 'v1' };
  const resolved = await resolveStaffFormLink(link.token, { db });
  assert.equal(resolved.subjectId, 'b1');
  assert.equal(resolved.purpose, 'coordination');
});

test('a PUBLIC customer token is rejected on the staff route', async () => {
  // The two surfaces must never be interchangeable in either direction.
  const db = stubDb({
    links: [{
      id: 'l9', token: 'public-token', audience: 'public', isActive: true,
      purpose: 'coordination', subjectType: 'booking', subjectId: 'b1',
      template: { status: 'active', currentVersionId: 'v1' },
    }],
  });
  await assert.rejects(() => resolveStaffFormLink('public-token', { db }), (e) => e.status === 404);
});

test('revoked, expired and unknown tokens all fail identically', async () => {
  // A probing caller must not be able to tell WHY a token failed.
  const base = {
    audience: 'staff', purpose: 'coordination', subjectType: 'booking', subjectId: 'b1',
    template: { status: 'active', currentVersionId: 'v1' },
  };
  const db = stubDb({
    links: [
      { id: 'l1', token: 'revoked', isActive: false, ...base },
      { id: 'l2', token: 'expired', isActive: true, expiresAt: new Date(Date.now() - 1000), ...base },
    ],
  });
  for (const t of ['revoked', 'expired', 'never-existed']) {
    await assert.rejects(() => resolveStaffFormLink(t, { db }), (e) => e.status === 404 && e.code === 'not_found');
  }
});

test('a link dies if its template is unpublished or archived', async () => {
  const db = stubDb({
    links: [{
      id: 'l1', token: 'tok', isActive: true, audience: 'staff', purpose: 'coordination',
      subjectType: 'booking', subjectId: 'b1',
      template: { status: 'archived', currentVersionId: 'v1' },
    }],
  });
  await assert.rejects(() => resolveStaffFormLink('tok', { db }), (e) => e.status === 404);
});

// ── the URL itself ───────────────────────────────────────────────────────────

test('the URL carries ONLY the token — no portal path, no ids', async () => {
  // The whole bug was a URL that contained a portal token plus a path. This one
  // has no path to truncate into anything else.
  const url = staffFormUrl({ token: 'abc123' }, 'https://app.example.com');
  assert.equal(url, 'https://app.example.com/f/abc123');
  assert.equal(url.includes('/p/'), false, 'must not resemble a portal link');
  assert.equal(url.includes('tour'), false);
});

test('no URL is produced without an origin or a token', () => {
  assert.equal(staffFormUrl(null, 'https://x'), null);
  assert.equal(staffFormUrl({ token: 'a' }, null), null);
});

// ── revocation ───────────────────────────────────────────────────────────────

test('revoking a subject kills its staff links only', async () => {
  const db = stubDb();
  await ensureStaffFormLink(coordination, { db });
  await ensureStaffFormLink({ ...coordination, subjectId: 'b2' }, { db });
  const n = await revokeStaffFormLinks({ subjectType: 'booking', subjectId: 'b1' }, { db });
  assert.equal(n, 1);
  assert.equal(db.rows.find((r) => r.subjectId === 'b1').isActive, false);
  assert.equal(db.rows.find((r) => r.subjectId === 'b2').isActive, true);
});

test('a revoked link is RE-ARMED rather than duplicated', async () => {
  // A cancellation that is undone must not strand a circulated URL.
  const db = stubDb();
  const first = await ensureStaffFormLink(coordination, { db });
  await revokeStaffFormLinks({ subjectType: 'booking', subjectId: 'b1' }, { db });
  const again = await ensureStaffFormLink(coordination, { db });
  assert.equal(again.token, first.token);
  assert.equal(again.isActive, true);
  assert.equal(db.rows.length, 1);
});
