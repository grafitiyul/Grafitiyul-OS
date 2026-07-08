import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedUrl, buildWatchUrl, posterCandidates } from './embedProviders.js';

// The PDF print card rebuilds a human watch URL + poster from (provider, id) —
// never from the raw pasted URL. These pin the rebuild rules per provider.

test('youtube: watch URL + poster candidates from a parsed share link', () => {
  const e = parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(e.provider, 'youtube');
  assert.equal(buildWatchUrl(e.provider, e.videoId), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(posterCandidates(e.provider, e.videoId), [
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  ]);
});

test('vimeo: unlisted hash survives into the watch URL; no keyless poster', () => {
  const e = parseEmbedUrl('https://vimeo.com/123456789/abcdef12');
  assert.equal(e.provider, 'vimeo');
  assert.equal(
    buildWatchUrl(e.provider, e.videoId, { hash: e.videoHash }),
    'https://vimeo.com/123456789/abcdef12',
  );
  assert.equal(buildWatchUrl('vimeo', '123456789'), 'https://vimeo.com/123456789');
  assert.deepEqual(posterCandidates('vimeo', '123456789'), []);
});

test('drive: view URL + thumbnail endpoint', () => {
  const e = parseEmbedUrl('https://drive.google.com/file/d/1A2b3C4d5E6f7G8h/view?usp=sharing');
  assert.equal(e.provider, 'drive');
  assert.equal(
    buildWatchUrl(e.provider, e.videoId),
    'https://drive.google.com/file/d/1A2b3C4d5E6f7G8h/view',
  );
  assert.deepEqual(posterCandidates(e.provider, e.videoId), [
    'https://drive.google.com/thumbnail?id=1A2b3C4d5E6f7G8h&sz=w1280',
  ]);
});

test('unknown provider / missing id → null URL, no candidates', () => {
  assert.equal(buildWatchUrl('tiktok', 'x'), null);
  assert.equal(buildWatchUrl('youtube', ''), null);
  assert.deepEqual(posterCandidates('youtube', ''), []);
  assert.deepEqual(posterCandidates('tiktok', 'x'), []);
});
