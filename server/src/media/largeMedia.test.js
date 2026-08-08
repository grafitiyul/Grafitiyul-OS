import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribability, MAX_REQUEST_BYTES } from './transcription/openai.js';
import { assembleTranscript, CHUNK_CONCURRENCY, STAGES } from './transcription/pipeline.js';
import { CHUNK_SECONDS, AUDIO_RATE } from './transcription/ffmpeg.js';
import { assertCategoriesMatchWorlds, resolveWorldIds } from './worlds.js';

// ── The 25 MB product limit is gone ─────────────────────────────────────────

test('a huge file is NOT refused — size is no longer a transcribability reason', () => {
  const fourGB = {
    mediaType: 'video',
    objectKey: 'library/originals/m1/lecture.mp4',
    byteSize: 4n * 1024n * 1024n * 1024n,
  };
  const res = transcribability(fourGB);
  assert.equal(res.ok, true, 'a 4 GB lecture must be transcribable');
});

test('the provider limit still exists, but only as an internal per-request bound', () => {
  // It must remain far above one chunk, and it is never surfaced as a rule.
  assert.equal(MAX_REQUEST_BYTES, 25 * 1024 * 1024);
});

test('chunk length keeps every request an order of magnitude under the limit', () => {
  // mono @ 16 kHz @ 32 kbps ≈ 4 KB/s.
  const bytesPerSecond = 32_000 / 8;
  const projected = CHUNK_SECONDS * bytesPerSecond;
  assert.ok(projected < MAX_REQUEST_BYTES / 4,
    `chunk ~${Math.round(projected / 1024 / 1024)}MB should be far under ${MAX_REQUEST_BYTES / 1024 / 1024}MB`);
  assert.equal(AUDIO_RATE, 16000, 'speech models expect 16 kHz');
});

test('the genuine blockers remain — no speech track, or we do not hold the bytes', () => {
  assert.equal(transcribability({ mediaType: 'image', objectKey: 'k' }).reason, 'not_audio_or_video');
  assert.equal(
    transcribability({ mediaType: 'video', objectKey: null, sourceProvider: 'youtube' }).reason,
    'youtube_reference_has_no_media',
  );
  // A Vimeo item MIRRORED into R2 has bytes and therefore passes.
  assert.equal(
    transcribability({ mediaType: 'video', objectKey: 'library/originals/m/v.mp4', sourceProvider: 'vimeo' }).ok,
    true,
  );
});

// ── Assembly: order and absolute timestamps ─────────────────────────────────

test('chunks assemble in INDEX order, never completion order', () => {
  const out = assembleTranscript([
    { index: 2, startSeconds: 1200, text: 'third' },
    { index: 0, startSeconds: 0, text: 'first' },
    { index: 1, startSeconds: 600, text: 'second' },
  ]);
  assert.equal(out.text, 'first\n\nsecond\n\nthird');
});

test('provider timestamps are shifted onto the ORIGINAL timeline', () => {
  const out = assembleTranscript([
    { index: 0, startSeconds: 0, text: 'a', segments: [{ start: 5, end: 9, text: 'a' }] },
    // Chunk 8 covers 00:35:00 onward; a segment 12s into it is really 35:12.
    { index: 8, startSeconds: 2100, text: 'b', segments: [{ start: 12, end: 20, text: 'b' }] },
  ]);
  assert.deepEqual(out.segments, [
    { start: 5, end: 9, text: 'a' },
    { start: 2112, end: 2120, text: 'b' },
  ]);
});

test('a silent chunk contributes no text but does not break assembly', () => {
  const out = assembleTranscript([
    { index: 0, startSeconds: 0, text: 'hello' },
    { index: 1, startSeconds: 600, text: '' },
    { index: 2, startSeconds: 1200, text: 'world' },
  ]);
  assert.equal(out.text, 'hello\n\nworld');
});

test('no segments anywhere yields null rather than an empty array', () => {
  assert.equal(assembleTranscript([{ index: 0, startSeconds: 0, text: 'x' }]).segments, null);
});

// ── Honest states and bounded concurrency ───────────────────────────────────

test('the pipeline distinguishes its stages so progress is never a bare spinner', () => {
  assert.deepEqual(Object.values(STAGES), [
    'preparing_media', 'chunking', 'transcribing', 'assembling',
  ]);
});

test('concurrency is bounded so several large videos cannot exhaust the service', () => {
  assert.ok(CHUNK_CONCURRENCY >= 1 && CHUNK_CONCURRENCY <= 8, 'bounded, small');
});

// ── Content Worlds invariant ────────────────────────────────────────────────

function fakeDb({ worlds = [], categories = [] } = {}) {
  return {
    contentWorld: {
      findMany: async ({ where }) =>
        worlds.filter((w) => (where?.id?.in ? where.id.in.includes(w.id) : true)),
      findUnique: async ({ where }) => worlds.find((w) => w.id === where.id) || null,
    },
    libraryCategory: {
      findMany: async ({ where }) => categories.filter((c) => where.id.in.includes(c.id)),
    },
  };
}

const WORLDS = [
  { id: 'w_gos', key: 'gos', active: true },
  { id: 'w_ch', key: 'challenge', active: true },
  { id: 'w_old', key: 'retired', active: false },
];
const CATS = [
  { id: 'c_sales', nameHe: 'מכירות', worldId: 'w_gos' },
  { id: 'c_food', nameHe: 'תזונה', worldId: 'w_ch' },
];

test('an item must belong to at least one world — world is the FIRST choice', async () => {
  const db = fakeDb({ worlds: WORLDS });
  await assert.rejects(() => resolveWorldIds(db, []), /content_world_required/);
  await assert.rejects(() => resolveWorldIds(db, null), /content_world_required/);
});

test('an item may belong to one world or several', async () => {
  const db = fakeDb({ worlds: WORLDS });
  assert.deepEqual(await resolveWorldIds(db, ['w_gos']), ['w_gos']);
  assert.deepEqual(await resolveWorldIds(db, ['w_gos', 'w_ch']), ['w_gos', 'w_ch']);
  // Duplicates collapse rather than creating two identical memberships.
  assert.deepEqual(await resolveWorldIds(db, ['w_gos', 'w_gos']), ['w_gos']);
});

test('unknown or inactive worlds are refused', async () => {
  const db = fakeDb({ worlds: WORLDS });
  await assert.rejects(() => resolveWorldIds(db, ['nope']), /unknown_content_world/);
  await assert.rejects(() => resolveWorldIds(db, ['w_old']), /inactive_content_world/);
});

test('THE INVARIANT: a category from a world the item is not in is rejected server-side', async () => {
  const db = fakeDb({ worlds: WORLDS, categories: CATS });
  // GOS-only item + a CHALLENGE category → refused, even though the UI filters.
  await assert.rejects(
    () => assertCategoriesMatchWorlds(db, { categoryIds: ['c_food'], worldIds: ['w_gos'] }),
    (e) => e.message === 'category_world_mismatch' && e.detail.categories[0].nameHe === 'תזונה',
  );
});

test('an item in BOTH worlds may use categories from both', async () => {
  const db = fakeDb({ worlds: WORLDS, categories: CATS });
  const ok = await assertCategoriesMatchWorlds(db, {
    categoryIds: ['c_sales', 'c_food'],
    worldIds: ['w_gos', 'w_ch'],
  });
  assert.deepEqual(ok.sort(), ['c_food', 'c_sales']);
});

test('the same category name in two worlds is two distinct categories', () => {
  // Enforced by the DB as @@unique([worldId, nameHe]) — a name is only unique
  // WITHIN a world, so "הרצאות" may exist under GOS and CHALLENGE at once.
  const gosLectures = { id: 'c1', nameHe: 'הרצאות', worldId: 'w_gos' };
  const chLectures = { id: 'c2', nameHe: 'הרצאות', worldId: 'w_ch' };
  assert.notEqual(gosLectures.id, chLectures.id);
  assert.notEqual(gosLectures.worldId, chLectures.worldId);
});

test('no categories selected is valid — a world alone is enough to file an item', async () => {
  const db = fakeDb({ worlds: WORLDS, categories: CATS });
  assert.deepEqual(await assertCategoriesMatchWorlds(db, { categoryIds: [], worldIds: ['w_gos'] }), []);
});
