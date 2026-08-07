// Confirmation-Email preview: what the primary button does, and in what order.
//
// Extracted as a pure module so the ORDER is provable in tests: a deal that is
// not yet WON must transition FIRST and send only on success — never
// send-then-transition, and never "send anyway" (there is no such business
// flow; a confirmation email is a WON workflow).

export const PRIMARY_ACTIONS = {
  send: { kind: 'send', labelHe: 'שלח מייל אישור', labelEn: 'Send confirmation email' },
  wonAndSend: {
    kind: 'won_and_send',
    labelHe: 'הפוך ל־WON ושלח מייל אישור',
    labelEn: 'Mark as WON and send confirmation email',
  },
};

/** The preview's primary action for a deal in this status. */
export function primaryAction(dealStatus) {
  return dealStatus === 'won' ? PRIMARY_ACTIONS.send : PRIMARY_ACTIONS.wonAndSend;
}

/**
 * Run the primary action. Callbacks are injected so the sequence is testable
 * without a network or a DOM:
 *   transition() → { ok } | { ok:false, error }   (canonical deal WON update)
 *   send()       → { ok } | { ok:false, error }   (the ONE send pipeline)
 *
 * Guarantees pinned by tests:
 *   • already WON      → transition is never called
 *   • not WON          → transition runs exactly once, BEFORE send
 *   • transition fails → send is NEVER called (no snapshot, no queue row, no
 *                        timeline entry, no partial state); the caller stays
 *                        in the preview with every edit intact
 */
export async function runPrimaryAction({ dealStatus, transition, send }) {
  const needsWon = dealStatus !== 'won';
  if (needsWon) {
    const t = await transition();
    if (!t?.ok) return { transitioned: false, sent: false, error: t?.error || 'won_transition_failed' };
  }
  const s = await send();
  return {
    transitioned: needsWon,
    sent: !!s?.ok,
    error: s?.ok ? null : s?.error || null,
    // The send response travels back so the caller's toast can state the
    // CANONICAL delivery state instead of assuming success.
    result: s?.result || null,
  };
}
