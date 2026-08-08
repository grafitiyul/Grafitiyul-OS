# GOS Media & Content Platform — Audit (2026-08-08)

Audit phase only. No schema or code changed. Read this before any implementation
slice; the decisions in §9 gate the build.

---

## 1. What already exists (the headline)

The single most important audit result:

> **GOS does not lack a media engine. It has two and a half of them, plus a
> production-grade public gallery system — and the two model names this project
> proposed (`MediaAsset`, `ContentItem`) are already taken by unrelated models.**

Building "one canonical engine" here is therefore mostly a **convergence**
problem, not a greenfield problem. Getting that wrong produces a third engine,
which is the exact outcome the project brief forbids.

---

## 2. The R2 storage layer — mature, reusable as-is

`server/src/r2.js` (372 lines) is a complete, well-built S3/R2 layer. Nothing
here needs replacing:

| Capability | Function | Notes |
|---|---|---|
| Presigned direct PUT | `presignPut` | bytes never touch Express |
| Multipart create/part/complete | `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload` | server orchestrates only |
| Server-side part listing | `listParts` | completion uses R2's own list — a lying client cannot fabricate parts, and no CORS `ExposeHeaders` dependency |
| Streaming server upload | `uploadStream` | 32 MB parts, constant memory, aborts on failure |
| Range read | `getObjectRange` | used for magic-byte verification of client uploads |
| Short-lived read URL | `presignGet` | private objects + `ResponseContentDisposition` download naming |
| Public URL | `publicUrl` | `R2_PUBLIC_BASE_URL` + key |
| GC helpers | `deleteObject`, `deleteObjects`, `listKeys`, `listMultipartUploads`, `abortMultipartUpload` | batch delete **throws** on partial failure; abort is idempotent |
| Graceful absence | `isConfigured()` | missing env → clear error, not a crash |

Object keys: `buildKey(folder, filename)` → `<folder>/<8-byte-hex>-<sanitised
tail>`. Collision-safe and deterministic in shape. Gallery keys are built
separately in `server/src/tours/gallery/keys.js` under
`tour-galleries/<tourEventId>/…`, which is what makes prefix-purge cleanup work.

**Verdict: reuse unchanged. The new engine is a consumer of this file.**

---

## 3. The asset models — where the duplication actually is

GOS currently persists R2/binary references in **five** different shapes:

### 3.1 `MediaFile` — the de-facto canonical "reusable asset"
`schema.prisma:2649`. Already does the thing the brief asks for: **one physical
object, referenced by many consumers, no byte copying.** Its back-relations:

- `ProductVariant` (meeting image), `ProductVariantImage` (gallery)
- `Location` (meeting-point image)
- `QuoteDocumentRender`
- `SharedContent` (shared content library images)
- `TourStation` (hero), `TourBlockAsset`
- `QuoteImage` (quote image library)

Limitations for this project:
- `sizeBytes Int` → **~2 GB ceiling**; wrong type for long video.
- `url String` — a stored *public* URL, implying these objects live on the public
  base. There is no per-object access decision.
- No `durationSeconds`, no `checksum`, no `thumbKey`/`posterKey`, no upload
  lifecycle state, no storage strategy, no external-source fields.
- `kind` is `image | pdf | doc` only — no video/audio.

### 3.2 `TourMedia` — the richer asset model, but hard-bound to a tour
`schema.prisma:5346`. Everything `MediaFile` lacks:
`thumbKey`, `posterKey`, `byteSize BigInt`, `width/height`, `durationSeconds`,
`capturedAt`, `checksum`, `uploadStatus` (`pending` → `ready`, server-verified),
multipart `uploadId`/`partSize`, `batchId`, full uploader attribution
(`office | guide | customer`), soft delete with `deletedById`.

But: `galleryId` (required FK) + denormalised `tourEventId`. **It cannot
represent an asset that is not a tour photo.**

### 3.3 `MediaAsset` — legacy, stores blobs in Postgres
`schema.prisma:345`. `bytes Bytes` — the raw file **in the database**. Violates
the project's own "avoid storing huge binaries in Postgres" rule. Used by
`people/profileImage.js`, `questionnaires/uploads.js`, `routes/media.js`,
`services/exports/docx.js`, `editor/imageDropPaste.js`, `StationEditor.jsx`.

**This is the name collision.** The brief's canonical `MediaAsset` cannot use
this name without a rename migration of a live model.

### 3.4 / 3.5 `DealFile` and `EmailAttachment`
Both are `r2Key` + `bucket` + `sizeBytes Int` records scoped to their owner
(deal / email message). `EmailAttachment.r2Key` is nullable — cached on demand.
Per the existing "Unified Files system" rule these are the Files concept and are
deliberately *not* library content.

### 3.6 `ContentItem` — the second name collision
`schema.prisma:153` is the **learning-module item bank** (`title` as HTML, `body`,
`folderId`, `flowNodes`). Nothing to do with a content library.

---

## 4. Public galleries — already built, tour-bound

`TourGallery` / `TourMedia` / `TourGalleryLink` / `TourGalleryCleanupTask` /
`TourGallerySettings` / `TourGalleryExport`, with services in
`server/src/tours/gallery/` (access, uploads, exports, keys, links, cleanupWorker,
zipStream, selfTest — **each with a `.test.js`**) and a public route at
`server/src/routes/publicGallery.js`.

Client: `client/src/gallery/` — `CustomerGalleryPage`, `GalleryGrid`,
`GalleryLightbox`, `UploadPrimaryButton`, `UploadQueuePanel`, `DownloadAllButton`;
uploader in `client/src/lib/galleryUpload.js`.

Measured against the Part A brief:

| Brief requirement | Status today |
|---|---|
| Public link, unguessable token | ✅ 24-byte base64url, `TourGalleryLink.token @unique` |
| Identity derives from token, never client input | ✅ explicitly enforced |
| Rotate link (old dies) | ✅ revoke + create, `revokedReason: 'rotated'` |
| Disable / Enable | ⚠️ **only revoke** — no reversible disable |
| Revoked reads as 404, indistinguishable | ✅ |
| External upload to R2 | ✅ gated by `customerUploadEnabled`, attributed `customer` |
| Multi-file, progress, retry, multipart | ✅ |
| Server-verified completion (no false success) | ✅ `pending` → `ready` after HEAD + magic bytes |
| Lightbox, grid, mobile-first, lazy | ✅ |
| Download-all ZIP, async, streamed | ✅ `TourGalleryExport` + `zipStream.js` |
| Safe cleanup / GC | ✅ `TourGalleryCleanupTask` — **never auto-purges a gallery with live media**; requires explicit admin approval + raises an OperationalIssue |
| Soft delete keeps audit | ✅ `deletedAt` / `deletedById` |
| Bilingual He/En public text | ❌ **absent** |
| Standalone (non-tour) gallery | ❌ **`tourEventId @unique` — impossible today** |
| Internal name + public title/subtitle | ❌ title is derived (product · date · customer) |
| Permission matrix canView/Download/Upload/Delete/Edit | ❌ one boolean; customers **can never delete**, by design |
| Cover image | ⚠️ `coverMediaId` exists |
| Reorder | ❌ no sort column on `TourMedia` |

So Part A is roughly **70% already built**, in a system that is
production-live with real customer media, and locked to tours.

---

## 5. Public link / capability-token conventions

Consistent across the estate — the new engine must follow it, not invent:
`TourGalleryLink`, `QuestionnaireLink`, `AgentReservationLink`, portal `/p/:token`,
`publicQuote`, `publicReservations`, `publicSitePages`.

Convention: opaque random token, `@unique`, stored as-is, resolved server-side,
`status: active | revoked`, `revokedAt` + `revokedReason`, masked-prefix logging
(`maskToken`), `Cache-Control: no-store`, denial as 404.

Note: `server/src/publicLinks.js` is **not** this — it is the registry of
marketing-site page URLs. Different concept, easily confused by name.

---

## 6. Workers, settings, uploads (all reusable)

- **Workers**: ~20 canonical interval workers registered in
  `server/src/index.js` (`startTourGalleryCleanupWorker`, `startControlSweepWorker`,
  `startReservationWorker`, …). Claim-based, idempotent, retry-aware. New jobs
  (thumbnails, Vimeo→R2 import, transcription) fit this pattern exactly.
- **Settings**: `client/src/admin/settings/` — `SettingsShell` (width presets),
  `SaveBar` (save-state), `cards.jsx`, `settingsNav.js` (+ test),
  `CrmSettingsHome.jsx` ← the "תיקיות תמונות וסרטונים" card lands here.
- **Uploads (client)**: `lib/galleryUpload.js` (multipart), `lib/upload.js`,
  `admin/common/useFileDrop.js`, `fileAccept.js`, and `fileInputGuard.test.js`
  which **fails the build on a raw `<input type=file>`** — the new uploader must
  go through `useFileDrop`.
- **Nav**: code owns module identity, `NavPreference` owns presentation,
  `navResolve.js` is the one resolver. A new module = a registry entry.

---

## 7. Multi-workspace reality — the biggest gap

**GOS has no tenancy of any kind.** `AdminUser` is `{ username, displayName,
passwordHash, role String @default("admin"), isActive }`. There is no permission
model, no workspace, no scoping. Every admin can do everything.

**Challenge System** (`c:\Projects\challenge-system`, NestJS + Prisma monorepo)
*does* have a real one: a `Workspace` model, `workspaceId` on ~15 domain roots
with `onDelete: Restrict`, a primary workspace (`wsp_grafitiyul_primary`) that
the entitlement resolver treats as fully entitled, and tenant-scoped uniqueness
(`@@unique([workspaceId, externalChatId])`).

Critically, **Challenge already has its own media stack**:
`apps/api/src/modules/upload/media-storage.ts` reading its own `R2_BUCKET` /
`R2_ACCOUNT_ID` / `R2_PUBLIC_BASE_URL`, plus a `SoundAsset` library that already
implements the exact patterns this brief asks for — workspace ownership
(`workspaceId String?`, NULL = shared platform catalog), a neutral per-workspace
alias layer (`WorkspaceSoundSelection`), and **reference-aware deletion**
(`SoundAssetUsage` with generic `refType` + `refId`).

So "do not build three copies" is already half-violated: Challenge has a working
one. Any GOS-central engine must either serve Challenge or knowingly coexist.

---

## 8. Transcription — pattern reusable, code is not

`c:\Projects\grafitiyul-recruitment` — TypeScript, **raw SQL over node-pg (no
Prisma)**, numbered `.sql` migrations. Transcription lives in
`server/src/routes/evaluatorPortal.ts`:

- OpenAI **`whisper-1`**, called by hand-rolled `https.request` multipart to
  `/v1/audio/transcriptions` (deliberately avoiding SDK/fetch differences on
  Windows), `language: he`, `response_format: text`.
- **`response_format: text` means no timestamps and no segments** — the brief's
  future timestamp/speaker features need `verbose_json`, not this call.
- **Storage is the local filesystem**, not R2:
  `path.resolve(process.env.UPLOAD_PATH ?? './uploads', '..', chunk.storage_path)`.
- **Chunked by design**: the client's MediaRecorder rotates every ~60 s; each
  chunk is a standalone audio file transcribed independently, then assembled in
  `chunk_seq` order. The code comments state plainly that handing Whisper a
  concatenated stream transcribes only the first ~60 s and silently drops the
  rest. This is hard-won knowledge worth keeping.
- Concurrency capped (`MAX_WHISPER_CONCURRENT`) to avoid 429 cascades.
- Execution is **fire-and-forget in-process** (`transcribeChunkAsync`) with a
  polling assembler — not a durable, restart-surviving job.

Status vocabulary already in use: `pending | processing | done | failed | skipped`.

**Verdict:** do not import this code. Reimplement the *technique* in GOS as a
durable worker over R2 objects, behind a provider abstraction. **GOS has no
OpenAI key today** — the only AI credentials present are Anthropic
(`server/src/agent/provider/anthropic.js`, and that file belongs to another
session's in-flight work) and `communication/translate.js`.

---

## 9. YouTube / Vimeo

Nothing exists. No connector, no credentials, no `ExternalMediaSource` concept
anywhere in the schema or server. Fully greenfield — and fully blocked on
credentials (§11).

---

## 10. Repo-safety situation (must be respected during implementation)

`git status` on `main` shows **another session's uncommitted work in progress**:

- `server/prisma/schema.prisma` — **+296 lines**, entirely the AI-agent feature
  (`AgentSettings`, `AgentCapabilityState`, `AgentProposal`, `AgentInsight`,
  `AgentStyleProfile`, …), with its migration `20261015090000_ai_agent/`
  **still untracked**.
- Also foreign: `client/src/App.jsx`, `client/src/lib/api.js`,
  `client/src/shell/moduleRoutes.js`, `server/src/index.js`,
  `server/src/routes/whatsapp.js`, `server/src/dealTitleGuard.test.js`,
  `server/src/agent/`, `client/src/admin/ai-agent/`.

This project must edit several of those same files (`schema.prisma`, `index.js`,
`api.js`, `moduleRoutes.js`). `git add server/prisma/schema.prisma` would sweep
in 296 lines of another session's schema **without its migration** — precisely
the production incident this repo has already suffered.

**Safe staging procedure for shared files (non-interactive):**

```sh
git diff -- server/prisma/schema.prisma > /tmp/all.patch
# keep only this feature's hunks
git apply --cached /tmp/media.patch
git diff --cached -- server/prisma/schema.prisma   # verify before commit
```

Never `git add -A`. Never stage a schema hunk this feature does not own.

---

## 11. Credentials required before anything can be activated

| Purpose | Env var | Present in GOS? |
|---|---|---|
| R2 storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | ✅ configured |
| Transcription | `OPENAI_API_KEY` | ❌ **absent** |
| YouTube Data API v3 | `YOUTUBE_API_KEY` (+ channel id) | ❌ absent |
| Vimeo | `VIMEO_ACCESS_TOKEN` (scopes: `private`, `video_files`) | ❌ absent |
| Challenge→GOS content API | a service token pair | ❌ does not exist |

Without these, transcription, YouTube and Vimeo can be **built** but ship in a
truthful "not configured" state. Part A (galleries) needs none of them.

**Vimeo caveat:** `video_files` (the direct source-file URLs required for
"Import to R2" *and* for transcribing a Vimeo item) is **not available on all
Vimeo plans** — it generally requires Pro or above. Until the account's plan and
token scopes are confirmed, "Import to R2" cannot be honestly enabled. Page
scraping is out per the brief.

---

## 12. Recommended architecture (pending §13 decisions)

**Promote, don't duplicate.** Generalise the proven `TourGallery`/`TourMedia`
engine rather than writing a third one:

```
MediaObject      ← generalised TourMedia (tour binding becomes optional owner ref)
                   + storageStrategy: r2_native | external_reference | mirrored_to_r2
                   + external source fields (provider, externalId, sourceUrl, …)
Gallery          ← generalised TourGallery (optional tourEventId; + He/En public
                   fields, internal name, permission matrix, enable/disable)
GalleryItem      ← membership + sortOrder  (removal ≠ asset destruction)
GalleryLink      ← generalised TourGalleryLink (adds reversible disable)
LibraryItem      ← the Content Library entry ("ContentItem" name is taken)
LibraryCategory  ← + join table
MediaTranscript  ← versioned, provenance-carrying
MediaJob         ← durable worker rows (thumbnail | mirror | transcribe)
MediaUsage       ← generic refType/refId reference tracking (Challenge's proven
                   SoundAssetUsage pattern) — powers reference-aware deletion
```

Naming note: `MediaAsset` and `ContentItem` are unavailable. Either rename the
legacy models (migration on live data) or adopt `MediaObject` / `LibraryItem`.
Recommendation: **adopt the new names** — cheaper, zero risk, and the legacy
Postgres-blob `MediaAsset` should be retired on its own schedule anyway.

---

## 12b. Delivery status (2026-08-08)

### Shipped and verified in production

Commits `ff3074a5` (see §14 note), `6edc337a`, `81b64fdd`. Migration
`20261016090000_media_content_platform` applied at 09:45 UTC.

- Schema generalisation + 12 new tables, fully additive.
- `server/src/media/` — keys, galleries, access, audit, usage, jobs, uploads.
- Admin API `/api/media/galleries`, generic public surface on `/api/gallery/:token`.
- Operator UI (Settings → CRM → תיקיות תמונות וסרטונים) + bilingual public viewer.
- 46 new tests; 4355 server + 1010 client tests green.

Production verification performed against real data:

| Check | Result |
|---|---|
| Migration applied, 12 tables created, workspace seeded | ✅ |
| Existing data: 24 tour galleries, 470 live media, 26 links | ✅ unchanged |
| **Generic key builder vs 200 real production media rows** | ✅ **200/200 byte-identical** for both `objectKey` and `thumbKey` |
| Public standalone gallery, He default | ✅ |
| `?lang=en` switches title + subtitle | ✅ |
| `internalName` never appears in the public payload | ✅ 0 occurrences |
| Disable → 404, Enable → 200 **on the same URL** | ✅ |
| Rotate → old token 404, new token 200 | ✅ |
| `extCanView=false` → 404 (server-side enforcement) | ✅ |
| Archived → 404 | ✅ |
| Audit trail records every mutation in order | ✅ |
| QA teardown by captured id; prod state restored | ✅ |

### Not built yet (Part B and the remainder)

Honest status — the schema and service seams exist for all of these, but the
code does not:

- Content Library service/routes/UI (`LibraryItem`, `LibraryCategory` tables exist).
- YouTube + Vimeo connectors and the import screen (`ExternalSourceConnection`,
  `TourMedia.source*` and the duplicate-protection unique index exist).
- Transcription provider + worker (`MediaTranscript`, `MediaJob` exist; job
  claim/retry/failure-reason service is written and tested).
- External Content API + service-token auth (`ContentServiceToken`,
  `LibraryItemWorkspace` exist).
- Thumbnail/mirror workers — no `MediaJob` worker is registered in `index.js` yet.

### Known gaps in what DID ship

1. **"Download all" is refused for standalone galleries** (`409
   export_not_supported_for_gallery`, button hidden). The ZIP archive's expiry
   is keyed on `tourEventId`; enabling it before re-keying on `galleryId` would
   write archives nothing ever purges. Fix = generalise `exports.js` +
   `TourGalleryExport` and the cleanup worker.
2. **Reordering has no drag-and-drop UI yet.** `sortOrder`, the reorder service
   and `POST /media/reorder` all work and are respected by the public viewer;
   only the drag interaction is missing.
3. **`GalleryItem` (cross-gallery reuse) has no UI.** The table, service and
   reference-aware delete are in place and used by the read path.
4. **No thumbnails for office uploads without a client-generated derivative** —
   same as the tour gallery today (derivatives are produced client-side by
   design; there is no server image pipeline).

## 12d. Part B — Content Library (shipped 2026-08-08, commit `41d2a439`)

Module at `/admin/content-library`, registered in `MODULE_REGISTRY` as a
management module (`defaultInNav: false`, like every other one — an
administrator pins it from ניהול התפריט; shipping it visible would have
rewritten every existing user's nav rail).

**Server** — `media/library.js`, `media/transcripts.js`, `media/imports.js`,
`media/serviceAuth.js`, `media/worker.js`, `media/providers/{youtube,vimeo}.js`,
`media/transcription/openai.js`, `routes/contentLibrary.js`, `routes/contentApi.js`.

**Client** — `admin/content/{ContentLibraryPage,ContentItemView,ContentImportPage,CategoriesPanel,ConnectionsPanel,contentLabels}`.

### Decisions worth remembering

- **Transcription is size-refused, not silently truncated.** The recruitment
  system's code documents that Whisper transcribes only the first ~60s of a long
  concatenated stream and drops the rest. GOS media is one finished R2 object,
  not client-recorded segments, and there is no ffmpeg in this deployment — so a
  file over the 25 MB API limit is REFUSED with a reason rather than sent as a
  fragment whose partial result would look complete.
- **`verbose_json` from day one**, so timestamps/segments/speakers can be added
  later without re-transcribing the archive. (Recruitment used plain `text`,
  which is why it can never add them retroactively.)
- **An empty transcript is a failure**, not a success — silent audio and wrong
  formats both return `""`.
- **Vimeo mirroring is capability-gated by a LIVE probe.** `capabilities()`
  reads `/oauth/verify` for the `video_files` scope AND inspects a real video for
  `download`/`files`. `canMirrorToR2` is true only when an actual file link was
  observed — never from a plan name or documentation, because a token can hold
  the scope while the plan exposes nothing.
- **Import writes `external_reference` even when mirroring was requested**; the
  strategy flips to `mirrored_to_r2` only when bytes actually land in R2.
- **Duplicate identity is `(provider, externalId)`**, enforced by the DB unique
  constraint, never by title.
- **Consumers never get an object key.** The Content API returns
  `storageStrategy` but not `objectKey`, and playback is a fresh presigned URL
  per request, so revoking a token actually revokes access.

### Production verification (2026-08-08, controlled QA records only)

| Check | Result |
|---|---|
| `/api/content` unauthenticated / bad token | ✅ 401, no detail leaked |
| `/api/content-library` without admin session | ✅ 401 |
| Primary (GOS) token sees its item | ✅ |
| **Non-primary workspace cannot see it (list)** | ✅ 0 results |
| **Non-primary workspace cannot fetch it by id** | ✅ 404 |
| Search matches a word present ONLY in the transcript | ✅ 1 match |
| Re-transcribe keeps history, exactly one current | ✅ 2 versions, 1 current |
| Grant enforcement (`canTranscribe` absent) | ✅ 403 |
| Transcribe WITH grant but no `OPENAI_API_KEY` | ✅ 503 `transcription_not_configured` |
| YouTube reference playback | ✅ embed, never a file URL |
| QA teardown by captured id; prod state restored | ✅ |

### Known gaps

1. **A >25 MB audio/video cannot be transcribed at all.** Fix = an audio
   extraction/segmentation step (ffmpeg in the deploy, or a provider that
   accepts larger files). Today it fails honestly.
2. **No thumbnail worker.** `MediaJob.kind = 'thumbnail'` exists and is unused;
   derivatives are still client-generated at upload, as in the gallery.
3. **Vimeo mirroring is untested against a real account** — no token exists yet.
   The path is built and unit-tested; its first real run will be the first proof.
4. **`ExternalSourceConnection` is unused.** YouTube channel selection is via
   `YOUTUBE_CHANNEL_ID` / a typed handle; the table is there for when several
   named connections per provider are needed.

## 12c. The MediaFile convergence path (do not skip)

Owner decision (2026-08-08): `MediaFile` is NOT migrated in this project.
Temporary coexistence is accepted; **permanent duplication is not.** The path,
recorded so it cannot quietly become permanent:

1. `MediaFile.sizeBytes Int` → `BigInt` (additive widen) — it currently caps at
   ~2 GB, which is wrong for video and is the one change that cannot wait
   indefinitely.
2. Add `MediaUsage` rows for every existing `MediaFile` consumer, so the
   "is it still referenced?" question has one answer across both models.
3. Introduce `TourMedia.legacyMediaFileId` (nullable) and backfill one
   `TourMedia` row per `MediaFile`, `storageStrategy='r2_native'`.
4. Repoint the 8 relations (ProductVariant, Location, QuoteImage, SharedContent,
   TourStation, TourBlockAsset, QuoteDocumentRender, ProductVariantImage) one at
   a time, each behind its own migration + test.
5. Retire `MediaFile` only once no relation points at it.

Also outstanding, and deliberately deferred as cosmetic-but-risky: the Prisma
models are still named `TourGallery` / `TourMedia` even though they now hold
non-tour data. Renaming them (with `@@map` to the existing tables, so zero SQL
runs) touches ~88 call sites across 11 files plus test stubs on a live
customer-facing system. It is worth doing as its own separately-verifiable
change, and worth nothing bundled into a feature.

## 13. Decisions required before implementation

1. **Gallery engine strategy** — generalise the live tour engine (one engine,
   touches production customer galleries) vs. build standalone alongside (zero
   risk, two engines until a later merge).
2. **Asset-model convergence** — converge `MediaFile` into the canonical object
   now (migration across 8 relation sites) or leave it for images-by-reference
   and converge later.
3. **Tenancy timing** — introduce a real `Workspace` model in GOS now, or ship
   Content Library GOS-only on a workspace-ready schema and wire the external
   consumers later.
4. **Sequencing** — Part A (galleries) first, Part B (library) first, or both.

Everything else in the brief is inferable from existing convention.
