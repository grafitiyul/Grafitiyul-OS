# Phase 1 — GOS Tour Content Domain (Design)

> Status: **design / proposal only** — not implemented. No schema, migration, or data
> changes have been made. This document is the agreed design for making GOS the source
> of truth for Tour Content, ahead of the future permissions/access layer.

---

## 1. Business decisions (locked)

1. Tour content is **internal only** — for trainees and guides. Not public.
2. It must be **extremely convenient, fast, and field-accessible**.
3. **GOS is the source of truth** for tour content.
4. A **tour** is built from **stations**.
5. A **station** is built from **ordered steps**.
6. A station is **not always a physical place** — it may be a physical location, a specific
   artwork, a binder/printed-material item, or another content stop.
7. A story/content block may appear in **multiple tours or multiple stations**.
8. Therefore content is **reusable by reference, not copied**.
9. Permissions are needed at **station level**.
10. There are only **two access states**: has access / no access.
11. The old `default_only` / `full_access` distinction is **removed**.
12. When a trainee becomes staff, **all existing station access must be preserved**.
13. More staff permissions may be granted later (additive).
14. **Active/inactive** is enough for publishing state.
15. **Version/history is required**, but quiet/admin/audit-level — not a prominent daily UI.
16. Lessons-learned is **out of scope** for now.
17. Tour content and procedures are **separate layers**.
18. Location links are interesting but **not required now**.
19. **Hebrew only for V1**, but the model must not block future English.
20. **Media is stored in R2 via the existing `MediaFile` model** — not DB binary
    (`MediaAsset`). Recruitment used DB BYTEA / unstable server files only because it
    was never connected to R2; GOS is.

---

## 2. Final domain model (business terms)

Core concepts, each with one job:

- **Tour** — an ordered collection of stations. Internal; active/inactive.
- **Station** — a *stop* with a **kind** (`location | artwork | printed_material |
  content_stop`). Owns an ordered list of steps and its own access list.
- **Step** — the *placement* of a content block into a station at a position. A step is
  not content; it says "block X appears here, in this order." This is what enables reuse.
- **Content Block** — the reusable unit of actual content (story/script/explanation):
  rich Hebrew body + attachments. Stored once, referenced from many steps across many
  stations and tours. Edit once → updates everywhere referenced.
- **Station Access** — a binary grant (has / no access) keyed to a person's stable GOS
  identity, so it survives the trainee→staff transition untouched.

Supporting, deliberately quiet:

- **Block Version** — immutable snapshot on each block edit. Admin/audit only.
- **Station Note** — admin/curator annotations, never shown to the learner.

Shape:

```
Tour → Station → Step → (reference) → ContentBlock → BlockAsset
                   │
                   ├── StationAccess → PersonRef   (binary)
                   └── StationNote                 (admin-only)
```

---

## 3. Proposed Prisma shape (proposal only)

Conventions: `cuid` PKs, PascalCase models, camelCase fields, `sortOrder`, `active`,
`He`-suffixed text (English additive later), and a `sourceRef` unique key on every
migrated entity for **idempotent import** + recruitment-id mapping. Namespaced `Tour*`
to stay separate from the learning `Flow`/`ContentItem` domain (decision 17).

```prisma
model Tour {
  id            String        @id @default(cuid())
  sourceRef     String?       @unique          // "tour:<recruitment.id>"
  titleHe       String
  descriptionHe String?
  active        Boolean       @default(true)
  sortOrder     Int           @default(0)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  stations      TourStation[]
}

model TourStation {
  id            String              @id @default(cuid())
  sourceRef     String?             @unique      // "station:<recruitment.id>"
  tour          Tour                @relation(fields: [tourId], references: [id], onDelete: Cascade)
  tourId        String
  titleHe       String
  descriptionHe String?
  kind          String              @default("location") // location|artwork|printed_material|content_stop
  heroImage     MediaFile?          @relation("TourStationHero", fields: [heroImageId], references: [id], onDelete: SetNull)
  heroImageId   String?
  locationId    String?             // optional future link to GOS Location (decision 18) — unused in V1
  active        Boolean             @default(true)
  sortOrder     Int                 @default(0)
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  steps         TourStep[]
  access        TourStationAccess[]
  notes         TourStationNote[]
  @@index([tourId, sortOrder])
}

model TourContentBlock {              // the reusable unit
  id            String                    @id @default(cuid())
  sourceRef     String?                   @unique
  titleHe       String?
  bodyHe        String                    @default("")   // rich HTML; inline images via R2 public URLs
  internalNote  String?
  shared        Boolean                   @default(false) // true = shown in reuse library; false = one-off inline
  active        Boolean                   @default(true)
  createdAt     DateTime                  @default(now())
  updatedAt     DateTime                  @updatedAt
  assets        TourBlockAsset[]
  placements    TourStep[]
  versions      TourContentBlockVersion[]
}

model TourStep {                      // ordered placement of a block into a station
  id             String           @id @default(cuid())
  station        TourStation      @relation(fields: [stationId], references: [id], onDelete: Cascade)
  stationId      String
  contentBlock   TourContentBlock @relation(fields: [contentBlockId], references: [id], onDelete: Restrict)
  contentBlockId String
  sortOrder      Int              @default(0)
  isVisible      Boolean          @default(true)
  roleHint       String?          // optional label carried from recruitment parts (build_up etc.); not a constraint
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  @@index([stationId, sortOrder])
}

model TourBlockAsset {
  id             String           @id @default(cuid())
  sourceRef      String?          @unique
  contentBlock   TourContentBlock @relation(fields: [contentBlockId], references: [id], onDelete: Cascade)
  contentBlockId String
  assetType      String           // video | image | file | link
  language       String?          // he | en | null  (he-only in V1, field kept for future)
  titleHe        String
  url            String?          // stable external links (YouTube/Vimeo/Drive/etc.)
  media          MediaFile?       @relation("TourBlockAssetMedia", fields: [mediaId], references: [id], onDelete: SetNull)
  mediaId        String?          // re-hosted binaries → R2/MediaFile
  sortOrder      Int              @default(0)
  active         Boolean          @default(true)
  // API invariant: url OR mediaId present
}

model TourStationAccess {             // binary: row with revokedAt null = HAS access
  id           String      @id @default(cuid())
  station      TourStation @relation(fields: [stationId], references: [id], onDelete: Cascade)
  stationId    String
  personRef    PersonRef   @relation(fields: [personRefId], references: [id], onDelete: Cascade)
  personRefId  String
  grantedById  String?
  grantedAt    DateTime    @default(now())
  revokedById  String?
  revokedAt    DateTime?
  @@unique([stationId, personRefId])
  @@index([personRefId])
}

model TourContentBlockVersion {       // quiet history/audit
  id             String           @id @default(cuid())
  contentBlock   TourContentBlock @relation(fields: [contentBlockId], references: [id], onDelete: Cascade)
  contentBlockId String
  versionNumber  Int
  titleHe        String?
  bodyHe         String
  editedById     String?
  createdAt      DateTime         @default(now())
  @@unique([contentBlockId, versionNumber])
}

model TourStationNote {               // admin-only annotations
  id        String      @id @default(cuid())
  station   TourStation @relation(fields: [stationId], references: [id], onDelete: Cascade)
  stationId String
  contentHe String      @default("")
  sortOrder Int         @default(0)
}
```

**Additive touches to existing models (only these):**

```prisma
model PersonRef {
  // ...existing...
  tourStationAccess TourStationAccess[]
}

model MediaFile {
  // ...existing...
  tourStationHeroes TourStation[]    @relation("TourStationHero")
  tourBlockAssets   TourBlockAsset[] @relation("TourBlockAssetMedia")
}
```

### Reusable content blocks
Stored once, referenced by steps. The same block can be a step in Station A of Tour 1 and
Station B of Tour 2 at the same time. Editing it updates every placement (decision 8;
mirrors GOS `SharedContent`). `shared=false` blocks are one-off/inline (not shown in the
reuse picker); `shared=true` appear in the library. `onDelete: Restrict` on step→block
prevents deleting a block still placed somewhere.

### Ordered steps
A station owns an ordered list of `TourStep` rows (`sortOrder`) — the step order **is** the
presentation order. There is no separate ordering table (recruitment's `station_flow_items`
is subsumed). `isVisible` hides without deleting. Station `kind` lets the field UI adapt.

### Station-level access
Binary, per station, per person. A `TourStationAccess` row with `revokedAt = null` = has
access; no active row = no access. Subject is `PersonRef.id` — the stable GOS identity —
so when `lifecycleHint` flips `trainee → staff`, **access is preserved with zero migration**
(decision 12). Team-level grants (decision 13) are a future additive `TourStationAccessTeam`.

---

## 4. R2 / MediaFile decision

GOS stores tour-content media **in Cloudflare R2 via `MediaFile`** (metadata + object key
in DB; bytes in R2). DB binary storage (`MediaAsset`) is **not** used for tour content.
GOS already has the R2 layer (`server/src/r2.js`: `presignPut`, `buildKey`, `publicUrl`,
`isConfigured`) and the `MediaFile` model.

- `TourStation.heroImage` → `MediaFile`.
- `TourBlockAsset.media` → `MediaFile`.
- Inline images inside `bodyHe` → R2 public URLs embedded in the HTML.
- Stable external URLs (YouTube/Vimeo/Drive) stay as `url`.

---

## 5. Concepts dropped from recruitment

- **`default_only` / `full_access`** → binary has/no access (decision 11).
- **`is_default` variant flag + single-default constraint** → gone (existed only to power
  `default_only`).
- **Fixed 4-part taxonomy (`station_part_definitions`)** → free ordered steps; old label
  preserved only as optional `TourStep.roleHint`.
- **`station_flow_items` table** → subsumed by step ordering.
- **`asset_context` (`flow`/`gallery`)** → dropped; steps sequence explicitly.
- **Hero-image bookkeeping columns** (`hero_image_stored_path`, `hero_image_import_status`,
  `hero_image_import_error`) → not carried.
- **Tour-scoped `trainee_portal_tokens`** → replaced by `PersonRef.portalToken` + station grants.
- **SERIAL integer IDs** → `cuid` (with `sourceRef` preserving the old id for traceability).
- **DB-binary media** → R2/`MediaFile` (decision 20).

---

## 6. Recruitment → GOS mapping

| Recruitment (SERIAL) | GOS (cuid) | Transform |
|---|---|---|
| `tours` | `Tour` | `is_active`→`active`; `order_index`→`sortOrder`; `name`→`titleHe` |
| `stations` | `TourStation` | `kind='location'` default; `hero_image_data`/`_mime` → R2 `MediaFile` → `heroImageId`; external `hero_image_url` kept |
| `station_part_definitions` | dropped | 4 labels survive as optional `TourStep.roleHint` |
| `station_part_variants` | `TourContentBlock` **+** `TourStep` | variant→block (`body`→`bodyHe`, `title`→`titleHe`) + a step placing it. `is_default` discarded; `roleHint`=part key |
| `station_assets` | `TourBlockAsset` | attach to block via `variant_id`; station-level (`variant_id` NULL) → per-station gallery block (confirm); external `url` kept, unstable → R2 |
| `station_flow_items` | dropped (table) | order/visibility → `TourStep.sortOrder`/`isVisible` |
| `station_notes` | `TourStationNote` | 1:1 |
| `trainee_station_access` | `TourStationAccess` (Phase 2) | `default_only`/`full_access` → one grant; `no_access`/absent → none; `candidate_id` → `PersonRef` via `externalPersonId="candidate:<id>"` |
| `trainee_portal_tokens` | dropped | replaced by `PersonRef.portalToken` + station grants |

Every migrated row carries `sourceRef` → **idempotent, re-runnable** import.

### R2 migration flow — BYTEA hero images
For each `stations` row with `hero_image_data`: read buffer + mime → `buildKey('tour-content/hero', '<sourceRef>.<ext>')` → `presignPut` → HTTP `PUT` buffer → create `MediaFile` (`r2Key`, `publicUrl`, `bucket`, `filename`, `mimeType`, `sizeBytes`, `kind:'image'`) → set `TourStation.heroImageId`. Deterministic key → re-run re-links, no duplicate.

### R2 migration flow — unstable asset URLs
Classify each `station_assets.url` (and any inline `bodyHe` URLs). For unstable/recruitment-hosted: fetch bytes → `buildKey('tour-content/asset', …)` → `presignPut` → `PUT` → create `MediaFile` → set `TourBlockAsset.mediaId`, `url=null` (and rewrite inline HTML `src`). Dead URLs → report as broken, never fabricate.

### What remains plain `url`
Stable external hosts GOS doesn't own: YouTube, Vimeo, Google Drive/Docs, `asset_type='link'`, other stable third-party https. Re-host only when availability depends on recruitment staying up or its filesystem persisting.

---

## 7. Migration phases (non-destructive)

- **Phase 1a — Model (GOS):** additive Prisma migration for the `Tour*` tables + `MediaFile`/`PersonRef` back-relations. No effect on existing features.
- **Phase 1b — APIs + admin UI (GOS):** read + admin-CRUD, `requireAdminAuth`, `no-store`; media via existing R2 flow. Flow-editor uses transactional step replace.
- **Phase 1c — One-time ETL (read-only on recruitment, R2 uploads for media):** import tours→stations→blocks/steps→assets→notes in FK order, keyed by `sourceRef`; hero BYTEA + unstable URLs → R2. Emits a migration report (counts, broken URLs, skipped).
- **Phase 1d — Verify:** parity counts, media resolves, no DB blobs, idempotency proof.
- **Phase 1e — Designate GOS as source of truth:** freeze tour-content editing in recruitment (read-only) so copies can't diverge; recruitment keeps serving its own copy to its trainee portal for now (no runtime coupling yet).
- **Phase 2 (later):** station access grants migration + grant UI (binary), on top of stable `PersonRef` identity.
- **Phase 3 (later):** recruitment consumes tour content from GOS via GOS export endpoints; retire recruitment tour tables.

---

## 8. Risks & verification

**Risks**
- Live-reference edits change content in every tour instantly (decision 8); versioning gives
  history but not a per-tour freeze — decide if V1 needs publish-snapshotting later.
- Broken/dead recruitment media (see inventory) can't be re-hosted → report, don't fabricate.
- HTML `bodyHe` URL rewriting must only touch recruitment-owned URLs.
- Recruitment-hosted binary **video** has no clean `MediaFile.kind` (image/pdf/doc) — flag.
- ETL must be re-runnable after partial failure (check both R2 object + MediaFile row before create).
- R2 must be configured in the ETL environment (`isConfigured()`), else uploads fail closed.

**Verification (post-migration, before cutover)**
1. Coverage: recruitment hero-data count == GOS stations with `heroImageId`; unstable assets == GOS assets with `mediaId`.
2. No DB blobs in GOS tour content (all media is `MediaFile`/R2).
3. Every new `MediaFile.url` returns 200 with correct type/size.
4. No recruitment-origin URLs remain (except intentional externals).
5. Broken-URL report produced for manual follow-up.
6. Spot-render sample stations in GOS admin (hero + assets + inline).
7. Idempotency proof: re-run → zero new R2 objects / MediaFile rows / re-links.

---

## 9. Open product decisions

1. Import channel: read-only DB→DB ETL (recommended) vs richer recruitment export endpoints.
2. One-off block authoring UX + `shared` promotion.
3. New-station access default: nobody until granted (recommended) vs auto-grant.
4. Optional `openToAll` station shortcut?
5. Versioning scope (blocks only, recommended) + restore in V1?
6. Station-kind starting set + extensibility.
7. Duplicate placement of a block within one station (proposed: allowed).
8. Station-level (`variant_id` NULL) asset landing spot (proposed: per-station gallery block).
9. Recruitment-hosted binary video handling (edge case).

---

## Appendix — Migration data volume (read-only inventory, 2026-07-03)

- Content: **4 tours, 76 stations, 421 variants, 156 assets, 4 flow-items, 5 notes**.
- Hero images: **32** stations with BYTEA (all `image/jpeg`, ~16.3 MB total, max ~6.8 MB) →
  R2. **26** stations have a legacy `hero_image_stored_path` but **no data** (broken —
  lost with recruitment's ephemeral filesystem) → cannot migrate; manual review.
- `station_assets.url` (156): **148 stable-external** (Vimeo/YouTube), **7 other-external**
  (review, likely keep), **1 relative junk** (`"בב"`, id #124 — bad data). **Zero
  recruitment-hosted URLs** → asset URL re-hosting is effectively unnecessary.
- Inline URLs in HTML bodies: **0**.
- Legacy `stations.hero_image_url`: **1** (Google Photos album link, station #6 — review).
- Reachability (HEAD/range probe, 155 absolute URLs): **151 reachable, 3 dead (HTTP 404)**
  — assets #27 & #31 (Google Drive files, removed by owner) and #88 (Greenpeace page) — plus
  #110 (`youtu.be/TsRmKhHNvqc`) timed out on HEAD (likely rejects the method; probably fine,
  re-check manually). Dead links are external content the owners deleted → flag for content
  review, not a re-hosting task.
- **Overall media-migration risk: LOW** — only 32 small JPEGs to move to R2; asset URLs are
  external. Main cleanup items: 26 broken heroes, 1 junk asset URL, 1 Google-Photos hero link.
</content>
