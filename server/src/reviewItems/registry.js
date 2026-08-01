// Review-item kind registry — the same shape as the בקרה detector registry.
//
// A new card type is ONE definition file plus one import. The Management Tasks
// screen, the API and the handled/history lifecycle never change.
//
// Definition:
//   kind        stable machine key (stored on every row — never renamed)
//   labelHe     what the operator calls this card family
//   tone        'default' | 'alert' — alert renders red (logistics)
//   descriptionHe  one plain sentence: what creates this card
//   buildLink(item) → deep link to the thing the card is about

const KINDS = new Map();

export function registerReviewKind(kind, def) {
  if (KINDS.has(kind)) throw new Error(`review kind already registered: ${kind}`);
  KINDS.set(kind, { kind, tone: 'default', ...def });
}

export function reviewKindDef(kind) {
  return KINDS.get(kind) || null;
}

export function listReviewKinds() {
  return [...KINDS.values()];
}

export function isKnownReviewKind(kind) {
  return KINDS.has(kind);
}
