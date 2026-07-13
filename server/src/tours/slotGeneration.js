// Shared tour date/time + settings helpers. Historically this module ALSO
// hosted the legacy `TourScheduleRule` group-slot generator (`ensureGeneratedSlots`),
// now RETIRED — the Open Tours engine (openTourGeneration.js) is the sole
// recurring-slot generator. These helpers + the TourSettings accessor remain
// SHARED and are imported by the new engine, so they stay here.

// Israel-local calendar date (server runs UTC) — "YYYY-MM-DD".
export function israelToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sunday
}

// Lazily-created settings singleton — the ONE accessor. SHARED (used by the
// Open Tours engine and the settings routes).
export async function getTourSettings(client) {
  return client.tourSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}
