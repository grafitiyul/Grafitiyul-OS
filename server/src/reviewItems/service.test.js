import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewItem, handleReviewItem, loadInbox } from './service.js';
import { buildSummaryDetails, summaryHeadline } from './kinds/tourSummary.js';
import { buildLogisticsFindings, logisticsHeadline } from './kinds/logisticsReport.js';
import './kinds/index.js';

// Management Tasks rests on two promises: exactly-once creation, and cards that
// are handled independently. Both are proved here rather than assumed.

function stubDb() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    reviewItem: {
      create: async ({ data }) => {
        for (const r of rows.values()) {
          if (r.dedupeKey === data.dedupeKey) {
            const e = new Error('Unique constraint failed');
            e.code = 'P2002';
            throw e;
          }
        }
        const row = { id: `ri${++seq}`, status: 'open', createdAt: new Date(2026, 8, 16, 10, seq), ...data };
        rows.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }) => [...rows.values()].find((r) => r.dedupeKey === where.dedupeKey) || null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of rows.values()) {
          if (r.id !== where.id) continue;
          if (where.status && r.status !== where.status) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      },
      findMany: async ({ where }) => [...rows.values()].filter((r) => r.status === where.status),
    },
  };
}

const card = (over = {}) => ({
  kind: 'tour_summary',
  dedupeKey: 'tour_summary:sub1',
  title: 'סיכום סיור',
  tourEventId: 'tour1',
  ...over,
});

// ── exactly once ─────────────────────────────────────────────────────────────

test('the same business event never creates two cards', async () => {
  const db = stubDb();
  const first = await createReviewItem(card(), { db });
  const second = await createReviewItem(card(), { db });

  assert.equal(first.created, true);
  assert.equal(second.created, false, 'a replay must return the existing card');
  assert.equal(second.item.id, first.item.id);
  assert.equal(db.rows.size, 1);
});

test('a card without a dedupeKey is refused', async () => {
  // The dedupeKey IS the exactly-once guarantee — creating without one would
  // silently allow duplicates.
  await assert.rejects(() => createReviewItem(card({ dedupeKey: null }), { db: stubDb() }), /dedupeKey/);
});

test('an unregistered kind is refused', async () => {
  await assert.rejects(() => createReviewItem(card({ kind: 'made_up' }), { db: stubDb() }), /unknown review kind/);
});

// ── independence ─────────────────────────────────────────────────────────────

test('handling the summary card does NOT handle its logistics card', async () => {
  // The headline requirement: two cards on one tour, handled separately.
  const db = stubDb();
  const { item: summary } = await createReviewItem(card(), { db });
  const { item: logistics } = await createReviewItem(
    card({ kind: 'logistics_report', dedupeKey: 'logistics_report:sub1', title: 'דו״ח לוגיסטי' }),
    { db },
  );

  await handleReviewItem(summary.id, { userId: 'u1', userName: 'דור' }, { db });

  assert.equal(db.rows.get(summary.id).status, 'handled');
  assert.equal(db.rows.get(logistics.id).status, 'open', 'the sibling card must be untouched');
});

test('handling a card twice is a no-op, not a rewritten timestamp', async () => {
  const db = stubDb();
  const { item } = await createReviewItem(card(), { db });
  const first = await handleReviewItem(item.id, { userName: 'דור' }, { db });
  const second = await handleReviewItem(item.id, { userName: 'מישהו אחר' }, { db });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(db.rows.get(item.id).handledByName, 'דור', 'the original handler stands');
});

test('the inbox groups cards by tour while keeping them separate rows', async () => {
  const db = stubDb();
  await createReviewItem(card(), { db });
  await createReviewItem(card({ kind: 'logistics_report', dedupeKey: 'logistics_report:sub1' }), { db });
  await createReviewItem(card({ dedupeKey: 'tour_summary:sub2', tourEventId: 'tour2' }), { db });

  const inbox = await loadInbox({ db });
  assert.equal(inbox.groups.length, 2, 'one group per tour');
  const tour1 = inbox.groups.find((g) => g.tourEventId === 'tour1');
  assert.equal(tour1.cards.length, 2, 'both cards travel together but stay separate rows');
  assert.deepEqual(inbox.counts, { tour_summary: 2, logistics_report: 1 });
});

test('a card with no tour still appears, in its own group', async () => {
  const db = stubDb();
  await createReviewItem(card({ tourEventId: null }), { db });
  const inbox = await loadInbox({ db });
  assert.equal(inbox.groups.length, 1, 'nothing is hidden for lacking a tour');
});

// ── the summary card's content ───────────────────────────────────────────────

const q = (key, role, extra = {}) => ({ key, config: { summaryRole: role, ...extra } });

test('summary details are addressed by ROLE, never by a hardcoded key', () => {
  // A definition that hardcoded q_ keys would break the moment a form was
  // rebuilt; roles survive rewording, reordering and new versions.
  const details = buildSummaryDetails({
    questions: [q('q_aaaaaaaa', 'overall'), q('q_bbbbbbbb', 'positive'), q('q_cccccccc', 'challenge')],
    answers: { q_aaaaaaaa: 'מעולה', q_bbbbbbbb: 'הקבוצה הייתה מעורבת', q_cccccccc: '' },
  });
  assert.deepEqual(details.map((d) => d.role), ['overall', 'positive']);
  assert.equal(details[0].labelHe, 'איך היה הסיור בכללי?');
  assert.equal(summaryHeadline(details), 'מעולה');
});

test('an unmapped role is simply absent — the card still renders', () => {
  const details = buildSummaryDetails({
    questions: [q('q_aaaaaaaa', 'overall')],
    answers: { q_aaaaaaaa: 'טוב' },
  });
  assert.equal(details.length, 1);
  assert.equal(summaryHeadline(details), 'טוב');
});

// ── the logistics card's condition ───────────────────────────────────────────

const lq = (key, role) => ({ key, config: { logisticsRole: role } });

test('no logistics problem means NO logistics card', () => {
  const findings = buildLogisticsFindings({
    questions: [lq('q_1', 'studio_dirty'), lq('q_2', 'equipment_shortage')],
    answers: { q_1: false, q_2: '' },
  });
  assert.deepEqual(findings, []);
});

test('an affirmative answer flags its slot, by OPTION KEY not by text', () => {
  const findings = buildLogisticsFindings({
    questions: [lq('q_1', 'studio_dirty')],
    answers: { q_1: 'o_11111111' },
    affirmativeOptionValues: new Set(['o_11111111']),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].role, 'studio_dirty');
  assert.equal(findings[0].labelHe, 'הסטודיו הושאר מלוכלך');
});

test('an option key NOT marked affirmative does not flag', () => {
  const findings = buildLogisticsFindings({
    questions: [lq('q_1', 'studio_dirty')],
    answers: { q_1: 'o_22222222' },
    affirmativeOptionValues: new Set(['o_11111111']),
  });
  assert.deepEqual(findings, []);
});

test('yes/no question shapes are all understood', () => {
  for (const yes of [true, 'true', 'yes', 'כן', 1]) {
    const findings = buildLogisticsFindings({ questions: [lq('q_1', 'vinyl_low')], answers: { q_1: yes } });
    assert.equal(findings.length, 1, `${yes} should flag`);
  }
  for (const no of [false, 'false', 'no', 'לא', 0, '', null]) {
    const findings = buildLogisticsFindings({ questions: [lq('q_1', 'vinyl_low')], answers: { q_1: no } });
    assert.equal(findings.length, 0, `${no} should not flag`);
  }
});

test('free-text slots flag on ANY substantive answer', () => {
  // "There is text" IS the signal for equipment and technical issues.
  const findings = buildLogisticsFindings({
    questions: [lq('q_1', 'equipment_shortage'), lq('q_2', 'technical_issue')],
    answers: { q_1: 'נגמרו מסכות', q_2: '   ' },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].role, 'equipment_shortage');
  assert.equal(findings[0].value, 'נגמרו מסכות');
});

test('several findings produce one readable headline', () => {
  const findings = buildLogisticsFindings({
    questions: [lq('q_1', 'studio_dirty'), lq('q_2', 'vinyl_low')],
    answers: { q_1: true, q_2: true },
  });
  assert.equal(logisticsHeadline(findings), 'הסטודיו הושאר מלוכלך · מלאי ויניל נמוך');
});
