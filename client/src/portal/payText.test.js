import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingLabel } from './payText.js';

// The waiting summary card shows an ACTIVITY COUNT, never an unapproved
// amount — with correct Hebrew singular/plural.

test('waitingLabel: zero / singular / plural Hebrew forms', () => {
  assert.equal(waitingLabel(0), 'אין פעילויות הממתינות לאישורך');
  assert.equal(waitingLabel(1), 'פעילות אחת ממתינה לאישורך');
  assert.equal(waitingLabel(3), '3 פעילויות ממתינות לאישורך');
});
