import test from 'node:test';
import assert from 'node:assert/strict';
import './reservationStuck.js';
import { issueTypeDef } from '../registry.js';

// reservation_stuck issue type — action shape + recheck + reprocess wiring.

const def = issueTypeDef('reservation_stuck');

test('issue type registers with a primary reprocess server action + inbox link', () => {
  assert.ok(def);
  const actions = def.buildActions({ data: { sessionId: 's1', sessionNo: 1042 } });
  const reprocess = actions.find((a) => a.key === 'reprocess');
  assert.equal(reprocess.kind, 'server');
  assert.equal(reprocess.style, 'primary');
  const link = actions.find((a) => a.key === 'open_reservations');
  assert.equal(link.kind, 'link');
  assert.equal(link.target.type, 'reservation');
});

test('recheck: stays open while unprocessed, resolves on processed/cancelled/deleted', async () => {
  const client = (status) => ({
    reservationSession: { findUnique: async () => (status ? { status } : null) },
  });
  const issue = { data: { sessionId: 's1' } };
  assert.equal(await def.recheck(client('failed'), issue), true);
  assert.equal(await def.recheck(client('partially_processed'), issue), true);
  assert.equal(await def.recheck(client('processed'), issue), false);
  assert.equal(await def.recheck(client('cancelled'), issue), false);
  assert.equal(await def.recheck(client(null), issue), false);
});

test('reprocess action: resolves the issue only when fully processed', async () => {
  // The action delegates to the real processor — stub via a client whose
  // updateMany refuses the claim (busy) to exercise the 409 path.
  const busyClient = {
    reservationSession: { updateMany: async () => ({ count: 0 }) },
  };
  const r = await def.serverActions.reprocess(busyClient, { data: { sessionId: 's1' } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});
