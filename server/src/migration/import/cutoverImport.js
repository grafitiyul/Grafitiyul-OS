// CUTOVER IMPORT — runbook v2 Stage 4 (freeze night). Pure planners + gates +
// executors for everything Wave 1 deliberately deferred:
//
//   1. FUTURE tours at freeze → genuine operational TourEvents (scheduled,
//      GOS-owned; calendar events created ONCE by the sync worker after the
//      TOUR_CALENDAR_SYNC_ENABLED hold is lifted). NOT template-attached.
//   2. DUPLICATE open slots (business identity: open + same date + startTime
//      vs a native GOS group_slot) → the native slot SURVIVES, the twin is
//      never created; bookings/registrations/assignments redirect into it and
//      the Airtable tour crosswalks to the native TourEvent.
//   3. DELTA on already-imported (Wave-1) tours: additive/replace only —
//      new payroll rows append, changed amounts REPLACE the frozen evidence
//      (runbook delta law: Replace derived artifacts), seats update, new
//      bookings append. NOTHING is ever deleted by a delta. A Wave-1 tour
//      cancelled retroactively in Airtable is a CONFLICT for owner review.
//   4. DEAL delta (three-way): a mapped field changed in the source during the
//      mirror merges into GOS only when GOS still holds the Snapshot-#1 value;
//      if GOS was edited meanwhile it is a CONFLICT — owner decisions and GOS
//      edits are never overwritten.
//
// One-active-booking-per-deal (DB partial unique index): a deal already
// actively booked in GOS keeps that booking; its future-tour attachment
// imports as registration-only seat evidence + card note. Within the plan a
// deal spanning several future tours keeps the active booking on the EARLIEST
// one (the next operational engagement).
//
// Hash B = canonical sha256 over the ENTIRE cutover plan (all four sections).
import crypto from 'node:crypto';
import { tourStatusOf } from './tourImport.js';

const t = (s) => String(s ?? '').trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canonical = (obj) => JSON.stringify(obj, (key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
});

// ── 1+2: future tours + duplicate redirects ───────────────────────────────────
export function planFutureTours({
  masterTours, coordRows,
  dealXwalk = new Map(), dealMetaByLegacyId = new Map(), personRefByEmail = new Map(),
  existingTourXwalk = new Map(),
  nativeSlots = [],               // native GOS group_slots: {id, date, startTime, status}
  activeBookingDealIds = new Set(), // gosDealIds that already hold an ACTIVE booking in GOS
  freezeDate,
}) {
  const warnings = [];
  const stats = {
    future: 0, create: 0, redirectedToNative: 0, alreadyImported: 0,
    bookings: 0, registrationOnly: 0, registrations: 0, seatsTotal: 0, assignments: 0,
    bookingsDealMissing: 0,
  };
  const coordByMaster = new Map();
  for (const c of coordRows) {
    if (!c.masterRecId) continue;
    if (!coordByMaster.has(c.masterRecId)) coordByMaster.set(c.masterRecId, []);
    coordByMaster.get(c.masterRecId).push(c);
  }
  const nativeByIdentity = new Map(); // `${date}|${startTime}` → native slot (scheduled only)
  for (const g of nativeSlots) {
    if (g.status === 'scheduled' && g.date && g.startTime) nativeByIdentity.set(`${g.date}|${g.startTime}`, g);
  }

  const future = [...masterTours]
    .filter((m) => tourStatusOf({ status: m.status, date: m.date, today: freezeDate }) === 'scheduled')
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)) || a.recId.localeCompare(b.recId));
  stats.future = future.length;

  const payloads = [];
  const redirects = [];
  const claimedActive = new Set(activeBookingDealIds); // grows as the plan claims deals
  for (const m of future) {
    if (existingTourXwalk.has(m.recId)) { stats.alreadyImported += 1; continue; }
    const coords = (coordByMaster.get(m.recId) || []).sort((a, b) => a.recId.localeCompare(b.recId));
    const legacyDealIds = [...new Set(coords.map((c) => c.legacyDealId).filter((x) => x != null))].sort((a, b) => a - b);
    const isOpen = legacyDealIds.length > 1;
    const kind = isOpen ? 'group_slot'
      : dealMetaByLegacyId.get(legacyDealIds[0])?.activityType === 'business' ? 'business' : 'private';

    // Same-tour dedupe by deal, then the one-active-per-deal split.
    const byDeal = new Map();
    const missingDeals = [];
    for (const c of coords) {
      if (c.legacyDealId == null) continue;
      const gosDealId = dealXwalk.get(String(c.legacyDealId)) || null;
      if (!gosDealId) {
        stats.bookingsDealMissing += 1;
        missingDeals.push(c.legacyDealId);
        warnings.push({ recId: m.recId, kind: 'booking_deal_missing', detail: `deal ${c.legacyDealId} has no GOS entity` });
        continue;
      }
      if (!byDeal.has(gosDealId)) byDeal.set(gosDealId, { gosDealId, legacyDealId: c.legacyDealId, seats: 0, registrations: [] });
      const b = byDeal.get(gosDealId);
      const seats = c.seats ?? null;
      b.seats += seats || 0;
      if (seats != null && seats > 0) { b.registrations.push(seats); stats.registrations += 1; stats.seatsTotal += seats; }
    }
    const bookings = [];
    const registrationOnly = [];
    const cardNotes = [];
    for (const b of byDeal.values()) {
      if (claimedActive.has(b.gosDealId)) {
        registrationOnly.push({ gosDealId: b.gosDealId, legacyDealId: b.legacyDealId, registrations: b.registrations.length ? b.registrations : (b.seats > 0 ? [b.seats] : []) });
        cardNotes.push({ label: 'הזמנה קיימת לדיל', value: `לדיל ${b.legacyDealId} כבר קיימת הזמנה פעילה ב-GOS — כאן נשמר רישום מושבים בלבד` });
        stats.registrationOnly += 1;
      } else {
        claimedActive.add(b.gosDealId); // earliest future tour claims the deal
        bookings.push(b);
        stats.bookings += 1;
      }
    }

    const guides = [];
    const seen = new Set();
    for (const c of coords) {
      const email = t(c.guideEmail).toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      guides.push({ email, displayName: t(c.guideName) || email, personRefId: personRefByEmail.get(email) || null, role: 'guide' });
      stats.assignments += 1;
    }

    const cardData = [
      { label: 'Tour_ID במערכת הקודמת', value: String(m.tourId ?? m.recId) },
      { label: 'יובא ב-Cutover', value: 'סיור עתידי תפעולי — בבעלות GOS מלאה, ללא תבנית' },
      ...(m.legacyCalendarId ? [{ label: 'מזהה אירוע יומן (מערכת קודמת)', value: m.legacyCalendarId }] : []),
      ...(missingDeals.length ? [{ label: 'קישורי דיל שלא נפתרו', value: `דילים ${missingDeals.join(', ')} לא קיימים ב-GOS` }] : []),
      ...cardNotes,
      ...(m.cardExtras || []),
    ];
    const body = {
      sourceRecId: m.recId, tourId: m.tourId ?? null, kind, name: t(m.name) || null,
      date: m.date, startTime: m.startTime || null, endTime: m.endTime || null,
      bookings, registrationOnly, guides, cardData,
    };

    // Duplicate re-evaluation (business identity, blanket rule): the native
    // slot survives; the twin's data redirects into it.
    const native = isOpen ? nativeByIdentity.get(`${m.date}|${m.startTime}`) : null;
    if (native) {
      redirects.push({ ...body, nativeTourEventId: native.id });
      stats.redirectedToNative += 1;
    } else {
      payloads.push({ ...body, status: 'scheduled' });
      stats.create += 1;
    }
  }
  return { payloads, redirects, stats, warnings };
}

// ── 3: delta on already-imported Wave-1 tours (additive/replace, never delete) ─
export function planImportedTourDelta({
  masterTours, coordRows, payrollRows,
  dealXwalk = new Map(), importedState = new Map(), // sourceRecId → GOS state
  freezeDate,
}) {
  const deltas = [];
  const conflicts = [];
  const stats = { toursTouched: 0, addBooking: 0, addRegistrationOnly: 0, updateSeats: 0, addPayroll: 0, replacePayrollAmount: 0, cancelledConflicts: 0 };

  const coordByMaster = new Map();
  for (const c of coordRows) {
    if (!c.masterRecId) continue;
    if (!coordByMaster.has(c.masterRecId)) coordByMaster.set(c.masterRecId, []);
    coordByMaster.get(c.masterRecId).push(c);
  }
  const payrollByMaster = new Map();
  for (const p of payrollRows) {
    if (!p.masterRecId) continue;
    if (!payrollByMaster.has(p.masterRecId)) payrollByMaster.set(p.masterRecId, []);
    payrollByMaster.get(p.masterRecId).push(p);
  }

  for (const m of masterTours) {
    const state = importedState.get(m.recId);
    if (!state) continue; // not a Wave-1 tour
    const ops = [];

    // A Wave-1 (completed, imported) tour cancelled retroactively in Airtable
    // contradicts "it actually took place" — owner review, never automatic.
    if (tourStatusOf({ status: m.status, date: m.date, today: freezeDate }) === 'cancelled') {
      conflicts.push({ kind: 'imported_tour_cancelled_in_source', sourceRecId: m.recId, tourEventId: state.tourEventId, name: t(m.name) || null, date: m.date });
      stats.cancelledConflicts += 1;
      continue;
    }

    // Bookings: same-tour merge first, then diff vs GOS.
    const byDeal = new Map();
    for (const c of coordByMaster.get(m.recId) || []) {
      if (c.legacyDealId == null) continue;
      const gosDealId = dealXwalk.get(String(c.legacyDealId)) || null;
      if (!gosDealId) continue;
      if (!byDeal.has(gosDealId)) byDeal.set(gosDealId, { gosDealId, legacyDealId: c.legacyDealId, seats: 0, registrations: [] });
      const b = byDeal.get(gosDealId);
      const seats = c.seats ?? null;
      b.seats += seats || 0;
      if (seats != null && seats > 0) b.registrations.push(seats);
    }
    for (const b of byDeal.values()) {
      const existing = state.bookings.get(b.gosDealId);
      if (!existing) {
        if (state.registrationOnlyDeals?.has(b.gosDealId)) continue; // demoted multi-tour deal — evidence already present
        ops.push({ op: 'addBooking', ...b });
        stats.addBooking += 1;
      } else if (existing.seats !== b.seats) {
        ops.push({ op: 'updateBookingSeats', bookingId: existing.id, gosDealId: b.gosDealId, from: existing.seats, to: b.seats });
        stats.updateSeats += 1;
      }
    }

    // Payroll: frozen evidence mirrors the FINAL source state (Replace-derived).
    for (const p of payrollByMaster.get(m.recId) || []) {
      const existing = state.payroll.get(p.recId);
      const total = p.totalPreVatMinor ?? 0;
      const vat = p.vatMinor ?? 0;
      if (!existing) {
        ops.push({
          op: 'addPayrollEntry', recId: p.recId, displayName: t(p.guideName) || 'לא ידוע',
          role: /ראשי/.test(t(p.role)) ? 'lead_guide' : /עוזר|סדנ/.test(t(p.role)) ? 'workshop_assistant' : 'guide',
          totalPreVatMinor: total, vatMinor: vat,
          officeApproved: !!p.approved, guideApproved: !!p.guideApproved, note: t(p.note) || null,
          titleHe: t(m.name) || `סיור ${m.tourId ?? ''}`.trim(), date: m.date,
        });
        stats.addPayroll += 1;
      } else if (existing.totalPreVatMinor !== total || existing.vatMinor !== vat) {
        ops.push({ op: 'replacePayrollAmount', recId: p.recId, entryId: existing.entryId, totalPreVatMinor: total, vatMinor: vat });
        stats.replacePayrollAmount += 1;
      }
    }

    if (ops.length) { deltas.push({ sourceRecId: m.recId, tourEventId: state.tourEventId, activityId: state.activityId ?? null, ops }); stats.toursTouched += 1; }
  }
  return { deltas, conflicts, stats };
}

// ── 4: deal delta — three-way merge (snap1 · final · GOS current) ─────────────
export const DEAL_DELTA_FIELDS = [
  'title', 'status', 'dealStageKey', 'valueMinor', 'currency',
  'wonAt', 'lostAt', 'lostReason', 'expectedCloseDate',
  'tourDate', 'tourTime', 'participants',
];

export function planDealDelta({ snap1ByOrderNo, finalByOrderNo, gosByOrderNo, existingDealXwalk }) {
  const merges = [];
  const conflicts = [];
  const stats = { dealsCompared: 0, dealsChangedInSource: 0, merges: 0, conflicts: 0, fieldsMerged: 0 };
  const eq = (a, b) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');

  for (const [orderNo, fin] of finalByOrderNo) {
    const dealId = existingDealXwalk.get(String(orderNo));
    if (!dealId) continue; // new deal — handled by the create path, not the delta
    const base = snap1ByOrderNo.get(orderNo);
    const gos = gosByOrderNo.get(orderNo);
    if (!base || !gos) continue;
    stats.dealsCompared += 1;

    const set = {};
    const conflictFields = [];
    for (const f of DEAL_DELTA_FIELDS) {
      if (eq(base[f], fin[f])) continue; // source unchanged during the mirror
      if (eq(gos[f], base[f])) set[f] = fin[f] ?? null; // GOS untouched → merge the source change
      else if (!eq(gos[f], fin[f])) conflictFields.push({ field: f, snap1: base[f] ?? null, final: fin[f] ?? null, gos: gos[f] ?? null });
      // gos already equals final → nothing to do
    }
    if (Object.keys(set).length || conflictFields.length) stats.dealsChangedInSource += 1;
    if (Object.keys(set).length) {
      merges.push({ orderNo, dealId, set, refreshCard: fin.cardData ?? null });
      stats.merges += 1;
      stats.fieldsMerged += Object.keys(set).length;
    }
    if (conflictFields.length) {
      conflicts.push({ orderNo, dealId, fields: conflictFields });
      stats.conflicts += 1;
    }
  }
  return { merges, conflicts, stats };
}

// ── Hash B + gates ────────────────────────────────────────────────────────────
export function buildCutoverPlan({ historical, future, tourDelta, dealDelta }) {
  const body = {
    historical: { payloads: historical.payloads, legacyEvidence: historical.legacyEvidence },
    future: { payloads: future.payloads, redirects: future.redirects },
    tourDelta: { deltas: tourDelta.deltas, conflicts: tourDelta.conflicts },
    dealDelta: { merges: dealDelta.merges, conflicts: dealDelta.conflicts },
    // New deals created from the final snapshot are pinned by their own plan
    // hash (the full deal-plan payloads are too large to embed twice).
    newDeals: dealDelta.newDeals ?? null,
  };
  const c = canonical(body);
  return { ...body, payloadHash: sha256(c), payloadBytes: c.length };
}

export function checkCutoverGates({ plan, expectHash, freezeDate, expected }) {
  const failures = [];
  if (!expectHash) failures.push('expect-hash (Hash B) חסר');
  else if (plan.payloadHash !== expectHash) failures.push(`Hash B שונה מהמאושר (${plan.payloadHash.slice(0, 16)}… ≠ ${String(expectHash).slice(0, 16)}…)`);
  if (plan.historical.payloads.some((p) => p.status !== 'completed')) failures.push('בדלתא ההיסטורית נמצא payload שאינו completed');
  if (plan.future.payloads.some((p) => p.status !== 'scheduled' || p.date < freezeDate)) failures.push('סיור עתידי לא תקין (לא scheduled או לפני תאריך ההקפאה)');
  if (expected) {
    if (expected.futureCreate != null && plan.future.payloads.length !== expected.futureCreate) failures.push(`סיורים עתידיים ${plan.future.payloads.length} ≠ ${expected.futureCreate}`);
    if (expected.redirects != null && plan.future.redirects.length !== expected.redirects) failures.push(`הפניות לסלוטים קיימים ${plan.future.redirects.length} ≠ ${expected.redirects}`);
    if (expected.historicalCreate != null && plan.historical.payloads.length !== expected.historicalCreate) failures.push(`דלתא היסטורית ${plan.historical.payloads.length} ≠ ${expected.historicalCreate}`);
  }
  return { ok: failures.length === 0, failures };
}

// ── executors (transactional chunks; additive; crosswalk-first idempotent) ────
export async function executeFutureTours(prisma, payloads, { batchId, snapshotId, chunk = 200, log = () => {} } = {}) {
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  let written = 0;
  for (const slice of chunks(payloads, chunk)) {
    const tourRows = [], bookingRows = [], regRows = [], assignRows = [], legacyRows = [];
    for (const p of slice) {
      const tourId = crypto.randomUUID();
      // Operational scheduled tour. gcalSyncStatus stays null: the worker's
      // sweep adopts it (→ event + invitations, ONCE) as soon as the
      // TOUR_CALENDAR_SYNC_ENABLED hold is lifted after verification.
      tourRows.push({ id: tourId, kind: p.kind, status: 'scheduled', date: p.date, startTime: p.startTime, notes: p.name || null, capacity: null });
      for (const b of p.bookings) {
        const bookingId = crypto.randomUUID();
        bookingRows.push({ id: bookingId, tourEventId: tourId, dealId: b.gosDealId, seats: b.seats, status: 'active' });
        for (const qty of b.registrations) regRows.push({ tourEventId: tourId, bookingId, dealId: b.gosDealId, quantity: qty, source: 'migration', status: 'confirmed' });
      }
      for (const x of p.registrationOnly) {
        for (const qty of x.registrations) regRows.push({ tourEventId: tourId, bookingId: null, dealId: x.gosDealId, quantity: qty, source: 'migration', status: 'confirmed' });
      }
      for (const g of p.guides) assignRows.push({ tourEventId: tourId, personRefId: g.personRefId, externalPersonId: g.email, displayName: g.displayName, role: g.role });
      legacyRows.push({ sourceSystem: 'airtable', sourceType: 'tour', sourceId: p.sourceRecId, entityType: 'TourEvent', entityId: tourId, importBatchId: batchId, snapshotId, cardData: p.cardData });
    }
    await prisma.$transaction([
      prisma.tourEvent.createMany({ data: tourRows }),
      prisma.booking.createMany({ data: bookingRows }),
      prisma.ticketRegistration.createMany({ data: regRows }),
      prisma.tourAssignment.createMany({ data: assignRows, skipDuplicates: true }),
      prisma.legacyRecord.createMany({ data: legacyRows, skipDuplicates: true }),
    ]);
    written += slice.length;
    log(`  ✓ future tours ${written}/${payloads.length}`);
  }
  return { written };
}

export async function executeRedirects(prisma, redirects, { batchId, snapshotId, log = () => {} } = {}) {
  let written = 0;
  for (const r of redirects) {
    const bookingRows = [], regRows = [], assignRows = [];
    for (const b of r.bookings) {
      const bookingId = crypto.randomUUID();
      bookingRows.push({ id: bookingId, tourEventId: r.nativeTourEventId, dealId: b.gosDealId, seats: b.seats, status: 'active' });
      for (const qty of b.registrations) regRows.push({ tourEventId: r.nativeTourEventId, bookingId, dealId: b.gosDealId, quantity: qty, source: 'migration', status: 'confirmed' });
    }
    for (const x of r.registrationOnly) {
      for (const qty of x.registrations) regRows.push({ tourEventId: r.nativeTourEventId, bookingId: null, dealId: x.gosDealId, quantity: qty, source: 'migration', status: 'confirmed' });
    }
    for (const g of r.guides) assignRows.push({ tourEventId: r.nativeTourEventId, personRefId: g.personRefId, externalPersonId: g.email, displayName: g.displayName, role: g.role });
    await prisma.$transaction([
      ...(bookingRows.length ? [prisma.booking.createMany({ data: bookingRows })] : []),
      ...(regRows.length ? [prisma.ticketRegistration.createMany({ data: regRows })] : []),
      ...(assignRows.length ? [prisma.tourAssignment.createMany({ data: assignRows, skipDuplicates: true })] : []),
      prisma.legacyRecord.createMany({
        data: [{ sourceSystem: 'airtable', sourceType: 'tour', sourceId: r.sourceRecId, entityType: 'TourEvent', entityId: r.nativeTourEventId, importBatchId: batchId, snapshotId, cardData: [...r.cardData, { label: 'איחוד כפילות', value: 'הסלוט המקורי של GOS שרד; נתוני הסיור מהמערכת הקודמת הופנו אליו' }] }],
        skipDuplicates: true,
      }),
    ]);
    written += 1;
    log(`  ✓ redirect → native slot (${r.sourceRecId})`);
  }
  return { written };
}

export async function executeTourDelta(prisma, deltas, { historicalComponentId, log = () => {} } = {}) {
  const counters = { addBooking: 0, updateSeats: 0, addPayroll: 0, replacePayrollAmount: 0 };
  for (const d of deltas) {
    await prisma.$transaction(async (tx) => {
      let activityId = d.activityId;
      for (const op of d.ops) {
        if (op.op === 'addBooking') {
          const bookingId = crypto.randomUUID();
          await tx.booking.create({ data: { id: bookingId, tourEventId: d.tourEventId, dealId: op.gosDealId, seats: op.seats, status: 'active' } });
          for (const qty of op.registrations) {
            await tx.ticketRegistration.create({ data: { tourEventId: d.tourEventId, bookingId, dealId: op.gosDealId, quantity: qty, source: 'migration', status: 'confirmed' } });
          }
          counters.addBooking += 1;
        } else if (op.op === 'updateBookingSeats') {
          await tx.booking.update({ where: { id: op.bookingId }, data: { seats: op.to } });
          counters.updateSeats += 1;
        } else if (op.op === 'addPayrollEntry') {
          if (!activityId) {
            const act = await tx.payrollActivity.create({ data: { sourceType: 'tour_event', tourEventId: d.tourEventId, titleHe: op.titleHe, payrollMonth: op.date.slice(0, 7), date: op.date, state: 'active' } });
            activityId = act.id;
          }
          const entry = await tx.payrollEntry.create({
            data: {
              activityId, personRefId: null, externalPersonId: `legacy:${op.recId}`,
              displayName: op.displayName, role: op.role,
              officeStatus: op.officeApproved ? 'approved' : 'draft',
              guideStatus: op.guideApproved ? 'approved' : 'pending',
              vatStatusSnapshot: op.vatMinor > 0 ? 'vat_18' : 'exempt',
              calcSnapshot: { migration: true, frozen: true, totalPreVatMinor: op.totalPreVatMinor, vatMinor: op.vatMinor, sourceRecId: op.recId, cutoverDelta: true },
              notes: op.note,
            },
          });
          await tx.payrollEntryLine.create({
            data: {
              entryId: entry.id, componentId: historicalComponentId,
              componentNameHe: 'שכר היסטורי — מערכת קודמת', sign: 1, vatMode: 'net',
              calculatedMinor: BigInt(op.totalPreVatMinor ?? 0),
              note: 'יובא מהמערכת הקודמת — ראיה מוקפאת (דלתא Cutover)',
            },
          });
          counters.addPayroll += 1;
        } else if (op.op === 'replacePayrollAmount') {
          await tx.payrollEntry.update({
            where: { id: op.entryId },
            data: {
              vatStatusSnapshot: op.vatMinor > 0 ? 'vat_18' : 'exempt',
              calcSnapshot: { migration: true, frozen: true, totalPreVatMinor: op.totalPreVatMinor, vatMinor: op.vatMinor, sourceRecId: op.recId, replacedAtCutover: true },
            },
          });
          await tx.payrollEntryLine.updateMany({
            where: { entryId: op.entryId, componentId: historicalComponentId },
            data: { calculatedMinor: BigInt(op.totalPreVatMinor ?? 0) },
          });
          counters.replacePayrollAmount += 1;
        }
      }
    });
    log(`  ✓ delta ${d.sourceRecId}: ${d.ops.length} ops`);
  }
  return counters;
}

export async function executeDealMerges(prisma, merges, { gosStageIdByKey = new Map(), log = () => {} } = {}) {
  let written = 0;
  for (const m of merges) {
    const data = {};
    for (const [f, v] of Object.entries(m.set)) {
      if (f === 'dealStageKey') data.dealStageId = gosStageIdByKey.get(v) ?? undefined;
      else if (f === 'wonAt' || f === 'lostAt') data[f] = v ? new Date(v) : null;
      else data[f] = v;
    }
    await prisma.$transaction([
      prisma.deal.update({ where: { id: m.dealId }, data }),
      ...(m.refreshCard ? [prisma.legacyRecord.updateMany({
        where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: String(m.orderNo) },
        data: { cardData: m.refreshCard },
      })] : []),
    ]);
    written += 1;
  }
  log(`  ✓ deal merges applied: ${written}`);
  return { written };
}

// Conflicts (tours + deals) become pending review rows — idempotent by subjectKey.
export async function seedCutoverConflicts(prisma, { tourConflicts = [], dealConflicts = [] } = {}) {
  let created = 0, kept = 0;
  const rows = [
    ...tourConflicts.map((c) => ({ subjectKey: `cutover:tour:${c.sourceRecId}`, proposal: { kind: c.kind, ...c } })),
    ...dealConflicts.map((c) => ({ subjectKey: `cutover:deal:${c.orderNo}`, proposal: { kind: 'deal_field_conflict', ...c } })),
  ];
  for (const r of rows) {
    const existing = await prisma.migrationDecision.findUnique({ where: { queue_subjectKey: { queue: 'exceptional', subjectKey: r.subjectKey } } });
    if (existing) { await prisma.migrationDecision.update({ where: { id: existing.id }, data: { proposal: r.proposal } }); kept += 1; }
    else { await prisma.migrationDecision.create({ data: { queue: 'exceptional', subjectKey: r.subjectKey, status: 'pending', proposal: r.proposal } }); created += 1; }
  }
  return { created, kept };
}
