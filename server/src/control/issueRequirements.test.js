import test from 'node:test';
import assert from 'node:assert/strict';
import { emitTourChangeImpact } from '../tours/changeImpact.js';
import { setRequirementState, refreshIssueClosure } from './issueRequirements.js';
import { sendNotification, evaluateCustomerNotification } from './issueNotifications.js';

// Part 4 end-to-end over an in-memory prisma fake: impact → first-class
// requirements → per-recipient notifications → parent closure. Reuses the same
// service code the routes call.

function makeDb({ regs = [], tour = { wooSyncStatus: null, gcalSyncStatus: null }, guides = 0 } = {}) {
  const issues = [];
  const reqs = [];
  const notifs = [];
  let seq = 0;
  const id = (p) => `${p}${++seq}`;
  const ACTIVE = ['open', 'acknowledged'];

  const findReq = (where) =>
    where.id
      ? reqs.find((r) => r.id === where.id)
      : reqs.find(
          (r) =>
            r.issueId === where.issueId_revision_kind.issueId &&
            r.revision === where.issueId_revision_kind.revision &&
            r.kind === where.issueId_revision_kind.kind,
        );

  const db = {
    _issues: issues,
    _reqs: reqs,
    _notifs: notifs,
    ticketRegistration: { findMany: async () => regs },
    tourAssignment: { count: async () => guides },
    tourEvent: { findUnique: async () => tour },
    operationalIssue: {
      findFirst: async ({ where }) =>
        issues.find((i) => i.dedupeKey === where.dedupeKey && ACTIVE.includes(i.status)) || null,
      findUnique: async ({ where, include }) => {
        const i = issues.find((x) => x.id === where.id);
        if (!i) return null;
        if (include?.requirements) {
          const withNotif = include.requirements.include?.notifications;
          i.requirements = reqs
            .filter((r) => r.issueId === i.id)
            .map((r) => (withNotif ? { ...r, notifications: notifs.filter((n) => n.requirementId === r.id) } : r));
        }
        return i;
      },
      create: async ({ data }) => {
        const row = { id: id('iss'), status: 'open', ...data };
        issues.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const i = issues.find((x) => x.id === where.id);
        Object.assign(i, data);
        return i;
      },
      updateMany: async ({ where, data }) => {
        let c = 0;
        for (const i of issues) {
          if (i.id !== where.id) continue;
          if (where.status?.in && !where.status.in.includes(i.status)) continue;
          Object.assign(i, data);
          c += 1;
        }
        return { count: c };
      },
    },
    issueRequirement: {
      upsert: async ({ where, create, update }) => {
        const ex = findReq(where);
        if (ex) {
          Object.assign(ex, update);
          return ex;
        }
        const row = { id: id('req'), state: 'pending', note: null, ...create };
        reqs.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        reqs.filter(
          (r) =>
            (where.issueId === undefined || r.issueId === where.issueId) &&
            (where.revision === undefined || r.revision === where.revision),
        ),
      findUnique: async ({ where, include }) => {
        const r = findReq(where);
        if (!r) return null;
        const out = { ...r };
        if (include?.issue) out.issue = issues.find((i) => i.id === r.issueId);
        if (include?.notifications) out.notifications = notifs.filter((n) => n.requirementId === r.id);
        return out;
      },
      update: async ({ where, data }) => {
        const r = findReq(where);
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }) => {
        let c = 0;
        for (const r of reqs) {
          if (r.issueId !== where.issueId || r.revision !== where.revision || r.kind !== where.kind) continue;
          if (where.state?.notIn && where.state.notIn.includes(r.state)) continue;
          Object.assign(r, data);
          c += 1;
        }
        return { count: c };
      },
    },
    issueNotification: {
      findUnique: async ({ where }) => {
        const k = where.requirementId_recipientKey_channel;
        return notifs.find((n) => n.requirementId === k.requirementId && n.recipientKey === k.recipientKey && n.channel === k.channel) || null;
      },
      upsert: async ({ where, create, update }) => {
        const k = where.requirementId_recipientKey_channel;
        const ex = notifs.find((n) => n.requirementId === k.requirementId && n.recipientKey === k.recipientKey && n.channel === k.channel);
        if (ex) {
          Object.assign(ex, update);
          return ex;
        }
        const row = { id: id('ntf'), attempts: 0, retryHistory: [], ...create };
        notifs.push(row);
        return row;
      },
    },
  };
  return db;
}

const REGS = [
  { id: 'r1', status: 'active', quantity: 2, dealId: 'd1', customerName: 'דנה', customerEmail: 'dana@x.com', customerPhone: '0501', deal: null },
  { id: 'r2', status: 'active', quantity: 1, dealId: 'd2', customerName: 'יוסי', customerEmail: 'yossi@x.com', customerPhone: '0502', deal: null },
];
const CHANGE = { tourEventId: 't1', impactType: 'tour_time_changed', before: { date: '2026-07-15', startTime: '18:00' }, after: { date: '2026-07-15', startTime: '19:00' } };
const okEmail = async () => ({ id: 'gmail-msg' });
const okWhats = async () => ({ ok: true });
const failSend = async () => { throw new Error('provider_down'); };

async function reqOf(db, issueId, kind) {
  return db._reqs.find((r) => r.issueId === issueId && r.kind === kind);
}

test('1+2. registered change → one issue with requirements; repeat reconcile no dup', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const kinds = db._reqs.filter((r) => r.issueId === issue.id).map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['calendar_sync', 'customer_notification', 'woo_sync']);
  await emitTourChangeImpact(db, CHANGE); // same revision
  assert.equal(db._issues.length, 1);
  assert.equal(db._reqs.length, 3); // no duplicate requirements
});

test('3+4. email + whatsapp sends create per-recipient notification records', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const cn = await reqOf(db, issue.id, 'customer_notification');
  for (const recipient of [
    { recipientKey: 'r1', name: 'דנה', email: 'dana@x.com', phone: '0501' },
    { recipientKey: 'r2', name: 'יוסי', email: 'yossi@x.com', phone: '0502' },
  ]) {
    await sendNotification(db, { requirement: cn, recipient, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: okEmail } });
    await sendNotification(db, { requirement: cn, recipient, channel: 'whatsapp', subject: 's', body: 'b', deps: { sendWhatsApp: okWhats } });
  }
  assert.equal(db._notifs.length, 4); // 2 recipients × 2 channels
  assert.ok(db._notifs.every((n) => n.status === 'sent' && n.sentAt));
  assert.deepEqual([...new Set(db._notifs.map((n) => n.channel))].sort(), ['email', 'whatsapp']);
});

test('5. partial success keeps the requirement in_progress and the issue OPEN', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const cn = await reqOf(db, issue.id, 'customer_notification');
  await sendNotification(db, { requirement: cn, recipient: { recipientKey: 'r1', email: 'dana@x.com' }, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: okEmail } });
  await sendNotification(db, { requirement: cn, recipient: { recipientKey: 'r2', email: 'yossi@x.com' }, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: failSend } });
  await evaluateCustomerNotification(db, cn.id);
  assert.equal(cn.state, 'in_progress');
  assert.equal((await db.operationalIssue.findUnique({ where: { id: issue.id } })).status, 'open');
});

test('6. retry updates the SAME notification row (attempts increment, status flips)', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const cn = await reqOf(db, issue.id, 'customer_notification');
  const recipient = { recipientKey: 'r2', email: 'yossi@x.com' };
  await sendNotification(db, { requirement: cn, recipient, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: failSend } });
  assert.equal(db._notifs.length, 1);
  assert.equal(db._notifs[0].status, 'failed');
  await sendNotification(db, { requirement: cn, recipient, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: okEmail } });
  assert.equal(db._notifs.length, 1); // same row
  assert.equal(db._notifs[0].status, 'sent');
  assert.equal(db._notifs[0].attempts, 2);
  assert.equal(db._notifs[0].retryHistory.length, 2);
});

test('7. manual completion requires a note', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const md = db._reqs.find((r) => r.issueId === issue.id); // any requirement
  await assert.rejects(() => setRequirementState(db, md.id, 'completed', { manual: true }), (e) => e.code === 'note_required');
  const ok = await setRequirementState(db, md.id, 'completed', { manual: true, note: 'התקשרתי ללקוחות', resolvedByName: 'רות' });
  assert.equal(ok.state, 'completed');
  assert.equal(ok.note, 'התקשרתי ללקוחות');
});

test('8. reverting the change resolves a requirement (waived + note)', async () => {
  const db = makeDb({ regs: REGS });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const cn = await reqOf(db, issue.id, 'customer_notification');
  const r = await setRequirementState(db, cn.id, 'waived', { manual: true, note: 'השינוי בוטל/הוחזר' });
  assert.equal(r.state, 'waived');
});

test('9. woo/calendar failure remains an OPEN requirement (issue stays open)', async () => {
  const db = makeDb({ regs: REGS, tour: { wooSyncStatus: 'failed', gcalSyncStatus: 'synced' } });
  const issue = await emitTourChangeImpact(db, CHANGE);
  await refreshIssueClosure(db, issue.id);
  const woo = await reqOf(db, issue.id, 'woo_sync');
  const cal = await reqOf(db, issue.id, 'calendar_sync');
  assert.equal(woo.state, 'failed'); // stays unresolved
  assert.equal(cal.state, 'completed'); // gcal synced
  assert.equal((await db.operationalIssue.findUnique({ where: { id: issue.id } })).status, 'open');
});

test('10+11. parent closes only when ALL requirements resolve; closed issue readable', async () => {
  const db = makeDb({ regs: REGS, tour: { wooSyncStatus: 'synced', gcalSyncStatus: 'synced' } });
  const issue = await emitTourChangeImpact(db, CHANGE);
  const cn = await reqOf(db, issue.id, 'customer_notification');
  // woo+calendar auto-complete from tour flags; notify both customers → complete.
  for (const recipient of [
    { recipientKey: 'r1', email: 'dana@x.com' },
    { recipientKey: 'r2', email: 'yossi@x.com' },
  ]) {
    await sendNotification(db, { requirement: cn, recipient, channel: 'email', subject: 's', body: 'b', deps: { sendEmail: okEmail } });
  }
  await evaluateCustomerNotification(db, cn.id);
  const closed = await db.operationalIssue.findUnique({ where: { id: issue.id } });
  assert.equal(closed.status, 'resolved');
  assert.equal(closed.resolution, 'requirements_complete');
  // Still readable after close.
  assert.ok(await db.operationalIssue.findUnique({ where: { id: issue.id } }));
});

test('12. a materially new change creates a NEW revision alongside the old audit', async () => {
  const db = makeDb({ regs: REGS });
  const first = await emitTourChangeImpact(db, CHANGE);
  const rev1 = first.revision;
  const second = await emitTourChangeImpact(db, { ...CHANGE, after: { date: '2026-07-15', startTime: '20:00' } });
  assert.notEqual(second.revision, rev1);
  // Old revision's requirements preserved; new revision has its own set.
  const rev1Reqs = db._reqs.filter((r) => r.revision === rev1);
  const rev2Reqs = db._reqs.filter((r) => r.revision === second.revision);
  assert.equal(rev1Reqs.length, 3);
  assert.equal(rev2Reqs.length, 3);
});
