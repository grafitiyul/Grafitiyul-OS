import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveKey,
  mediaKeyPipelineSelfCheck,
  originalKey,
  parseMediaKey,
  posterKey,
  scopeOf,
  storagePrefix,
  thumbKey,
} from './keys.js';
import { originalKey as tourOriginalKey, galleryPrefix } from '../tours/gallery/keys.js';

// ── The compatibility guarantee ─────────────────────────────────────────────
// This is the test that protects live customer galleries. If the generic
// builder ever stops emitting the historical tour key, every already-uploaded
// tour photo becomes unreachable.

test('tour scope emits byte-identical keys to the historical tour builder', () => {
  for (const id of ['6881e558-71aa-40c3-aa5f-95684ff94a63', 'cmrhoex8500409lkocq14h41b']) {
    assert.equal(
      originalKey({ tourEventId: id }, 'media1', 'IMG_1234.jpg'),
      tourOriginalKey(id, 'media1', 'IMG_1234.jpg'),
    );
    assert.equal(storagePrefix({ tourEventId: id }), galleryPrefix(id));
  }
});

test('a tour asset keeps the tour prefix even though galleryId is also known', () => {
  // Ordering matters: tourEventId wins. Were galleryId to take precedence, every
  // existing tour object would be looked up under a prefix that has no objects.
  const key = originalKey({ tourEventId: 'tourA', galleryId: 'galB' }, 'm1', 'a.jpg');
  assert.equal(key, 'tour-galleries/tourA/originals/m1/a.jpg');
});

// ── Scopes ──────────────────────────────────────────────────────────────────

test('standalone galleries and library assets get their own prefixes', () => {
  assert.equal(storagePrefix({ galleryId: 'galB' }), 'galleries/galB/');
  assert.equal(storagePrefix({ library: true }), 'library/');
  assert.equal(scopeOf({ tourEventId: 't' }), 'tour');
  assert.equal(scopeOf({ galleryId: 'g' }), 'gallery');
  assert.equal(scopeOf({ library: true }), 'library');
});

test('an absent or empty owner is an error, never a silent library downgrade', () => {
  // Regression guard: a falsy galleryId once fell through to the library
  // prefix, which would have written a gallery's objects somewhere its own
  // prefix purge and listing would never look.
  for (const owner of [{}, { galleryId: '' }, { galleryId: null }, { tourEventId: '' }]) {
    assert.throws(() => storagePrefix(owner), /invalid_storage_scope|invalid_gallery_id/);
  }
  assert.throws(() => scopeOf({}), /invalid_storage_scope/);
});

test('every key kind of a gallery lives under that gallery prefix (prefix purge works)', () => {
  const owner = { galleryId: 'galB' };
  const prefix = storagePrefix(owner);
  for (const k of [
    originalKey(owner, 'm1', 'a.jpg'),
    thumbKey(owner, 'm1'),
    posterKey(owner, 'm1'),
    archiveKey(owner, 'exp1'),
  ]) {
    assert.ok(k.startsWith(prefix), `${k} escaped ${prefix}`);
  }
});

test('keys are deterministic — same inputs, same key, forever', () => {
  const a = originalKey({ galleryId: 'g1' }, 'm1', 'IMG_1234.jpg');
  const b = originalKey({ galleryId: 'g1' }, 'm1', 'IMG_1234.jpg');
  assert.equal(a, b);
});

// ── Parsing ─────────────────────────────────────────────────────────────────

test('round-trips every scope × id shape × key kind', () => {
  const res = mediaKeyPipelineSelfCheck();
  assert.deepEqual(res.failures, []);
  assert.equal(res.ok, true);
});

test('parse distinguishes galleries/ from tour-galleries/', () => {
  const tour = parseMediaKey('tour-galleries/tourA/originals/m1/a.jpg');
  assert.equal(tour.scope, 'tour');
  assert.equal(tour.ownerId, 'tourA');

  const gal = parseMediaKey('galleries/galB/originals/m1/a.jpg');
  assert.equal(gal.scope, 'gallery');
  assert.equal(gal.ownerId, 'galB');
});

test('library keys parse with no owner id', () => {
  const lib = parseMediaKey('library/originals/m1/a.jpg');
  assert.equal(lib.scope, 'library');
  assert.equal(lib.ownerId, null);
  assert.equal(lib.mediaId, 'm1');
});

test('parse rejects anything that is not a media key', () => {
  for (const bad of ['', 'whatsapp/acc/x.jpg', 'tour-galleries/', 'galleries/g1/nope/x', null]) {
    assert.equal(parseMediaKey(bad), null);
  }
});

// ── Path-shaping is rejected, not sanitised away ─────────────────────────────

test('ids that could reshape a key path are refused', () => {
  for (const bad of ['../evil', 'a/b', 'a.b', 'a b', '']) {
    assert.throws(() => originalKey({ galleryId: bad }, 'm1', 'a.jpg'));
    assert.throws(() => thumbKey({ galleryId: 'g1' }, bad));
  }
});

test('filenames are sanitised into the tail, never allowed to escape the prefix', () => {
  const k = originalKey({ galleryId: 'g1' }, 'm1', '../../etc/passwd');
  const prefix = 'galleries/g1/originals/m1/';
  assert.ok(k.startsWith(prefix));
  // The guarantee is containment, not the absence of dots: separators are
  // stripped so the tail can never introduce another path segment. Dots stay,
  // because filenames legitimately carry extensions.
  const tail = k.slice(prefix.length);
  assert.ok(!tail.includes('/'), `tail introduced a path segment: ${tail}`);
});
