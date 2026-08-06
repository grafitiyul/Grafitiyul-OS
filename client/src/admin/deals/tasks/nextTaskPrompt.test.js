import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { shouldPromptNextTask } from './nextTaskPrompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Completing the last open task on a LIVE deal offers the next one. Every rule
// below is a way to annoy or mislead an operator if it goes wrong.

const COMPLETED = { reason: 'completed', taskId: 't1' };
const ok = (over = {}) =>
  shouldPromptNextTask({ cause: COMPLETED, dealStatus: 'open', openTasks: [], ...over });

test('the last open task on an OPEN deal offers the next one', () => {
  assert.equal(ok(), true);
});

// ── when NOT to show ────────────────────────────────────────────────────────

test('a finished deal has no "next" — WON and LOST never prompt', () => {
  assert.equal(ok({ dealStatus: 'won' }), false);
  assert.equal(ok({ dealStatus: 'lost' }), false);
  assert.equal(ok({ dealStatus: null }), false);
});

test('another open task means the deal is not idle', () => {
  assert.equal(ok({ openTasks: [{ id: 't2' }] }), false);
});

test('a task created concurrently suppresses the prompt', () => {
  // The read happens AFTER the completion, so a task another operator (or an
  // automation) added meanwhile is already in this list.
  assert.equal(ok({ openTasks: [{ id: 'created_meanwhile' }] }), false);
});

test('anything that is not a successful completion never prompts', () => {
  assert.equal(shouldPromptNextTask({ cause: null, dealStatus: 'open', openTasks: [] }), false);
  assert.equal(shouldPromptNextTask({ cause: {}, dealStatus: 'open', openTasks: [] }), false);
  assert.equal(
    shouldPromptNextTask({ cause: { reason: 'cancelled', taskId: 't1' }, dealStatus: 'open', openTasks: [] }),
    false,
  );
  // An edit, a send-now, a reopen — every other cause the strip reports.
  assert.equal(
    shouldPromptNextTask({ cause: { reason: 'updated', taskId: 't1' }, dealStatus: 'open', openTasks: [] }),
    false,
  );
});

test('a completion with no task id cannot be de-duplicated, so it never prompts', () => {
  assert.equal(shouldPromptNextTask({ cause: { reason: 'completed' }, dealStatus: 'open', openTasks: [] }), false);
});

test('a FAILED task-state read never guesses — silence beats a wrong prompt', () => {
  // loadTasks returns null when the request failed. "No open tasks" and "we
  // could not find out" must not look the same (the Slice 0 lesson).
  assert.equal(ok({ openTasks: null }), false);
  assert.equal(ok({ openTasks: undefined }), false);
});

test('one completion prompts at most once — realtime refetch, double-click, poll', () => {
  assert.equal(ok({ promptedFor: 't1' }), false);
  // …but a genuinely different completion later still prompts.
  assert.equal(ok({ promptedFor: 't0' }), true);
});

test('already on the משימה tab: the same form is already in front of them', () => {
  // Two TaskComposers would also fight over the shared per-deal draft.
  assert.equal(ok({ activeTab: 'task' }), false);
  for (const tab of ['note', 'whatsapp', 'email', 'file', null]) {
    assert.equal(ok({ activeTab: tab }), true, `tab ${tab} still prompts`);
  }
});

// ── the regression this slice exists to kill ────────────────────────────────

test('completing a task NEVER switches the composer tab', async () => {
  // The original implementation called setTab('task'), which unmounted the
  // active tab and destroyed any draft in it. The offer must be a dialog.
  const src = await readFile(path.join(here, '..', '..', 'common', 'timeline', 'TimelineFeed.jsx'), 'utf8');
  const start = src.indexOf('const onTaskChanged');
  const end = src.indexOf('[loadTasks, refresh, dealStatus]', start);
  assert.ok(start > 0 && end > start, 'the completion handler is where expected');
  const handler = src.slice(start, end);
  assert.ok(!handler.includes('setTab('), 'the completion handler must never change tabs');
  assert.ok(handler.includes('setNextTaskOpen(true)'), 'it opens the dialog instead');
});

test('the dialog renders OUTSIDE the composer body, so the active tab keeps rendering', async () => {
  const src = await readFile(path.join(here, '..', '..', 'common', 'timeline', 'TimelineFeed.jsx'), 'utf8');
  const composerEnd = src.indexOf('{/* Template picker');
  const dialog = src.indexOf('<NextTaskDialog');
  assert.ok(composerEnd > 0 && dialog > composerEnd, 'mounted beside the other modal, not inside the tab body');
});

test('the dialog wraps the CANONICAL TaskComposer — no second task form', async () => {
  const src = await readFile(path.join(here, 'NextTaskDialog.jsx'), 'utf8');
  assert.ok(src.includes("import TaskComposer from './TaskComposer.jsx'"), 'the real composer');
  assert.ok(src.includes('<TaskComposer'), 'rendered as-is');
  // No re-implemented fields: the dialog must not grow its own inputs.
  assert.ok(!/<input\b/.test(src), 'no hand-rolled fields');
  assert.ok(!/<select\b/.test(src), 'no hand-rolled selects');
  assert.ok(!src.includes('api.dealTasks'), 'no second create path');
});
