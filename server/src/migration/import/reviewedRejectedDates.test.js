import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRejectedDates, REVIEWED_REJECTED_DATES, NEEDS_MANUAL_DECISION, REVIEWED_ON,
} from './reviewedRejectedDates.js';

const ERR = 'source_error:#ERROR!';
const reviewedIds = Object.keys(REVIEWED_REJECTED_DATES);
const rej = (recId, over = {}) => ({ recId, tourId: 1, status: 'עתידי', reason: ERR, ...over });

test('the reviewed list holds exactly the 45 audited records', () => {
  assert.equal(reviewedIds.length, 45);
  for (const [recId, v] of Object.entries(REVIEWED_REJECTED_DATES)) {
    assert.match(recId, /^rec[A-Za-z0-9]{14}$/, `${recId} is not an Airtable record id`);
    assert.ok(['historical', 'cancelled', 'empty_shell', 'unknown'].includes(v.verdict), `${recId} verdict ${v.verdict}`);
    assert.equal(typeof v.coordAtReview, 'number');
    assert.equal(v.reason, ERR);
  }
  assert.equal(REVIEWED_ON, '2026-07-30');
});

test('exactly one record was deferred for a manual decision, and it is in the list', () => {
  assert.equal(NEEDS_MANUAL_DECISION.length, 1);
  for (const id of NEEDS_MANUAL_DECISION) assert.ok(REVIEWED_REJECTED_DATES[id], `${id} missing from the reviewed list`);
});

test('reviewed records are acknowledged, not blocking', () => {
  const rejectedDates = reviewedIds.map((id) => rej(id));
  // Reproduce each record's coordination count so nothing looks changed.
  const coordRows = [];
  for (const [id, v] of Object.entries(REVIEWED_REJECTED_DATES)) {
    for (let i = 0; i < v.coordAtReview; i += 1) coordRows.push({ masterRecId: id });
  }
  const { acknowledged, unreviewed, changed } = classifyRejectedDates({ rejectedDates, coordRows });
  assert.equal(acknowledged.length, 45);
  assert.equal(unreviewed.length, 0);
  assert.equal(changed.length, 0);
});

test('a NEW broken record still blocks — the gate stays strict', () => {
  const { acknowledged, unreviewed } = classifyRejectedDates({
    rejectedDates: [rej(reviewedIds[0]), rej('recBRANDNEW00001')],
    coordRows: [],
  });
  assert.equal(unreviewed.length, 1);
  assert.equal(unreviewed[0].recId, 'recBRANDNEW00001');
  assert.equal(unreviewed[0].why, 'not_in_reviewed_list');
  assert.equal(acknowledged.length, 1);
});

test('a reviewed record failing for a DIFFERENT reason is a different finding', () => {
  const { acknowledged, changed } = classifyRejectedDates({
    rejectedDates: [rej(reviewedIds[0], { reason: 'not_iso:31/12/2026' })],
    coordRows: [],
  });
  assert.equal(acknowledged.length, 0);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].why, 'reason_changed');
  assert.equal(changed[0].reviewedReason, ERR);
});

test('a reviewed empty record that GAINED a coordination row blocks again', () => {
  // The approval was for a record with nothing in it. Once it carries operational
  // content the approval no longer describes it.
  const emptyId = Object.entries(REVIEWED_REJECTED_DATES).find(([, v]) => v.coordAtReview === 0)[0];
  const { acknowledged, changed } = classifyRejectedDates({
    rejectedDates: [rej(emptyId)],
    coordRows: [{ masterRecId: emptyId }],
  });
  assert.equal(acknowledged.length, 0);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].why, 'coordination_rows_changed');
  assert.equal(changed[0].reviewedCount, 0);
  assert.equal(changed[0].currentCount, 1);
});

test('the flagged record LOSING its coordination row also blocks again', () => {
  const flagged = NEEDS_MANUAL_DECISION[0];
  assert.equal(REVIEWED_REJECTED_DATES[flagged].coordAtReview, 1);
  const { changed } = classifyRejectedDates({ rejectedDates: [rej(flagged)], coordRows: [] });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].why, 'coordination_rows_changed');
});

test('no rejections at all is the clean case', () => {
  const r = classifyRejectedDates({ rejectedDates: [], coordRows: [] });
  assert.deepEqual(r, { acknowledged: [], unreviewed: [], changed: [] });
});

test('a record id that collides with an Object prototype key is not treated as reviewed', () => {
  // Guards the lookup: a plain `REVIEWED[recId]` would find Object.prototype
  // members and wave through a record that was never reviewed.
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const { acknowledged, unreviewed } = classifyRejectedDates({ rejectedDates: [rej(id)], coordRows: [] });
    assert.equal(acknowledged.length, 0, `${id} must not be acknowledged`);
    assert.equal(unreviewed.length, 1);
  }
});

test('coordination rows for OTHER masters do not disturb the counts', () => {
  const emptyId = Object.entries(REVIEWED_REJECTED_DATES).find(([, v]) => v.coordAtReview === 0)[0];
  const { acknowledged, changed } = classifyRejectedDates({
    rejectedDates: [rej(emptyId)],
    coordRows: [{ masterRecId: 'recSOMEOTHERTOUR' }, { masterRecId: null }, {}],
  });
  assert.equal(acknowledged.length, 1);
  assert.equal(changed.length, 0);
});
