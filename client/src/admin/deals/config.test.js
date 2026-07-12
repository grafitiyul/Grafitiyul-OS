// Regression tests — the Deal header must always reflect the CANONICAL
// classification: the linked Organization's type when an org is attached,
// the deal's own manual type only when it has none.
// Plain node:test (no JSX) — run with `npm test` in client/.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveOrgTypeId,
  effectiveOrgTypeLabel,
  resolveActivityLabel,
} from './config.js';

const orgDeal = (over = {}) => ({
  activityType: 'business',
  organizationTypeId: null, // force-nulled by the API for org-linked deals
  organizationType: null,
  organization: {
    id: 'org1',
    name: 'עיריית תל אביב',
    organizationTypeId: 'municipality',
    organizationType: { id: 'municipality', label: 'רשות מקומית' },
  },
  ...over,
});

test('org-linked deal → effective type is the ORGANIZATION type', () => {
  assert.equal(effectiveOrgTypeId(orgDeal()), 'municipality');
  assert.equal(effectiveOrgTypeLabel(orgDeal()), 'רשות מקומית');
});

test('stale deal-level type never contradicts the linked organization', () => {
  // Bug #2 regression: manual "בית ספר" pick left on the deal, then an org of
  // another type attached — the header must show the ORG type, not the stale one.
  const stale = orgDeal({
    organizationTypeId: 'school',
    organizationType: { id: 'school', label: 'בית ספר' },
  });
  assert.equal(effectiveOrgTypeId(stale), 'municipality');
  assert.equal(effectiveOrgTypeLabel(stale), 'רשות מקומית');
});

test('replacing the organization immediately changes the effective type', () => {
  const replaced = orgDeal({
    organization: {
      id: 'org2',
      name: 'בי״ס יסודי',
      organizationTypeId: 'school',
      organizationType: { id: 'school', label: 'בית ספר' },
    },
  });
  assert.equal(effectiveOrgTypeId(replaced), 'school');
  assert.equal(effectiveOrgTypeLabel(replaced), 'בית ספר');
});

test('org linked but typeless → no effective type (stale deal value stays dead)', () => {
  const typeless = orgDeal({
    organization: { id: 'org3', name: 'X', organizationTypeId: null, organizationType: null },
    organizationTypeId: 'school',
    organizationType: { id: 'school', label: 'בית ספר' },
  });
  assert.equal(effectiveOrgTypeId(typeless), null);
  assert.equal(effectiveOrgTypeLabel(typeless), null);
});

test('no organization → the deal-level manual type applies', () => {
  const manual = {
    activityType: 'business',
    organization: null,
    organizationTypeId: 'producers',
    organizationType: { id: 'producers', label: 'מפיקים' },
  };
  assert.equal(effectiveOrgTypeId(manual), 'producers');
  assert.equal(effectiveOrgTypeLabel(manual), 'מפיקים');
});

test('header badge text follows the canonical effective type', () => {
  const label = resolveActivityLabel({
    activityType: 'business',
    orgTypeLabel: effectiveOrgTypeLabel(orgDeal()),
    subtypeLabel: null,
  });
  assert.equal(label, 'רשות מקומית');
  // Business with no effective type falls back to the broad "עסקי".
  assert.equal(
    resolveActivityLabel({ activityType: 'business', orgTypeLabel: null, subtypeLabel: null }),
    'עסקי',
  );
});
