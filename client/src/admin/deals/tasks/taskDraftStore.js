// Deal-scoped task-composer draft — the "one shared unsaved workspace".
//
// The composer tabs render conditionally (TimelineFeed), so leaving the משימה
// tab UNMOUNTS TaskComposer and its useState dies with it. The draft therefore
// lives HERE, keyed by dealId, and survives any tab switching inside the Deal
// page. Deliberately in-memory (NOT localStorage, unlike note drafts): the
// contract is that the draft dies with the Deal page — DealDetail clears it on
// unmount / deal switch, and a successful save clears it too.
const drafts = new Map();

export function readTaskDraft(dealId) {
  return drafts.get(dealId) || null;
}

export function writeTaskDraft(dealId, draft) {
  if (dealId) drafts.set(dealId, draft);
}

export function clearTaskDraft(dealId) {
  drafts.delete(dealId);
}
