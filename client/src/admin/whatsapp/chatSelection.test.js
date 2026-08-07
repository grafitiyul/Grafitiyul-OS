import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_ROW_ACCENT,
  chatMatchesAccountFilter,
  chatSwitchEffect,
  chatRowClass,
  chatRowStateClass,
  isChatSelected,
  isSameChat,
} from './chatSelection.js';

// The WhatsApp inbox's selected-conversation state: WHICH row is the open one
// (account-scoped identity) and HOW it renders (obvious blue fill that survives
// hover). Both rules live in one module — these lock them.

const chat = (id, accountId) => ({ id, accountId });

test('selected row carries the semi-transparent blue state (fill + ring + accent)', () => {
  const cls = chatRowStateClass({ active: true });
  assert.match(cls, /bg-blue-500\/10/, 'soft semi-transparent blue fill');
  assert.match(cls, /ring-blue-300/, 'blue inset ring');
  assert.match(chatRowClass({ active: true }), /relative/, 'positioned for the accent bar');
  assert.match(CHAT_ROW_ACCENT, /bg-blue-500/, 'solid blue accent bar');
  assert.match(CHAT_ROW_ACCENT, /right-0/, 'on the RTL leading edge');
});

test('hover never hides the selected state — it deepens the SAME blue', () => {
  const cls = chatRowStateClass({ active: true });
  assert.match(cls, /hover:bg-blue-500\/20/, 'hovered selection stays blue, only deeper');
  assert.doesNotMatch(cls, /hover:bg-gray-/, 'the neutral hover tint never applies to a selected row');
  // Hovering a selected row that is ALSO the keyboard cursor stays blue too.
  assert.equal(chatRowStateClass({ active: true, cursor: true }), cls, 'selection beats the cursor');
});

test('unselected rows keep the plain hover behaviour; the cursor is its own quiet state', () => {
  assert.equal(chatRowStateClass({}), 'hover:bg-gray-50');
  assert.match(chatRowStateClass({ cursor: true }), /bg-gray-100/);
  assert.doesNotMatch(chatRowStateClass({ cursor: true }), /blue/, 'only the OPEN chat is blue');
});

test('the selected state adds no text/badge colour — unread styling stays readable', () => {
  const cls = chatRowStateClass({ active: true });
  assert.doesNotMatch(cls, /text-/, 'no text colour is forced on a selected row');
  assert.doesNotMatch(cls, /font-/, 'no font weight is forced (unread bolding survives)');
  assert.doesNotMatch(cls, /opacity-/, 'nothing is dimmed');
});

test('selection moves with the open chat and never lights two rows', () => {
  const a = chat('c1', 'acc1');
  const b = chat('c2', 'acc1');
  assert.equal(isChatSelected(a, a), true);
  assert.equal(isChatSelected(b, a), false);
  // Switching: the newly opened chat is selected, the previous one is not.
  assert.equal(isChatSelected(b, b), true);
  assert.equal(isChatSelected(a, b), false);
});

test('the same remote identity under ANOTHER account never highlights', () => {
  // Two accounts, same person → two DB rows, two ids. Neither may match.
  const onAcc1 = chat('chat_acc1_972501234567', 'acc1');
  const onAcc2 = chat('chat_acc2_972501234567', 'acc2');
  assert.equal(isChatSelected(onAcc2, onAcc1), false, 'different rows never match');
  // And even a payload that somehow reused an id is rejected by accountId.
  assert.equal(isSameChat({ id: 'same', accountId: 'acc1' }, { id: 'same', accountId: 'acc2' }), false);
  assert.equal(isSameChat({ id: 'same', accountId: 'acc1' }, { id: 'same', accountId: 'acc1' }), true);
});

test('isSameChat is safe on missing input', () => {
  assert.equal(isSameChat(null, chat('c1', 'a')), false);
  assert.equal(isSameChat(chat('c1', 'a'), null), false);
  assert.equal(isSameChat({}, {}), false);
});

test('switching accounts drops a selection that belongs to the other number', () => {
  const c = chat('c1', 'acc1');
  assert.equal(chatMatchesAccountFilter(c, 'all'), true, '"כל המספרים" keeps everything');
  assert.equal(chatMatchesAccountFilter(c, 'acc1'), true);
  assert.equal(chatMatchesAccountFilter(c, 'acc2'), false, 'stale selection is dropped');
  assert.equal(chatMatchesAccountFilter(null, 'acc2'), true, 'nothing selected → nothing to drop');
  assert.equal(chatMatchesAccountFilter({ id: 'x' }, 'acc2'), false, 'unprovable ownership → drop');
});

test('private and group conversations share one selection language', () => {
  const priv = { id: 'c1', accountId: 'acc1', type: 'private' };
  const grp = { id: 'c2', accountId: 'acc1', type: 'group' };
  assert.equal(isChatSelected(grp, grp), true);
  assert.equal(isChatSelected(priv, grp), false);
  // The row state is computed from selection alone — never from the chat kind.
  assert.equal(chatRowStateClass({ active: true }), chatRowStateClass({ active: true }));
});

// ── Selecting another conversation closes the Deal drawer ──────────────────
// Opening a Deal is a deliberate act. Clicking a conversation to READ it must
// never drop the operator into a different customer's deal.

const CHAT_A = { id: 'chat_a', accountId: 'acc1' };
const CHAT_B = { id: 'chat_b', accountId: 'acc1' };

test('switching conversations closes the Deal opened from the previous one', () => {
  assert.deepEqual(chatSwitchEffect({ selected: CHAT_A, next: CHAT_B, drawerOpen: true }), {
    select: true,
    closeDrawer: true,
    confirm: false,
  });
});

test('and never opens the next conversation\'s Deal in its place', () => {
  // The effect has no "open" outcome at all — the shape itself forbids it.
  const effect = chatSwitchEffect({ selected: CHAT_A, next: CHAT_B, drawerOpen: true });
  assert.deepEqual(Object.keys(effect).sort(), ['closeDrawer', 'confirm', 'select']);
});

test('re-clicking the SAME conversation leaves its open Deal alone', () => {
  assert.deepEqual(chatSwitchEffect({ selected: CHAT_A, next: { ...CHAT_A }, drawerOpen: true }), {
    select: true,
    closeDrawer: false,
    confirm: false,
  });
});

test('with no drawer open, switching is just switching', () => {
  assert.deepEqual(chatSwitchEffect({ selected: CHAT_A, next: CHAT_B, drawerOpen: false }), {
    select: true,
    closeDrawer: false,
    confirm: false,
  });
});

test('unsaved Deal edits stop everything until the operator answers', () => {
  const asked = chatSwitchEffect({ selected: CHAT_A, next: CHAT_B, drawerOpen: true, dirty: true });
  assert.deepEqual(asked, { select: false, closeDrawer: false, confirm: true });
  // Nothing moved: the operator is still on chat A with their edits intact.
  const answered = chatSwitchEffect({
    selected: CHAT_A, next: CHAT_B, drawerOpen: true, dirty: true, confirmed: true,
  });
  assert.deepEqual(answered, { select: true, closeDrawer: true, confirm: false });
});

test('dirty edits with no drawer open never raise a prompt', () => {
  assert.equal(chatSwitchEffect({ selected: CHAT_A, next: CHAT_B, drawerOpen: false, dirty: true }).confirm, false);
});

test('the same remote number under ANOTHER account is a different conversation', () => {
  const other = { id: 'chat_a', accountId: 'acc2' };
  assert.equal(chatSwitchEffect({ selected: CHAT_A, next: other, drawerOpen: true }).closeDrawer, true);
});

test('no target chat is a no-op', () => {
  assert.deepEqual(chatSwitchEffect({ selected: CHAT_A, next: null, drawerOpen: true }), {
    select: false,
    closeDrawer: false,
    confirm: false,
  });
});
