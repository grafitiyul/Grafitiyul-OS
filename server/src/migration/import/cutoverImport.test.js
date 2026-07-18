import test from 'node:test';
import assert from 'node:assert/strict';
import { planFutureTours, planImportedTourDelta, planDealDelta, buildCutoverPlan, checkCutoverGates } from './cutoverImport.js';

// SYNTHETIC fixtures — this repo is public.
const FREEZE = '2026-07-25';
const master = (o) => ({ recId: o.id, tourId: o.tourId ?? 1, name: o.name || 'סיור', date: o.date, startTime: o.time ?? '10:00', endTime: null, status: o.status || 'עתידי', legacyCalendarId: o.cal || null, cardExtras: [] });
const coordOf = (o) => ({ recId: o.id, masterRecId: o.master ?? null, legacyDealId: o.deal ?? null, guideEmail: o.email || '', guideName: o.guide || '', seats: o.seats ?? null });

test('future tours: only future-at-freeze import, as scheduled operational tours; kinds derive from deals', () => {
  const r = planFutureTours({
    masterTours: [
      master({ id: 'rPast', date: '2026-07-20' }),               // before freeze → not future
      master({ id: 'rFut', date: '2026-08-01' }),
      master({ id: 'rFutCancel', date: '2026-08-02', status: 'מבוטל' }), // cancelled never imports
      master({ id: 'rBiz', date: '2026-08-03' }),
    ],
    coordRows: [
      coordOf({ id: 'c1', master: 'rFut', deal: 1, seats: 5, email: 'g@x.com', guide: 'רון' }),
      coordOf({ id: 'c2', master: 'rBiz', deal: 3, seats: 20 }),
    ],
    dealXwalk: new Map([['1', 'd1'], ['3', 'd3']]),
    dealMetaByLegacyId: new Map([[3, { activityType: 'business' }]]),
    personRefByEmail: new Map([['g@x.com', 'pr1']]),
    freezeDate: FREEZE,
  });
  assert.equal(r.stats.future, 2, 'cancelled and past are not future');
  assert.equal(r.stats.create, 2);
  assert.ok(r.payloads.every((p) => p.status === 'scheduled' && p.date >= FREEZE));
  const byId = Object.fromEntries(r.payloads.map((p) => [p.sourceRecId, p]));
  assert.equal(byId.rBiz.kind, 'business');
  assert.equal(byId.rFut.kind, 'private');
  assert.equal(byId.rFut.guides[0].personRefId, 'pr1');
});

test('future tours: a deal already actively booked in GOS gets registration-only; within the plan the EARLIEST tour claims the booking', () => {
  const r = planFutureTours({
    masterTours: [
      master({ id: 'rA', date: '2026-08-10' }),
      master({ id: 'rB', date: '2026-08-01' }), // earlier — should claim deal 2
      master({ id: 'rC', date: '2026-08-05' }),
    ],
    coordRows: [
      coordOf({ id: 'c1', master: 'rA', deal: 2, seats: 4 }),
      coordOf({ id: 'c2', master: 'rB', deal: 2, seats: 4 }),
      coordOf({ id: 'c3', master: 'rC', deal: 9, seats: 3 }), // deal 9 already active in GOS
    ],
    dealXwalk: new Map([['2', 'd2'], ['9', 'd9']]),
    activeBookingDealIds: new Set(['d9']),
    freezeDate: FREEZE,
  });
  const byId = Object.fromEntries(r.payloads.map((p) => [p.sourceRecId, p]));
  assert.equal(byId.rB.bookings.length, 1, 'earliest future tour claims the active booking');
  assert.equal(byId.rA.bookings.length, 0);
  assert.equal(byId.rA.registrationOnly.length, 1, 'later tour keeps seat evidence only');
  assert.equal(byId.rC.bookings.length, 0, 'deal already active in GOS is never double-booked');
  assert.equal(byId.rC.registrationOnly[0].gosDealId, 'd9');
  assert.ok(byId.rC.cardData.some((c) => c.label === 'הזמנה קיימת לדיל'));
});

test('duplicate re-evaluation: an open future tour matching a native GOS slot (date+time) REDIRECTS — the twin is never created', () => {
  const r = planFutureTours({
    masterTours: [master({ id: 'rOpen', date: '2026-08-01', time: '10:00' })],
    coordRows: [
      coordOf({ id: 'c1', master: 'rOpen', deal: 1, seats: 2 }),
      coordOf({ id: 'c2', master: 'rOpen', deal: 2, seats: 3 }),
    ],
    dealXwalk: new Map([['1', 'd1'], ['2', 'd2']]),
    nativeSlots: [{ id: 'native1', date: '2026-08-01', startTime: '10:00', status: 'scheduled' }],
    freezeDate: FREEZE,
  });
  assert.equal(r.stats.create, 0);
  assert.equal(r.stats.redirectedToNative, 1);
  assert.equal(r.redirects[0].nativeTourEventId, 'native1');
  assert.equal(r.redirects[0].bookings.length, 2, 'twin bookings redirect into the native slot');
});

test('imported-tour delta: additive/replace only — new payroll appends, changed amount replaces, seats update; retro-cancellation is a CONFLICT', () => {
  const importedState = new Map([
    ['rT1', {
      tourEventId: 'te1', activityId: 'act1',
      bookings: new Map([['d1', { id: 'b1', seats: 4 }]]),
      payroll: new Map([['p1', { entryId: 'e1', totalPreVatMinor: 40000, vatMinor: 0 }]]),
    }],
    ['rT2', { tourEventId: 'te2', activityId: null, bookings: new Map(), payroll: new Map() }],
  ]);
  const r = planImportedTourDelta({
    masterTours: [
      master({ id: 'rT1', date: '2023-06-01', status: 'הסתיים' }),
      master({ id: 'rT2', date: '2023-06-02', status: 'מבוטל' }), // retro-cancelled Wave-1 tour!
      master({ id: 'rNew', date: '2026-08-01' }),                  // not imported — ignored here
    ],
    coordRows: [
      coordOf({ id: 'c1', master: 'rT1', deal: 1, seats: 6 }),  // seats 4 → 6
      coordOf({ id: 'c2', master: 'rT1', deal: 2, seats: 3 }),  // new booking
    ],
    payrollRows: [
      { recId: 'p1', masterRecId: 'rT1', guideName: 'רון', role: 'מדריך', totalPreVatMinor: 45000, vatMinor: 0, approved: true, guideApproved: false, note: '' }, // 400→450
      { recId: 'p2', masterRecId: 'rT1', guideName: 'דנה', role: 'עוזרת סדנה', totalPreVatMinor: 30000, vatMinor: 5400, approved: false, guideApproved: false, note: '' }, // new
    ],
    dealXwalk: new Map([['1', 'd1'], ['2', 'd2']]),
    importedState,
    freezeDate: FREEZE,
  });
  assert.equal(r.stats.updateSeats, 1);
  assert.equal(r.stats.addBooking, 1);
  assert.equal(r.stats.replacePayrollAmount, 1);
  assert.equal(r.stats.addPayroll, 1);
  const ops = r.deltas.find((d) => d.sourceRecId === 'rT1').ops;
  assert.equal(ops.find((o) => o.op === 'addPayrollEntry').role, 'workshop_assistant');
  assert.equal(r.stats.cancelledConflicts, 1, 'retro-cancellation never mutates automatically');
  assert.equal(r.conflicts[0].kind, 'imported_tour_cancelled_in_source');
  assert.ok(!r.deltas.some((d) => d.sourceRecId === 'rT2'));
});

test('deal delta three-way: source-changed + GOS-untouched merges; source-changed + GOS-edited conflicts; GOS edits alone are never touched', () => {
  const base = { title: 'סיור', status: 'open', dealStageKey: 'quote', valueMinor: 100000, currency: 'ILS', wonAt: null, lostAt: null, lostReason: null, expectedCloseDate: null, tourDate: '2026-08-01', tourTime: null, participants: 20 };
  const r = planDealDelta({
    snap1ByOrderNo: new Map([[100, base], [200, base], [300, base]]),
    finalByOrderNo: new Map([
      [100, { ...base, status: 'won', dealStageKey: 'closing', wonAt: '2026-07-20T10:00:00Z' }], // source won it
      [200, { ...base, valueMinor: 120000 }],                                                    // source changed value
      [300, base],                                                                               // source unchanged
      [999, { ...base }],                                                                        // new deal — not delta's job
    ]),
    gosByOrderNo: new Map([
      [100, { ...base }],                        // GOS untouched → merge
      [200, { ...base, valueMinor: 150000 }],    // GOS ALSO edited value → conflict
      [300, { ...base, title: 'שם חדש ב-GOS' }], // GOS-only edit, source unchanged → untouched
    ]),
    existingDealXwalk: new Map([['100', 'deal-100'], ['200', 'deal-200'], ['300', 'deal-300']]),
  });
  assert.equal(r.stats.merges, 1);
  assert.deepEqual(Object.keys(r.merges[0].set).sort(), ['dealStageKey', 'status', 'wonAt']);
  assert.equal(r.stats.conflicts, 1);
  assert.equal(r.conflicts[0].orderNo, 200);
  assert.equal(r.conflicts[0].fields[0].field, 'valueMinor');
  assert.ok(!r.merges.some((m) => m.orderNo === 300), 'a GOS edit with an unchanged source is sacred');
});

test('Hash B: deterministic over the whole plan; gates refuse drift and structural violations', () => {
  const historical = { payloads: [{ status: 'completed', sourceRecId: 'h1' }], legacyEvidence: [] };
  const future = { payloads: [{ status: 'scheduled', date: '2026-08-01', sourceRecId: 'f1' }], redirects: [] };
  const tourDelta = { deltas: [], conflicts: [] };
  const dealDelta = { merges: [], conflicts: [] };
  const a = buildCutoverPlan({ historical, future, tourDelta, dealDelta });
  const b = buildCutoverPlan({ historical, future, tourDelta, dealDelta });
  assert.equal(a.payloadHash, b.payloadHash);

  assert.equal(checkCutoverGates({ plan: a, expectHash: a.payloadHash, freezeDate: FREEZE }).ok, true);
  assert.equal(checkCutoverGates({ plan: a, expectHash: 'OTHER', freezeDate: FREEZE }).ok, false);
  assert.equal(checkCutoverGates({ plan: a, expectHash: null, freezeDate: FREEZE }).ok, false);
  const tamperedFuture = buildCutoverPlan({ historical, future: { payloads: [{ status: 'scheduled', date: '2026-07-01', sourceRecId: 'f1' }], redirects: [] }, tourDelta, dealDelta });
  assert.equal(checkCutoverGates({ plan: tamperedFuture, expectHash: tamperedFuture.payloadHash, freezeDate: FREEZE }).ok, false, 'a pre-freeze "future" tour must refuse');
  const tamperedHist = buildCutoverPlan({ historical: { payloads: [{ status: 'scheduled' }], legacyEvidence: [] }, future, tourDelta, dealDelta });
  assert.equal(checkCutoverGates({ plan: tamperedHist, expectHash: tamperedHist.payloadHash, freezeDate: FREEZE }).ok, false, 'a non-completed historical payload must refuse');
});
