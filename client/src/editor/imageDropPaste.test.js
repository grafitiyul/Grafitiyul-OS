import test from 'node:test';
import assert from 'node:assert/strict';
import { splitImageFiles, isImageFilePaste } from './imageDropPaste.js';

// Pure decision helpers for editor image drop/paste (DOM-free, like fileAccept).

const img = (name, type = 'image/png') => ({ name, type });

test('splitImageFiles: splits by the canonical editor image allowlist', () => {
  const { images, others } = splitImageFiles([
    img('a.png'),
    img('b.jpg', 'image/jpeg'),
    { name: 'c.pdf', type: 'application/pdf' },
    { name: 'd.svg', type: 'image/svg+xml' }, // not in the allowlist — server would refuse it
  ]);
  assert.deepEqual(images.map((f) => f.name), ['a.png', 'b.jpg']);
  assert.deepEqual(others.map((f) => f.name), ['c.pdf', 'd.svg']);
});

test('isImageFilePaste: true for a pure image-file paste (screenshot)', () => {
  assert.equal(isImageFilePaste({ files: [img('s.png')], types: ['Files'] }), true);
});

test('isImageFilePaste: false when the clipboard also carries text/html (web/Word copy keeps the HTML paste path)', () => {
  assert.equal(
    isImageFilePaste({ files: [img('s.png')], types: ['text/html', 'Files'] }),
    false,
  );
});

test('isImageFilePaste: false for no files / non-image files', () => {
  assert.equal(isImageFilePaste({ files: [], types: ['text/plain'] }), false);
  assert.equal(isImageFilePaste(null), false);
  assert.equal(
    isImageFilePaste({ files: [{ name: 'x.pdf', type: 'application/pdf' }], types: ['Files'] }),
    false,
  );
});
