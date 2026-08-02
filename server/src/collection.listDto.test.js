import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionDeals } from './collection.js';

// The work-queue list DTO shipped selecting ProductVariant.nameHe and
// TourAssignment.person — neither field exists, so Prisma rejected the whole
// query and the Collection screen was empty in production. Unit tests never saw
// it because nothing exercised the query shape.
//
// This runs collectionDeals against a double that ASSERTS the selected shape,
// which is what makes a phantom field fail here instead of on the live screen.

function dbAsserting(onArgs) {
  return {
    deal: {
      findMany: async (args) => {
        onArgs(args);
        return [];
      },
    },
    icountDocument: { findMany: async () => [] },
    dealCollectionEvidence: { findMany: async () => [] },
  };
}

// The fields each relation legitimately has. Selecting anything else is the bug.
const ALLOWED = {
  organization: ['id', 'name'],
  organizationUnit: ['id', 'name'],
  product: ['id', 'nameHe'],
  productVariant: ['id', 'location'],
  location: ['id', 'nameHe'],
};

test('every relation the list DTO selects uses fields that exist', async () => {
  let seen = null;
  await collectionDeals(dbAsserting((a) => { seen = a; }), {});
  for (const [rel, allowed] of Object.entries(ALLOWED)) {
    const sel = seen.include[rel]?.select;
    assert.ok(sel, `${rel} must be included`);
    for (const key of Object.keys(sel)) {
      assert.ok(allowed.includes(key), `${rel}.${key} is not a real field (allowed: ${allowed.join(', ')})`);
    }
  }
});

test('the guide is read through personRef, not a non-existent `person` relation', async () => {
  let seen = null;
  await collectionDeals(dbAsserting((a) => { seen = a; }), {});
  const asg = seen.include.bookings.select.tourEvent.select.assignments.select;
  assert.ok(asg.personRef, 'assignments must select personRef');
  assert.equal(asg.person, undefined, 'TourAssignment has no `person` relation');
});

test('reviewStatus narrows the query and null returns the whole accounting picture', async () => {
  let seen = null;
  await collectionDeals(dbAsserting((a) => { seen = a; }), { reviewStatus: 'active_collection' });
  assert.equal(seen.where.collectionReviewStatus, 'active_collection');
  assert.equal(seen.where.status, 'won');

  await collectionDeals(dbAsserting((a) => { seen = a; }), {});
  assert.equal('collectionReviewStatus' in seen.where, false);
  assert.equal(seen.where.status, 'won'); // still WON-only — unchanged behaviour
});
