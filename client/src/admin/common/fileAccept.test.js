import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAccept, pickAcceptedFiles } from './fileAccept.js';

// Minimal stand-in for a browser File — pickAcceptedFiles only reads
// .type / .name / .size, so this is a faithful test double.
const f = (name, type, size = 100) => ({ name, type, size });

test('matchesAccept: image/* wildcard matches any image mime', () => {
  assert.equal(matchesAccept(f('a.png', 'image/png'), 'image/*'), true);
  assert.equal(matchesAccept(f('a.webp', 'image/webp'), 'image/*'), true);
  assert.equal(matchesAccept(f('a.pdf', 'application/pdf'), 'image/*'), false);
});

test('matchesAccept: exact mime + extension rules', () => {
  assert.equal(matchesAccept(f('doc.pdf', 'application/pdf'), 'application/pdf'), true);
  assert.equal(matchesAccept(f('doc.pdf', ''), '.pdf'), true, 'extension fallback when mime missing');
  assert.equal(matchesAccept(f('img.png', 'image/png'), 'image/jpeg,image/png,image/webp'), true);
  assert.equal(matchesAccept(f('img.gif', 'image/gif'), 'image/jpeg,image/png,image/webp'), false);
});

test('matchesAccept: empty/wildcard accept takes anything', () => {
  assert.equal(matchesAccept(f('x.bin', 'application/octet-stream'), ''), true);
  assert.equal(matchesAccept(f('x.bin', 'application/octet-stream'), '*/*'), true);
});

// Check #1: a dropped file goes through the SAME validation the picker uses.
// Both the drop path and the picker path call pickAcceptedFiles, so proving it
// here proves parity.
test('pickAcceptedFiles: valid image is accepted (picker == drop path)', () => {
  const { accepted, rejected } = pickAcceptedFiles([f('meeting.jpg', 'image/jpeg')], { accept: 'image/*' });
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].name, 'meeting.jpg');
});

// Check #2: invalid types are rejected clearly (reason surfaced to the caller).
test('pickAcceptedFiles: wrong type is rejected with reason "type"', () => {
  const { accepted, rejected } = pickAcceptedFiles([f('notes.pdf', 'application/pdf')], { accept: 'image/*' });
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'type');
});

test('pickAcceptedFiles: single mode keeps only the first file', () => {
  const { accepted } = pickAcceptedFiles([f('a.png', 'image/png'), f('b.png', 'image/png')], {
    accept: 'image/*',
    multiple: false,
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, 'a.png');
});

test('pickAcceptedFiles: multiple mode splits accepted vs rejected across the batch', () => {
  const batch = [f('a.png', 'image/png'), f('bad.txt', 'text/plain'), f('b.webp', 'image/webp')];
  const { accepted, rejected } = pickAcceptedFiles(batch, { accept: 'image/*', multiple: true });
  assert.deepEqual(accepted.map((x) => x.name), ['a.png', 'b.webp']);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'type');
});

test('pickAcceptedFiles: oversize file rejected with reason "size"', () => {
  const { accepted, rejected } = pickAcceptedFiles([f('huge.png', 'image/png', 10_000)], {
    accept: 'image/*',
    maxBytes: 5_000,
  });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, 'size');
});
