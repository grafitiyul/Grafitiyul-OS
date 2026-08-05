// THE canonical "who closed this deal" contract.
//
// Deal.wonActor is frozen by transitionDealToWon in the same atomic write as
// status/wonAt — an immutable historical identity, never re-derived later.
// This module owns both sides of that contract:
//   * buildWonActor  — the frozen shape written at the transition;
//   * wonActorLabel  — the ONE display resolver every surface (Manager
//     Reports, future timelines/screens) uses to show the closer.
//
// Attribution rules (deliberate, in priority order):
//   1. a real authenticated user → their identity FROZEN AT THE TRANSITION
//      (displayName, username fallback — the adminDisplayName contract);
//   2. an automatic close → an explicit system attribution naming the real
//      source (WooCommerce / Cardcom / iCount / generic card payment) — never
//      a fabricated human, never a global ADMIN;
//   3. no record at all (legacy WON deals) → an explicit "unknown", never a
//      blank or a dash, and never the deal's CURRENT assignee (ownership can
//      change after the close; the closer cannot).

import { adminDisplayName } from '../admin/displayName.js';

/**
 * The frozen wonActor value for ONE genuine transition.
 *   user  — the authenticated closer's row (ADMIN_NAME_SELECT shape), or null
 *           for an automatic close.
 *   cause — the canonical transition cause ('manual', 'card_payment',
 *           'icount_payment', 'cardcom_payment', 'woo_order', 'no_payment',
 *           'manual_payment', 'external_payment', …).
 *   at    — the transition's wonAt.
 */
export function buildWonActor({ user = null, cause = null, at = null } = {}) {
  if (user?.id) {
    return {
      type: 'user',
      userId: user.id,
      displayName: user.displayName || null,
      username: user.username || null,
      cause: cause || null,
      at: at ? new Date(at).toISOString() : null,
    };
  }
  return {
    type: 'system',
    cause: cause || null,
    at: at ? new Date(at).toISOString() : null,
  };
}

// System-attribution wording per cause — the real source, named clearly.
const SYSTEM_LABELS = {
  woo_order: { he: 'מערכת — תשלום WooCommerce', en: 'System — WooCommerce payment' },
  cardcom_payment: { he: 'מערכת — Cardcom', en: 'System — Cardcom' },
  icount_payment: { he: 'מערכת — תשלום iCount', en: 'System — iCount payment' },
  card_payment: { he: 'מערכת — תשלום אשראי', en: 'System — credit-card payment' },
};

const UNKNOWN = { he: 'לא ידוע', en: 'Unknown' };
const SYSTEM = { he: 'מערכת', en: 'System' };

/**
 * The display label for a frozen wonActor (or the equivalent normalized
 * { type, displayName, username, cause } shape). `null`/missing → an explicit
 * "unknown" — a legacy deal must say so, not show a blank.
 */
export function wonActorLabel(actor, lang = 'he') {
  const en = lang === 'en';
  if (!actor || typeof actor !== 'object') return en ? UNKNOWN.en : UNKNOWN.he;
  if (actor.type === 'user') {
    const name = adminDisplayName(actor);
    if (name) return name;
    // A user-typed record with no resolvable name is still a PROVEN close by
    // a person — attribute honestly rather than inventing a system source.
    return en ? UNKNOWN.en : UNKNOWN.he;
  }
  const sys = SYSTEM_LABELS[actor.cause];
  if (sys) return en ? sys.en : sys.he;
  return en ? SYSTEM.en : SYSTEM.he;
}
