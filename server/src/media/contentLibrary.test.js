import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_TYPES, TRANSCRIBABLE_TYPES, transcriptState } from './library.js';
import { transcribability, MAX_REQUEST_BYTES } from './transcription/openai.js';
import { downloadableFiles } from './providers/vimeo.js';
import { parseIsoDuration } from './providers/youtube.js';
import { findAlreadyImported, importExternalVideos } from './imports.js';
import { hashToken, workspaceScopeWhere } from './serviceAuth.js';

// ── Content types ───────────────────────────────────────────────────────────

test('every content type the brief asked for exists', () => {
  for (const t of ['video', 'audio', 'image', 'pdf', 'document', 'youtube', 'vimeo', 'link']) {
    assert.ok(CONTENT_TYPES.includes(t), `${t} is a content type`);
  }
});

test('only audio and video are ever transcribable', () => {
  assert.deepEqual([...TRANSCRIBABLE_TYPES], ['video', 'audio']);
});

// ── Honest processing state ─────────────────────────────────────────────────

test('a queued or running job is NEVER reported as completed', () => {
  const item = { contentType: 'video' };
  assert.equal(transcriptState(item, null, { status: 'queued' }).status, 'queued');
  assert.equal(transcriptState(item, null, { status: 'running' }).status, 'processing');
});

test('a failed job carries its reason forward instead of a bare failure', () => {
  const state = transcriptState({ contentType: 'video' }, null, {
    status: 'failed',
    lastError: 'file_too_large_for_provider',
  });
  assert.equal(state.status, 'failed');
  assert.equal(state.error, 'file_too_large_for_provider');
});

test('an existing transcript wins over any stale job row', () => {
  const at = new Date('2026-08-08T10:00:00Z');
  const state = transcriptState({ contentType: 'video' }, { generatedAt: at }, { status: 'failed' });
  assert.equal(state.status, 'completed');
  assert.equal(state.at, at);
});

test('an image reports transcription as unavailable, not as "not started"', () => {
  // "not_started" implies an action is possible. It is not.
  assert.equal(transcriptState({ contentType: 'image' }, null, null).status, 'unavailable');
});

// ── Transcribability ────────────────────────────────────────────────────────

test('a YouTube reference is refused with a reason naming YouTube', () => {
  const res = transcribability({
    mediaType: 'video',
    objectKey: null,
    sourceProvider: 'youtube',
  });
  assert.equal(res.ok, false);
  // We do NOT download YouTube media merely to transcribe it.
  assert.equal(res.reason, 'youtube_reference_has_no_media');
});

test('any external reference without bytes is refused', () => {
  const res = transcribability({ mediaType: 'video', objectKey: null, sourceProvider: 'vimeo' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'external_reference_has_no_media');
});

test('a file over the provider limit is NO LONGER refused — the pipeline chunks it', () => {
  // Behaviour deliberately reversed (2026-08-08): the 25 MB provider limit is
  // handled by chunking in the pipeline, so it is no longer a product limit.
  // See largeMedia.test.js for the chunk-sizing guarantees.
  const res = transcribability({
    mediaType: 'audio',
    objectKey: 'library/originals/m1/a.mp3',
    byteSize: MAX_REQUEST_BYTES * 100,
  });
  assert.equal(res.ok, true);
});

test('an R2-backed audio or video within the limit is transcribable', () => {
  for (const mediaType of ['audio', 'video']) {
    const res = transcribability({
      mediaType,
      objectKey: 'library/originals/m1/a.mp4',
      byteSize: 1024,
    });
    assert.equal(res.ok, true, mediaType);
  }
});

test('an image is never transcribable however it is stored', () => {
  const res = transcribability({ mediaType: 'image', objectKey: 'library/originals/m1/a.jpg' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_audio_or_video');
});

// ── Vimeo capability is observed, never assumed ─────────────────────────────

test('no download/files arrays means NO mirrorable file — never an optimistic guess', () => {
  assert.deepEqual(downloadableFiles({}), []);
  assert.deepEqual(downloadableFiles({ download: [], files: [] }), []);
  assert.deepEqual(downloadableFiles(null), []);
});

test('streaming-only files (HLS) do not count as a downloadable source', () => {
  const files = downloadableFiles({
    files: [{ link: 'https://x/master.m3u8', type: 'application/vnd.apple.mpegurl' }],
  });
  assert.equal(files.length, 0, 'an HLS manifest is not a source file');
});

test('a real download entry is usable, largest first', () => {
  const files = downloadableFiles({
    download: [
      { link: 'https://x/sd.mp4', quality: 'sd', size: 1000, type: 'video/mp4' },
      { link: 'https://x/hd.mp4', quality: 'hd', size: 9000, type: 'video/mp4' },
    ],
  });
  assert.equal(files.length, 2);
  assert.equal(files[0].quality, 'hd', 'the mirror should take the best source');
});

// ── YouTube duration parsing ────────────────────────────────────────────────

test('ISO-8601 durations parse; unknown ones are null rather than 0:00', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P1DT2H'), 93600);
  // A live stream has no duration — reporting 0 would render as "0:00".
  assert.equal(parseIsoDuration('P0D'), null);
  assert.equal(parseIsoDuration('garbage'), null);
  assert.equal(parseIsoDuration(null), null);
});

// ── Duplicate protection ────────────────────────────────────────────────────

function fakeImportDb({ existingMedia = [] } = {}) {
  const state = { media: [...existingMedia], items: [], jobs: [], links: [] };
  return {
    state,
    tourMedia: {
      findMany: async ({ where }) =>
        state.media.filter(
          (m) =>
            m.sourceProvider === where.sourceProvider &&
            where.sourceExternalId.in.includes(m.sourceExternalId),
        ),
      create: async ({ data }) => {
        const dup = state.media.find(
          (m) =>
            m.sourceProvider === data.sourceProvider &&
            m.sourceExternalId === data.sourceExternalId,
        );
        if (dup) {
          const e = new Error('unique');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `md${state.media.length + 1}`, libraryItems: [], ...data };
        state.media.push(row);
        return row;
      },
    },
    libraryItem: {
      create: async ({ data }) => {
        const row = { id: `li${state.items.length + 1}`, ...data };
        state.items.push(row);
        return row;
      },
      findUnique: async ({ where }) => state.items.find((i) => i.id === where.id) || null,
    },
    libraryItemCategory: { deleteMany: async () => ({}), createMany: async () => ({}) },
    libraryItemWorkspace: { deleteMany: async () => ({}), createMany: async () => ({}) },
    contentWorkspace: { findUnique: async () => ({ id: 'ws1', key: 'gos' }) },
    // World-first validation: an item cannot exist without a world.
    contentWorld: {
      findMany: async ({ where }) =>
        [{ id: 'w_gos', key: 'gos', active: true }].filter((w) =>
          where?.id?.in ? where.id.in.includes(w.id) : true,
        ),
      findUnique: async () => ({ id: 'w_gos', key: 'gos', active: true }),
    },
    libraryItemWorld: { deleteMany: async () => ({}), createMany: async () => ({}), findMany: async () => [] },
    mediaJob: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const row = { id: `j${state.jobs.length + 1}`, ...data };
        state.jobs.push(row);
        return row;
      },
    },
  };
}

test('re-importing the same video resolves to the existing item, never a duplicate', async () => {
  const db = fakeImportDb({
    existingMedia: [
      {
        id: 'md0',
        sourceProvider: 'youtube',
        sourceExternalId: 'abc123',
        libraryItems: [{ id: 'li0', internalName: 'כבר קיים' }],
      },
    ],
  });
  const res = await importExternalVideos(db, {
    provider: 'youtube',
    worldIds: ['w_gos'],
    videos: [{ externalId: 'abc123', title: 'A totally different title' }],
  });
  assert.equal(res.imported.length, 0);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].reason, 'already_imported');
  // The operator gets a pointer to what already represents this video.
  assert.equal(res.skipped[0].itemId, 'li0');
});

test('duplicates are detected by provider id, NEVER by title', async () => {
  const db = fakeImportDb({
    existingMedia: [
      { id: 'md0', sourceProvider: 'youtube', sourceExternalId: 'aaa', libraryItems: [] },
    ],
  });
  // Same title, different provider id → a genuinely different video.
  const res = await importExternalVideos(db, {
    provider: 'youtube',
    worldIds: ['w_gos'],
    videos: [{ externalId: 'bbb', title: 'Same Title' }],
  });
  assert.equal(res.imported.length, 1, 'a different video with the same title still imports');
});

test('an import is always an external reference until bytes actually land', async () => {
  const db = fakeImportDb();
  await importExternalVideos(db, {
    provider: 'vimeo',
    worldIds: ['w_gos'],
    strategy: 'mirror',
    videos: [{ externalId: 'v1', title: 'Clip', canMirrorToR2: true }],
  });
  const media = db.state.media[0];
  // Claiming 'mirrored_to_r2' here would report success for work not yet done.
  assert.equal(media.storageStrategy, 'external_reference');
  assert.equal(media.objectKey, null);
  assert.equal(db.state.jobs.length, 1, 'a mirror job is queued instead');
  assert.equal(db.state.jobs[0].kind, 'mirror_to_r2');
});

test('asking to mirror a video Vimeo will not expose says so instead of pretending', async () => {
  const db = fakeImportDb();
  const res = await importExternalVideos(db, {
    provider: 'vimeo',
    worldIds: ['w_gos'],
    strategy: 'mirror',
    videos: [
      { externalId: 'v2', title: 'Clip', canMirrorToR2: false, mirrorBlockedReason: 'no_source_file_exposed' },
    ],
  });
  assert.equal(res.imported[0].mirrorQueued, false);
  assert.equal(res.imported[0].mirrorSkippedReason, 'no_source_file_exposed');
  assert.equal(db.state.jobs.length, 0, 'no impossible job is queued');
});

test('YouTube is never mirrored, even when mirror is requested', async () => {
  const db = fakeImportDb();
  await importExternalVideos(db, {
    provider: 'youtube',
    worldIds: ['w_gos'],
    strategy: 'mirror',
    videos: [{ externalId: 'yt1', title: 'Clip', canMirrorToR2: true }],
  });
  assert.equal(db.state.jobs.length, 0, 'no download path exists for YouTube');
});

test('the internal name seeds from the source title but is its own field', async () => {
  const db = fakeImportDb();
  await importExternalVideos(db, {
    provider: 'youtube',
    worldIds: ['w_gos'],
    videos: [{ externalId: 'y1', title: 'Provider Title', internalName: 'שם שהמפעיל בחר' }],
  });
  assert.equal(db.state.items[0].internalName, 'שם שהמפעיל בחר');
  // The provider's own wording is preserved separately, not overwritten.
  assert.equal(db.state.media[0].sourceTitle, 'Provider Title');
});

test('findAlreadyImported is a no-op for an empty selection', async () => {
  const db = fakeImportDb();
  assert.equal((await findAlreadyImported(db, { provider: 'youtube', externalIds: [] })).size, 0);
});

// ── Workspace scoping ───────────────────────────────────────────────────────

test('the primary workspace sees everything; others see only what is granted', () => {
  assert.deepEqual(workspaceScopeWhere({ workspace: { isPrimary: true }, workspaceId: 'w1' }), {});
  assert.deepEqual(workspaceScopeWhere({ workspace: { isPrimary: false }, workspaceId: 'w2' }), {
    workspaces: { some: { workspaceId: 'w2' } },
  });
});

test('a missing grant row means NO access — never implicit access', () => {
  // The scope is a positive filter: an item with no LibraryItemWorkspace row
  // for this workspace simply cannot match it.
  const where = workspaceScopeWhere({ workspace: { isPrimary: false }, workspaceId: 'challenge' });
  assert.ok(where.workspaces.some.workspaceId === 'challenge');
});

test('service tokens are stored only as hashes', () => {
  const token = 'gos_ct_example';
  const hash = hashToken(token);
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64, 'sha256 hex');
  assert.equal(hashToken(token), hash, 'stable for lookup');
});
