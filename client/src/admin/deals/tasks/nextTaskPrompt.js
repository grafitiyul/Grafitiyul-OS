// ── "should we offer the next task?" ────────────────────────────────────────
//
// Completing the last open task on a LIVE deal leaves it with nothing
// scheduled, which is how a lead goes quiet. So GOS offers to schedule the
// next one — an OFFER, never a write.
//
// Every reason NOT to offer lives here, in one pure function, because each of
// them is a way to annoy or mislead an operator:
//
//   • the deal is WON/LOST      → it is finished; there is no "next"
//   • completion failed         → nothing happened, so nothing follows
//   • another open task remains → the deal is not idle
//   • we could not read the state → never guess; silence beats a wrong prompt
//   • this completion already prompted → a realtime refetch, a double-click or
//     a poll tick observing the same empty state must not re-open it
//   • the operator is already on the משימה tab → the identical form is in
//     front of them, and a second composer would fight the shared per-deal
//     draft
//
// `openTasks` must be the CANONICAL state read back after the completion —
// the server's answer, not the row the client happened to be looking at. Pass
// null when that read failed.
//
// Pure (no React, no DOM) so every rule above is unit-testable.

export function shouldPromptNextTask({
  cause,
  dealStatus,
  openTasks,
  promptedFor = null,
  activeTab = null,
} = {}) {
  if (cause?.reason !== 'completed') return false;
  if (!cause.taskId) return false;
  if (dealStatus !== 'open') return false;
  if (!Array.isArray(openTasks)) return false; // the check itself failed
  if (openTasks.length > 0) return false;
  if (promptedFor === cause.taskId) return false;
  if (activeTab === 'task') return false;
  return true;
}
