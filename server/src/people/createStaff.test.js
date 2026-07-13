import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualStaffCreate,
  findDuplicatePerson,
  buildManualStaffAudit,
} from './createStaff.js';
import { isAssignableStaff } from './eligibility.js';

// Manual "+ איש צוות חדש" creation. These pin the identity/mapping invariants
// that the route (POST /api/people) relies on, without a DB: buildManualStaffCreate
// returns the exact prisma.create data, findDuplicatePerson gates duplicates,
// and the resulting person shape flows correctly through the canonical
// assignment-eligibility rule.

const FIXED = { externalPersonId: 'manual:test-uuid', portalToken: 'tok_test' };

test('creates an admin/management-owned identity (never recruitment)', () => {
  const { data, error } = buildManualStaffCreate(
    { displayName: 'דנה כהן', status: 'active', phone: '050-123-4567', email: 'Dana@Example.com' },
    FIXED,
  );
  assert.equal(error, undefined);
  // Canonical protection field: 'management' → the recruitment pull skips this
  // row and can never overwrite the manually-entered name/email/phone.
  assert.equal(data.identitySource, 'management');
  assert.match(data.externalPersonId, /^manual:/);
  assert.equal(data.displayName, 'דנה כהן');
  assert.equal(data.email, 'Dana@Example.com');
  assert.equal(data.phone, '050-123-4567');
  // A portal token is always minted (required + unique column).
  assert.ok(data.portalToken && data.portalToken.length > 0);
  // Profile is seeded 1:1 with the notes + normalized bank shape.
  assert.ok(data.profile?.create);
});

test('status → lifecycle/status/portal mapping (the three requested states)', () => {
  const active = buildManualStaffCreate({ displayName: 'א', status: 'active' }, FIXED).data;
  assert.equal(active.lifecycleHint, 'staff');
  assert.equal(active.status, 'active');
  assert.equal(active.portalEnabled, true);
  assert.ok(active.accessGrantedAt && !active.accessRevokedAt);

  const trainee = buildManualStaffCreate({ displayName: 'ב', status: 'trainee' }, FIXED).data;
  assert.equal(trainee.lifecycleHint, 'trainee');
  assert.equal(trainee.status, 'active');
  assert.equal(trainee.portalEnabled, true);

  const inactive = buildManualStaffCreate({ displayName: 'ג', status: 'inactive' }, FIXED).data;
  assert.equal(inactive.lifecycleHint, null);
  assert.equal(inactive.status, 'blocked');
  // Inactive people never keep open access.
  assert.equal(inactive.portalEnabled, false);
  assert.ok(inactive.accessRevokedAt && !inactive.accessGrantedAt);
});

test('portal eligibility is honored — a non-portal role mints a token but keeps access closed', () => {
  const noPortal = buildManualStaffCreate(
    { displayName: 'משרד', status: 'active', portalEligible: false },
    FIXED,
  ).data;
  assert.ok(noPortal.portalToken); // token still exists (required column)
  assert.equal(noPortal.portalEnabled, false);
  assert.ok(!noPortal.accessGrantedAt && noPortal.accessRevokedAt);
});

test('validation: name and status are required/checked', () => {
  assert.equal(buildManualStaffCreate({ status: 'active' }).error, 'displayName_required');
  assert.equal(buildManualStaffCreate({ displayName: '   ', status: 'active' }).error, 'displayName_required');
  assert.equal(buildManualStaffCreate({ displayName: 'x' }).error, 'invalid_status');
  assert.equal(buildManualStaffCreate({ displayName: 'x', status: 'bogus' }).error, 'invalid_status');
});

test('the created person flows correctly through the assignment-eligibility rule', () => {
  const active = buildManualStaffCreate({ displayName: 'א', status: 'active' }, FIXED).data;
  const trainee = buildManualStaffCreate({ displayName: 'ב', status: 'trainee' }, FIXED).data;
  const inactive = buildManualStaffCreate({ displayName: 'ג', status: 'inactive' }, FIXED).data;
  // active + trainee are pickable in Tour assignments; inactive is excluded.
  assert.equal(isAssignableStaff(active), true);
  assert.equal(isAssignableStaff(trainee), true);
  assert.equal(isAssignableStaff(inactive), false);
});

test('duplicate detection matches by normalized phone and case-insensitive email', () => {
  const roster = [
    { id: 'p1', displayName: 'קיים', email: 'existing@example.com', phone: '052-999-8888' },
    { id: 'p2', displayName: 'אחר', email: null, phone: '03-1112222' },
  ];
  // Same phone, different formatting → still a match.
  const byPhone = findDuplicatePerson(roster, { phone: '0529998888' });
  assert.equal(byPhone?.person.id, 'p1');
  assert.deepEqual(byPhone?.matchedOn, ['phone']);
  // Same email, different casing → still a match.
  const byEmail = findDuplicatePerson(roster, { email: 'EXISTING@example.com' });
  assert.equal(byEmail?.person.id, 'p1');
  assert.deepEqual(byEmail?.matchedOn, ['email']);
  // No overlap → no duplicate (safe to create).
  assert.equal(findDuplicatePerson(roster, { phone: '050-000-0000', email: 'new@x.com' }), null);
  // Empty inputs never match anyone.
  assert.equal(findDuplicatePerson(roster, {}), null);
});

test('audit captures identity + initial status + portal access', () => {
  const built = buildManualStaffCreate(
    { displayName: 'דנה', status: 'active', phone: '0501234567' },
    FIXED,
  );
  // Mimic the persisted row shape the route passes in.
  const person = { displayName: 'דנה', email: null, phone: '0501234567' };
  const profile = { imageUrl: null, notes: null, bankDetails: null };
  const changes = buildManualStaffAudit(person, profile, built.summary);
  const keys = changes.map((c) => c.fieldKey);
  assert.ok(keys.includes('displayName'), 'records the name');
  assert.ok(keys.includes('phone'), 'records the phone');
  assert.ok(keys.includes('lifecycleStatus'), 'records the initial status');
  assert.ok(keys.includes('portalAccess'), 'records portal access');
  const statusRow = changes.find((c) => c.fieldKey === 'lifecycleStatus');
  assert.equal(statusRow.newValue, 'active');
});
