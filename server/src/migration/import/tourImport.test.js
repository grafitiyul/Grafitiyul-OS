import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOverlap, tourStatusOf, planTourImport, checkTourExecutionGates } from './tourImport.js';

// SYNTHETIC fixtures — this repo is public.
const TODAY = '2026-07-18';
const master = (o) => ({ recId: o.id, tourId: o.tourId ?? 1, name: o.name || 'סיור', date: o.date, startTime: o.time ?? '10:00', endTime: o.end ?? null, status: o.status || 'הסתיים', legacyCalendarId: o.cal || null, cardExtras: [] });
const coordOf = (o) => ({ recId: o.id, masterRecId: o.master ?? null, legacyDealId: o.deal ?? null, guideEmail: o.email || '', guideName: o.guide || '', seats: o.seats ?? null });
const base = (over = {}) => ({ masterTours: [], coordRows: [], payrollRows: [], dealXwalk: new Map(), dealMetaByLegacyId: new Map(), personRefByEmail: new Map(), existingTourXwalk: new Map(), today: TODAY, ...over });

test('LAW 1 — Wave 1 is strictly historical: future, cancelled and postponed never import', () => {
  const r = planTourImport(base({
    masterTours: [
      master({ id: 'rPast', date: '2023-06-01', status: 'עתידי' }),   // stale status, past date → completed
      master({ id: 'rFuture', date: '2026-09-01', status: 'עתידי' }), // deferred to cutover
      master({ id: 'rCancelled', date: '2023-06-01', status: 'מבוטל' }),
      master({ id: 'rCancelledFut', date: '2026-09-01', status: 'מבוטל' }), // cancelled beats future
      master({ id: 'rPostponed', date: '2023-06-01', status: 'נדחה' }),     // never took place
    ],
  }));
  assert.equal(r.stats.create, 1);
  assert.equal(r.stats.deferredFuture, 1);
  assert.equal(r.stats.cancelledExcluded, 2, 'cancelled excluded whatever the date');
  assert.equal(r.stats.postponedExcluded, 1);
  // Population equation — the reconciliation the gates enforce.
  const s = r.stats;
  assert.equal(s.create + s.alreadyImported + s.cancelledExcluded + s.postponedExcluded + s.deferredFuture, s.masterTours);
  // Every payload is completed history.
  assert.ok(r.payloads.every((p) => p.status === 'completed' && p.completedReason === 'migration'));
});

test('LAW 2 — a cancelled tour with payroll leaves ONLY card evidence, never entities', () => {
  const r = planTourImport(base({
    masterTours: [master({ id: 'rC', date: '2023-06-01', status: 'מבוטל' })],
    payrollRows: [{ recId: 'p1', masterRecId: 'rC', guideName: 'רון', role: 'מדריך', totalPreVatMinor: 45000, vatMinor: 0, approved: true, guideApproved: false, note: '' }],
  }));
  assert.equal(r.stats.create, 0);
  assert.equal(r.stats.payrollActivities, 0, 'no activity for an excluded tour');
  assert.equal(r.stats.payrollLegacyOnlyRows, 1);
  assert.equal(r.legacyEvidence.length, 1);
  const e = r.legacyEvidence[0];
  assert.equal(e.sourceId, 'rC');
  assert.match(e.cardData[0].value, /cancelled_tour_not_migrated/);
  assert.ok(e.cardData.some((c) => /450 ₪/.test(c.value)), 'the payroll amount is preserved as evidence');
});

test('unlinked payroll rows become legacy-only evidence — never guessed onto a tour', () => {
  const r = planTourImport(base({
    masterTours: [master({ id: 'rA', date: '2023-06-01' })],
    payrollRows: [{ recId: 'pX', masterRecId: null, guideName: 'דנה', totalPreVatMinor: 30000, approved: false }],
  }));
  assert.equal(r.stats.payrollLegacyOnlyRows, 1);
  assert.equal(r.legacyEvidence[0].sourceType, 'payroll');
});

test('an included tour carries bookings/registrations/guides/payroll; kind derives from deals', () => {
  const r = planTourImport(base({
    masterTours: [
      master({ id: 'rOpen', date: '2023-06-01' }),
      master({ id: 'rBiz', date: '2023-06-02' }),
      master({ id: 'rPriv', date: '2023-06-03' }),
    ],
    coordRows: [
      coordOf({ id: 'c1', master: 'rOpen', deal: 1, seats: 4, email: 'g@x.com', guide: 'רון' }),
      coordOf({ id: 'c2', master: 'rOpen', deal: 2, seats: 6 }),
      coordOf({ id: 'c3', master: 'rBiz', deal: 3, seats: 20 }),
      coordOf({ id: 'c4', master: 'rPriv', deal: 4 }),
      coordOf({ id: 'c5', master: null, deal: 9 }), // orphan
    ],
    dealXwalk: new Map([['1', 'd1'], ['2', 'd2'], ['3', 'd3'], ['4', 'd4']]),
    dealMetaByLegacyId: new Map([[3, { activityType: 'business' }], [4, { activityType: 'private' }]]),
    payrollRows: [{ recId: 'p1', masterRecId: 'rOpen', guideName: 'רון', role: 'מדריך ראשי', totalPreVatMinor: 50000, vatMinor: 9000, approved: true, guideApproved: true }],
    personRefByEmail: new Map([['g@x.com', 'pr1']]),
  }));
  const byId = Object.fromEntries(r.payloads.map((p) => [p.sourceRecId, p]));
  assert.equal(byId.rOpen.kind, 'group_slot', 'multi-deal → open');
  assert.equal(byId.rBiz.kind, 'business');
  assert.equal(byId.rPriv.kind, 'private');
  assert.equal(r.stats.bookings, 4);
  assert.equal(r.stats.registrations, 3, 'seats>0 only');
  assert.equal(r.stats.seatsTotal, 30);
  assert.equal(r.stats.orphanCoordRows, 1);
  assert.equal(byId.rOpen.payroll[0].role, 'lead_guide');
  assert.equal(byId.rOpen.guides[0].personRefId, 'pr1');
});

test('ONE active booking per deal: same-tour duplicates merge; multi-tour deals keep the latest booking, earlier tours get registration-only evidence', () => {
  const r = planTourImport(base({
    masterTours: [
      master({ id: 'rT1', date: '2023-06-01' }),
      master({ id: 'rT2', date: '2023-06-03' }),
    ],
    coordRows: [
      // deal 1 twice on the SAME tour → one booking, seats summed, 2 registrations
      coordOf({ id: 'c1', master: 'rT1', deal: 1, seats: 4 }),
      coordOf({ id: 'c2', master: 'rT1', deal: 1, seats: 3 }),
      // deal 2 on BOTH tours → active booking on rT2 (later), rT1 registration-only
      coordOf({ id: 'c3', master: 'rT1', deal: 2, seats: 5 }),
      coordOf({ id: 'c4', master: 'rT2', deal: 2, seats: 5 }),
    ],
    dealXwalk: new Map([['1', 'd1'], ['2', 'd2']]),
  }));
  const byId = Object.fromEntries(r.payloads.map((p) => [p.sourceRecId, p]));
  const d1 = byId.rT1.bookings.find((b) => b.gosDealId === 'd1');
  assert.equal(d1.seats, 7, 'same-tour duplicate rows merge with summed seats');
  assert.deepEqual(d1.registrations, [4, 3]);
  assert.equal(r.stats.bookingsMergedRows, 1);
  assert.ok(!byId.rT1.bookings.some((b) => b.gosDealId === 'd2'), 'earlier tour loses the booking');
  assert.ok(byId.rT2.bookings.some((b) => b.gosDealId === 'd2'), 'latest tour keeps the active booking');
  assert.deepEqual(byId.rT1.extraRegistrations, [{ gosDealId: 'd2', legacyDealId: 2, registrations: [5] }]);
  assert.ok(byId.rT1.cardData.some((c) => c.label === 'הזמנה מרובת סיורים'), 'card evidence on the demoted tour');
  assert.equal(r.stats.bookingsDemotedMultiTour, 1);
  assert.equal(r.stats.bookings, 2, 'Booking rows: d1@rT1 merged + d2@rT2 only');
  // no deal ever holds two active bookings in the plan
  const activeDeals = r.payloads.flatMap((p) => p.bookings.map((b) => b.gosDealId));
  assert.equal(new Set(activeDeals).size, activeDeals.length);
});

test('the hard gates enforce hash, population equation and both laws structurally', () => {
  const plan = planTourImport(base({
    masterTours: [master({ id: 'rA', date: '2023-06-01' }), master({ id: 'rF', date: '2026-09-01', status: 'עתידי' }), master({ id: 'rC', date: '2023-01-01', status: 'מבוטל' })],
  }));
  const expected = { masterTours: 3, wave1: 1, cancelled: 1, future: 1 };
  assert.equal(checkTourExecutionGates({ plan, expectHash: plan.payloadHash, expected }).ok, true);

  for (const [label, mutate] of [
    ['hash drift', (g) => { g.expectHash = 'OTHER'; }],
    ['missing hash', (g) => { g.expectHash = null; }],
    ['wrong wave1 count', (g) => { g.expected = { ...expected, wave1: 2 }; }],
    ['wrong cancelled count', (g) => { g.expected = { ...expected, cancelled: 0 }; }],
    ['wrong future count', (g) => { g.expected = { ...expected, future: 0 }; }],
  ]) {
    const g = { plan, expectHash: plan.payloadHash, expected };
    mutate(g);
    assert.equal(checkTourExecutionGates(g).ok, false, `${label} must refuse`);
  }
  // A tampered plan smuggling a non-completed payload is refused structurally.
  const tampered = { ...plan, payloads: [...plan.payloads, { status: 'scheduled' }] };
  assert.equal(checkTourExecutionGates({ plan: tampered, expectHash: plan.payloadHash, expected }).ok, false);
});

test('DETERMINISM: identical hashes across runs, whatever the input order', () => {
  const inputs = (order) => base({ masterTours: order, coordRows: [coordOf({ id: 'c1', master: 'rA', deal: 1, seats: 3 })], dealXwalk: new Map([['1', 'd1']]) });
  const a = planTourImport(inputs([master({ id: 'rA', date: '2023-06-01' }), master({ id: 'rB', date: '2023-06-02' })]));
  const b = planTourImport(inputs([master({ id: 'rB', date: '2023-06-02' }), master({ id: 'rA', date: '2023-06-01' })]));
  assert.equal(a.payloadHash, b.payloadHash);
});

test('idempotency: an already-imported tour is skipped and still reconciles', () => {
  const r = planTourImport(base({
    masterTours: [master({ id: 'rA', date: '2023-06-01' })],
    existingTourXwalk: new Map([['rA', 'tour-live-1']]),
  }));
  assert.equal(r.stats.create, 0);
  assert.equal(r.stats.alreadyImported, 1);
  assert.equal(checkTourExecutionGates({ plan: r, expectHash: r.payloadHash, expected: { masterTours: 1, wave1: 1, cancelled: 0, future: 0 } }).ok, true);
});

test('the overlap classifier survives for the CUTOVER planner (business identity)', () => {
  const gosTours = [{ id: 'g1', date: '2026-08-01', startTime: '10:00', kind: 'group_slot', status: 'scheduled', bookedLegacyDealIds: new Set() }];
  assert.equal(classifyOverlap({ date: '2026-08-01', startTime: '10:00', isOpen: true, legacyDealIds: [] }, gosTours).kind, 'duplicate_open_slot');
  assert.equal(classifyOverlap({ date: '2026-08-01', startTime: '12:00', isOpen: true, legacyDealIds: [] }, gosTours).kind, 'coincidental_date');
  assert.equal(tourStatusOf({ status: 'עתידי', date: '2023-05-01', today: TODAY }), 'completed');
});
