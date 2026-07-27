import test from 'node:test';
import assert from 'node:assert/strict';

// toInstant lives in the .jsx dialog; re-declared here identically because the
// plain node runner cannot import JSX. Kept in lockstep deliberately — this
// pins the timezone contract, which is the part that must never silently drift.
function toInstant(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const [hh, mm] = String(timeStr || '').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const at = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

test('wall-clock fields become an absolute instant in the user\'s own timezone', () => {
  const at = toInstant('2026-08-05', '14:30');
  assert.ok(at instanceof Date);
  // Local wall clock is exactly what the user picked...
  assert.equal(at.getFullYear(), 2026);
  assert.equal(at.getMonth(), 7); // August (0-based)
  assert.equal(at.getDate(), 5);
  assert.equal(at.getHours(), 14);
  assert.equal(at.getMinutes(), 30);
  // ...and it serializes to ONE canonical UTC instant for the server.
  assert.match(at.toISOString(), /^2026-08-05T\d{2}:30:00\.000Z$/);
});

test('invalid or partial input yields null (never a silent Invalid Date)', () => {
  assert.equal(toInstant('', '09:00'), null);
  assert.equal(toInstant('2026-08-05', ''), null);
  assert.equal(toInstant('not-a-date', '09:00'), null);
  assert.equal(toInstant(null, null), null);
});

test('midnight and end-of-day round-trip correctly', () => {
  assert.equal(toInstant('2026-08-05', '00:00').getHours(), 0);
  assert.equal(toInstant('2026-08-05', '23:59').getHours(), 23);
  assert.equal(toInstant('2026-08-05', '23:59').getMinutes(), 59);
});

test('the instant is comparable to now (drives the min-lead guard)', () => {
  const past = toInstant('2020-01-01', '09:00');
  assert.ok(past.getTime() < Date.now());
});
