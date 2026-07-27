import test from 'node:test';
import assert from 'node:assert/strict';

// Canonical unread membership (routes/email.js): the unread VIEW, the
// unread-first sectioning of the "all" view, and the badge count must all give
// the same answer. These pin the shape of that rule and the union that keeps it
// independent of pagination — the defect where "all" showed 27 of 29 unread
// because two unread threads were older than the newest-200 page.

// Mirrors isUnreadThread / UNREAD_OR in routes/email.js.
const isUnreadThread = (t) => t.unreadCount > 0 || t.manualUnread;

test('membership: Gmail UNREAD or an explicit GOS mark — nothing else', () => {
  assert.equal(isUnreadThread({ unreadCount: 1, manualUnread: false }), true);
  assert.equal(isUnreadThread({ unreadCount: 0, manualUnread: true }), true);
  assert.equal(isUnreadThread({ unreadCount: 0, manualUnread: false }), false);
});

// The union + sectioning the route performs, extracted so it can be asserted
// without a database.
function buildPage({ pageRows, unreadRows }) {
  const seen = new Set(pageRows.map((t) => t.id));
  const page = [...pageRows, ...unreadRows.filter((t) => !seen.has(t.id))];
  const pinned = page.filter((t) => t.pinnedAt);
  const unread = page.filter((t) => !t.pinnedAt && isUnreadThread(t));
  const read = page.filter((t) => !t.pinnedAt && !isUnreadThread(t));
  return [...pinned, ...unread, ...read];
}

const th = (id, o = {}) => ({ id, unreadCount: 0, manualUnread: false, pinnedAt: null, ...o });

test('every unread thread appears even when older than the paginated window', () => {
  // Page holds the newest threads; two unread ones fell outside it.
  const pageRows = [th('new1'), th('new2', { unreadCount: 1 }), th('new3')];
  const unreadRows = [th('new2', { unreadCount: 1 }), th('old1', { unreadCount: 1 }), th('old2', { manualUnread: true })];
  const out = buildPage({ pageRows, unreadRows });
  const ids = out.map((t) => t.id);
  assert.ok(ids.includes('old1'), 'unread thread outside the page must be included');
  assert.ok(ids.includes('old2'));
  assert.equal(out.filter(isUnreadThread).length, 3);
});

test('no duplicates when an unread thread is already inside the page', () => {
  const pageRows = [th('a', { unreadCount: 2 }), th('b')];
  const unreadRows = [th('a', { unreadCount: 2 })];
  const ids = buildPage({ pageRows, unreadRows }).map((t) => t.id);
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(new Set(ids).size, ids.length);
});

test('ordering: pinned first, then every unread, then the rest', () => {
  const pageRows = [th('read1'), th('pin1', { pinnedAt: new Date(), unreadCount: 0 }), th('unread1', { unreadCount: 1 })];
  const unreadRows = [th('unread1', { unreadCount: 1 }), th('unreadOld', { unreadCount: 1 })];
  const ids = buildPage({ pageRows, unreadRows }).map((t) => t.id);
  assert.equal(ids[0], 'pin1');
  assert.deepEqual(ids.slice(1, 3).sort(), ['unread1', 'unreadOld']);
  assert.equal(ids.at(-1), 'read1');
});

test('a pinned unread thread stays in the pinned section (not duplicated below)', () => {
  const pageRows = [th('p', { pinnedAt: new Date(), unreadCount: 1 })];
  const ids = buildPage({ pageRows, unreadRows: [th('p', { pinnedAt: new Date(), unreadCount: 1 })] }).map((t) => t.id);
  assert.deepEqual(ids, ['p']);
});
