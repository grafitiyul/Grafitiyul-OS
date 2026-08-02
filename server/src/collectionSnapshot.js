// THE one-time collection snapshot handed over by the business.
//
// These are Deal.orderNo values — which for migrated deals are the Pipedrive
// deal ids themselves (verified: both keys resolve to the identical 37 deals).
// This list IS the initial work queue. It is not inferred, not expanded and not
// reduced; GOS does not invent collection candidates.
//
// It is frozen on purpose. Once an operator starts working the queue, additions
// and removals happen through the UI (source 'operator'), never by editing this
// file — a decision recorded here would silently override a human's.
export const COLLECTION_SNAPSHOT_ORDER_NOS = Object.freeze([
  23226, 24607, 25160, 25257, 25260, 25392, 25394, 25395, 25488, 25651,
  25698, 25707, 25752, 25813, 25823, 25827, 25841, 25843, 25856, 25871,
  25877, 25910, 25922, 26011, 26027, 26106, 26108, 26134, 26162, 26163,
  26192, 26216, 26245, 26265, 26270, 26279, 26298,
]);

export const COLLECTION_SNAPSHOT_EXPECTED = 37;
