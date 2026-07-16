// Shared tour date/time + settings helpers. Historically this module ALSO
// hosted the legacy `TourScheduleRule` group-slot generator (`ensureGeneratedSlots`),
// now RETIRED — the Open Tours engine (openTourGeneration.js) is the sole
// recurring-slot generator. These helpers + the TourSettings accessor remain
// SHARED and are imported by the new engine, so they stay here.

// The date helpers moved to the ONE canonical date module
// (src/lib/israelDate.js) when the CRM Tasks workspace needed the same logic —
// there were three independent copies of "today in Israel" by then. Behaviour
// is unchanged (israelToday now takes an optional injectable clock, which the
// callers here simply don't pass). Re-exported so every existing importer
// (tours/woo/*, openTourGeneration, routes/openTours, maintenance/*) is
// untouched.
export { israelToday, addDays, weekdayOf } from '../lib/israelDate.js';

// Lazily-created settings singleton — the ONE accessor. SHARED (used by the
// Open Tours engine and the settings routes).
export async function getTourSettings(client) {
  return client.tourSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}
