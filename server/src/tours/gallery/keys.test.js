import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveKey,
  galleryPrefix,
  originalKey,
  posterKey,
  sanitizeFileName,
  thumbKey,
} from './keys.js';

test('keys are built only from immutable ids — same file, same key, forever', () => {
  const k1 = originalKey('tour1', 'media1', 'IMG_1234.jpg');
  const k2 = originalKey('tour1', 'media1', 'IMG_1234.jpg');
  assert.equal(k1, k2);
  assert.equal(k1, 'tour-galleries/tour1/originals/media1/IMG_1234.jpg');
});

test('all key kinds live under the one per-tour prefix (cleanup purges everything)', () => {
  const prefix = galleryPrefix('tourA');
  for (const k of [
    originalKey('tourA', 'm1', 'a.jpg'),
    thumbKey('tourA', 'm1'),
    posterKey('tourA', 'm1'),
    archiveKey('tourA', 'exp1'),
  ]) {
    assert.ok(k.startsWith(prefix), `${k} must start with ${prefix}`);
  }
});

test('derivative keys are extension-stable (.webp) regardless of source type', () => {
  assert.equal(thumbKey('t', 'm'), 'tour-galleries/t/thumbs/m.webp');
  assert.equal(posterKey('t', 'm'), 'tour-galleries/t/posters/m.webp');
});

test('filename tail is sanitised — Hebrew/spaces/traversal never reach the key', () => {
  assert.equal(sanitizeFileName('צילום מסך 2026.png'), '_2026.png');
  assert.equal(sanitizeFileName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeFileName(''), 'file');
  assert.equal(sanitizeFileName(null), 'file');
  const long = 'x'.repeat(300) + '.jpg';
  assert.ok(sanitizeFileName(long).length <= 80);
});

test('two media rows can carry the same original filename without key collision', () => {
  const a = originalKey('tour1', 'mediaA', 'IMG_0001.jpg');
  const b = originalKey('tour1', 'mediaB', 'IMG_0001.jpg');
  assert.notEqual(a, b);
});

test('invalid ids are rejected (keys must never be attacker-shaped)', () => {
  assert.throws(() => galleryPrefix('a/b'), /invalid_tour_event_id/);
  assert.throws(() => originalKey('t', 'm/../x', 'a.jpg'), /invalid_media_id/);
  assert.throws(() => galleryPrefix(''), /invalid_tour_event_id/);
});
