// Client-side runner for 'api'-kind issue actions — actions that reuse an
// EXISTING endpoint instead of a new /api/control mutation (reuse, never
// duplicate). Keyed by `${issueType}:${actionKey}`; each handler receives the
// full issue and performs the existing API call. After a handler resolves,
// the dashboard calls api.control.recheck(issue.id) so the card reflects
// reality immediately.
//
// Handlers may return { needsInput: 'reschedule' } instead of acting — the
// card then opens the matching input dialog and re-invokes with the payload.

const HANDLERS = new Map();

export function registerApiAction(issueType, actionKey, handler) {
  HANDLERS.set(`${issueType}:${actionKey}`, handler);
}

export function apiActionHandler(issueType, actionKey) {
  return HANDLERS.get(`${issueType}:${actionKey}`) || null;
}

// ── WhatsApp: skipped / failed scheduled messages ───────────────────────────
// Reuse the EXISTING scheduled-message endpoints; never re-implement them here.

// "קבע מועד חדש" — first invocation asks for a date+time (needsInput), the
// second (with the picked payload) reschedules the existing message.
registerApiAction('whatsapp_scheduled_stuck', 'reschedule', async (issue, payload) => {
  if (!payload) return { needsInput: 'reschedule' };
  const { api } = await import('../../lib/api.js');
  const scheduledAt = new Date(`${payload.date}T${payload.time}:00`).toISOString();
  await api.whatsapp.updateScheduled(issue.data.messageId, { scheduledAt });
});

// "בטל לצמיתות" — cancel the scheduled message (moves any linked task too).
registerApiAction('whatsapp_scheduled_stuck', 'cancel', async (issue) => {
  const { api } = await import('../../lib/api.js');
  await api.whatsapp.cancelScheduled(issue.data.messageId);
});
