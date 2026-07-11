// Pure derivation: TourEvent row (with product/variant/assignments/components
// included) → the desired Google Calendar event body. This is THE one place
// calendar content is computed — the sync worker calls it on every reconcile,
// so nothing about scheduling is ever duplicated or stored calendar-side.
//
// Product rules encoded here (spec):
//   * title = variant name only (= the Product's name in this system — variants
//     carry no name of their own), Hebrew for Hebrew tours, English otherwise;
//     never customer/organization names or internal ids.
//   * description = the fixed "the Guide App is the source of truth" text,
//     Hebrew or English by tour language. Nothing else.
//   * duration always derives from ProductVariant.durationHours.
//   * location = the tour's workshop locations, or empty. Never invented.
//   * attendees = EVERY assignment regardless of role; a missing email is a
//     WARNING for that guide, never a failure for the tour.

export const CALENDAR_TIMEZONE = 'Asia/Jerusalem';

// Fallback when the variant has no duration yet — the event still needs an end
// time; flagged as a warning so operations can fix the variant.
export const DEFAULT_DURATION_HOURS = 2;

export const DESCRIPTION_HE =
  'כל המידע על הפעילות נמצא באפליקציית המדריכים של גרפיטיול.\n\n' +
  'זימון זה ביומן הוא רק בשביל הנוחות - אם יש אי התאמה בין היומן לבין האפליקציה - האפליקציה קובעת!';

export const DESCRIPTION_EN =
  'All tour information is available in the Grafitiyul Guide App.\n\n' +
  'This calendar invitation is provided only for convenience. If there is any difference between this invitation and the Guide App, the Guide App is always the source of truth.';

// Business default is Hebrew; only an explicit non-he language switches the
// invitation to English (en/es/fr/ru all get the English variant name).
export function isHebrewTour(tourLanguage) {
  return !tourLanguage || tourLanguage === 'he';
}

// ── Wall-time ⇄ epoch in a named timezone (no dayjs on the server) ───────────

function tzOffsetMs(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - epochMs;
}

// "2026-07-20" + "10:00" in `timeZone` → epoch ms. Two-pass offset resolution
// handles DST boundaries deterministically.
export function wallTimeToEpoch(dateStr, timeStr, timeZone = CALENDAR_TIMEZONE) {
  const guess = Date.parse(`${dateStr}T${timeStr}:00Z`);
  const off1 = tzOffsetMs(guess, timeZone);
  let epoch = guess - off1;
  const off2 = tzOffsetMs(epoch, timeZone);
  if (off2 !== off1) epoch = guess - off2;
  return epoch;
}

// epoch ms → "YYYY-MM-DDTHH:MM:SS" wall time in `timeZone` (Google dateTime
// without offset — the timeZone field carries the zone).
export function epochToWallTime(epochMs, timeZone = CALENDAR_TIMEZONE) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

// ── Desired event ─────────────────────────────────────────────────────────────

function eventTitle(tour, warnings) {
  const he = isHebrewTour(tour.tourLanguage);
  const nameHe = tour.product?.nameHe || null;
  const nameEn = tour.product?.nameEn || null;
  const title = he ? nameHe : nameEn || nameHe;
  if (title) return title;
  warnings.push('לסיור אין מוצר משויך — הזימון נוצר עם כותרת כללית');
  return he ? 'פעילות גרפיטיול' : 'Grafitiyul Activity';
}

function eventLocation(tour) {
  const rows = [...(tour.activityComponents || [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter((r) => r.workshopLocation);
  const parts = [];
  const seen = new Set();
  for (const r of rows) {
    const loc = r.workshopLocation;
    const label = loc.address ? `${loc.nameHe} — ${loc.address}` : loc.nameHe;
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  return parts.join(', ');
}

function eventAttendees(tour, warnings) {
  const attendees = [];
  const seen = new Set();
  for (const a of tour.assignments || []) {
    const email = String(a.personRef?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      warnings.push(`ל"${a.displayName}" אין אימייל בפרופיל — לא נשלח זימון`);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    attendees.push({ email });
  }
  return attendees;
}

// tour → { event, warnings }. The caller (sync worker) decides ELIGIBILITY
// (status/date/time present) before calling; this only shapes content.
export function buildDesiredEvent(tour) {
  const warnings = [];
  const he = isHebrewTour(tour.tourLanguage);

  const durationHours = tour.productVariant?.durationHours;
  let hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    warnings.push('לוריאנט אין משך מוגדר — הזימון נוצר עם ברירת מחדל של שעתיים');
    hours = DEFAULT_DURATION_HOURS;
  }

  const startEpoch = wallTimeToEpoch(tour.date, tour.startTime);
  const endEpoch = startEpoch + Math.round(hours * 60) * 60 * 1000;

  const event = {
    summary: eventTitle(tour, warnings),
    description: he ? DESCRIPTION_HE : DESCRIPTION_EN,
    location: eventLocation(tour),
    start: { dateTime: `${tour.date}T${tour.startTime}:00`, timeZone: CALENDAR_TIMEZONE },
    end: { dateTime: epochToWallTime(endEpoch), timeZone: CALENDAR_TIMEZONE },
    attendees: eventAttendees(tour, warnings),
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    // Idempotency stamp — lets the worker re-find an event whose id write was
    // lost, so a tour can never end up with two events.
    extendedProperties: { private: { gosTourEventId: tour.id } },
  };
  return { event, warnings };
}

// ── Diff (existing Google event → minimal PATCH) ─────────────────────────────
// Update-in-place is the product rule (one stable invitation per guide);
// a null return means the event already matches and NO API write happens —
// that's what makes role-only changes and re-marks free of guest spam.

function attendeeEmails(list) {
  return new Set(
    (list || [])
      .filter((a) => !a.organizer && !a.resource)
      .map((a) => String(a.email || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function sameInstant(existingTime, desiredDateStr) {
  if (!existingTime?.dateTime) return false; // all-day or missing → rewrite
  const existingEpoch = Date.parse(existingTime.dateTime);
  const desiredEpoch = wallTimeToEpoch(
    desiredDateStr.slice(0, 10),
    desiredDateStr.slice(11, 16),
  );
  return existingEpoch === desiredEpoch;
}

export function diffEvent(existing, desired) {
  const patch = {};

  if ((existing.summary || '') !== desired.summary) patch.summary = desired.summary;
  if ((existing.description || '') !== desired.description) patch.description = desired.description;
  if ((existing.location || '') !== (desired.location || '')) patch.location = desired.location;

  if (!sameInstant(existing.start, desired.start.dateTime)) patch.start = desired.start;
  if (!sameInstant(existing.end, desired.end.dateTime)) patch.end = desired.end;

  const have = attendeeEmails(existing.attendees);
  const want = attendeeEmails(desired.attendees);
  const sameAttendees = have.size === want.size && [...want].every((e) => have.has(e));
  if (!sameAttendees) {
    // Keep responseStatus for guests who stay so their RSVP survives the patch.
    const byEmail = new Map(
      (existing.attendees || []).map((a) => [String(a.email || '').trim().toLowerCase(), a]),
    );
    patch.attendees = desired.attendees.map((a) => {
      const prev = byEmail.get(a.email);
      return prev?.responseStatus ? { email: a.email, responseStatus: prev.responseStatus } : a;
    });
  }

  // Heal adopted/legacy events that miss the idempotency stamp.
  if (existing.extendedProperties?.private?.gosTourEventId !== desired.extendedProperties.private.gosTourEventId) {
    patch.extendedProperties = desired.extendedProperties;
  }

  return Object.keys(patch).length ? patch : null;
}
