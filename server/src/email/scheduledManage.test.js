import test from 'node:test';
import assert from 'node:assert/strict';

// Management-flow rules for scheduled emails (routes/email.js). These pin the
// contracts the UI depends on: what each scope shows, and the guards that stop
// an item being edited/cancelled after the worker has taken it.

// Mirrors the route's scope → status mapping.
function statusesForScope(scope) {
  return scope === 'history'
    ? ['pending', 'failed', 'cancelled', 'sent']
    : ['pending', 'failed'];
}

test('the open queue is actionable items only — sent leaves it, cancelled too', () => {
  const open = statusesForScope('open');
  assert.deepEqual(open, ['pending', 'failed']);
  assert.ok(!open.includes('sent'), 'a sent email lives on in normal email history, not the queue');
  assert.ok(!open.includes('cancelled'));
});

test('history keeps cancelled AND sent visible for audit', () => {
  const history = statusesForScope('history');
  for (const s of ['pending', 'failed', 'cancelled', 'sent']) {
    assert.ok(history.includes(s), `history must retain ${s}`);
  }
});

// Mirrors the guarded writes: every mutation is conditioned on status:'pending'.
const isMutable = (status) => status === 'pending';

test('only a pending item may be edited, rescheduled or cancelled', () => {
  assert.equal(isMutable('pending'), true);
  for (const s of ['sending', 'sent', 'cancelled', 'failed']) {
    assert.equal(isMutable(s), false, `${s} must not be mutable`);
  }
});

// The edit route keeps the SAME row (updateMany on the id) rather than
// delete+recreate, so identity and audit fields survive.
function applyEdit(row, patch) {
  if (!isMutable(row.status)) return { changed: 0, row };
  return {
    changed: 1,
    row: {
      ...row,
      ...patch,
      // A fresh intent gets a fresh retry ladder.
      attemptCount: 0,
      nextRetryAt: null,
      failureReason: null,
    },
  };
}

test('editing preserves the record identity and its audit trail', () => {
  const original = {
    id: 'se1',
    status: 'pending',
    createdById: 'user-1',
    createdAt: '2026-07-27T10:00:00Z',
    dealId: 'deal-9',
    subject: 'ישן',
    attemptCount: 3,
    failureReason: 'previous failure',
  };
  const { changed, row } = applyEdit(original, { subject: 'חדש' });
  assert.equal(changed, 1);
  assert.equal(row.id, 'se1', 'same record — never delete + recreate');
  assert.equal(row.createdById, 'user-1');
  assert.equal(row.createdAt, '2026-07-27T10:00:00Z');
  assert.equal(row.dealId, 'deal-9');
  assert.equal(row.subject, 'חדש');
  // Retry state resets so an edited item is not punished by an old failure.
  assert.equal(row.attemptCount, 0);
  assert.equal(row.failureReason, null);
});

test('editing an item the worker already took is refused, not silently applied', () => {
  for (const status of ['sent', 'cancelled']) {
    const { changed, row } = applyEdit({ id: 'se2', status, subject: 'ישן' }, { subject: 'חדש' });
    assert.equal(changed, 0);
    assert.equal(row.subject, 'ישן', 'the stored composition must be untouched');
  }
});

// Attachment bytes must never reach the client; only names/sizes do.
function toAttachmentDto(attachments) {
  return (attachments || []).map((a) => ({
    filename: a?.filename || null,
    mimeType: a?.mimeType || null,
    sizeBytes: a?.contentBase64 ? Math.floor(String(a.contentBase64).length * 0.75) : null,
  }));
}

test('attachment bytes never leave the server; names and sizes do', () => {
  const dto = toAttachmentDto([{ filename: 'q.pdf', mimeType: 'application/pdf', contentBase64: 'AAAAAAAA' }]);
  assert.equal(dto[0].filename, 'q.pdf');
  assert.equal(dto[0].sizeBytes, 6);
  assert.ok(!('contentBase64' in dto[0]), 'bytes must not be serialized to the client');
});
