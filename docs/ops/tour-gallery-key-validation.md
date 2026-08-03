# Tour Gallery — key-pipeline validation (why this guard exists)

## The incident (2026-08-03 P0)

Guide photo uploads failed in production with a generic error while every test
suite and the upload-readiness self-test were green. Root cause: the id guard
in `server/src/tours/gallery/keys.js` accepted only `[a-z0-9]` — no hyphen.

- **Production TourEvent ids are UUIDs** (`6881e558-71aa-…`) — imported/synced
  tours, even though the Prisma schema default is `cuid()`.
- **Tests and dev data historically used CUID ids** (`cmrhoex85…`), which are
  purely alphanumeric and passed the guard.

So the key builder threw `invalid_tour_event_id` for **every real tour and
every uploader** (guide staff links, customer links, office) at upload
initiation — and nothing in CI could ever see it, because fake development
identifiers masked a production-only failure. The readiness self-test also
missed it: it hand-built its probe key instead of calling the canonical
builder.

## The guard

1. **One key owner.** All gallery object keys are built by
   `tours/gallery/keys.js` (`galleryPrefix` / `originalKey` / `thumbKey` /
   `posterKey` / `archiveKey`). No handwritten keys, no duplicated id regexes.
   Callers: `uploads.js`, `service.js` (cleanup prefix), `exports.js`,
   `selfTest.js`.
2. **Pure pipeline self-check.** `keyPipelineSelfCheck()` builds
   original + thumbnail keys with a UUID id **and** a CUID id and parses each
   back (`parseGalleryKey` round-trip). No storage calls. It runs:
   - once at server startup (`index.js`) — loud warning on failure, never a
     crash; result exposed on `GET /health` as `galleryKeys: ok|failed`;
   - as the first leg (`keyBuilder`) of the upload-readiness self-test
     (`POST /api/tour-gallery/self-test`), gating `ready`.
3. **The live probe key is real.** The self-test's R2 probe object key is
   built by `originalKey(crypto.randomUUID(), …)` — the same path and the
   production id shape.

## The rule for future storage code

Any validation of storage identifiers/keys **must exercise both id formats
that exist in this system** — UUID (production tours) and CUID (schema
default) — with production-shaped sample values, and must go through the real
builder, never a lookalike string. A guard tested only with dev-shaped ids is
how this incident shipped.
