import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveKey,
  galleryPrefix,
  keyPipelineSelfCheck,
  originalKey,
  parseGalleryKey,
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
  assert.throws(() => galleryPrefix('a.b'), /invalid_tour_event_id/);
  assert.throws(() => galleryPrefix('a b'), /invalid_tour_event_id/);
});

// Regression — 2026-08-03 P0: production TourEvent ids are uuids (hyphenated),
// not cuids. The id guard rejected the hyphen, so EVERY production upload died
// at initiate with invalid_tour_event_id before a row was even created.
// Dev/test cuids passed, which is exactly how the failure stayed invisible:
// from here on, every key-shape test runs BOTH id formats.
const UUID = '6881e558-71aa-40c3-aa5f-95684ff94a63'; // real production TourEvent id shape
const CUID = 'cmrhoex8500409lkocq14h41b'; // schema-default / dev-test id shape

for (const [shape, id] of [['uuid', UUID], ['cuid', CUID]]) {
  test(`${shape} tour ids build valid keys of every kind`, () => {
    assert.equal(galleryPrefix(id), `tour-galleries/${id}/`);
    assert.equal(
      originalKey(id, 'abc123def456', 'IMG_0001.jpg'),
      `tour-galleries/${id}/originals/abc123def456/IMG_0001.jpg`,
    );
    assert.equal(thumbKey(id, 'abc123def456'), `tour-galleries/${id}/thumbs/abc123def456.webp`);
    assert.equal(posterKey(id, 'abc123def456'), `tour-galleries/${id}/posters/abc123def456.webp`);
    assert.equal(archiveKey(id, 'exp1'), `tour-galleries/${id}/archives/exp1.zip`);
  });

  test(`${shape} keys parse back to their exact identity (round-trip)`, () => {
    assert.deepEqual(parseGalleryKey(originalKey(id, 'm1a2b3', 'IMG_0001.jpg')), {
      kind: 'original',
      tourEventId: id,
      mediaId: 'm1a2b3',
      fileName: 'IMG_0001.jpg',
    });
    assert.deepEqual(parseGalleryKey(thumbKey(id, 'm1a2b3')), {
      kind: 'thumb',
      tourEventId: id,
      mediaId: 'm1a2b3',
    });
    assert.deepEqual(parseGalleryKey(posterKey(id, 'm1a2b3')), {
      kind: 'poster',
      tourEventId: id,
      mediaId: 'm1a2b3',
    });
    assert.deepEqual(parseGalleryKey(archiveKey(id, 'exp1')), {
      kind: 'archive',
      tourEventId: id,
      exportId: 'exp1',
    });
  });
}

test('parser rejects foreign/malformed keys instead of misattributing them', () => {
  assert.equal(parseGalleryKey('whatsapp/acc1/media.jpg'), null);
  assert.equal(parseGalleryKey('tour-galleries/'), null);
  assert.equal(parseGalleryKey(`tour-galleries/${UUID}/unknown/m1.webp`), null);
  assert.equal(parseGalleryKey(`tour-galleries/${UUID}/thumbs/m1.jpg`), null); // wrong ext
  assert.equal(parseGalleryKey(`tour-galleries/a.b/thumbs/m1.webp`), null); // bad tour id
  assert.equal(parseGalleryKey(`tour-galleries/${UUID}/originals/m..1/x.jpg`), null); // bad media id
  assert.equal(parseGalleryKey(''), null);
  assert.equal(parseGalleryKey(null), null);
});

test('keyPipelineSelfCheck: healthy pipeline reports ok with zero failures', () => {
  const result = keyPipelineSelfCheck();
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.deepEqual(result.failures, []);
});
