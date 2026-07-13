import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelTourAssignments } from './assignmentLifecycle.js';

// A cancelled/replaced tour must not retain operational staff. The assignment
// rows are removed (their audit lives on the timeline); idempotent no-op when
// there are none.

function fakeDb({ assignments = [] } = {}) {
  const rows = assignments.map((a) => ({ ...a }));
  const timeline = [];
  return {
    _rows: rows,
    _timeline: timeline,
    tourAssignment: {
      findMany: async ({ where }) => rows.filter((a) => a.tourEventId === where.tourEventId),
      deleteMany: async ({ where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tourEventId === where.tourEventId) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
    timelineEntry: { create: async ({ data }) => { timeline.push(data); return data; } },
  };
}

test('removes all assignments of a cancelled tour + records a timeline audit', async () => {
  const db = fakeDb({
    assignments: [
      { id: 'a1', tourEventId: 'T1', externalPersonId: 'p1', role: 'lead_guide' },
      { id: 'a2', tourEventId: 'T1', externalPersonId: 'p2', role: 'guide' },
      { id: 'a3', tourEventId: 'T2', externalPersonId: 'p3', role: 'guide' }, // other tour, untouched
    ],
  });
  const res = await cancelTourAssignments(db, 'T1', { reason: 'tour_cancelled' });
  assert.equal(res.removed, 2);
  assert.equal(db._rows.length, 1); // only T2's assignment remains
  assert.equal(db._rows[0].tourEventId, 'T2');
  // Audit recorded on the timeline (history preserved, not silently dropped).
  assert.equal(db._timeline.length, 1);
  assert.equal(db._timeline[0].data.event, 'assignments_removed');
  assert.equal(db._timeline[0].data.reason, 'tour_cancelled');
  assert.equal(db._timeline[0].data.assignments.length, 2);
});

test('no assignments → idempotent no-op (no timeline noise)', async () => {
  const db = fakeDb({ assignments: [] });
  const res = await cancelTourAssignments(db, 'T1');
  assert.equal(res.removed, 0);
  assert.equal(db._timeline.length, 0);
});
