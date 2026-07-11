import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuidePermissions,
  guideVisibleTourWhere,
  resolveGuidePortalAccess,
  resolveGuideTourAccess,
} from './access.js';
import {
  guideParticipantDto,
  guideTourDetailDto,
  guideTourCardDto,
  tourEndMs,
} from './dto.js';

// Guide Portal enforcement layer — permissions come from the server, DTOs
// whitelist fields. UI hiding is never the gate.

const ALL_ON = {
  viewTeam: true,
  viewParticipantPhone: true,
  viewParticipantEmail: true,
  viewCustomerInfo: true,
  viewFieldRep: true,
  fillTourSummary: true,
  useTourGallery: true,
  useCoordinationForms: true,
  viewPay: true,
  viewProcedures: true,
  viewTraining: true,
  editPersonalProfile: true,
};

function fakeClient({
  person = null,
  tour = null,
  assignment = null,
  settings = ALL_ON,
  gallerySettings = { guideCanDelete: true, guideCanShareCustomerLink: true },
} = {}) {
  return {
    personRef: { findUnique: async () => person },
    tourEvent: { findUnique: async () => tour },
    tourAssignment: { findFirst: async () => assignment },
    guidePortalSettings: {
      findUnique: async () => ({ id: 'singleton', ...settings }),
      upsert: async () => ({ id: 'singleton', ...settings }),
    },
    tourGallerySettings: {
      findUnique: async () => ({ id: 'singleton', ...gallerySettings }),
      upsert: async () => ({ id: 'singleton', ...gallerySettings }),
    },
  };
}

const GUIDE = {
  id: 'p1',
  externalPersonId: 'ext1',
  displayName: 'דנה',
  portalEnabled: true,
  status: 'active',
};

// ── access ──────────────────────────────────────────────────────────

test('unknown token → 404 (no enumeration signal)', async () => {
  const res = await resolveGuidePortalAccess(fakeClient(), { portalToken: 'nope' });
  assert.deepEqual(res, { ok: false, status: 404, error: 'not_found' });
});

test('disabled portal / blocked person → 403', async () => {
  for (const person of [
    { ...GUIDE, portalEnabled: false },
    { ...GUIDE, status: 'blocked' },
  ]) {
    const res = await resolveGuidePortalAccess(fakeClient({ person }), {
      portalToken: 'tok',
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
  }
});

test('valid token resolves person + merged permissions (gallery SSOT)', async () => {
  const client = fakeClient({
    person: GUIDE,
    gallerySettings: { guideCanDelete: false, guideCanShareCustomerLink: true },
  });
  const res = await resolveGuidePortalAccess(client, { portalToken: 'tok' });
  assert.equal(res.ok, true);
  assert.equal(res.permissions.viewTeam, true);
  assert.equal(res.permissions.deleteGalleryMedia, false);
  assert.equal(res.permissions.shareGalleryCustomerLink, true);
});

test('tour access requires an assignment on THIS tour', async () => {
  const client = fakeClient({
    person: GUIDE,
    tour: { id: 't1', status: 'scheduled' },
    assignment: null,
  });
  const res = await resolveGuideTourAccess(client, {
    portalToken: 'tok',
    tourEventId: 't1',
  });
  assert.deepEqual(
    { ok: res.ok, status: res.status, error: res.error },
    { ok: false, status: 403, error: 'not_assigned' },
  );
});

test('REVOCATION: removed assignment blocks the tour in EVERY state — no historical access', async () => {
  // Assignment row hard-deleted by the admin → findFirst returns null. The
  // guide must get 403 for scheduled, completed (past) and cancelled tours
  // alike, direct URLs included. Cancelled tours 403 on status BEFORE the
  // assignment lookup (they are invisible to guides regardless).
  for (const [status, error] of [
    ['scheduled', 'not_assigned'],
    ['completed', 'not_assigned'],
    ['cancelled', 'tour_cancelled'],
  ]) {
    const client = fakeClient({
      person: GUIDE,
      tour: { id: 't1', status },
      assignment: null,
    });
    const res = await resolveGuideTourAccess(client, {
      portalToken: 'tok',
      tourEventId: 't1',
    });
    assert.deepEqual(
      { ok: res.ok, status: res.status, error: res.error },
      { ok: false, status: 403, error },
      `tour status=${status} must be blocked after removal`,
    );
  }
});

test('cancelled tour is INVISIBLE to guides — 403 even with a live assignment', async () => {
  // Product decision (2026-07): deal-reopen auto-cancels the tour but keeps
  // the assignment rows for plan restore. Those rows must not grant access.
  const client = fakeClient({
    person: GUIDE,
    tour: { id: 't1', status: 'cancelled' },
    assignment: { id: 'a1', role: 'guide' },
  });
  const res = await resolveGuideTourAccess(client, {
    portalToken: 'tok',
    tourEventId: 't1',
  });
  assert.deepEqual(
    { ok: res.ok, status: res.status, error: res.error },
    { ok: false, status: 403, error: 'tour_cancelled' },
  );
});

test('postponed tour is hidden from guides until rescheduled — 403 with a live assignment', async () => {
  // The assignment stays (visibility returns the moment a new date is
  // applied), but while the tour has no active date the portal shows nothing.
  const client = fakeClient({
    person: GUIDE,
    tour: { id: 't1', status: 'postponed' },
    assignment: { id: 'a1', role: 'guide' },
  });
  const res = await resolveGuideTourAccess(client, {
    portalToken: 'tok',
    tourEventId: 't1',
  });
  assert.deepEqual(
    { ok: res.ok, status: res.status, error: res.error },
    { ok: false, status: 403, error: 'tour_postponed' },
  );
});

test('feed where-clause excludes cancelled AND postponed (twin of the detail rule)', () => {
  assert.deepEqual(guideVisibleTourWhere(), { status: { notIn: ['cancelled', 'postponed'] } });
});

test('buildGuidePermissions maps every settings switch', () => {
  const perms = buildGuidePermissions(
    { ...ALL_ON, viewPay: false },
    { guideCanDelete: true, guideCanShareCustomerLink: false },
  );
  assert.equal(perms.viewPay, false);
  assert.equal(perms.deleteGalleryMedia, true);
  assert.equal(perms.shareGalleryCustomerLink, false);
  // "סיורי עבר" is a permanent tab — past-tour visibility is NOT a permission.
  assert.equal('viewPastTours' in perms, false);
});

// ── DTOs ────────────────────────────────────────────────────────────

const BOOKING = {
  id: 'b1',
  status: 'active',
  seats: 25,
  deal: {
    orderNo: 27042,
    title: 'סיור לחברת ABC',
    customerInfo: '<p>אלרגיה לבוטנים</p>',
    organization: { name: 'חברת ABC' },
    organizationUnit: null,
    contacts: [
      {
        isPrimary: true,
        roles: [],
        contact: {
          firstNameHe: 'יעל',
          lastNameHe: 'כהן',
          phones: [{ value: '050-1234567' }],
          emails: [{ value: 'yael@abc.co.il' }],
        },
      },
      {
        isPrimary: false,
        roles: ['fieldRep'],
        contact: { firstNameHe: 'רון', lastNameHe: 'לוי', phones: [], emails: [] },
      },
    ],
  },
};

test('participant DTO exposes operational fields only — no deal id', () => {
  const dto = guideParticipantDto(BOOKING, ALL_ON);
  assert.equal(dto.title, 'חברת ABC'); // org wins over customer name
  assert.equal(dto.customerName, 'יעל כהן');
  assert.equal(dto.orderNo, 27042);
  assert.equal(dto.phone, '050-1234567');
  assert.equal(dto.email, 'yael@abc.co.il');
  assert.equal(dto.fieldRepName, 'רון לוי');
  assert.equal(dto.customerInfo, '<p>אלרגיה לבוטנים</p>');
  assert.equal('deal' in dto, false);
  assert.equal('dealId' in dto, false);
});

test('participant DTO respects permission switches', () => {
  const dto = guideParticipantDto(BOOKING, {
    ...ALL_ON,
    viewParticipantPhone: false,
    viewParticipantEmail: false,
    viewCustomerInfo: false,
    viewFieldRep: false,
  });
  assert.equal(dto.phone, null);
  assert.equal(dto.email, null);
  assert.equal(dto.customerInfo, null);
  assert.equal(dto.fieldRepName, null);
  assert.equal(dto.seats, 25); // participant count is always operational
});

test('coordination status rides the DTO only when the permission is on', () => {
  const withStatus = guideParticipantDto(BOOKING, ALL_ON, { coordinationStatus: 'draft' });
  assert.equal(withStatus.coordinationStatus, 'draft');
  const off = guideParticipantDto(
    BOOKING,
    { ...ALL_ON, useCoordinationForms: false },
    { coordinationStatus: 'draft' },
  );
  assert.equal(off.coordinationStatus, null);
});

test('detail DTO stamps coordination status per booking', () => {
  const dto = guideTourDetailDto({
    tour: TOUR,
    assignment: null,
    occupancy: null,
    permissions: ALL_ON,
    coordinationStatusByBooking: { b1: 'submitted' },
  });
  assert.equal(dto.participants[0].coordinationStatus, 'submitted');
});

test('participant title falls back to customer name without an organization', () => {
  const noOrg = {
    ...BOOKING,
    deal: { ...BOOKING.deal, organization: null },
  };
  assert.equal(guideParticipantDto(noOrg, ALL_ON).title, 'יעל כהן');
});

const TOUR = {
  id: 't1',
  kind: 'business',
  status: 'scheduled',
  date: '2026-07-20',
  startTime: '10:00',
  tourLanguage: 'he',
  notes: null,
  product: { nameHe: 'סיור גרפיטי' },
  location: { nameHe: 'פלורנטין' },
  productVariant: { durationHours: 2, location: { nameHe: 'פלורנטין' } },
  assignments: [
    {
      id: 'a1',
      displayName: 'דנה',
      role: 'lead_guide',
      personRef: { profile: { imageUrl: '/api/media/x' } },
    },
  ],
  activityComponents: [
    {
      id: 'c1',
      activityComponent: { nameHe: 'סדנת גרפיטי', icon: '🎨', color: 'emerald', isWorkshop: true },
      workshopLocation: { nameHe: 'גג הסטודיו', address: 'רח׳ העם 1', instructions: null },
    },
  ],
  bookings: [BOOKING, { ...BOOKING, id: 'b2', status: 'cancelled' }],
};

test('tour detail DTO — full shape, cancelled bookings dropped', () => {
  const dto = guideTourDetailDto({
    tour: TOUR,
    assignment: { role: 'lead_guide' },
    occupancy: { activeSeats: 25, activeBookings: 1 },
    permissions: ALL_ON,
  });
  assert.equal(dto.variantName, 'סיור גרפיטי · פלורנטין');
  assert.equal(dto.activityType, 'business');
  assert.equal(dto.participantsTotal, 25);
  assert.equal(dto.viewerRole, 'lead_guide');
  assert.equal(dto.team.length, 1);
  assert.equal(dto.team[0].imageUrl, '/api/media/x');
  assert.equal(dto.components[0].workshopLocation.nameHe, 'גג הסטודיו');
  assert.equal(dto.participants.length, 1); // cancelled booking dropped
});

test('tour detail DTO hides team when viewTeam is off', () => {
  const dto = guideTourDetailDto({
    tour: TOUR,
    assignment: null,
    occupancy: null,
    permissions: { ...ALL_ON, viewTeam: false },
  });
  assert.equal(dto.team, null);
});

test('tour card DTO — operational card fields', () => {
  const dto = guideTourCardDto({
    tour: TOUR,
    assignment: { role: 'guide' },
    occupancy: { activeSeats: 25 },
  });
  assert.equal(dto.variantName, 'סיור גרפיטי · פלורנטין');
  assert.equal(dto.participantsTotal, 25);
  assert.equal(dto.role, 'guide');
  assert.equal(dto.activityType, 'business');
});

test('tourEndMs — end = start + variant duration (fallback 3h)', () => {
  const end = tourEndMs(TOUR);
  assert.equal(end, Date.parse('2026-07-20T10:00:00') + 2 * 3600 * 1000);
  const noDuration = { ...TOUR, productVariant: null };
  assert.equal(
    tourEndMs(noDuration),
    Date.parse('2026-07-20T10:00:00') + 3 * 3600 * 1000,
  );
  assert.ok(Number.isNaN(tourEndMs({ date: null, startTime: null })));
});
