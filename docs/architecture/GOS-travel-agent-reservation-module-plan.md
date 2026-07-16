# Travel Agency Reservation Module — Architecture Audit & Proposal

Status: PROPOSAL (audit + design only, no implementation)
Date: 2026-07-16
Scope: canonical reservation entry point for travel agents, designed as the
first consumer of a single source-agnostic booking-processing pipeline.

---

## 0) Audit summary — what exists today

A full codebase audit was performed before this design. Findings:

| Area | Finding |
|---|---|
| Existing agent form | **Does not exist in GOS.** The current permanent-link form lives outside this repo (legacy stack). Greenfield build. |
| Seat/registration SSOT | `TicketRegistration` (schema.prisma:3549) is already source-agnostic: `source` string, `@@unique([source, externalOrderId, externalLineId])` idempotency, customer snapshot fields. Only writer today is the deal path. |
| Deal creation | Inline in 3 routes (`deals.js:443`, `whatsapp.js:795`, `email.js:708`). **No shared createDeal service, no "deal created" timeline event.** |
| WON pipeline | ONE canonical transition: `settleDealWon` (`server/src/deals/paymentWon.js`) → `createTourForWonDeal`, all in `$transaction`. Reservation module must NOT duplicate it. |
| Timeline | `TimelineEntry` is polymorphic + loose-keyed (`subjectType`, `subjectId`, no DB FK). New subject types cost zero schema change. Single writer: `emitTimelineEvent` (`server/src/timeline/events.js`). |
| Idempotency precedent | Unique `idempotencyKey` column + check-before-create + `$transaction` (iCount docs/IPN); claim-based `updateMany` worker with TTL + `nextRetryAt` backoff (`whatsapp/scheduledWorker.js`). |
| Public token links | Established convention: high-entropy token `@unique`, exact-match `findUnique`, unknown → 404, subject always derived from token row, kill switch, URL-only (never localStorage). Reference resolver: `server/src/routes/portal.js` `resolvePerson`; reference model comment: `QuestionnaireLink` (schema.prisma:4108). |
| Signature | Two proven pads: `admin/documents/shared/SignaturePad.jsx` (crop-to-PNG) and bilingual `quote/SignaturePopup.jsx` (typed/uploaded/drawn). Server precedent: PNG magic-byte validation, 5 MB cap, stored as Postgres `Bytes` (`routes/signers.js`, `SignerAsset`). |
| i18n / RTL | No i18n framework. Proven pattern: per-component `L = {he, en}` tables + `dir` attribute + `shared/questionnaire/localized.mjs` (`{he,en,...}` maps, `resolveLocalized`, `isRtl`) + `questionnaire/LanguageSwitcher.jsx`. Quote page (`CustomerQuoteView.jsx`) is the proven bilingual RTL/LTR public surface. |
| Mobile public surfaces | Templates: `PublicFormPage.jsx` + `QuestionnaireRuntime.jsx` (draft autosave, single column, inline 422 problems), guide portal shell, `public/components/` primitive kit + `public/theme/tokens.js`. |
| Attachments | R2 direct-to-bucket presigned uploads, immutable-ID key scheme (`tours/gallery/keys.js`), framework-agnostic upload queue (`lib/galleryUpload.js`), private `DealFile` (no public URL column, admin-authed presigned GET only). |
| Caching | All `/api` + HTML `no-store`; no service worker. New public surfaces inherit the correct freshness posture automatically. |
| Realtime | SSE invalidation hints (`lib/realtime.js`) + BroadcastChannel buses (`tourEvents.js` pattern) for a future admin review screen. |

Conclusion: nearly every hard sub-problem (tokens, idempotency, workers,
signatures, bilingual public pages, R2, timeline) already has a proven house
pattern. The genuinely NEW concepts are exactly two entities —
**ReservationSession** and **ReservationGroup** — plus one canonical
**booking intake pipeline** with a shared Deal-creation service.

---

## 1) Architecture proposal

### 1.1 The core rule, restated as code boundaries

```
PUBLIC FORM  ──writes──▶  ReservationSession (+ Groups)   [intake — dumb, atomic]
                              │
                              ▼
                    booking processor (source-blind)      [ONE pipeline]
                              │  per-group $transaction
                              ▼
              createDealFromIntent()  ──▶  Deal + DealContact + Timeline (+ future: pricing, tasks)
```

- The form **never** touches `prisma.deal`. It has exactly one write:
  "persist my session". Everything downstream is the CRM's job.
- The processor consumes sessions regardless of `source`
  (`travel_agent` now; `website | api | internal` later) — same code path.
- Deal creation becomes a **shared service** (`server/src/bookings/createDeal.js`
  or similar) — fixing today's gap where 3 routes create Deals inline with no
  creation timeline event. Existing routes can migrate onto it later (out of
  scope for this module, but the service is designed for it).

### 1.2 Sync-first, async-safety-net processing

The agent must see real order numbers ("GOS-28134…") on the success screen,
so processing is attempted **synchronously right after the intake commit**:

1. `POST /api/public/reservations/:token/submit` — validates, persists
   Session + Groups in one `$transaction`, status `submitted`. This commit is
   the durability point: from here the reservation can never be lost.
2. Same request then invokes the processor inline. Happy path: all groups
   become Deals in milliseconds; the response already carries
   `[{groupId, orderNo, status:'processed'}]`.
3. If any group fails (or the process crashes mid-way), the session remains
   `processing`/`partially_processed`. A sweep worker (claim-based, TTL,
   `nextRetryAt` backoff — scheduledWorker pattern) retries. The public
   result screen polls a status endpoint and upgrades entries from
   "התקבל, בעיבוד" to "GOS-#####" as they land.
4. A בקרה detector (`reservation_stuck`) raises an `OperationalIssue` if a
   session isn't fully processed within N minutes — no silent failures.

This gives the UX of synchronous creation with the correctness of a durable
queue.

---

## 2) Entity model

### 2.1 `AgentReservationLink` — the permanent personal link

One row per agent capability link (NOT a column on Contact — separate model
enables rotation, kill switch, per-link settings, and future non-agent
sources), mirroring `QuestionnaireLink` / `TourGalleryLink`:

```
AgentReservationLink
  id            cuid PK
  token         String @unique        // 24-byte base64url, capability token
  contactId     FK → Contact (Restrict)   // the travel agent
  organizationId FK → Organization (SetNull)?  // the agency (optional explicit pin;
                                                // else derived from agent's primary orgLink)
  isEnabled     Boolean @default(true) // kill switch (portalEnabled pattern)
  label         String?               // admin-facing note
  defaultLanguage String @default("he")
  createdAt / revokedAt / lastUsedAt
```

Rules (inherited from the house token contract):
- exact-match `findUnique`, unknown/revoked/disabled → 404/403, never enumerable
- subject (agent Contact, agency Org) always derived from the token row
- token lives in the URL only; never persisted to device-global storage
- rotation = revoke + mint new (audit preserved)

### 2.2 `ReservationSession` — the canonical submission

```
ReservationSession
  id              cuid PK
  sessionNo       Int @unique @default(dbgenerated(...))   // own PG sequence, human ref
  source          String        // 'travel_agent' | 'website' | 'api' | 'internal'
  agentLinkId     FK → AgentReservationLink (SetNull)?     // travel_agent source
  contactId       FK → Contact (SetNull)?                  // the agent (denormalized for survivability)
  organizationId  FK → Organization (SetNull)?             // agency at submit time
  language        String        // 'he' | 'en' — language the form was filled in
  status          String        // submitted | processing | processed |
                                //   partially_processed | failed | cancelled
  submissionKey   String @unique      // client-minted UUID — intake idempotency
  payloadSnapshot Json          // the EXACT submitted payload, frozen (audit + reprocess)
  signerName      String
  signatureMethod String        // drawn | typed
  signatureBytes  Bytes?        // cropped PNG (SignerAsset precedent: magic-byte
                                // validated, 5MB cap); one signature per SESSION
  legalConfirmations Json       // [{key, textVersion, acceptedAt}] — session-wide
  clientMeta      Json?         // ip, userAgent — abuse forensics
  submittedAt / processedAt
  claimId / claimExpiresAt / attemptCount / nextRetryAt / lastError   // worker fields
```

### 2.3 `ReservationGroup` — one future Deal

```
ReservationGroup
  id              cuid PK
  sessionId       FK → ReservationSession (Cascade)
  sortOrder       Int
  status          String        // pending | processed | failed
  -- booking intent (validated refs + display snapshots, both kept):
  productId / productVariantId / locationId   FK (SetNull)  // city + tour selection
  productLabel / locationLabel  String        // frozen display snapshot
  tourDate        String        // "YYYY-MM-DD" (Deal working-scalar convention)
  tourTime        String        // "HH:MM"
  participantsBreakdown Json    // [{key, label, quantity}] structured composition —
                                //   ticketBreakdown-compatible contract (pricing-ready)
  participantsTotal Int         // derived, denormalized for lists
  tourLanguage    String?
  onSiteContactName / onSiteContactPhone  String?   // snapshot, NOT a Contact row (v1)
  notes           String?
  -- processing result:
  createdDealId   FK → Deal (SetNull)?  @unique     // exactly-once anchor
  processedAt     DateTime?
  attemptCount / lastError
```

### 2.4 Relationships

```
Contact (agent) 1 ── n AgentReservationLink 1 ── n ReservationSession 1 ── n ReservationGroup
                                                                              │ 0..1
                                                                              ▼
                                                                             Deal
```

- Session → Group: composition, `onDelete: Cascade` (a group never outlives
  its session).
- Group → Deal: `createdDealId` FK with `@unique` — a group produces **at most
  one** Deal, and the pointer lives on the *reservation* side. The Deal gets
  **no structural dependency back**: after creation Deals are fully
  independent (matching the requirement). Provenance on the Deal side is
  carried by `dealSourceId` (new DealSource catalog entry `travel_agent`),
  `source` detail string (`"session #<sessionNo>"`), and a system timeline
  entry with `data: {reservationSessionId, reservationGroupId, siblingDealIds}`.
- Deleting a session does NOT delete Deals (SetNull on `createdDealId`
  direction is irrelevant — the FK points group→deal; deal deletion nulls the
  pointer, session deletion cascades only its own rows). In practice sessions
  are never deleted (see §8).

### 2.5 What a group's Deal looks like

Created by the shared service inside the per-group transaction:

- `title` — generated: `"<agency/agent> — <location> <tourDate>"` (editable later like any Deal)
- `dealStageId` — configured intake stage (owner decision, see §11)
- `status='open'`, `activityType` per classification rule (org-linked ⇒ `business`, forced by `reconcileClassification`)
- `organizationId` — the agency (from the link/agent's primary org)
- `contacts` — the agent as `DealContact` (`roles:['coordinator']`, `isPrimary:true`)
- `productId/productVariantId/locationId`, `tourDate`, `tourTime`, `participants`, `tourLanguage` — from the group
- `dealSourceId='travel_agent'`, `source="reservation #<sessionNo>"`
- notes — group notes + on-site contact snapshot

From here the Deal enters the normal lifecycle untouched: quotes, group
registration modal, payment links, `settleDealWon`, tour creation. **This
module ends where the existing pipeline begins.**

Deliberately NOT in v1 (see §11 open decisions): auto-creating Contact rows
for on-site contacts (dedup pollution risk), seat holds / `TicketRegistration`
rows at intake (bookings are *requests*; capacity commitment stays at the
existing WON path).

---

## 3) Processing flow (exactly-once)

### 3.1 Intake (public request)

```
POST /api/public/reservations/:token/submit   { submissionKey, language, groups[], signature, confirmations }
 1. resolve token (resolvePerson-style resolver; disabled → 403, unknown → 404)
 2. validate payload (structural + per-group field validation) → 422 with per-group problems
 3. findUnique(submissionKey) → if exists, RETURN that session's current result  ← retry-safe
 4. $transaction: create Session(status='submitted') + all Groups(status='pending')
 5. respond is deferred until step 6 completes or times out (soft budget ~5s)
```

### 3.2 Processor (source-blind, reentrant)

```
processReservationSession(sessionId):
 1. claim: updateMany({id, status IN (submitted, processing-with-expired-claim)}
                       → status='processing', claimId, claimExpiresAt)
    count===0 → someone else owns it → return                    ← concurrency-safe
 2. for each group ORDER BY sortOrder:
      if group.createdDealId != null → skip                       ← retry-safe
      $transaction:
        a. re-read group FOR UPDATE, re-check createdDealId
        b. createDealFromIntent(tx, intent)      // shared service
        c. update group {createdDealId, status:'processed', processedAt}
        d. emitTimelineEvent(tx, deal-created entry on the Deal)
      on error: group {status:'failed', lastError, attemptCount++}; continue to next group
 3. finalize session:
      all processed → 'processed'
      some failed   → 'partially_processed' + nextRetryAt (backoff)
      all failed    → 'failed' + nextRetryAt
 4. post-commit: emit session timeline entry (agent Contact + reservation_session subjects),
    realtime invalidation hint
```

**Why this is exactly-once:** the Deal creation (2b) and the `createdDealId`
stamp (2c) commit in the same transaction. If the transaction commits, the
pointer exists and every future pass skips the group. If it rolls back,
neither exists and a retry is a clean re-attempt. The `@unique` on
`createdDealId` plus the claim gate make double-creation impossible even
under concurrent workers or crash-during-commit replays. This is the exact
shape already proven by `settleDealWon` + the iCount `idempotencyKey` guard.

### 3.3 Retry & failure semantics

| Failure | Behavior |
|---|---|
| Agent double-tap / network retry of submit | Same `submissionKey` → same session returned. No duplicate session, ever. |
| Crash after intake commit, before processing | Session sits at `submitted`; sweep worker picks it up (claim + TTL). Agent's result page polls and fills in as Deals land. |
| One group fails (e.g. product deleted between submit & process) | Other groups' Deals are **kept** — never rolled back (they are independent business objects the moment they exist). Failed group → `failed` + error, session → `partially_processed`, retried with backoff. |
| Repeated failure (attemptCount ≥ N) | Retries stop; בקרה detector raises `reservation_stuck` OperationalIssue with a link to the session review screen. Admin fixes data and presses "עבד מחדש" (reprocess) — which is just `processReservationSession` again, inherently safe. |
| Token disabled mid-fill | Submit → 403 with a calm bilingual message; nothing persisted. |
| Validation failure | 422 with per-group problem list (questionnaire runtime pattern); no session row created. |

The public result screen never shows raw errors — a failed group displays as
"התקבל, בטיפול" (received, being handled). Failures are an **internal**
concern; the agent's submission was accepted at step 4 and that is the
promise we make them.

### 3.4 Timeline generation

All through the single writer `emitTimelineEvent`; zero TimelineEntry schema
change (polymorphic loose keys):

- **New subject type** `reservation_session`: `submitted`, `processed` /
  `partially_processed`, per-group failure notes. Powers the session review
  screen's history.
- **On each created Deal**: one `isSystem` entry — "נוצרה מהזמנת סוכן
  #<sessionNo> (קבוצה 2/3)" with `data: {reservationSessionId,
  reservationGroupId, siblingDealIds}` so siblings are one click away. This
  also introduces the currently-missing "deal created" event convention.
- **On the agent's Contact**: one entry per session — the agent's activity
  history becomes visible on their Contact page.

---

## 4) Public form — UX architecture

Route: `/r/:token` (sibling of `/p/`, `/g/`, `/quote/`, `/form/` — outside
AdminGuard; token URL-only per the security invariant; `no-store` inherited).

Built from proven pieces — **no new UI infrastructure**:

| Need | Reuse |
|---|---|
| Mobile-first shell | Guide-portal shell conventions (sticky header, centered `max-w-2xl` column, safe-area) + `public/components/` primitive kit + `public/theme/tokens.js` |
| Bilingual he/en, RTL/LTR mirror | `L = {he, en}` tables + top-level `dir` attribute flip (CustomerQuoteView pattern) + `LanguageSwitcher` + `localized.mjs` for data-borne strings |
| Draft resilience | Questionnaire runtime's autosave pattern → local draft keyed by token (server drafts not needed in v1; a page refresh must not lose 3 filled groups) |
| Signature | `SignaturePopup` pattern (drawn `DrawPad` + typed), crop-to-PNG, ONE per session in the footer |
| Validation UX | Per-card independent validation with visible complete/incomplete state; submit blocked until all cards valid + confirmations checked |

Screen anatomy (matches the brief):

1. **Session header (live)** — agent name (from token, read-only), group
   count, per-group participant chips, total participants. Recomputed on
   every keystroke from local state.
2. **Group cards** — each group one card: city → tour (dependent selects fed
   by a public catalog DTO), date, time, participants breakdown (structured
   rows, not one number — pricing-ready), tour language, on-site contact,
   notes. Card actions: duplicate (copies everything but date), delete.
   Completeness badge per card.
3. **Session footer** — legal confirmations (session-wide), single
   signature, submit.
4. **Result screen** — "ההזמנה התקבלה" + per-group rows
   `GOS-28134 · חיפה · 12.8 · 42 משתתפים`; entries still processing show a
   pending chip and upgrade via status polling. (Public page shows numbers
   only; admin screens link numbers to Deals via `dealPath`.)

Catalog DTO: a small public read endpoint (token-gated) exposing only
bookable locations/products/variants + labels in both languages — never the
admin product DTOs.

---

## 5) Future pricing readiness (design now, build later)

The session already carries everything a pricing engine needs, so pricing
becomes a pure function over existing data — no redesign:

- **Who**: `organizationId` → `OrganizationType.defaultPriceListId` /
  `defaultPaymentTermId` (already in schema) — agency-specific pricing
  resolution path exists today.
- **What**: `participantsBreakdown` is structured `[{key, label, quantity}]`
  — the same composition contract as `ticketBreakdown` (Group Ticket Builder
  / TicketRegistration), not a bare total. Price-per-type × quantity is
  computable per group.
- **When/where**: `productVariantId` + `tourDate` + `tourTime` — enough for
  variant-, season- or date-based rules.
- **Where it lands**: pricing output belongs on the **Deal/Quote side**
  (Offer/QuoteVersion — the existing quote machinery), not on the
  reservation. A future slice adds a step 2e to the processor: "generate
  draft quote from intent". The reservation stays a frozen record of what
  was *requested*.

The only rule to hold now: participant composition is captured
**structured**, and the breakdown keys come from a catalog (not free text).

---

## 6) Attachments (future slice, designed now)

- New `ReservationAttachment {id, sessionId, groupId?, r2Key, fileName, mime,
  size, uploadedAt}` — R2 direct presigned upload reusing
  `lib/galleryUpload.js` + the immutable-ID key scheme:
  `reservations/<sessionId>/<attachmentId>-<safeName>` (keys never move).
- Magic-byte sniffing + size caps per the questionnaire-upload precedent;
  capability check runs BEFORE any upload (publicQuestionnaire pattern).
- At processing, group-scoped attachments are **server-side R2 copied** to
  `deals/<dealId>/…` and registered as private `DealFile` rows — each Deal
  owns an independent copy, honoring both "Deals are fully independent" and
  the DealFile privacy contract (no public URLs, admin-authed presigned GET
  only). Session-scoped attachments stay on the session.

---

## 7) Admin surface

New screen (nav placement TBD — likely under CRM): **הזמנות סוכנים**
(Reservations inbox):

- Sessions list (shared table infra: column chooser/drag/persistence), status
  chips, agent/agency, group count, participants, created Deal links
  (`dealPath(orderNo)`).
- Session detail: frozen payload view, per-group status, created Deals,
  signature image, legal confirmations, timeline, and a "עבד מחדש" action for
  failed groups.
- Link management lives on the **Contact page** (agent): mint link, copy URL,
  rotate, disable — mirroring the guide-portal enable/rotate UX.
- Realtime: SSE invalidation hints (`useRealtime`) or a
  `gos:reservation-changed` bus per the tourEvents convention; refetch
  canonical DTOs, never patch rows.

## 8) Session visibility & retention (Q8)

**Sessions remain permanently visible and immutable.** They are the audit
record answering "what exactly did the agent submit, and what did we do with
it" — the same role `IcountWebhookLog` / `LegacyRecord` play elsewhere. Rows
are light (Deals carry the working data). No archive/cleanup worker needed;
`payloadSnapshot` guarantees the original submission survives any later
catalog changes.

---

## 9) Extensibility — one pipeline for every source (Q10)

The pipeline is source-blind by construction:

| Source | Intake writer | Auth | Processor |
|---|---|---|---|
| Travel agent (now) | public form `/r/:token` | AgentReservationLink token | shared |
| Website (future) | checkout/booking flow | none/public + stricter abuse controls | shared |
| API (future) | `POST /api/v1/reservations` | API key/partner auth | shared |
| Internal (future) | admin "הזמנה חדשה" UI | AdminGuard | shared |
| WooCommerce inbound (future) | order webhook → session | webhook secret | shared |

Each source is ONLY a new intake adapter: authenticate, map to the session
payload contract, call `submitReservationSession(payload, sourceCtx)`. The
processor, `createDealFromIntent`, timeline, retries, pricing hook and admin
inbox are shared. `ReservationSession.source` + nullable `agentLinkId` keep
the model honest for source-specific fields.

This also positions `createDealFromIntent` as the future home for the 3
existing inline Deal-creation sites (WhatsApp/email/manual) — a later,
separate cleanup.

---

## 10) Answers to the audit questions

1. **Should ReservationSession be its own entity?** Yes. It is the durability
   point, the idempotency anchor (`submissionKey`), the audit record
   (payload snapshot + signature + confirmations), and the retry spine. No
   existing entity can absorb those roles.
2. **Should Groups be their own entity?** Yes. The group is the exactly-once
   unit of work: per-group status, per-group error, per-group `createdDealId
   @unique`. Groups-as-JSON-on-session would make partial failure and
   idempotent retry unimplementable.
3. **Session → Group → Deal relationships?** Session 1—n Group (cascade
   composition); Group 0..1—1 Deal via unique `createdDealId` on the group
   side; **no structural back-reference on Deal** — provenance via
   DealSource + system timeline entry. Deals are fully independent from birth.
4. **Exactly-once Deal creation?** Three locks: (a) `submissionKey @unique`
   dedupes intake; (b) session claim (`updateMany` conditional transition)
   serializes processors; (c) Deal create + `createdDealId` stamp in ONE
   `$transaction`, pointer `@unique`. All three are existing house patterns.
5. **Retries?** Submit retries return the existing session. Processing
   retries: sweep worker, claim TTL, `attemptCount` + `nextRetryAt` backoff,
   skip-if-`createdDealId`. After N attempts → stop + בקרה issue + manual
   reprocess button (same function, inherently safe).
6. **Partially failed sessions?** Succeeded groups keep their Deals forever
   (never rolled back). Failed groups retry independently. Session status
   `partially_processed` is a first-class state with admin visibility. The
   agent always sees "received" — internal failures never leak to the public
   result page.
7. **Timeline?** Via the single writer `emitTimelineEvent`, three subjects:
   the session (new loose subjectType, zero schema change), each created Deal
   (system "created from reservation" entry with sibling links — introducing
   the missing deal-created event), and the agent Contact.
8. **Session visible in GOS after processing?** Yes — permanent, immutable,
   with its own review screen; it is the audit trail and the reprocess
   surface.
9. **Attachments?** Future slice; designed: `ReservationAttachment` on R2
   (immutable keys, presigned direct upload, existing upload engine), copied
   into private `DealFile` per Deal at processing time.
10. **Website / API / Internal / Agent bookings without duplicated logic?**
    Yes — sources are thin intake adapters over one
    `submitReservationSession` + one processor + one `createDealFromIntent`.
    §9 table.

---

## 11) Open product decisions (owner input needed before Slice 1)

1. **Intake Deal stage** — which `DealStage` do agent-created Deals land in?
   (Recommend a dedicated stage or the first stage by sortOrder; needs a
   product decision, it shapes the team's pipeline view.)
2. **Agency org linkage** — always attach the agent's primary organization to
   the Deal (forcing `activityType='business'` per the classification SSOT)?
   Recommended yes; confirm this matches how agent deals are worked today.
3. **On-site contact** — v1 stores it as a snapshot on the group/Deal notes
   (recommended; avoids Contact-table pollution). Confirm no requirement to
   create Contact rows now.
4. **Tour selection semantics** — v1 treats groups as *requests* (no seat
   holds, no `TicketRegistration` at intake; capacity commitment stays at the
   existing WON path). Confirm agents don't need live-availability
   guarantees at submit time.
5. **Participant breakdown keys** — which composition types should the form
   offer (age bands? ticket types per product)? This defines the
   pricing-ready catalog.
6. **English scope** — full form + result screen in both languages from day
   one, or Hebrew-first with EN in a follow-up slice?

## 12) Risks called out honestly

- **Public write surface**: a leaked token lets an outsider create Deals.
  Mitigations: per-token rate limiting + payload caps at intake, kill switch,
  rotation, `clientMeta` forensics, and a בקרה anomaly detector
  (sessions/hour per link) in the hardening slice. Residual risk accepted as
  with payment/questionnaire links.
- **Catalog drift**: product/location deleted between submit and process →
  per-group permanent failure path + admin reprocess (designed in §3.3), and
  label snapshots keep the session readable forever.
- **No i18n framework**: per-component `L` tables scale poorly, but adopting
  a framework for one module is over-engineering now. Accepted; revisit if a
  third bilingual admin surface appears.
- **Deal-stage/no-pricing gap**: until the pricing slice, agent Deals arrive
  without value — the team must triage them manually. Called out so it's not
  mistaken for a bug.

---

## 13) Slice plan

Each slice ships independently, pushed to main (= deploy) only when verified.

- **Slice 0 — this document.** Decisions §11 answered by owner.
- **Slice 1 — Entities + agent links.** Prisma models
  (`AgentReservationLink`, `ReservationSession`, `ReservationGroup`,
  `sessionNo` sequence, DealSource `travel_agent`), migration (validated via
  `npm run validate:migrations`), token mint/rotate/disable on the Contact
  page, resolver + tests (portal.resolve.test.js pattern). No public UI yet.
- **Slice 2 — Public form.** `/r/:token` bilingual mobile-first form: header
  summary, group cards (validate/duplicate/delete), catalog DTO endpoint,
  local draft, signature + confirmations, submit → session persisted
  (status `submitted` only). Honest "received" screen (no Deal numbers yet).
  Admin: minimal read-only sessions list.
- **Slice 3 — Processing pipeline.** `createDealFromIntent` service,
  processor (claim + per-group tx + exactly-once), inline-sync attempt +
  sweep worker, timeline entries (session / Deal / Contact), result screen
  upgraded to live GOS-numbers with status polling.
- **Slice 4 — Admin review + control.** Full הזמנות סוכנים inbox (shared
  table infra), session detail + reprocess action, realtime invalidation,
  בקרה `reservation_stuck` detector.
- **Slice 5 — Hardening + EN polish.** Rate limiting, payload caps, anomaly
  detector, link-usage audit, full English pass, mobile QA.
- **Future slices (designed, not scheduled):** pricing hook (draft quote from
  intent), attachments (§6), website/API intake adapters, migration of the 3
  legacy inline Deal-creation sites onto `createDealFromIntent`.
