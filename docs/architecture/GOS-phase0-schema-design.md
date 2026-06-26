# GOS — Phase-0 Schema Design Proposal

**Status:** Design proposal only. No Prisma code, no migrations, no tables. Architecture is locked
(see `GOS-architecture-proposal.md` and `GOS-source-of-truth-register.md`).
**Purpose:** Specify every Phase-0 model — purpose, key fields, relationships, ownership, indexes,
uniqueness, soft-delete, audit — and **challenge the model before code is written**.
**Last updated:** 2026-06-24

> Field types below are conceptual (e.g. "uuid", "bigint", "citext", "jsonb", "timestamptz").
> They describe intent, not Prisma syntax. The actual schema is a later step.

---

## 1) Cross-cutting conventions (apply to every model unless stated)

- **Primary keys:** `id` = **UUID v7** (time-ordered). Rationale: globally unique (safe for imports
  and cross-system references), time-sortable (good index locality on high-volume tables like
  `Message` and `DomainEvent`), and non-guessable. App-generated, not DB-generated.
- **Timestamps:** `createdAt`, `updatedAt` — `timestamptz`, always UTC.
- **Soft delete:** `deletedAt` (`timestamptz`, nullable) + `deletedByUserId` on most entities.
  **Critical consequence:** every "uniqueness rule" below that must coexist with soft-delete is a
  **partial unique index** (`... WHERE deleted_at IS NULL`). Postgres unique constraints can't do
  this; partial indexes can. This is the single biggest schema-mechanics decision.
- **PII / anonymization:** entities holding personal data also get `anonymizedAt`. Anonymization
  (strip PII, keep the row + links) is **distinct** from soft-delete (hide the row). Records tied
  to tax/legal documents are **anonymized, never deleted** (retention).
- **Money:** every amount is `bigint` minor units **plus** a `currency` `char(3)` (always `ILS`
  now). Never store an amount without its currency. **No float/double for money, ever.**
- **Enums vs lookup tables:** stable, closed sets (message direction, document type) → enum.
  Evolving/config-driven sets (deal stage, roles) → **lookup/config table**, not enum (Postgres
  enums are painful to alter, and stages are configuration per the architecture).
- **External reference columns** (`pipedriveId`, `airtableId`, `recruitmentExternalId`,
  `icountDocId`): nullable, unique-where-not-null. They exist **only** for the mirror→flip
  migration and are removable per-concept after cutover. They are not business keys.
- **No tenant/orgId column anywhere.** GOS is single-business. Multi-tenancy is on the
  never-build list.
- **Secrets** (WhatsApp tokens, payment-provider keys) are **never** plaintext columns — store a
  reference to a secret manager.

---

## 2) Challenge the model — tensions to lock BEFORE writing schema

These are the decisions that are expensive to change later. I give a recommendation for each.

1. **Polymorphic links (Note, Attachment, Activity, FormResponse, LessonLearned).**
   Prisma/Postgres can't FK-enforce a polymorphic `(targetType, targetId)`. Two options:
   (a) **explicit nullable FKs** per target (FK-safe, queryable, but columns proliferate as
   entities grow); (b) **generic `targetType`+`targetId`** (flexible, no referential integrity).
   **Recommendation:** explicit nullable FKs for the *small* Phase-0 target set (Deal, Contact,
   Organization, Tour, TeamMember). Use generic loose references **only** for `DomainEvent` and
   `AuditLog`, which are polymorphic by nature. Revisit if note/attachment targets explode.

2. **Soft-delete vs append-only — three classes.** Not everything should be soft-deletable:
   - **Soft-delete** (`deletedAt`): most CRM/Ops/Finance-ops entities.
   - **Immutable append-only** (no update, no delete): `DomainEvent`, `AuditLog`,
     `ProcedureVersion`, published `FormDefinition` versions.
   - **Status-driven** (no delete; lifecycle via status): `Payment`, `Conversation`, `Message`,
     `FinanceDocument` (a mirror).
   Mixing these uniformly is a mistake; the per-model specs below assign each one explicitly.

3. **Derived/denormalized fields.** `Deal.collectionStatus` (from `Payment`s) and
   `Conversation.lastMessageAt` (from `Message`s) are caches. **Recommendation:** treat the
   event-derived read-model as the truth long-term; if we denormalize for query speed now, it must
   be updated in the **same transaction** as the source change, and documented as a cache. Do not
   let two writers update it.

4. **Supporting models your list omits but Phase 0 needs** (see Section 3). Building the listed
   models without these creates hidden hardcoded enums and missing FKs.

5. **`User` vs `TeamMember` vs `Contact` email collision.** All three can have an email. The
   `User.email` is a **login identity**, not a communication address. Keep them as separate columns
   on separate models; do not "share" an email field. (Identity stays separate — already locked.)

6. **High-volume tables** (`Message`, `DomainEvent`): design for append + future time-partitioning
   from day one (UUID v7 PK helps). Don't add wide mutable columns to them.

---

## 3) Supporting models required but NOT in your list (flagged)

These are needed for Phase 0 to be coherent. I recommend including them:

- **UserRole** and **RolePermission** — the RBAC join tables (without them, Role/Permission are
  inert).
- **DealStage** (and optionally **Pipeline**) — deal stages are configuration data, not an enum.
- **Location** — Tours reference reusable venues, not free-text strings.
- **ConsentRecord** — locked in the architecture (privacy); Phase 0 stores customer + message +
  guide PII, so consent must exist now, not later.
- **EventConsumerOffset / ProcessedEvent** — lets automation/consumers be idempotent (track which
  `eventId`s were handled). Small but essential for the event backbone.
- *(Optional now, likely soon)* **QuoteLine** — if quotes need structured line items rather than a
  `jsonb` blob.

The rest of this document specifies the requested models **and** these supporting models where they
are structurally required.

---

## 4) Identity & Access

### User
- **Purpose:** an authenticatable principal (a login). Distinct from TeamMember and Contact; may be
  a person or a service account.
- **Key fields:** `id`; `email` (citext, login identity); `passwordHash` (nullable — null when
  SSO-only); `displayName`; `status` (enum: invited/active/suspended); `lastLoginAt`;
  `teamMemberId` (nullable FK — a User may *be* a TeamMember); timestamps; `deletedAt`.
- **Relationships:** `*–* Role` via **UserRole**; `0..1 TeamMember`; actor on `AuditLog`,
  `Activity.ownerUserId`, etc.
- **Ownership:** Identity & Access.
- **Indexes:** unique `email` (partial, where not deleted); `teamMemberId`; `status`.
- **Uniqueness:** `email` unique among non-deleted, case-insensitive.
- **Soft delete:** yes. Auth queries must exclude soft-deleted **and** suspended.
- **Audit:** HIGH — creation, status changes, role grants/revocations, password resets.

### Role
- **Purpose:** a named bundle of permissions (RBAC).
- **Key fields:** `id`; `key` (e.g. `admin`,`manager`,`office`,`sales`,`guide`); `name`;
  `description`; `isSystem` (protects built-ins from edit/delete); timestamps.
- **Relationships:** `*–* Permission` via **RolePermission**; `*–* User` via **UserRole**.
- **Ownership:** Identity & Access.
- **Indexes:** unique `key`.
- **Uniqueness:** `key` unique.
- **Soft delete:** **no** — use an `archived` flag; system roles cannot be deleted.
- **Audit:** HIGH (security-sensitive).

### Permission
- **Purpose:** a single capability = resource + action + scope (e.g. `deal.read.all`,
  `deal.write.own`, `tour.assign.team`). A **seeded, closed reference set** referenced by code.
- **Key fields:** `id`; `key` (unique); `resource`; `action`; `scope` (enum: own/team/all);
  `description`.
- **Relationships:** `*–* Role` via **RolePermission**.
- **Ownership:** Identity & Access.
- **Indexes:** unique `key`.
- **Uniqueness:** `key` unique.
- **Soft delete:** **no** (seeded reference data).
- **Audit:** changes to the permission catalog (rare) — yes.
- **Challenge:** `scope=team` presumes a team-membership/hierarchy concept that doesn't exist yet.
  **Recommendation:** seed `own` and `all` now; defer real `team` scope until a team hierarchy
  model exists. Don't fake it.

### UserRole / RolePermission (join tables)
- **Purpose:** RBAC assignments.
- **Key fields:** `UserRole(userId, roleId)`; `RolePermission(roleId, permissionId)`; `grantedAt`,
  `grantedByUserId`.
- **Indexes / uniqueness:** unique composite on each pair.
- **Soft delete:** no — revocation = row delete, but **log it in AuditLog** (revocations matter).
- **Audit:** HIGH.

---

## 5) CRM

### Organization
- **Purpose:** external company/account (school, company, municipality).
- **Key fields:** `id`; `name`; `legalName` (nullable); `type` (FK to a small type lookup or enum:
  school/company/municipality/other); `website`; `address` (jsonb); `pipedriveId` (nullable
  unique); timestamps; `deletedAt`.
- **Relationships:** `1–* Contact`; `1–* Deal`; referenced by `FinanceDocument.customerRef`
  (logical).
- **Ownership:** CRM.
- **Indexes:** `name` (trigram/GIN for search); `type`; unique `pipedriveId`.
- **Uniqueness:** none on natural keys (dedup is a process, not a constraint); `pipedriveId` unique.
- **Soft delete:** yes.
- **Audit:** MEDIUM.
- **Challenge:** Organization is **optional** — a Deal/Contact can be an individual with no org.
  `organizationId` is nullable on both.

### Contact
- **Purpose:** external person.
- **Key fields:** `id`; `firstName`; `lastName`; `displayName`; `organizationId` (nullable FK);
  `primaryEmail` (citext, nullable); `title`; `source`; `pipedriveId` (nullable unique);
  timestamps; `deletedAt`; `anonymizedAt`.
- **Relationships:** `*–1 Organization`; `1–* ContactPhone`; `1–* DealContact`;
  `1–* ConsentRecord`; `0..* Conversation` (resolved); subject of `Activity`, `Note`, `Attachment`.
- **Ownership:** CRM.
- **Indexes:** `organizationId`; `primaryEmail` (non-unique — dedup is a process); unique
  `pipedriveId`; trigram on name for search.
- **Uniqueness:** none enforced on natural identity; `pipedriveId` unique.
- **Soft delete:** yes **+ anonymization** (PII). Anonymize strips name/email; keeps id + links so
  financial/operational history stays intact.
- **Audit:** MEDIUM-HIGH (PII; consider access logging for sensitive views).

### ContactPhone
- **Purpose:** phone identity — maps a normalized number to a Contact; the anchor for WhatsApp
  resolution.
- **Key fields:** `id`; `contactId` (FK, **required**); `e164` (normalized, the key); `rawInput`;
  `label` (mobile/office/whatsapp); `isPrimary`; `verifiedAt` (nullable); timestamps; `deletedAt`.
- **Relationships:** `*–1 Contact`. Used by `Conversation` resolution (Conversation links to
  Contact, matched via this number).
- **Ownership:** CRM.
- **Indexes:** **partial unique** on `e164` `WHERE deleted_at IS NULL` (a number resolves to ≤1
  active Contact); `contactId`; partial unique `(contactId) WHERE isPrimary AND deleted_at IS NULL`.
- **Uniqueness:** one active mapping per number. **Re-assignment over time** = soft-delete the old
  mapping, create a new one (history preserved). Numbers are not globally unique forever.
- **Soft delete:** yes — deactivation is how re-mapping works.
- **Audit:** MEDIUM (resolution changes affect which conversations attach to whom).
- **Challenge:** a `ContactPhone` **always** has a Contact. Unknown inbound numbers do **not**
  create orphan ContactPhones — they live as unresolved `Conversation`s (Section 8).

### Deal
- **Purpose:** the commercial agreement. **Owns money** (total value, discount, terms).
- **Key fields:** `id`; `title`; `organizationId` (nullable FK); `stageId` (FK → **DealStage**);
  `status` (enum: open/won/lost — separate from pipeline stage); `valueMinor` (bigint) + `currency`;
  `discountMinor` (nullable) + `currency`; `paymentTerms` (jsonb/text); `expectedCloseDate`;
  `wonAt`/`lostAt`/`lostReason`; `ownerUserId` (sales owner); `collectionStatus` (**derived cache**
  from Payments — see tension #3); `pipedriveId` (nullable unique); timestamps; `deletedAt`.
- **Relationships:** `*–1 Organization`; `*–1 DealStage`; `1–* DealContact`; `1–* Booking`;
  `1–* Quote`; `1–* Payment`; `1–* PaymentLink`; `0..* FinanceDocument`; `1–* Activity`.
- **Ownership:** CRM (commercial). **No `tour_id` on Deal** — linked via Booking only.
- **Indexes:** `organizationId`; `stageId`; `status`; `ownerUserId`; `expectedCloseDate`; unique
  `pipedriveId`.
- **Uniqueness:** none natural; `pipedriveId` unique.
- **Soft delete:** yes (lost ≠ deleted — `status=lost` keeps it).
- **Audit:** **HIGH — field-level** on `valueMinor`, `discountMinor`, `paymentTerms`, `stageId`,
  `status`. Money and stage history must be reconstructable.

### DealContact
- **Purpose:** M:N Deal↔Contact with multiple roles + per-deal communication preferences.
- **Key fields:** `id`; `dealId` (FK); `contactId` (FK); `roles` (text[]/enum[]: coordinator,
  payer, decisionMaker, participant, invoiceContact, other); `isPrimary` (bool);
  `receiveConfirmations`, `receiveOperationalUpdates`, `receivePaymentLinks`, `receiveQuotes`
  (bool); timestamps; `deletedAt`.
- **Relationships:** `*–1 Deal`; `*–1 Contact`.
- **Ownership:** CRM.
- **Indexes:** partial unique `(dealId, contactId) WHERE deleted_at IS NULL`; partial unique
  `(dealId) WHERE isPrimary AND deleted_at IS NULL` (≤1 primary per deal); GIN on `roles`;
  `contactId`.
- **Uniqueness:** one active link per (deal, contact); at most one primary per deal.
- **Soft delete:** yes.
- **Audit:** MEDIUM (who may receive payment links is sensitive). **Routing is gated by
  `ConsentRecord`** — legal consent overrides these per-deal flags.

### Activity
- **Purpose:** Pipedrive-style CRM touchpoint — call, follow-up, send quote, check payment, meeting,
  CS reminder. **NOT a generic task; NOT an operational task; NOT a procedure checklist item.**
- **Key fields:** `id`; `type` (enum: call/follow_up/send_quote/check_payment/meeting/cs_reminder/
  other); `subject`; `notes`; `dueAt`; `completedAt`; `status` (enum: planned/done/cancelled);
  `ownerUserId`; explicit nullable targets `dealId`, `contactId`, `organizationId`; timestamps;
  `deletedAt`.
- **Relationships:** optional `*–1` to Deal/Contact/Organization; `*–1 User` (owner).
- **Ownership:** CRM.
- **Indexes:** `dealId`; `contactId`; `ownerUserId`; `(ownerUserId, dueAt)` (my upcoming);
  `status`.
- **Uniqueness:** none.
- **Soft delete:** yes.
- **Audit:** LOW-MEDIUM.
- **Challenge:** at least one target FK should be set (app-level check; not enforceable as a single
  DB constraint cleanly).

### Note
- **Purpose:** free-text note attached to an entity.
- **Key fields:** `id`; `body` (text); `authorUserId`; explicit nullable targets `dealId`,
  `contactId`, `organizationId`, `tourId`, `teamMemberId`; timestamps; `deletedAt`.
- **Relationships:** `*–1 User` (author) + target FKs.
- **Ownership:** CRM (platform-ish, but lives with CRM in Phase 0).
- **Indexes:** one per target FK; `authorUserId`.
- **Uniqueness:** none.
- **Soft delete:** yes.
- **Audit:** LOW.
- **Challenge:** explicit-FK fan-out (tension #1). Acceptable at this entity count; reconsider if
  note targets keep growing.

### Attachment
- **Purpose:** **metadata** for a file attached to an entity. Bytes live in object storage (Files
  platform), never in the DB.
- **Key fields:** `id`; `fileName`; `mimeType`; `sizeBytes`; `storageKey` (object-store path);
  `checksum` (content hash — immutable/content-addressed, aligns with the caching rule);
  `uploadedByUserId`; explicit nullable targets (same set as Note); timestamps; `deletedAt`.
- **Relationships:** `*–1 User` + target FKs.
- **Ownership:** Files platform (metadata); referenced by domains.
- **Indexes:** one per target FK; unique `storageKey`.
- **Uniqueness:** `storageKey` unique.
- **Soft delete:** yes (metadata). Physical file deletion is a separate retention job.
- **Audit:** MEDIUM (uploads/deletions).

---

## 6) Operations

### TourType
- **Purpose:** catalog template for a kind of tour (defaults only — **not authoritative price**).
- **Key fields:** `id`; `key`; `name`; `description`; `defaultDurationMin`; `defaultPriceMinor`
  (bigint) + `currency` (**suggested**, never overrides Deal); `requiredSkills` (text[]);
  `defaultCapacity`; `active`; timestamps; `deletedAt`.
- **Relationships:** `1–* Tour`.
- **Ownership:** Operations (catalog).
- **Indexes:** unique `key`; `active`.
- **Uniqueness:** `key` unique.
- **Soft delete:** archive via `active` + `deletedAt`; keep history (Tours reference it).
- **Audit:** LOW.

### Tour
- **Purpose:** operational execution instance. **No commercial data, no price, no dealId.**
- **Key fields:** `id`; `tourTypeId` (FK); `title`; `scheduledStart` (timestamptz);
  `scheduledEnd`/`durationMin`; `timeZone` (default `Asia/Jerusalem`); `locationId` (FK →
  **Location**); `status` (enum: draft/scheduled/confirmed/in_progress/completed/cancelled);
  `capacity`; `notes`; `airtableId` (nullable unique); timestamps; `deletedAt`.
- **Relationships:** `*–1 TourType`; `*–1 Location`; `1–* Booking`; `1–* TourAssignment`.
- **Ownership:** Operations.
- **Indexes:** `scheduledStart` (calendar/upcoming — heavily used); `tourTypeId`; `status`;
  `locationId`; unique `airtableId`.
- **Uniqueness:** none natural.
- **Soft delete:** yes; **cancellation is a status, not a delete**.
- **Audit:** MEDIUM (schedule + status changes).
- **Challenge:** store UTC + explicit `timeZone`; do not assume the server zone. A Tour can exist
  **before** any Deal (open/public tours) and may have **no** Deal at all (internal/training/free).

### Booking
- **Purpose:** the Deal↔Tour join — links commercial to operational.
- **Key fields:** `id`; `dealId` (FK); `tourId` (FK); `seats` (int); `allocatedAmountMinor`
  (bigint, **nullable**) + `currency`; `status` (enum: tentative/confirmed/cancelled); timestamps;
  `deletedAt`.
- **Relationships:** `*–1 Deal`; `*–1 Tour`.
- **Ownership:** Operations.
- **Indexes:** `dealId`; `tourId`; partial unique `(dealId, tourId) WHERE deleted_at IS NULL`.
- **Uniqueness:** **Recommendation:** one active booking line per (deal, tour); use `seats` for
  quantity. *(Alternative: allow multiple lines per pair for separate seat blocks — drop the unique.
  Decide before code.)*
- **Soft delete:** yes.
- **Audit:** MEDIUM (commercial allocation).
- **Challenge:** `allocatedAmountMinor` is optional and **never** replaces the Deal total.
  Capacity enforcement (`sum(seats) ≤ Tour.capacity`) is application logic, not a DB constraint.

### TourAssignment
- **Purpose:** rich assignment of a TeamMember to a Tour (operational facts + pay snapshot).
- **Key fields:** `id`; `tourId` (FK); `teamMemberId` (FK); `role` (enum: lead/assistant/trainee/
  driver/coordinator); `status` (enum: proposed/offered/confirmed/declined/cancelled); `attendance`
  (enum: unknown/present/no_show); `checkInAt` (nullable); `agreedAmountMinor` (bigint, nullable) +
  `currency`; `payrollOverrideMinor` (nullable) + `overrideReason`; `notes`; timestamps;
  `deletedAt`.
- **Relationships:** `*–1 Tour`; `*–1 TeamMember`.
- **Ownership:** Operations (facts). **Payroll/Finance READS the pay snapshot — never a second
  writer.**
- **Indexes:** `tourId`; `teamMemberId`; partial unique `(tourId, teamMemberId) WHERE deleted_at
  IS NULL` (one assignment per member per tour — role is a field).
- **Uniqueness:** one active assignment per (tour, member).
- **Soft delete:** yes.
- **Audit:** MEDIUM-HIGH (pay snapshot is money).
- **Challenge:** **double-booking** (a guide on two time-overlapping tours) is a cross-row,
  time-range check — **not** a simple unique constraint. Flag as application logic (or a Postgres
  exclusion constraint later).

---

## 7) Team

### TeamMember
- **Purpose:** internal staff identity (guide/office/manager/sales). **GOS-owned source of truth.**
- **Key fields:** `id` (**GOS-generated canonical id**); `firstName`; `lastName`; `displayName`;
  `memberTypes` (text[]: guide/office/manager/sales); `status` (enum: active/on_leave/inactive/
  former); `primaryEmail` (citext, nullable); `primaryPhoneE164` (nullable); `skills` (text[]);
  `startDate`; `endDate`; `defaultPayRateMinor` (nullable) + `currency`; `recruitmentExternalId`
  (nullable unique — **external reference only**); `userId` (nullable link to User); timestamps;
  `deletedAt`; `anonymizedAt`.
- **Relationships:** `1–* TourAssignment`; `0..1 User`; read by payroll.
- **Ownership:** Team (GOS).
- **Indexes:** `status`; partial unique `recruitmentExternalId` (where not null); `userId`.
- **Uniqueness:** GOS `id` is canonical; `recruitmentExternalId` unique → makes the
  **candidate→hired handoff idempotent** (re-hires/seasonal returns can't create duplicates).
- **Soft delete:** yes; `status=former` for departed staff; anonymize after the retention period.
- **Audit:** MEDIUM-HIGH (employment data is sensitive).
- **Challenge:** **availability** is a scheduling subsystem — do **not** build a half-baked
  availability model in Phase 0. `skills` as `text[]` is enough for now; real availability/scheduling
  is a later module.

---

## 8) Communications

### ChannelAccount
- **Purpose:** one external channel identity = one WhatsApp number.
- **Key fields:** `id`; `channelType` (enum: whatsapp/…); `provider` (enum: cloud_api/vendor…);
  `e164`; `displayName`; `providerAccountId`; `credentialsRef` (**reference to secret manager**, not
  the token); `status` (enum: active/inactive); timestamps; `deletedAt`.
- **Relationships:** `1–* Conversation`.
- **Ownership:** Communications.
- **Indexes:** unique `(channelType, e164)`; `status`.
- **Uniqueness:** one account per (channelType, number).
- **Soft delete:** yes (deactivate).
- **Audit:** MEDIUM.

### Conversation
- **Purpose:** a thread between one ChannelAccount and one external participant. **Uniqueness here
  is what prevents duplicate conversations.**
- **Key fields:** `id`; `channelAccountId` (FK); `participantE164` (normalized external number);
  `contactId` (**nullable** FK — null = unresolved inbox); `status` (enum: open/archived);
  `lastMessageAt` (**derived cache**); timestamps; `deletedAt`.
- **Relationships:** `*–1 ChannelAccount`; `*–1 Contact` (nullable, resolved via ContactPhone);
  `1–* Message`.
- **Ownership:** Communications.
- **Indexes:** **unique `(channelAccountId, participantE164)`** (the anti-duplicate rule);
  `contactId`; `lastMessageAt` (inbox ordering); partial index `WHERE contactId IS NULL` (the
  unresolved inbox).
- **Uniqueness:** one conversation per (channel, participant).
- **Soft delete:** rarely — archive via `status`; retain history; privacy via anonymization.
- **Audit:** LOW overall; MEDIUM on `contactId` changes (resolution/merge).
- **Challenge:** a Contact's **single communication history** = all their Conversations across all
  channels, aggregated in a **read view** — not a merged store. Two of our numbers are never fused
  into one thread.

### Message
- **Purpose:** a single message within a conversation. High-volume, append-mostly.
- **Key fields:** `id` (UUID v7); `conversationId` (FK); `direction` (enum: inbound/outbound);
  `status` (enum: queued/sent/delivered/read/failed/received); `body` (text);
  `mediaAttachmentId` (nullable FK → Attachment) or `mediaStorageKey`; `providerMessageId`
  (nullable unique); `sentByUserId` (nullable — outbound staff); `occurredAt` (provider timestamp);
  `createdAt`; `anonymizedAt`.
- **Relationships:** `*–1 Conversation`; optional `*–1 User` (sender).
- **Ownership:** Communications. CRM/Ops **read** via the Contact link; never copy message text.
- **Indexes:** `(conversationId, occurredAt)`; **unique `providerMessageId` (where not null)** —
  the idempotency key that stops double-insert on webhook retries; `status` (outbound queue);
  `direction`.
- **Uniqueness:** `providerMessageId` unique → ingestion idempotency.
- **Soft delete:** **no** normal delete; retain. Privacy = `anonymizedAt` strips `body`.
- **Audit:** LOW (effectively immutable content).
- **Challenge:** design for **time-partitioning** later; keep the row narrow. Media bytes go to the
  Files service, not the DB.

---

## 9) Finance (operational — GOS owns; iCount owns legal)

### Quote
- **Purpose:** a priced offer derived from a Deal (operational finance).
- **Key fields:** `id`; `dealId` (FK); `number` (GOS-internal ref, **not** an iCount number);
  `status` (enum: draft/sent/accepted/rejected/expired); `totalMinor` (bigint) + `currency`;
  `lineItems` (jsonb) *(or* `1–* QuoteLine`*)*; `validUntil`; `sentAt`; `acceptedAt`; timestamps;
  `deletedAt`.
- **Relationships:** `*–1 Deal`; optional `1–* QuoteLine`.
- **Ownership:** Finance Ops (GOS).
- **Indexes:** `dealId`; `status`; unique `number`.
- **Uniqueness:** `number` unique.
- **Soft delete:** yes.
- **Audit:** MEDIUM (money).
- **Challenge:** the Quote total is an **offer**; `Deal.valueMinor` remains the **agreed** truth.

### PaymentLink
- **Purpose:** a generated link for a customer to pay (operational collection).
- **Key fields:** `id`; `dealId` (FK); `amountMinor` (bigint) + `currency`; `provider`;
  `providerLinkId` (unique); `url`; `status` (enum: active/paid/expired/cancelled);
  `sentToDealContactId` (nullable FK — who received it); `expiresAt`; `paidAt`; timestamps;
  `deletedAt`.
- **Relationships:** `*–1 Deal`; `0..1 DealContact` (recipient); related to `Payment` when paid.
- **Ownership:** Finance Ops (GOS).
- **Indexes:** `dealId`; `status`; unique `providerLinkId`.
- **Uniqueness:** `providerLinkId` unique.
- **Soft delete:** yes / cancel via status.
- **Audit:** MEDIUM.

### Payment
- **Purpose:** a recorded collection event against a Deal (operational record — **not** the legal
  receipt).
- **Key fields:** `id`; `dealId` (FK); `amountMinor` (bigint) + `currency`; `method` (enum:
  card/bank/cash/other); `paidAt`; `paymentLinkId` (nullable FK); `providerTransactionId` (nullable
  unique); `status` (enum: pending/completed/refunded/failed); `financeDocumentId` (nullable FK →
  the iCount receipt mirror); timestamps; `deletedAt`.
- **Relationships:** `*–1 Deal`; `0..1 PaymentLink`; `0..1 FinanceDocument`.
- **Ownership:** Finance Ops (GOS). The **legal receipt** is iCount (`FinanceDocument`).
- **Indexes:** `dealId`; `status`; unique `providerTransactionId` (where not null — idempotency).
- **Uniqueness:** `providerTransactionId` unique → no double-recording on retry.
- **Soft delete:** discouraged; refund = status/new row, not delete. `Deal.collectionStatus` is
  derived from completed Payments.
- **Audit:** **HIGH — field-level** (money movement).

### FinanceDocument
- **Purpose:** **read-only mirror** of an iCount legal document (invoice/receipt/etc.). iCount is
  canonical.
- **Key fields:** `id`; `dealId` (nullable FK); `type` (enum: invoice/receipt/invoice_receipt/
  credit_note); `icountDocId` (external, **unique**); `number` (iCount legal number); `totalMinor`
  (bigint) + `currency`; `issueDate`; `status` (enum: issued/voided/…); `pdfStorageKey`/`pdfUrl`;
  `customerRef`; `rawPayload` (jsonb snapshot from iCount); `mirroredAt`; `createdAt`; `updatedAt`.
- **Relationships:** `*–1 Deal`; `0..1 Payment`.
- **Ownership:** **iCount (canonical)**; GOS holds a mirror.
- **Indexes:** unique `icountDocId`; `dealId`; `type`; `number`.
- **Uniqueness:** `icountDocId` unique → idempotent mirror sync.
- **Soft delete:** **no** — it mirrors an external truth; voids are reflected via `status`. **Never
  edited by the app**; only the sync process upserts. Retained per tax law (~7y).
- **Audit:** LOW (the mirror sync is logged; the document isn't app-editable).
- **Challenge:** the rest of GOS treats this table as **read-only**. Never compute VAT, assign
  numbers, or generate the PDF in GOS.

---

## 10) Forms (shared platform capability with domain bindings)

### FormDefinition
- **Purpose:** a versioned form template (the field schema). Published versions are immutable.
- **Key fields:** `id`; `key`; `version` (int); `title`; `description`; `schema` (jsonb — field
  definitions); `bindingType` (enum/lookup: order/strategic/guide/tour_before/tour_after/internal/
  other); `status` (enum: draft/published/archived); timestamps; `deletedAt`.
- **Relationships:** `1–* FormResponse`.
- **Ownership:** Forms platform.
- **Indexes:** unique `(key, version)`; `status`; `bindingType`.
- **Uniqueness:** `(key, version)` unique.
- **Soft delete:** archive; **published versions are immutable** and never deleted (responses
  reference them).
- **Audit:** MEDIUM.
- **Challenge:** editing a published form = **new version row** (same `key`, `version+1`), so old
  responses keep their exact schema. This mirrors Procedure/ProcedureVersion (consistent pattern).

### FormResponse
- **Purpose:** a submitted set of answers bound to a domain entity; emits `forms.response.submitted`.
- **Key fields:** `id`; `formDefinitionId` (FK → exact version); `answers` (jsonb);
  `submittedByUserId` (nullable) / `submittedByContactId` (nullable — external submitter); explicit
  nullable bindings `tourId`, `dealId`, `teamMemberId`, `contactId`; `submittedAt`; `status` (enum:
  draft/submitted); timestamps; `deletedAt`; `anonymizedAt`.
- **Relationships:** `*–1 FormDefinition`; binding FKs.
- **Ownership:** Forms platform; the data semantically belongs to the bound domain.
- **Indexes:** `formDefinitionId`; one per binding FK; `submittedAt`.
- **Uniqueness:** none (a form can be answered many times).
- **Soft delete:** yes; **anonymize** if it holds PII.
- **Audit:** MEDIUM.
- **Challenge:** on submit, emit a `DomainEvent` so automations and modules can react — this is the
  Forms↔Automations seam.

---

## 11) Knowledge (contextual, not a passive wiki)

### Procedure
- **Purpose:** an SOP's stable identity + its binding context (where/when it should surface).
- **Key fields:** `id`; `key`; `title`; `summary`; `category`; `bindingEntityType` +
  `bindingTrigger` (e.g. `tour` + `before`); `currentVersionId` (FK → ProcedureVersion); `status`
  (enum: active/archived); timestamps; `deletedAt`.
- **Relationships:** `1–* ProcedureVersion`; `currentVersion` pointer.
- **Ownership:** Knowledge.
- **Indexes:** unique `key`; `status`; `(bindingEntityType, bindingTrigger)`.
- **Uniqueness:** `key` unique.
- **Soft delete:** archive.
- **Audit:** LOW-MEDIUM.

### ProcedureVersion
- **Purpose:** **immutable** versioned content of a procedure (so a checklist instance can reference
  an exact version and history is preserved).
- **Key fields:** `id`; `procedureId` (FK); `version` (int); `content` (jsonb/markdown);
  `checklistItems` (jsonb); `authorUserId`; `publishedAt`; `createdAt`.
- **Relationships:** `*–1 Procedure`.
- **Ownership:** Knowledge.
- **Indexes:** unique `(procedureId, version)`.
- **Uniqueness:** `(procedureId, version)` unique.
- **Soft delete:** **no** (immutable history).
- **Audit:** LOW (immutable by design).

### LessonLearned
- **Purpose:** a captured lesson linked to the context that produced it (not a free-floating wiki
  page).
- **Key fields:** `id`; `title`; `body`; explicit nullable links `tourTypeId`, `dealStageId`,
  `tourId`, `organizationId`; `impact` (enum: low/medium/high); `authorUserId`; `status` (enum:
  open/applied/archived); timestamps; `deletedAt`.
- **Relationships:** optional link FKs; `*–1 User` (author).
- **Ownership:** Knowledge.
- **Indexes:** one per link FK; `status`.
- **Uniqueness:** none.
- **Soft delete:** yes.
- **Audit:** LOW.

---

## 12) Platform

### DomainEvent
- **Purpose:** **append-only business event log** — the backbone for automations, integration, and
  derived read-models. This is the seam that replaces Make.com.
- **Key fields:** `id` (UUID v7); `type` (`domain.entity.action`, past tense); `version` (int);
  `occurredAt`; `actorType` (enum: user/system/automation); `actorId` (nullable); `correlationId`;
  `causationId` (nullable); `source` (module); `entityType`; `entityId`; `payload` (jsonb — minimal
  snapshot of fields automations need); `createdAt`.
- **Relationships:** **logical** `(entityType, entityId)` — deliberately **not** FK-enforced
  (polymorphic by nature).
- **Ownership:** Platform.
- **Indexes:** `type`; `(entityType, entityId)`; `occurredAt`; `correlationId`; `createdAt`.
  Plan **time-partitioning** by `occurredAt` for scale.
- **Uniqueness:** `id`; optional producer-supplied dedupe key for idempotent emission.
- **Soft delete:** **NO — immutable, append-only.** Growth handled by archival/partitioning later.
- **Audit:** it is audit infrastructure; not itself audited.
- **Challenge:** consumers are made idempotent via **EventConsumerOffset/ProcessedEvent** (track
  handled `eventId`s) — include this supporting table now.

### AuditLog
- **Purpose:** **change log** — who changed what field on which record. Distinct from DomainEvent.
- **Key fields:** `id`; `actorUserId` (nullable — system actions); `action` (enum: create/update/
  delete/anonymize/grant/revoke); `entityType`; `entityId`; `changedFields` (jsonb: field →
  `{old,new}`); `reason` (nullable); `ip`/`userAgent` (nullable); `occurredAt`; `createdAt`.
- **Relationships:** logical `(entityType, entityId)`; nullable `*–1 User`.
- **Ownership:** Platform.
- **Indexes:** `(entityType, entityId)`; `actorUserId`; `occurredAt`.
- **Uniqueness:** `id`.
- **Soft delete:** **NO — immutable, append-only.**
- **Audit:** it is the audit; not itself audited.
- **Challenge — DomainEvent vs AuditLog (must be crystal):**
  - **AuditLog** = *every* persistence mutation, with field-level diffs, for compliance/forensics.
  - **DomainEvent** = *meaningful business facts* (`crm.deal.won`) for automations and read-models.
  - A single action can produce both. AuditLog is **not** derived from DomainEvent (most field
    changes aren't business events) and DomainEvent is **not** derived from AuditLog. Keep both.

---

## 13) Soft-delete classification (decision table)

| Class | Behaviour | Models |
|---|---|---|
| **Soft-delete** (`deletedAt`) | hidden, restorable; unique rules become partial indexes | User, Organization, Contact, ContactPhone, Deal, DealContact, Activity, Note, Attachment, TourType, Tour, Booking, TourAssignment, TeamMember, ChannelAccount, Quote, PaymentLink, FormDefinition (draft), FormResponse, Procedure, LessonLearned |
| **Soft-delete + anonymize** (PII) | + `anonymizedAt` strips PII, keeps row/links | Contact, TeamMember, FormResponse, Message (anonymize only) |
| **Status-driven** (no delete) | lifecycle via status; retained | Payment, Conversation, Message |
| **Immutable / append-only** (no update, no delete) | never mutated | DomainEvent, AuditLog, ProcedureVersion, published FormDefinition versions |
| **External mirror** (no app delete) | reflects iCount; status only | FinanceDocument |
| **Reference/config** (no soft-delete) | archive flag instead | Role, Permission, UserRole, RolePermission |

---

## 14) Audit-level classification (decision table)

| Level | Meaning | Models |
|---|---|---|
| **HIGH (field-level)** | reconstruct every change | User, Role, Permission, UserRole, RolePermission, Deal (money/stage/status), Payment |
| **MEDIUM** | create/update/delete + key fields | Organization, Contact, ContactPhone, DealContact, TourAssignment (pay), Tour, Booking, TeamMember, Quote, PaymentLink, ChannelAccount, Attachment, FormDefinition, FormResponse |
| **LOW** | create/delete only | Activity, Note, TourType, Conversation, Message, Procedure, ProcedureVersion, LessonLearned, FinanceDocument (sync) |

---

## 15) What NOT to do in this schema (guardrails)

- Do **not** add `tour_id` to Deal or `deal_id` to Tour — Booking is the only link.
- Do **not** store money as float/decimal-as-float, and never without a `currency`.
- Do **not** put VAT logic, invoice numbering, or the legal PDF anywhere in GOS — iCount owns them.
- Do **not** make `Message`/`DomainEvent`/`AuditLog` mutable or soft-deletable.
- Do **not** create orphan `ContactPhone` rows for unknown inbound numbers — use unresolved
  `Conversation`s.
- Do **not** use Postgres enums for evolving sets (deal stage, roles) — use config/lookup tables.
- Do **not** store provider secrets as plaintext columns.
- Do **not** add a tenant/orgId column — single business.
- Do **not** rely on plain unique constraints alongside soft-delete — use **partial unique
  indexes** (`WHERE deleted_at IS NULL`).
- Do **not** build a real availability/scheduling model inside TeamMember in Phase 0.

---

## 16) Decisions needed from you before schema code

1. **ID strategy:** confirm **UUID v7** app-generated for all PKs.
2. **Polymorphic links:** confirm **explicit nullable FKs** for Note/Attachment/Activity/
   FormResponse/LessonLearned (generic only for DomainEvent/AuditLog).
3. **Supporting models:** approve adding **UserRole, RolePermission, DealStage, Location,
   ConsentRecord, EventConsumerOffset** to Phase 0 (and possibly QuoteLine).
4. **Booking uniqueness:** one line per (deal, tour) *(recommended)* vs multiple seat-block lines.
5. **DealContact roles:** `text[]`/`enum[]` with GIN *(recommended)* vs a child role table.
6. **Quote line items:** `jsonb` *(recommended for Phase 0)* vs a `QuoteLine` child model.
7. **Permission scope:** seed `own`/`all` now and defer `team` until a team hierarchy exists.
8. **`collectionStatus` on Deal:** confirm it's a documented transactional **cache** of Payments
   (vs computed-on-read).

Once these eight are answered, the model is ready to become actual Prisma schema.
