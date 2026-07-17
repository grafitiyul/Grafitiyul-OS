// TOUR IMPORT planner — PURE. Consumes normalized Airtable tour data + the
// crosswalk + native GOS tours + the owner's five policy decisions (2026-07-17),
// and produces deterministic TourEvent/Booking/Assignment/Registration/Payroll
// payloads plus the business-identity overlap classification.
//
// ── THE FIVE POLICIES ─────────────────────────────────────────────────────────
// 1. CALENDAR: legacy Google events are adopted ONLY when proven to live on the
//    org's primary calendar (the same account+calendar the GOS sync worker
//    owns) — adoption stamps GOS ownership so future edits update THAT event
//    and no duplicate invitation can exist. Unproven → import normally, legacy
//    id preserved as evidence, GOS creates its own canonical event later.
//    Historical tours: legacy id is ALWAYS evidence-only.
// 2. OVERLAPS: business identity, never timestamps. A deal-identity match
//    (an Airtable tour's legacy deal is booked on a native GOS tour) or an
//    open-slot match (open tour, same date + same start time as a native
//    group_slot) is a genuine duplicate; same-date-only is coincidence.
// 3. FUTURE OPEN TOURS: normal TourEvents (template null — never inferred);
//    fully GOS-controlled after import.
// 4. PAYROLL: historical rows import as frozen evidence (never recalculated);
//    payroll GENERATION for migration-owned tours is suppressed by MIGRATION
//    OWNERSHIP (the tour has a LegacyRecord), not by date; a final cutover
//    delta re-imports late Airtable changes, then GOS generation is enabled.
// 5. HISTORICAL PARTICIPANTS: TicketRegistrations import wherever reliable
//    (a linked deal + seat count), source='migration' — visible history that
//    triggers nothing (completed tours are outside every operational sweep).
import crypto from 'node:crypto';

const t = (s) => String(s ?? '').trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hhmm = (s) => {
  const m = /(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

// Airtable status → TourEvent status. Airtable statuses are STALE ("עתידי" on
// past dates) — the DATE decides; the status only distinguishes cancelled and
// the single postponed row.
export function tourStatusOf({ status, date, today }) {
  if (status === 'מבוטל') return 'cancelled';
  if (status === 'נדחה') return 'postponed';
  return date >= today ? 'scheduled' : 'completed';
}

// ── OVERLAP: business identity ────────────────────────────────────────────────
// gosTours: [{ id, date, startTime, kind, status, bookedLegacyDealIds:Set }]
export function classifyOverlap(tour, gosTours) {
  const sameDate = gosTours.filter((g) => g.date === tour.date && g.status !== 'cancelled');
  if (!sameDate.length) return { kind: 'none' };
  // (a) DEAL IDENTITY — the strongest signal: the same commercial engagement.
  for (const g of sameDate) {
    const shared = tour.legacyDealIds.filter((d) => g.bookedLegacyDealIds?.has(d));
    if (shared.length) return { kind: 'duplicate_deal', gosTourId: g.id, sharedDeals: shared };
  }
  // (b) OPEN-SLOT IDENTITY: an open tour occupying the same public slot.
  if (tour.isOpen) {
    const slot = sameDate.find((g) => g.kind === 'group_slot' && g.startTime === tour.startTime);
    if (slot) return { kind: 'duplicate_open_slot', gosTourId: slot.id };
  }
  // (c) Same date only — two different tours on one day. Not a duplicate.
  return { kind: 'coincidental_date', gosSameDate: sameDate.length };
}

// ── the planner ───────────────────────────────────────────────────────────────
// masterTours: [{ recId, tourId, name, date, startTime, endTime, status, freeSeats,
//                 legacyCalendarId, cardExtras:[{label,value}] }]
// coordRows:   [{ recId, masterRecId|null, legacyDealId|null, guideEmail, guideName,
//                 seats, legacyCalendarId }]
// payrollRows: [{ recId, masterRecId|null, guideEmail, guideName, role, date, month,
//                 baseMinor, totalPreVatMinor, vatMinor, approved, guideApproved, note }]
// adoptedCalendar: Map<masterRecId, { eventId, accountId }> — ONLY verified ones.
export function planTourImport({
  masterTours, coordRows, payrollRows = [],
  gosTours = [], dealXwalk = new Map(), personRefByEmail = new Map(),
  existingTourXwalk = new Map(), adoptedCalendar = new Map(), today,
}) {
  const problems = [];
  const warnings = [];
  const stats = {
    masterTours: masterTours.length, coordRows: coordRows.length,
    create: 0, alreadyImported: 0, duplicatesForReview: 0,
    byStatus: { scheduled: 0, completed: 0, cancelled: 0, postponed: 0 },
    future: 0, historical: 0,
    bookings: 0, bookingsDealResolved: 0, bookingsDealMissing: 0,
    assignments: 0, assignmentsPersonRef: 0, assignmentsExternal: 0,
    registrations: 0, seatsTotal: 0,
    orphanCoordRows: 0, orphanTours: 0,
    calendarAdopted: 0, calendarEvidenceOnly: 0,
    payrollActivities: 0, payrollEntries: 0, payrollUnlinked: 0,
    legacyCards: 0,
  };

  const coordByMaster = new Map();
  for (const c of coordRows) {
    if (!c.masterRecId) { stats.orphanCoordRows += 1; continue; }
    if (!coordByMaster.has(c.masterRecId)) coordByMaster.set(c.masterRecId, []);
    coordByMaster.get(c.masterRecId).push(c);
  }
  const payrollByMaster = new Map();
  for (const pr of payrollRows) {
    if (!pr.masterRecId) { stats.payrollUnlinked += 1; continue; }
    if (!payrollByMaster.has(pr.masterRecId)) payrollByMaster.set(pr.masterRecId, []);
    payrollByMaster.get(pr.masterRecId).push(pr);
  }

  const payloads = [];
  const duplicates = [];
  const ordered = [...masterTours].sort((a, b) => a.recId.localeCompare(b.recId));

  for (const m of ordered) {
    if (existingTourXwalk.has(m.recId)) { stats.alreadyImported += 1; continue; }
    const coords = (coordByMaster.get(m.recId) || []).sort((a, b) => a.recId.localeCompare(b.recId));
    const legacyDealIds = [...new Set(coords.map((c) => c.legacyDealId).filter((x) => x != null))].sort((a, b) => a - b);
    const isOpen = legacyDealIds.length > 1 || (legacyDealIds.length === 0 && m.date >= today);
    const status = tourStatusOf({ status: m.status, date: m.date, today });
    const future = m.date >= today && status === 'scheduled';
    stats.byStatus[status] += 1;
    if (future) stats.future += 1; else stats.historical += 1;
    if (!coords.length) stats.orphanTours += 1;

    // Overlap — FUTURE tours only (history cannot collide with live operations).
    if (future) {
      const overlap = classifyOverlap({ date: m.date, startTime: m.startTime, isOpen, legacyDealIds }, gosTours);
      if (overlap.kind.startsWith('duplicate')) {
        stats.duplicatesForReview += 1;
        duplicates.push({ masterRecId: m.recId, tourId: m.tourId, name: m.name, date: m.date, startTime: m.startTime, isOpen, legacyDealIds, ...overlap });
        continue; // held for the owner — never auto-imported, never auto-dropped
      }
    }

    // Bookings + historical/future registrations (policy 5).
    const bookings = [];
    for (const c of coords) {
      if (c.legacyDealId == null) continue;
      const gosDealId = dealXwalk.get(String(c.legacyDealId)) || null;
      if (!gosDealId) { stats.bookingsDealMissing += 1; warnings.push({ recId: m.recId, kind: 'booking_deal_missing', detail: `deal ${c.legacyDealId} has no GOS entity` }); continue; }
      stats.bookingsDealResolved += 1;
      const seats = c.seats ?? null;
      bookings.push({ gosDealId, legacyDealId: c.legacyDealId, seats: seats || 0, registration: seats != null && seats > 0 });
      if (seats != null && seats > 0) { stats.registrations += 1; stats.seatsTotal += seats; }
    }
    stats.bookings += bookings.length;

    // Guide assignments — distinct guides across the coordination rows.
    const guides = [];
    const seen = new Set();
    for (const c of coords) {
      const email = t(c.guideEmail).toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const personRefId = personRefByEmail.get(email) || null;
      guides.push({ email, displayName: t(c.guideName) || email, personRefId, role: 'guide' });
      if (personRefId) stats.assignmentsPersonRef += 1; else stats.assignmentsExternal += 1;
    }
    stats.assignments += guides.length;

    // Calendar (policy 1): adopted only when VERIFIED; else evidence on the card.
    const adopted = future ? adoptedCalendar.get(m.recId) || null : null;
    if (adopted) stats.calendarAdopted += 1;
    else if (m.legacyCalendarId) stats.calendarEvidenceOnly += 1;

    // Payroll (policy 4): frozen historical evidence per tour.
    const payroll = (payrollByMaster.get(m.recId) || []).sort((a, b) => a.recId.localeCompare(b.recId)).map((pr) => ({
      guideEmail: t(pr.guideEmail).toLowerCase() || null,
      displayName: t(pr.guideName) || t(pr.guideEmail) || 'לא ידוע',
      personRefId: personRefByEmail.get(t(pr.guideEmail).toLowerCase()) || null,
      role: pr.role || null,
      totalPreVatMinor: pr.totalPreVatMinor ?? null,
      vatMinor: pr.vatMinor ?? null,
      officeApproved: !!pr.approved,
      guideApproved: !!pr.guideApproved,
      note: t(pr.note) || null,
      sourceRecId: pr.recId,
    }));
    if (payroll.length) { stats.payrollActivities += 1; stats.payrollEntries += payroll.length; }

    const card = [
      { label: 'Tour_ID במערכת הקודמת', value: String(m.tourId ?? m.recId) },
      { label: 'סטטוס מקורי', value: m.status || '—' },
      ...(m.legacyCalendarId && !adopted ? [{ label: 'מזהה אירוע יומן (מערכת קודמת)', value: m.legacyCalendarId }] : []),
      ...(m.cardExtras || []),
    ];
    stats.legacyCards += 1;

    payloads.push({
      kind: isOpen ? 'group_slot' : 'deal_tour',
      sourceRecId: m.recId,
      tourId: m.tourId ?? null,
      name: t(m.name) || null,
      date: m.date, startTime: m.startTime, endTime: m.endTime || null,
      status,
      completedReason: status === 'completed' ? 'migration' : null,
      capacity: isOpen && m.freeSeats != null ? null : null, // capacity semantics deferred to import-time derivation
      bookings, guides, payroll,
      calendar: adopted ? { eventId: adopted.eventId, accountId: adopted.accountId } : null,
      cardData: card,
    });
    stats.create += 1;
  }

  const canonical = JSON.stringify(payloads, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return { payloads, duplicates, stats, problems, warnings, payloadHash: sha256(canonical), payloadBytes: canonical.length };
}
