import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSingletonKey } from './structure.js';

// Per-actor singletons (tour_summary): the guide's externalPersonId joins the
// key, so every required guide holds their own active submission while the
// per-subject uniqueness still holds for classic singleton purposes.

test('classic singleton key: subject + purpose only', () => {
  assert.equal(
    buildSingletonKey({ subjectType: 'booking', subjectId: 'b1', purpose: 'coordination' }),
    'booking:b1:coordination',
  );
});

test('perActor singleton key: guide scope joins the key', () => {
  assert.equal(
    buildSingletonKey({
      subjectType: 'tour_event', subjectId: 't1', purpose: 'tour_summary', actorScope: 'xp9',
    }),
    'tour_event:t1:tour_summary:xp9',
  );
  // Two guides on the same tour never collide.
  assert.notEqual(
    buildSingletonKey({ subjectType: 'tour_event', subjectId: 't1', purpose: 'tour_summary', actorScope: 'a' }),
    buildSingletonKey({ subjectType: 'tour_event', subjectId: 't1', purpose: 'tour_summary', actorScope: 'b' }),
  );
});

test('unbound submissions never get a key, scoped or not', () => {
  assert.equal(buildSingletonKey({ subjectType: null, subjectId: null, purpose: 'general' }), null);
  assert.equal(
    buildSingletonKey({ subjectType: 'tour_event', subjectId: '', purpose: 'tour_summary', actorScope: 'x' }),
    null,
  );
});
