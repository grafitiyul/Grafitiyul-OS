// ── THE canonical Deal lifecycle vocabulary ─────────────────────────────────
//
// One source of truth for how a Deal's CRM status is WORDED, shared by the
// client and the server. Before this module the same three states were spelled
// four different ways across the app — a deal was "LOST" in the deals table,
// "אבוד" in the WhatsApp and email inboxes, in global search and in the
// Communication Center, and its reason was "סיבת הפסד" in the timeline. Three
// words for one status is three different things to an operator reading a
// screen.
//
// The decision: the CRM lifecycle states are named OPEN / WON / LOST — short,
// unambiguous, already what the deal badge and the pipeline show, and not
// confusable with ordinary Hebrew. "אבוד"/"הפסד" as ordinary Hebrew words
// elsewhere (a lost item, a financial loss) are untouched; this module is only
// about Deal.status.
//
// Renderers own the label. Historical audit rows keep whatever wording they
// were written with — nothing stored is ever rewritten — but a renderer that
// can resolve the label from the FIELD KEY should prefer this module, so old
// rows display today's vocabulary without their data being touched.

export const DEAL_STATUSES = ['open', 'won', 'lost'];

export const DEAL_STATUS_LABELS = Object.freeze({
  open: 'OPEN',
  won: 'WON',
  lost: 'LOST',
});

/** Human label for a Deal.status; unknown values fall through unchanged. */
export function dealStatusLabel(status) {
  return DEAL_STATUS_LABELS[status] || status || '';
}

// Deal changelog / timeline field wording that names the lifecycle. Keyed by
// the changelog fieldKey so a renderer can re-label an OLD stored row without
// mutating it.
export const DEAL_STATUS_FIELD_LABELS = Object.freeze({
  status: 'סטטוס',
  lostReasonId: 'סיבת LOST',
  lostNotes: 'הערות LOST',
});

/**
 * The label a changelog line should display. Prefers the canonical wording for
 * the fields this module owns, and otherwise keeps whatever the entry was
 * written with — so unrelated fields are never touched.
 */
export function dealChangeFieldLabel(fieldKey, storedLabel) {
  return DEAL_STATUS_FIELD_LABELS[fieldKey] || storedLabel || '';
}
