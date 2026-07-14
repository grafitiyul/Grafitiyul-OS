# GOS — Internal Migration Readiness Audit (destination side)

**Status:** Audit report. Read-only inspection of the live GOS codebase — no implementation, no
external-system access, no schema changes.
**Scope:** Proves (or disproves) that GOS is ready to be the destination for the Pipedrive +
Airtable migration. Companion to `GOS-legacy-migration-preparation-plan.md`.
**Inspected:** `server/prisma/schema.prisma` (complete — ~150 models), `server/src/whatsapp/phone.js`,
`server/src/timeline/events.js` + changelog writers, `server/src/routes/contacts.js`,
`server/src/deals/classification.js` context, service-layer conventions.
**Finalized decisions honored:** no new business entities (no "Customer"), one-time migration
(no import framework), Audit → Mapping → Snapshot → Dry Run → Validation → Production flow.
**Last updated:** 2026-07-14

---

## Verdict up front

**GOS is destination-ready with exactly ONE required schema addition** (a legacy
crosswalk/archive table, designed in the mapping phase). Every destination business model the
migration needs already exists, is live in production, and needs **zero field changes**. The
remaining work before data can load is data seeding (catalog rows), mapping decisions, and
scripts — not modeling.

Notable discovery: the timeline was **pre-wired for migration** — `TimelineEntry.actorType`
already defines an `'import'` origin ("`'import'` → a migration / import (actorLabel, e.g.
'ייבוא נתונים')"). Provenance display on migrated history is a solved problem.

---

## 1) Destination models that already exist

All live, all in production use:

| Legacy concept | Existing GOS destination |
|---|---|
| Pipedrive Organization | `Organization` + `OrganizationUnit` + `OrganizationType` (+ `OrganizationSubtype` catalog) |
| Pipedrive Person | `Contact` + `ContactPhone` + `ContactEmail` + `ContactOrganization` |
| Pipedrive Deal | `Deal` (+ `DealStage`, `DealSource`, `LostReason` catalogs) |
| Pipedrive Deal↔Person link | `DealContact` (multi-contact, roles array, per-deal comm preferences) |
| Pipedrive Activity | `Task` + `TaskType` (open/future) and `TimelineEntry` (completed/history) |
| Pipedrive Note | `TimelineEntry` (kind `note`, rich HTML body) + `TimelineComment` |
| Pipedrive File | `DealFile` (private R2, presigned-GET contract) / `MediaFile` (general R2) |
| Pipedrive Email history | `EmailThread`/`EmailMessage` (Gmail mirror — Gmail is the live archive) |
| Airtable Tour row | `TourEvent` (kind private/business/group_slot; status incl. completed/cancelled/postponed) |
| Airtable Deal↔Tour link | `Booking` (the ONLY Deal↔TourEvent relationship — locked invariant) |
| Airtable participants/seats | `TicketRegistration` (source-agnostic seat SSOT) |
| Airtable guide scheduling | `TourAssignment` (role on the row, snapshots survive staff deletion) |
| Airtable locations | `Location` (+ `WorkshopLocation` for workshop venues) |
| Airtable tour-type catalog | `Product` + `ProductVariant` (+ `ActivityType`, `ActivityComponent`) |
| Guides / staff | `PersonRef` + `PersonProfile` (staff SSOT already in GOS, incl. former staff lifecycle) |
| Payments / accounting refs | `IcountDocument`, `DealPaymentLink`, `PaymentRequest` (iCount stays external SSOT) |

Per the finalized decision, **no new business entity is needed and none will be introduced** —
"customer 360" is already achievable through existing relationships (Contact → orgLinks,
dealContacts, whatsAppChats, emailThreads; Deal → bookings → tourEvent) plus presentation.

## 2) Destination relationships that already exist

- **Contact ↔ Organization:** `ContactOrganization` — many-to-many, optional unit scope, role,
  isPrimary, unique per (contact, org, unit).
- **Deal ↔ Contact:** `DealContact` — many-to-many with `roles[]`
  (coordinator/payer/decisionMaker/participant/invoiceContact/other) + routing preferences,
  unique per (deal, contact).
- **Deal ↔ Organization/Unit/Subtype:** direct nullable FKs with SetNull; classification SSOT
  rule enforced in `src/deals/classification.js` (linked org forces business type, deal copy
  force-cleared — imports MUST route through or replicate this rule).
- **Deal ↔ TourEvent:** `Booking` only (Restrict on both FKs; partial unique = one active
  booking per deal). Direct FK is forbidden by design — the migration must honor this.
- **TourEvent ↔ staff:** `TourAssignment` — unique (tourEvent, externalPersonId), role
  per-assignment, `personRefId` SetNull + snapshot columns so history survives.
- **Seats:** `TicketRegistration` — occupancy is always derived (`SUM(quantity)` of active),
  never stored on TourEvent. Historical participant counts map to registrations or stay archived.
- **History spine:** `TimelineEntry(subjectType, subjectId)` — deliberately loose-keyed
  polymorphic; attaches to deal / contact / organization **today** and to any future subject
  with zero schema change. This is the presentation mechanism the finalized decision points to.

## 3) Destination fields that already exist (coverage highlights)

- **Deal** covers the full Pipedrive commercial core: `title`, org/unit/subtype links, required
  `dealStageId`, `status` open/won/lost, `valueMinor` (BigInt agorot) + `currency`,
  `discountMinor`, `dealSourceId` + free-text `source`, `ownerUserId` (loose string — no FK),
  `expectedCloseDate`, `wonAt`/`lostAt`, structured `lostReasonRef` + `lostNotes`, `notes`,
  working fields (`tourDate`/`tourTime`/`participants`), `orderNo` (sequence @27000).
- **Contact**: bilingual names — API requires only ONE first name (He or En); the other three
  may be empty strings (`routes/contacts.js:87`). Unlimited phones/emails with label/isPrimary.
  `communicationLanguage`, `taxId` (person-level), `notes`.
- **Organization**: `name`, type link, `taxId`, `address`, finance contact fields, `notes`;
  units carry their own finance fields.
- **TourEvent**: `date` "YYYY-MM-DD" + `startTime` "HH:MM" strings (project convention),
  language, capacity, notes, status lifecycle incl. `completed` + `completedAt`.
- **Timestamps**: `createdAt` is `@default(now())` everywhere but Prisma accepts explicit
  values on create — **original legacy timestamps can be preserved verbatim** on every model.
- **Money**: BigInt minor units + currency code everywhere — legacy floats/strings must be
  converted at transform time (single convention, no exceptions).

## 4) Entities that already support external identifiers

Strong existing precedents (the pattern is proven in five separate modules):

| Mechanism | Where |
|---|---|
| `externalPersonId` (unique) | `PersonRef` — THE staff crosswalk, already bridging recruitment→GOS |
| `sourceRef` (unique, "migration only") | `Tour`, `TourStation`, `TourContentBlock`, `TourBlockAsset` — an idempotent-ETL key already shipped for the tour-content migration |
| `@@unique([source, externalId])` | `HolidayRule`, `CalendarMarker` — idempotent import dedupe |
| `@@unique([source, externalOrderId, externalLineId])` | `TicketRegistration` — multi-source ingest (admin/deal/woocommerce) |
| Provider ids / idempotency keys | `IcountDocument.idempotencyKey`, `WooProductMapping`/`WooVariationLink`, `WhatsAppMessage @@unique([accountId, externalMessageId])`, `EmailMessage @@unique([accountId, gmailMessageId])` |

**However — the three core CRM targets have NO legacy-id support:** `Organization`, `Contact`,
`Deal` (also `Task`, `TimelineEntry`, `TourEvent`, `Booking`) carry no external-identifier
column. This is the single real gap (see §7/§8).

## 5) Entities that already support immutable history

- **`TimelineEntry`** — soft delete (`deletedAt`), content-edit stamp (`editedAt`), pinning,
  non-anonymous origin contract, and the ready-made **`actorType='import'` + `actorLabel`**
  origin. `emitTimelineEvent()` (`src/timeline/events.js`) is the single system writer;
  `dealChangelog.js` / `personChangelog.js` provide the `kind='change'` convention.
- **Append-only patterns already in production:** `DealPaymentLink` (supersede, never mutate),
  `IcountDocument` (issued snapshots + raw provider payloads), `QuoteSignature` (one per
  document, locked), `QuoteDocumentRender`, `FlowAnswer` (versioned answers),
  `QuestionnaireSubmission`/`Answer` (frozen snapshots), `PayrollEntry` (calc snapshots +
  immutable timeline), webhook logs (`CardcomWebhookLog`, `IcountWebhookLog` — raw payloads,
  deliberately FK-free so they survive entity deletion).
- **Frozen-copy convention:** customer/amount fields frozen onto payment links, name snapshots
  on assignments/payroll — the "snapshot at write, never re-read" discipline is standard here.
- **`MaintenanceJob`** — durable, claim-based, exactly-once job markers (multi-instance safe).
  A proven mechanism for tracking one-time backfill completion (the migration's loads stay
  out-of-band scripts per the phase-A/B rule, but batch bookkeeping has a home).

## 6) Models sufficient WITHOUT modification

Everything. Concretely: `Organization`, `OrganizationUnit`, `OrganizationType`,
`OrganizationSubtype`, `Contact`, `ContactPhone`, `ContactEmail`, `ContactOrganization`,
`Deal`, `DealContact`, `DealStage`, `DealSource`, `LostReason`, `Task`, `TaskType`,
`TimelineEntry`, `TimelineComment`, `DealFile`, `TourEvent`, `Booking`, `TicketRegistration`,
`TourAssignment`, `Location`, `Product`, `ProductVariant`, `PersonRef`.

No destination model needs a field added, changed, or removed for the migration. The catalogs
(`DealStage`, `DealSource`, `LostReason`, `TaskType`, `OrganizationType`) need **data rows**
(seeded from the mapping spec), not schema.

## 7) Gaps that still exist

1. **G1 — No legacy crosswalk/archive store.** The only structural gap. Core CRM entities have
   no external-id column and there is no place to park raw legacy payloads or unmapped fields.
2. **G2 — `Task` is deal-scoped and future-shaped.** `dealId` and `dueDate` are required.
   Open Pipedrive activities attached only to a person/org (no deal) have no Task home; they
   must become contact/org timeline entries or get an owner-decided rule (M3 decision).
   Completed historical activities are timeline material anyway — not affected.
3. **G3 — Stage mapping is mandatory before any deal load.** `Deal.dealStageId` is a required
   FK. Legacy pipelines/stages must map onto live `DealStage` rows (or owner-approved new
   catalog rows, e.g. a "legacy/ארכיון" stage) before a single deal inserts.
4. **G4 — `orderNo` policy undecided.** Imported deals auto-consume the @27000 sequence unless
   decided otherwise (prep-plan question §10.10 — still open, blocks the deal load only).
5. **G5 — Phone identity is convention, not constraint.** `ContactPhone.value` is stored raw;
   uniqueness of number→contact is NOT DB-enforced. Dedup must run through the canonical
   `normalizePhoneIntl` / `buildPhoneIndex` / `matchContactId` (`src/whatsapp/phone.js`) —
   exactly-one → auto-match, ambiguous → human review. The import must not invent a second
   normalizer.
6. **G6 — Owner/user mapping target is a loose string.** There is no `User` model;
   `ownerUserId`/`createdBy` are loose AdminUser ids. Historical Pipedrive owners who aren't
   current admins can only be preserved as labels (timeline `createdByName` snapshots /
   archive) — consistent with the prep plan, but now confirmed structural.
7. **G7 — Classification invariant must be honored by the loader.** Deal imports linking an
   Organization must apply the `classification.js` rule (business type forced, deal-level copy
   cleared) or corrupt the live invariant.
8. **G8 — Raw-payload storage location undecided** (DB JSONB vs R2 objects) — depends on M2
   volume data; a 15-year archive could strain Railway Postgres. Design decision for M3.

## 8) Additions truly required before importing data

**Exactly one schema addition: the `LegacyRecord` table** (final design in M3; additive-only
migration per phase-A discipline, validated by the migration gate). Shape sketch:

- `sourceSystem` / `sourceType` / `sourceId` (`@@unique` triple) — crosswalk + idempotency
- `importBatchId`, `snapshotAt` — batch bookkeeping + rollback handle
- `payload Json` (or R2 key, per G8) — raw record + unmapped-field archive
- `entityType` / `entityId` (nullable loose refs, GOS convention) — link to the migrated entity

This single table delivers idempotent upserts (lookup by source triple → entityId),
batch rollback (delete entities listed by batch), verification (reconcile counts/fields),
the Legacy Archive attachment for the UI, and the never-silently-drop guarantee — **with zero
modifications to live tables** (better than the prep plan's per-row crosswalk-column phrasing).

Everything else required is **not schema**: catalog data seeds (stages/sources/reasons per the
approved mapping), out-of-band idempotent load scripts, the verification harness, and the
review-queue tooling. Per the finalized decisions these are single-purpose scripts for THIS
migration — clean and tested, but no generic import framework, no reusable Import Center.

## 9) Prep-plan assumptions now updated after inspecting the real code

1. **Crosswalk mechanism (improved):** the plan said "every migrated row carries a legacy
   reference." Reality: the central `LegacyRecord` table carries it, pointing AT the row —
   zero live-table columns needed. Same guarantees, smaller blast radius.
2. **Provenance is already built:** `TimelineEntry.actorType='import'` + `actorLabel` exist in
   production. Migrated notes/activities/events surface their origin with no new mechanism.
3. **The source-of-truth register (June) is stale on both ends:** models it treats as future
   (`TeamMember`, `User`, `FinanceDocument`, `ConsentRecord`, "CRM Activity") either don't
   exist or landed under different names (`PersonRef` is the staff SSOT; `Task` is the CRM
   activity; `IcountDocument` is the finance mirror). And concepts it marks "Stage 0" (Orgs,
   Contacts, Deals, Tours, Bookings) are **already live GOS models at Stage 2 for new data** —
   the migration is a historical backfill into a running system, not a system bootstrap. The
   register should be revised during M3.
4. **Staff resolution is easier than assumed:** `PersonRef` (incl. former staff) +
   `TourAssignment`'s snapshot design mean legacy guide references resolve against an existing
   SSOT, and even unresolvable ones survive as name snapshots.
5. **Task shape constrains Goal A:** "pending tasks" import needs the G2 rule (non-deal
   activities) and always a due date — add to the M3 mapping spec + owner questions.
6. **Existing utilities the plan didn't credit:** the canonical phone normalizer (matching the
   register's E.164 intent), `emitTimelineEvent`, changelog writers, `MaintenanceJob`, and the
   migration validation gate (pre-commit) are all reusable as-is.
7. **Original timestamps are preservable** (explicit `createdAt` on create) — verification can
   assert date fidelity, strengthening the reconciliation reports.
8. **Batch rollback works without entity columns:** `LegacyRecord.importBatchId` +
   `entityType/entityId` lists give per-batch rollback; no `importBatchId` column on live
   tables (the plan's phrasing implied one).

## 10) Prioritized checklist — everything before the first snapshot extraction

The snapshot lands in staging storage, NOT in GOS models — so the GOS schema slice is **not**
a snapshot blocker; it blocks the load phases (M4+). Order:

**Must complete BEFORE first extraction (M1):**
1. ☐ Product-owner answers to the blocking M0 questions — minimum: Airtable base list (scope),
   Pipedrive pipeline overview, the Deal↔Tour shared-key question. (Owner)
2. ☐ Provision **read-only** Pipedrive access: dedicated read-only user + API token. (Owner
   grants; architect verifies scope by attempting a write and expecting failure.)
3. ☐ Provision **read-only** Airtable PAT: `data.records:read` + `schema.bases:read`, scoped
   to the in-scope bases only. (Owner grants.)
4. ☐ Decide + provision snapshot storage: R2 bucket/prefix for raw JSON + attachments
   (existing R2 account; new dedicated prefix). Confirm credentials and headroom. (Architect,
   owner confirms cost stance.)
5. ☐ Build the extractor: resumable, rate-limit-aware, snapshot-first, **attachments
   downloaded at extraction time** (Airtable URL-expiry trap), full schema metadata captured
   (custom-field definitions, users, pipelines, table schemas). Single-purpose code — no
   framework. (Architect.)
6. ☐ Measure-first run: extract one small entity type end-to-end, record real rate-limit
   throughput, project full-extraction duration, report before the full pull. (Architect.)

**Should complete before extraction (cheap now, expensive later):**
7. ☐ Make.com scenario inventory walkthrough (owner + architect) — identifies every legacy
   write-path; required for cutover anyway, and tells us whether snapshots drift mid-audit.
8. ☐ Remaining M0 question answers (§10 of the prep plan) — needed by M3 at the latest; the
   "active" definitions and freeze-window appetite shape the audit report's cut lines.

**Explicitly NOT pre-snapshot (deferred to their phases):**
- `LegacyRecord` schema design + additive migration → after M3 mapping sign-off, before M4.
- Stage/source/reason catalog seeds → M3 output.
- Dedup/review tooling, load scripts, verification harness → M4/M5, per approved mapping spec.
- orderNo policy, non-deal-activity rule, raw-payload storage (G4/G2/G8) → owner decisions
  during M3, informed by M2 volume data.

---

## Appendix — invariants the loader must never violate (from live code)

1. Deal↔TourEvent only via `Booking`; never a direct FK (schema comment is explicit).
2. One active `Booking` per deal (partial unique index).
3. Occupancy/seat truth only in `TicketRegistration` (derived, never stored).
4. Org-linked deal ⇒ classification forced by the org (`classification.js`).
5. Money = BigInt minor units + currency, no floats.
6. Phone matching only through `normalizePhoneIntl`; ambiguous never auto-merges.
7. Timeline entries never anonymous — imports use `actorType='import'` + `actorLabel`.
8. Backfills run out-of-band, never inside `prisma migrate` (deploy-pipeline protection).
9. Cancellation is a status, not a delete (TourEvent, Booking, TicketRegistration).
10. WhatsApp/Email mirrors never create Contacts — and neither should link-time migration
    passes; contact creation happens only in the explicit identity-spine load.
