import test from 'node:test';
import assert from 'node:assert/strict';
import { detectorCatalogue, undocumentedIssueTypes, issueTypeDef } from './registry.js';
import './detectors/index.js';
import { registerMirrorIssueTypes } from '../mirror/register.js';

// בקרה is only useful if every bubble on it can be explained. These guards make
// "there are bubbles whose purpose is unclear" a test failure rather than a
// product complaint.

test('every registered detector documents itself', () => {
  const undocumented = undocumentedIssueTypes();
  assert.deepEqual(
    undocumented, [],
    `these issue types have no labelHe/purposeHe: ${undocumented.join(', ')}`,
  );
});

test('the detector catalogue explains what raises each issue and what closes it', () => {
  const cat = detectorCatalogue();
  assert.ok(cat.length >= 10, `expected the full detector set, got ${cat.length}`);
  for (const d of cat) {
    assert.ok(d.labelHe && d.labelHe !== d.type, `${d.type} has no human label`);
    assert.ok(d.purposeHe?.length > 20, `${d.type} has no real explanation`);
    assert.ok(d.fixHe?.length > 10, `${d.type} does not say what makes it go away`);
  }
});

test('the retired legacy issue types are NOT registered', () => {
  // Both belonged to the mirror period. GOS is now the single source of truth,
  // and the mirror no longer runs — so these could never auto-resolve either.
  registerMirrorIssueTypes();
  assert.equal(issueTypeDef('legacy_sync_conflict'), null);
  assert.equal(issueTypeDef('legacy_tour_product_unmatched'), null);
  assert.equal(
    detectorCatalogue().some((d) => d.type.startsWith('legacy_')), false,
    'no legacy detector may appear in the catalogue',
  );
});

test('the real detectors survive the cleanup', () => {
  // The measured production truth on 2026-08-01: deal_tour_out_of_sync was
  // actively re-deriving. Removing it would have hidden a live problem.
  const types = detectorCatalogue().map((d) => d.type);
  for (const kept of [
    'deal_tour_out_of_sync', 'gallery_cleanup_approval', 'whatsapp_scheduled_stuck',
    'held_reservation_expired', 'tour_over_capacity', 'reservation_stuck',
    'reservation_link_abuse', 'woo_sync_failed', 'open_tour_generation_failed',
    'tour_change_impact',
  ]) {
    assert.ok(types.includes(kept), `${kept} must stay registered`);
  }
});
