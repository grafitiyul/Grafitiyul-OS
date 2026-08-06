// Deal-scoped task-composer draft — the "one shared unsaved workspace",
// persisted EXACTLY like note drafts: localStorage via the shared
// lib/localDrafts.js engine, keyed per deal. The draft therefore survives tab
// switches, navigating to another deal and back, page refresh, and closing/
// reopening the browser. It is cleared ONLY by a successful save or by the
// operator's explicit "בטל טיוטה" — never by a mere unmount.
//
// A draft with no meaningful content (no text, untouched date, default
// priority) is not stored — type/owner selections alone are defaults, not
// unsaved work.
import { readDraftMap, writeDraftEntry } from '../../../lib/localDrafts.js';

const TASK_DRAFTS_KEY = 'gos-task-drafts';

export function taskDraftIsEmpty(draft) {
  return !draft || (!(draft.text || '').trim() && !draft.dueTouched && (draft.priority || 'none') === 'none');
}

export function readTaskDraft(dealId) {
  return readDraftMap(TASK_DRAFTS_KEY)[dealId] || null;
}

export function writeTaskDraft(dealId, draft) {
  if (!dealId) return;
  writeDraftEntry(TASK_DRAFTS_KEY, dealId, taskDraftIsEmpty(draft) ? null : draft);
}

export function clearTaskDraft(dealId) {
  writeDraftEntry(TASK_DRAFTS_KEY, dealId, null);
}
