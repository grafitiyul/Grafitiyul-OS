// Prisma-shape contract tests — the guard the fake-db blind spot demands.
//
// A stub suite stays green while a select naming a non-existent column 500s
// every production request. These walk the fields this module actually reads
// and writes against the GENERATED Prisma DMMF, so a schema drift fails here
// rather than at 3am in a customer conversation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const model = (name) => Prisma.dmmf.datamodel.models.find((m) => m.name === name);

function assertScalars(modelName, fields) {
  const m = model(modelName);
  assert.ok(m, `${modelName} exists in the generated schema`);
  for (const f of fields) {
    const field = m.fields.find((x) => x.name === f);
    assert.ok(field, `${modelName}.${f} exists`);
    assert.notEqual(field.kind, 'object', `${modelName}.${f} is a scalar`);
  }
}

function field(modelName, name) {
  const f = model(modelName)?.fields.find((x) => x.name === name);
  assert.ok(f, `${modelName}.${name} exists`);
  return f;
}

// ── The generalisation itself ───────────────────────────────────────────────
// These four assertions ARE the feature. If any of them regresses to required,
// standalone galleries and library assets become unrepresentable — and the
// failure would otherwise only surface as a 500 on the first real upload.

test('the tour binding is optional — a gallery is not defined by a tour', () => {
  assert.equal(field('TourGallery', 'tourEventId').isRequired, false);
});

test('media may exist outside a gallery, outside a tour, and outside R2', () => {
  assert.equal(field('TourMedia', 'galleryId').isRequired, false);
  assert.equal(field('TourMedia', 'tourEventId').isRequired, false);
  // An external reference (YouTube/Vimeo) has no R2 object at all.
  assert.equal(field('TourMedia', 'objectKey').isRequired, false);
});

test('an external reference is identified by provider + id, never by URL or title', () => {
  const m = model('TourMedia');
  const unique = m.uniqueFields.find(
    (u) => u.includes('sourceProvider') && u.includes('sourceExternalId'),
  );
  assert.ok(unique, 'TourMedia has a (sourceProvider, sourceExternalId) unique constraint');
});

// ── Columns the services read and write ─────────────────────────────────────

test('gallery carries its standalone identity, bilingual text and permission matrix', () => {
  assertScalars('TourGallery', [
    'id', 'tourEventId', 'coverMediaId', 'customerUploadEnabled',
    'internalName', 'titleHe', 'titleEn', 'subtitleHe', 'subtitleEn', 'defaultLanguage',
    'extCanView', 'extCanDownload', 'extCanUpload', 'extCanDelete', 'extCanEdit',
    'status', 'createdById',
  ]);
});

test('media carries storage strategy, source provenance, ordering and captions', () => {
  assertScalars('TourMedia', [
    'id', 'galleryId', 'tourEventId', 'objectKey', 'thumbKey', 'posterKey',
    'mediaType', 'mimeType', 'originalFileName', 'byteSize', 'width', 'height',
    'durationSeconds', 'checksum', 'uploadStatus', 'uploadedByType', 'uploadedByLinkId',
    'deletedAt', 'deletedById',
    'storageStrategy', 'sourceProvider', 'sourceExternalId', 'sourceUrl', 'sourceTitle',
    'sourceThumbnailUrl', 'sourcePublishedAt', 'sourceUpdatedAt', 'sourceMeta',
    'importedAt', 'mirroredAt', 'sortOrder', 'captionHe', 'captionEn',
  ]);
});

test('a public link can be disabled reversibly as well as revoked permanently', () => {
  assertScalars('TourGalleryLink', [
    'id', 'galleryId', 'token', 'audience', 'personRefId', 'status',
    'createdById', 'disabledAt', 'disabledById', 'revokedAt', 'revokedReason',
  ]);
});

test('the new platform models exist with the columns their services use', () => {
  assertScalars('GalleryItem', ['id', 'galleryId', 'mediaId', 'sortOrder', 'addedById']);
  assertScalars('GalleryAudit', [
    'id', 'galleryId', 'action', 'actorType', 'linkId', 'actorId', 'mediaId',
    'ipHash', 'userAgent', 'detail',
  ]);
  assertScalars('ContentWorkspace', ['id', 'key', 'name', 'isPrimary', 'active']);
  assertScalars('ContentServiceToken', [
    'id', 'workspaceId', 'label', 'tokenHash', 'canRead', 'canWrite', 'canUpload',
    'canTranscribe', 'status', 'lastUsedAt', 'createdById', 'revokedAt',
  ]);
  assertScalars('LibraryCategory', ['id', 'nameHe', 'nameEn', 'sortOrder', 'archived']);
  assertScalars('LibraryItem', [
    'id', 'internalName', 'contentType', 'mediaId', 'description', 'language',
    'publicTitleHe', 'publicTitleEn', 'archived', 'createdById', 'updatedById',
  ]);
  assertScalars('LibraryItemCategory', ['itemId', 'categoryId']);
  assertScalars('LibraryItemWorkspace', ['itemId', 'workspaceId', 'access']);
  assertScalars('MediaTranscript', [
    'id', 'mediaId', 'isCurrent', 'text', 'segments', 'language', 'provider',
    'model', 'sourceObjectKey', 'sourceChecksum', 'durationSeconds', 'generatedAt',
    'requestedById',
  ]);
  assertScalars('MediaJob', [
    'id', 'mediaId', 'kind', 'status', 'attempts', 'maxAttempts', 'lastError',
    'payload', 'notBefore', 'claimedAt', 'startedAt', 'completedAt', 'requestedById',
  ]);
  assertScalars('MediaUsage', ['id', 'mediaId', 'refType', 'refId']);
  assertScalars('ExternalSourceConnection', [
    'id', 'provider', 'label', 'config', 'active', 'lastSyncAt', 'lastSyncError', 'createdById',
  ]);
});

// ── Compound keys the services address rows by ──────────────────────────────
// removeMediaFromGallery / reorderGalleryMedia / registerUsage all use compound
// wheres. A missing @@unique turns those into runtime errors, not type errors.

test('compound unique keys the services address rows by exist', () => {
  const galleryItem = model('GalleryItem').uniqueFields;
  assert.ok(
    galleryItem.some((u) => u.includes('galleryId') && u.includes('mediaId')),
    'GalleryItem has (galleryId, mediaId)',
  );
  const usage = model('MediaUsage').uniqueFields;
  assert.ok(
    usage.some((u) => u.includes('mediaId') && u.includes('refType') && u.includes('refId')),
    'MediaUsage has (mediaId, refType, refId)',
  );
});

// ── Deletion semantics encoded in the schema ────────────────────────────────

test('deleting a library item never cascades into the asset it describes', () => {
  // SetNull, not Cascade: the same physical video can also be a gallery item
  // and a quote attachment. Tidying the library must not destroy those.
  const rel = model('LibraryItem').fields.find((f) => f.name === 'media');
  assert.equal(rel.relationOnDelete, 'SetNull');
});
