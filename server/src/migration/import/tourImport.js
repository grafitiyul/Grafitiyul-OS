// TOUR IMPORT planner + executor — Wave 1 (runbook v2, owner-approved 2026-07-17).
//
// ── THE TWO LAWS (runbook v2) ─────────────────────────────────────────────────
// Law 1 — WAVE 1 IS STRICTLY HISTORICAL. A tour imports iff its date is in the
//   past, it was not cancelled, it was not postponed (a postponed tour never
//   took place), and its relationships resolve through the crosswalk. Future
//   tours, cancelled tours and postponed tours do NOT exist in GOS before
//   cutover — Airtable remains their operational source of truth.
// Law 2 — CANCELLED TOURS NEVER BECOME TOUREVENTS. They are deliberate,
//   audited exclusions (`cancelled_tour_not_migrated`): no bookings, no
//   registrations, no assignments, no payroll activities, no calendar. Payroll
//   rows attached to a cancelled tour become LEGACY-ONLY card evidence.
//
// Wave 1 rows are historical evidence: status='completed', completedReason=
// 'migration' (never scheduled-in-the-past — the IL-midnight worker must have
// nothing to sweep), calendar/Woo flags null ("never considered"), and payroll
// lazy-ensure is suppressed by migration ownership (the crosswalk row).
//
// The planner is PURE and deterministic (canonical hash = Hash A). The executor
// follows the proven pattern: hard gates, 500-row transactional chunks,
// crosswalk-first idempotency, MigrationRun checkpoints, forward-correction.
import crypto from 'node:crypto';

const t = (s) => String(s ?? '').trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Airtable statuses are STALE ("עתידי" on past dates) — the DATE decides;
// the status only distinguishes cancelled and postponed.
export function tourStatusOf({ status, date, today }) {
  if (status === 'מבוטל') return 'cancelled';
  if (status === 'נדחה') return 'postponed';
  return date >= today ? 'scheduled' : 'completed';
}

// ── OVERLAP: business identity (kept for the CUTOVER planner; Wave 1 imports
// no future tours, so it never fires there) ───────────────────────────────────
export function classifyOverlap(tour, gosTours) {
  const sameDate = gosTours.filter((g) => g.date === tour.date && g.status !== 'cancelled');
  if (!sameDate.length) return { kind: 'none' };
  for (const g of sameDate) {
    const shared = tour.legacyDealIds.filter((d) => g.bookedLegacyDealIds?.has(d));
    if (shared.length) return { kind: 'duplicate_deal', gosTourId: g.id, sharedDeals: shared };
  }
  if (tour.isOpen) {
    const slot = sameDate.find((g) => g.kind === 'group_slot' && g.startTime === tour.startTime);
    if (slot) return { kind: 'duplicate_open_slot', gosTourId: slot.id };
  }
  return { kind: 'coincidental_date', gosSameDate: sameDate.length };
}

// ── the Wave-1 planner ────────────────────────────────────────────────────────
export function planTourImport({
  masterTours, coordRows, payrollRows = [],
  dealXwalk = new Map(), dealMetaByLegacyId = new Map(), // legacyDealId → {activityType}
  personRefByEmail = new Map(),
  existingTourXwalk = new Map(), today,
}) {
  const warnings = [];
  const stats = {
    masterTours: masterTours.length, coordRows: coordRows.length,
    create: 0, alreadyImported: 0,
    cancelledExcluded: 0, postponedExcluded: 0, deferredFuture: 0,
    bookings: 0, bookingsDealResolved: 0, bookingsDealMissing: 0,
    registrations: 0, seatsTotal: 0,
    assignments: 0, assignmentsPersonRef: 0, assignmentsExternal: 0,
    orphanCoordRows: 0, toursWithoutDeals: 0,
    payrollActivities: 0, payrollEntries: 0,
    payrollLegacyOnlyRows: 0, // unlinked OR attached to an excluded tour
    legacyCards: 0, legacyEvidenceRows: 0,
    kinds: { group_slot: 0, private: 0, business: 0 },
  };

  const coordByMaster = new Map();
  for (const c of coordRows) {
    if (!c.masterRecId) { stats.orphanCoordRows += 1; continue; }
    if (!coordByMaster.has(c.masterRecId)) coordByMaster.set(c.masterRecId, []);
    coordByMaster.get(c.masterRecId).push(c);
  }
  const payrollByMaster = new Map();
  const payrollUnlinked = [];
  for (const pr of payrollRows) {
    if (!pr.masterRecId) { payrollUnlinked.push(pr); continue; }
    if (!payrollByMaster.has(pr.masterRecId)) payrollByMaster.set(pr.masterRecId, []);
    payrollByMaster.get(pr.masterRecId).push(pr);
  }

  const payloads = [];
  // LEGACY-ONLY evidence rows (Law 2 + unlinked payroll): LegacyRecord rows with
  // NO entity — proof of deliberate exclusion, never a tour.
  const legacyEvidence = [];
  const ordered = [...masterTours].sort((a, b) => a.recId.localeCompare(b.recId));

  for (const m of ordered) {
    const status = tourStatusOf({ status: m.status, date: m.date, today });
    const payroll = (payrollByMaster.get(m.recId) || []).sort((a, b) => a.recId.localeCompare(b.recId));

    // Law 2 first: cancelled is excluded whatever the date.
    if (status === 'cancelled') {
      stats.cancelledExcluded += 1;
      if (payroll.length) {
        stats.payrollLegacyOnlyRows += payroll.length;
        legacyEvidence.push({
          sourceType: 'tour', sourceId: m.recId,
          cardData: [
            { label: 'החרגה', value: 'cancelled_tour_not_migrated — סיור מבוטל, הוחרג בכוונה מהמיגרציה (חוק 2 בספר הריצה)' },
            { label: 'Tour_ID במערכת הקודמת', value: String(m.tourId ?? m.recId) },
            { label: 'תאריך', value: m.date },
            ...payroll.map((pr) => ({ label: `שכר (ראיה בלבד): ${t(pr.guideName) || '—'}`, value: `${((pr.totalPreVatMinor ?? 0) / 100).toFixed(0)} ₪ לפני מע"מ${pr.approved ? ' · מאושר' : ''}` })),
          ],
        });
        stats.legacyEvidenceRows += 1;
      }
      continue;
    }
    if (status === 'postponed') { stats.postponedExcluded += 1; continue; } // never took place
    if (status === 'scheduled') { stats.deferredFuture += 1; continue; }    // belongs to Airtable until cutover
    if (existingTourXwalk.has(m.recId)) { stats.alreadyImported += 1; continue; }

    // ── an included, completed historical tour ──────────────────────────────
    const coords = (coordByMaster.get(m.recId) || []).sort((a, b) => a.recId.localeCompare(b.recId));
    const legacyDealIds = [...new Set(coords.map((c) => c.legacyDealId).filter((x) => x != null))].sort((a, b) => a - b);
    if (!coords.length) stats.toursWithoutDeals += 1;
    const isOpen = legacyDealIds.length > 1;
    const kind = isOpen ? 'group_slot'
      : dealMetaByLegacyId.get(legacyDealIds[0])?.activityType === 'business' ? 'business' : 'private';
    stats.kinds[kind] += 1;

    const bookings = [];
    for (const c of coords) {
      if (c.legacyDealId == null) continue;
      const gosDealId = dealXwalk.get(String(c.legacyDealId)) || null;
      if (!gosDealId) {
        stats.bookingsDealMissing += 1;
        warnings.push({ recId: m.recId, kind: 'booking_deal_missing', detail: `deal ${c.legacyDealId} has no GOS entity` });
        continue;
      }
      stats.bookingsDealResolved += 1;
      const seats = c.seats ?? null;
      bookings.push({ gosDealId, legacyDealId: c.legacyDealId, seats: seats || 0, registration: seats != null && seats > 0 });
      if (seats != null && seats > 0) { stats.registrations += 1; stats.seatsTotal += seats; }
    }
    stats.bookings += bookings.length;

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

    const payrollOut = payroll.map((pr) => ({
      displayName: t(pr.guideName) || 'לא ידוע',
      personRefId: null, // payroll rows carry names, not emails — resolved at cutover if ever needed
      role: /ראשי/.test(t(pr.role)) ? 'lead_guide' : /עוזר|סדנ/.test(t(pr.role)) ? 'workshop_assistant' : 'guide',
      totalPreVatMinor: pr.totalPreVatMinor ?? 0,
      vatMinor: pr.vatMinor ?? 0,
      officeApproved: !!pr.approved,
      guideApproved: !!pr.guideApproved,
      note: t(pr.note) || null,
      sourceRecId: pr.recId,
    }));
    if (payrollOut.length) { stats.payrollActivities += 1; stats.payrollEntries += payrollOut.length; }

    stats.legacyCards += 1;
    payloads.push({
      sourceRecId: m.recId,
      tourId: m.tourId ?? null,
      kind,
      name: t(m.name) || null,
      date: m.date, startTime: m.startTime || null, endTime: m.endTime || null,
      status: 'completed',
      completedReason: 'migration',
      bookings, guides, payroll: payrollOut,
      cardData: [
        { label: 'Tour_ID במערכת הקודמת', value: String(m.tourId ?? m.recId) },
        { label: 'סטטוס מקורי', value: m.status || '—' },
        ...(m.legacyCalendarId ? [{ label: 'מזהה אירוע יומן (מערכת קודמת)', value: m.legacyCalendarId }] : []),
        ...(m.cardExtras || []),
      ],
    });
    stats.create += 1;
  }

  // Unlinked payroll rows: legacy-only evidence, never guessed onto a tour.
  for (const pr of payrollUnlinked) {
    stats.payrollLegacyOnlyRows += 1;
    legacyEvidence.push({
      sourceType: 'payroll', sourceId: pr.recId,
      cardData: [
        { label: 'החרגה', value: 'שורת שכר ללא קישור לסיור — נשמרת כראיה בלבד' },
        { label: 'מדריך', value: t(pr.guideName) || '—' },
        { label: 'סכום לפני מע"מ', value: `${((pr.totalPreVatMinor ?? 0) / 100).toFixed(0)} ₪` },
        { label: 'מאושר', value: pr.approved ? 'כן' : 'לא' },
      ],
    });
  }
  stats.legacyEvidenceRows = legacyEvidence.length;

  const canonical = JSON.stringify({ payloads, legacyEvidence }, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return { payloads, legacyEvidence, stats, warnings, payloadHash: sha256(canonical), payloadBytes: canonical.length };
}

// ── HARD GATES — refuse before any write ──────────────────────────────────────
export function checkTourExecutionGates({ plan, expectHash, expected }) {
  const failures = [];
  if (!expectHash) failures.push('expect-hash חסר');
  else if (plan.payloadHash !== expectHash) failures.push(`hash התוכנית שונה מהמאושר (${plan.payloadHash.slice(0, 16)}… ≠ ${String(expectHash).slice(0, 16)}…)`);
  const s = plan.stats;
  const accounted = s.create + s.alreadyImported + s.cancelledExcluded + s.postponedExcluded + s.deferredFuture;
  if (accounted !== s.masterTours) failures.push(`אוכלוסיות לא מתאזנות: ${accounted} ≠ ${s.masterTours}`);
  if (expected) {
    if (s.masterTours !== expected.masterTours) failures.push(`סך סיורי מקור ${s.masterTours} ≠ ${expected.masterTours}`);
    if (s.create + s.alreadyImported !== expected.wave1) failures.push(`Wave 1: ${s.create}+${s.alreadyImported} ≠ ${expected.wave1}`);
    if (s.cancelledExcluded !== expected.cancelled) failures.push(`מבוטלים ${s.cancelledExcluded} ≠ ${expected.cancelled}`);
    if (s.deferredFuture !== expected.future) failures.push(`עתידיים ${s.deferredFuture} ≠ ${expected.future}`);
  }
  // Law 1+2 structural assertions over the actual payloads:
  if (plan.payloads.some((p) => p.status !== 'completed')) failures.push('נמצא payload שאינו completed — הפרת חוק 1');
  if (plan.payloads.some((p) => p.calendar)) failures.push('נמצא payload עם יומן — אסור ב-Wave 1');
  return { ok: failures.length === 0, failures };
}

// ── EXECUTOR — proven pattern; writes tourEvent + booking + ticketRegistration
// + tourAssignment + payrollActivity/Entry/Line + legacyRecord ONLY. ──────────
export async function executeTourPlan(prisma, plan, { batchId, snapshotId, historicalComponentId, chunk = 500, log = () => {}, checkpoint = async () => {} } = {}) {
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  let written = 0;

  for (const slice of chunks(plan.payloads, chunk)) {
    const tourRows = [], bookingRows = [], regRows = [], assignRows = [], legacyRows = [];
    const activityRows = [], entryRows = [], lineRows = [];
    for (const p of slice) {
      const tourId = crypto.randomUUID();
      tourRows.push({
        id: tourId, kind: p.kind, status: 'completed',
        completedAt: new Date(`${p.date}T${p.endTime || p.startTime || '23:00'}:00`),
        completedReason: 'migration',
        date: p.date, startTime: p.startTime,
        notes: null, capacity: null,
      });
      for (const b of p.bookings) {
        const bookingId = crypto.randomUUID();
        bookingRows.push({ id: bookingId, tourEventId: tourId, dealId: b.gosDealId, seats: b.seats, status: 'active' });
        if (b.registration) {
          regRows.push({ tourEventId: tourId, bookingId, dealId: b.gosDealId, quantity: b.seats, source: 'migration', status: 'confirmed' });
        }
      }
      for (const g of p.guides) {
        assignRows.push({ tourEventId: tourId, personRefId: g.personRefId, externalPersonId: g.email, displayName: g.displayName, role: g.role });
      }
      if (p.payroll.length) {
        const activityId = crypto.randomUUID();
        activityRows.push({
          id: activityId, sourceType: 'tour_event', tourEventId: tourId,
          titleHe: p.name || `סיור ${p.tourId ?? ''}`.trim(),
          payrollMonth: p.date.slice(0, 7), date: p.date, state: 'active',
        });
        for (const pr of p.payroll) {
          const entryId = crypto.randomUUID();
          entryRows.push({
            id: entryId, activityId,
            personRefId: pr.personRefId, externalPersonId: `legacy:${pr.sourceRecId}`,
            displayName: pr.displayName, role: pr.role,
            officeStatus: pr.officeApproved ? 'approved' : 'draft',
            guideStatus: pr.guideApproved ? 'approved' : 'pending',
            vatStatusSnapshot: (pr.vatMinor ?? 0) > 0 ? 'vat_18' : 'exempt',
            calcSnapshot: { migration: true, frozen: true, totalPreVatMinor: pr.totalPreVatMinor, vatMinor: pr.vatMinor, sourceRecId: pr.sourceRecId },
            notes: pr.note,
          });
          lineRows.push({
            entryId, componentId: historicalComponentId,
            componentNameHe: 'שכר היסטורי — מערכת קודמת', sign: 1, vatMode: 'net',
            quantity: null, unitPriceMinor: null,
            calculatedMinor: BigInt(pr.totalPreVatMinor ?? 0),
            note: 'יובא מהמערכת הקודמת — ראיה מוקפאת, לא מחושב מחדש',
          });
        }
      }
      legacyRows.push({
        sourceSystem: 'airtable', sourceType: 'tour', sourceId: p.sourceRecId,
        entityType: 'TourEvent', entityId: tourId,
        importBatchId: batchId, snapshotId, cardData: p.cardData,
      });
    }
    await prisma.$transaction([
      prisma.tourEvent.createMany({ data: tourRows }),
      prisma.booking.createMany({ data: bookingRows }),
      prisma.ticketRegistration.createMany({ data: regRows }),
      prisma.tourAssignment.createMany({ data: assignRows, skipDuplicates: true }),
      prisma.payrollActivity.createMany({ data: activityRows }),
      prisma.payrollEntry.createMany({ data: entryRows }),
      prisma.payrollEntryLine.createMany({ data: lineRows, skipDuplicates: true }),
      prisma.legacyRecord.createMany({ data: legacyRows, skipDuplicates: true }),
    ]);
    written += slice.length;
    await checkpoint({ written, total: plan.payloads.length });
    if (written % 1000 < chunk) log(`  ✓ ${written}/${plan.payloads.length} tours`);
  }

  // Law 2 evidence + unlinked payroll: LegacyRecord rows with NO entity.
  const evidenceRows = plan.legacyEvidence.map((e) => ({
    sourceSystem: 'airtable', sourceType: e.sourceType, sourceId: e.sourceId,
    entityType: null, entityId: null, importBatchId: batchId, snapshotId, cardData: e.cardData,
  }));
  for (const slice of chunks(evidenceRows, chunk)) {
    await prisma.legacyRecord.createMany({ data: slice, skipDuplicates: true });
  }
  log(`  ✓ legacy evidence rows: ${evidenceRows.length}`);
  return { written, evidence: evidenceRows.length };
}
