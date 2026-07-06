// Cross-component signal: a Deal's tasks changed somewhere OTHER than the
// timeline itself (e.g. a WhatsApp message was scheduled from the floating
// WhatsApp dock, which lives outside the TimelineFeed tree). The feed listens
// and refetches so the new/updated task appears immediately — no page refresh.
export const DEAL_TASKS_CHANGED_EVENT = 'gos:deal-tasks-changed';

export function emitDealTasksChanged(dealId) {
  if (!dealId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEAL_TASKS_CHANGED_EVENT, { detail: { dealId } }));
}
