# GOS Architecture Proposal

**Status:** Approved direction (foundations). Documentation only — no runtime code, no Prisma schema, no DB migrations yet.
**Owner:** Product / CTO / Systems Architecture
**Last updated:** 2026-06-24

---

## 0) Framing correction — the governing principle

GOS (Grafitiyul Operating System) is intended to become the central operating system of the
business and over time replace Pipedrive (CRM), Airtable (tour ops / guide scheduling),
Make.com (automations), Cognito Forms, various WhatsApp tools, operational spreadsheets, and
parts of the recruitment system as source-of-truth.

The stated core principle is *"one source of truth, no duplicate systems."* That is correct as a
**destination** but dangerous as a **transition rule**. Grafitiyul is a live business. During the
migration the same concept will unavoidably exist in two places at once.

**The invariant that actually protects the business:**

> Single ownership with an explicit, documented sync direction at every moment in time.
> For any concept, at any given week, exactly one system is the **writer** and everyone else is a
> **reader** — and we always know which is which.

This is enforced through the companion document: `GOS-source-of-truth-register.md`.

---

## 1) Domain Map

GOS is split into two layers. This separation is the single most important structural decision.

**Platform layer (shared kernel — built once, used by everything):**
- Identity & Access (auth, users, roles, permissions)
- Events & Automations (the event log / bus)
- Forms engine
- Files & Attachments
- Notifications (internal)
- Audit log
- Integration Gateway (iCount, WhatsApp, recruitment system, legacy imports)
- Search

**Domain modules (the business):**
- **CRM** — Organizations, Contacts, Deals, Activities, Notes
- **Operations / Tours** — Tour, Booking, TourType catalog, Location, Scheduling
- **Team** — TeamMember, roles, skills, availability, payroll-relevant data
- **Finance Ops** — Quote, PaymentLink, Collection, Payment
- **Communications** — Conversation, Message, Channel
- **Knowledge / Procedures** — Procedure, Checklist, Lesson
- **Learning** — existing module

**Experience layer (composition, not new data):**
- Admin app
- Guide Portal
- Customer-facing pages (forms, payment links)

**The rule:** domain modules own data; the platform layer owns capabilities; the experience layer
owns nothing — it only composes. A portal is never a source of truth.

---

## 2) Core Entities (conceptual, not schema)

| Entity | Owner module | Owns |
|---|---|---|
| Organization | CRM | company identity |
| Contact | CRM | external person identity |
| ContactPhone | CRM | phone identity: maps a normalized number to a Contact |
| Deal | CRM | **commercial agreement**: price, discount, terms, stage |
| DealContact | CRM | links a Deal to many Contacts, each with roles + comm preferences |
| Activity | CRM | a sales/CS touchpoint (call, follow-up, send quote) |
| Tour | Operations | **execution**: date, time, location, type, status |
| TourType | Operations | catalog: default duration, required skills, default price |
| Booking | Operations | the **link** between a Deal and a Tour (seats, qty, optional value) |
| TourAssignment | Operations | a TeamMember assigned to a Tour (role, status, attendance, pay snapshot) |
| TeamMember | Team | internal person identity, role, skills, availability |
| Quote | Finance Ops | a priced offer derived from a Deal |
| Payment / PaymentLink | Finance Ops | operational collection state |
| FinanceDocument | Finance Ops | read-only **mirror** of an iCount invoice/receipt |
| Conversation / Message | Communications | message history per channel |
| ChannelAccount | Communications | one external channel identity (e.g. one WhatsApp number) |
| Procedure / Checklist | Knowledge | SOPs and lessons |
| ConsentRecord | Identity / Privacy | lawful basis + consent state per Contact/channel |
| User | Identity | login account + permissions |
| DomainEvent | Events | immutable record of "something happened" |

Three deliberately **separate** person-like entities: `User` (can log in), `TeamMember` (internal
staff), `Contact` (external customer). They may link, but conflating them is a classic mistake (see
Risks).

---

## 3) Ownership / Source-of-Truth Model

For every concept: who writes it, and who only reads it. (Full migration detail lives in the
companion register.)

| Concept | Source of truth | Readers (never writers) |
|---|---|---|
| Commercial agreement (price, discount, terms) | **Deal (CRM)** | Tours, Finance Ops, Portal |
| Operational execution (date, guides, status) | **Tour (Operations)** | CRM, Portal, Finance |
| Deal↔Tour link | **Booking (Operations)** | both sides |
| Internal people | **TeamMember (Team)** | recruitment system, Portal, payroll |
| External people | **Contact (CRM)** | Communications, Finance |
| Operational money: quotes, payment links, collection status | **Finance Ops (GOS)** | CRM, Portal |
| Legal money: official invoices, receipts, tax | **iCount** | GOS stores a read-only mirror |
| Message history | **Communications** | CRM, Operations |
| Login & permissions | **Identity** | everyone |

### The money boundary (critical — compliance risk)

Three layers of money, never merged:

1. **Commercial** — what was agreed. Owner: **Deal**.
2. **Operational finance** — what we're collecting and how. Owner: **GOS Finance Ops** (quotes,
   payment links, "paid 60%").
3. **Legal accounting** — the official tax document. Owner: **iCount, forever.**

GOS never generates the source-of-truth invoice or receipt. It requests iCount to issue one, then
stores a reference + mirror for display. Building tax logic in GOS is forbidden (see Section 10).

### Team source-of-truth reversal — implications

Today recruitment owns team data; future state, GOS owns it and recruitment consumes.

- Define a **stable TeamMember ID** that becomes the canonical key everywhere (payroll, portal,
  tour assignment, recruitment).
- Cutover is directional and one-time per record: recruitment stops writing the fields GOS now
  owns and starts reading them. No field is ever written by both — that is dual ownership,
  forbidden.
- Recruitment keeps **recruitment-specific** data (candidate pipeline stage, interview notes,
  training-specific data). A candidate is not yet a TeamMember.
- Boundary: **GOS owns confirmed team members; recruitment owns candidates.** The
  "candidate → hired" event is the explicit handoff.

---

## 4) Relationships Between Domains

### Deal ↔ Tour — locked decision

The real relationship is **many-to-many**, and all three scenarios are real:

- **One Deal → many Tours** — a program/series sold as one commercial agreement (a semester of
  workshops, a multi-day trip).
- **One Deal → one Tour** — the common simple case.
- **Many Deals → one Tour** — an open/public tour where several customers buy seats, or a
  co-funded event.

Therefore: **do not put `deal_id` on Tour, and do not put `tour_id` on Deal.** Both bake in a
cardinality reality will break.

**Model: an explicit `Booking` (allocation) entity between Deal and Tour.**

- A Booking links one Deal to one Tour and carries: seats/quantity and the **portion of commercial
  value** allocated to that tour.
- Price lives on the **Deal** side (commercial). Capacity lives on the **Tour** side
  (operational). Booking is where they meet.
- The two lifecycles stay **independent**: a Deal can be Won before any Tour is scheduled; a Tour
  can run while collection is still in progress. Linked, not coupled.

UX optimizes the 1-Deal-1-Tour common path, but the data model is M:N from day one — retrofitting
M:N later is expensive and the public-tour case exists today.

### Domain relationship map

```
Organization 1─* Contact
Contact      1─* ContactPhone   (one contact, many numbers)
Deal         1─* DealContact *─1 Contact   ← M:N via DealContact (roles + comm prefs)
Deal         1─* Quote
Deal         1─* Booking *─1 Tour          ← M:N via Booking
Deal         *─1 FinanceDocument            (mirror of iCount doc)
TourType     1─* Tour
Tour         1─* TourAssignment *─1 TeamMember   ← rich assignment, not a thin join
Deal/Tour/Contact 1─* Activity  (CRM touchpoints)
ChannelAccount 1─* Conversation *─1 Contact   (resolved via ContactPhone)
Conversation 1─* Message
Contact      1─* ConsentRecord
Any entity   1─* FormResponse   (forms bind to domains)
Any entity   1─* DomainEvent    (everything emits events)
Any entity   1─* Attachment / Note
```

---

## 5) Recommended Module Structure

Build in this dependency order (platform first — domains lean on it):

**Platform / shared kernel**
1. Identity & Access
2. Audit log
3. Files & Attachments
4. **Events** (the event log) — build early, even before automations
5. Forms engine
6. Integration Gateway
7. Notifications + Search (later)

**Domain modules**
8. CRM
9. Operations / Tours (+ Booking + TourType catalog)
10. Team
11. Finance Ops
12. Communications
13. Knowledge / Procedures
14. Learning (exists)

**Experience layer**
15. Admin app, Guide Portal, customer pages

### Forms — shared platform capability with domain bindings

Not a standalone silo, and not loose fields scattered per module.

- One **Forms engine** (FormDefinition, FormResponse) in the platform layer, used by all modules.
- Each form **binds** to a domain: a before-tour form attaches to a Tour; an order form
  creates/updates a Deal; a guide form attaches to a TeamMember.
- A submitted form **emits a domain event** (`FormSubmitted`) that automations and modules react
  to.

### Knowledge / Procedures — contextual, not a passive wiki

- A Procedure links to an **entity type + a trigger** (e.g. "Tour enters 'day before' status" →
  show the pre-tour checklist on that tour).
- Procedures become **checklists attached to live entities**, not documents in a drawer.
- Lessons-learned link to the entity that taught them (this TourType, this deal stage).
- It uses the same event system as automations.

Difference from a wiki: a wiki is something you go to; this comes to you at the right step.

---

## 6) Future Expansion Strategy

- **Strangler-fig migration, never a big-bang rewrite.** GOS grows around the legacy systems and
  replaces them concept-by-concept. The business never stops.
- **Per-concept cutover with a verified flip of ownership.** For each concept: GOS *mirrors*
  (read-only) from legacy → GOS becomes writer and legacy becomes reader → legacy is retired.
  Three stages, never two writers at once.
- **The event log is the integration backbone.** New modules subscribe to existing events instead
  of touching existing code.
- **Catalog-driven flexibility where it belongs** (TourTypes, form definitions, deal stages,
  automation rules are configuration/data) — **fixed structure where it belongs** (core CRM
  entities are concrete, not generic EAV).
- Single business, single tenant. Do **not** build multi-tenancy "for the future."

---

## 7) Biggest Architectural Risks

1. **Dual-write / divergent source of truth during migration.** The #1 killer. Mitigation: strict
   single-writer-at-a-time, documented in the register.
2. **Big-bang rewrite temptation.** Mitigation: strangler-fig, phase-gated.
3. **Identity resolution.** Phone→Contact (WhatsApp), person dedup, candidate→TeamMember,
   Contact-who-is-also-a-guide. Mitigation: explicit identity/phone tables, dedup tooling, manual
   merge allowed.
4. **Money-boundary leak.** Tax docs' source of truth in GOS. Mitigation: iCount canonical, GOS
   mirrors.
5. **Over-flexibility (EAV soup).** The learning module's "infinite flexibility" rule is correct
   *there* but must not spread to CRM/Tours/Finance core entities. Mitigation: concrete entities
   for the spine; configuration only at the edges.
6. **Event system retrofitted late.** Mitigation: emit events from day one, even before anything
   consumes them.
7. **WhatsApp fragility.** Unofficial multi-number tools get banned. Mitigation: model channels
   abstractly; provider swappable behind the Gateway.
8. **Permissions added too late.** GOS is the central business OS. Mitigation: permission guard
   from Phase 0, even if coarse.
9. **Side-effects buried in domain code.** Mitigation: all automation in one Automations module
   reacting to events; domains only emit.
10. **Migration cutover correctness.** Mitigation: import as read-only mirror first, reconcile,
    then flip.

---

## 8) Missing Business Concepts (named now so they don't bite later)

- **Identity/Auth as its own thing** — separate from TeamMember and Contact.
- **Audit log** — who changed what, when. Mandatory.
- **Service catalog / TourType / Price book** — "what we sell and its default price," distinct from
  a specific Tour and from a specific Deal's agreed price.
- **Capacity & participant manifest** — attendees per Tour.
- **Locations / Venues** as reusable entities.
- **Guide availability & double-booking prevention** — scheduling is a subsystem, not a field.
- **Guide payroll / compensation** — what *we pay guides*, separate from what *customers pay us*.
- **Operational tasks** — distinct from CRM Activity and Procedure Checklist item (see below).
- **Consent / privacy (Israeli Privacy Protection Law)** — message history & contact data carry
  legal obligations.
- **Notifications (internal)** vs **Communications (external)** — different concepts.
- **Unified calendar** — a read view over tours, activities, availability.
- **Reporting/analytics** — read models built from events.
- **Migration/import tooling** — first-class effort.
- **Money as integers (minor units)**, never floats.

### Three distinct work-items (must stay separate)

- **CRM Activity** — sales/CS touchpoint (Pipedrive-style: call, follow-up, send quote, check
  payment, meeting, CS reminder). Owned by CRM. NOT a generic task.
- **Operational Task** — ops work on a tour ("prepare equipment," "confirm bus"). Owned by
  Operations.
- **Procedure Checklist Item** — an SOP step from Knowledge.

---

## 9) Recommended Implementation Phases

Each phase ends with a **verified ownership flip**, not just "code shipped."

- **Phase 0 — Foundations.** Identity & Access (login + roles guard), Audit log, Files, **Event
  log**, Forms engine primitives, Integration Gateway skeleton. The spine — do not skip.
- **Phase 1 — CRM core.** Organizations, Contacts, Deals, Activities, Notes. Import Pipedrive as
  read-only mirror → reconcile → flip GOS to writer → retire Pipedrive.
- **Phase 2 — Operations.** Tours, TourType catalog, **Booking**, guide assignment, Locations,
  availability. Replace Airtable via mirror-then-flip. Establish **Team** source-of-truth
  (canonical TeamMember ID); point recruitment to consume it.
- **Phase 3 — Finance Ops.** Quotes, payment links, collection tracking. Integrate iCount as the
  legal layer (GOS requests docs, mirrors them). Introduce guide payroll concept.
- **Phase 4 — Communications.** WhatsApp ingestion, Conversation/Message model, phone→Contact
  resolution, visibility from CRM and Operations.
- **Phase 5 — Guide Portal.** Composition over Team + Tours + Forms + Procedures + Finance. New
  data: none.
- **Phase 6 — Automations + Knowledge.** Gradually move Make.com flows in-house (events already
  exist from Phase 0). Contextual procedures wired to triggers.

Make.com keeps running by consuming GOS webhooks throughout — retire it last, flow by flow.

---

## 10) Things That Should NEVER Be Built

- A GOS accounting/bookkeeping/tax engine. **iCount stays canonical, forever.**
- A second source of truth for any concept, or two systems writing the same field.
- Generic infinite-EAV "everything is flexible" modeling for CRM/Tours/Finance core entities.
- Multi-tenant SaaS architecture. Single business.
- An automations engine built **before** the event log.
- Hidden side-effects/triggers scattered inside domain code.
- A long-term WhatsApp integration depending on ban-prone unofficial hacks as the *architecture*.
- Hidden/stale caching (per project caching rules — `no-store` for app/data, immutable hashed
  assets only).
- Conflating CRM Activity, operational Task, and Procedure Checklist item into one "task" table.
- Storing money as floating-point.
- Conflating User / TeamMember / Contact into one "person" table.

---

## 11) Deal ↔ Contact — multi-contact model (locked)

A Deal supports **multiple Contacts**. We do **not** assume one main contact plus secondaries.
Real flows: two coordinators from one company; a coordinator + a finance contact; several people
receiving operational updates; different people receiving confirmations; a separate person
receiving payment links.

**Structure:** `Deal ↔ DealContact ↔ Contact`.

`DealContact` carries:
- **Roles (multiple per contact):** coordinator, payer, decisionMaker, participant, invoiceContact,
  other.
- **isPrimary** — a convenience marker for the default contact, not a structural limit.
- **Communication preferences:** receiveConfirmations, receiveOperationalUpdates,
  receivePaymentLinks, receiveQuotes.

These per-deal preferences are **operational routing**. They are gated by the Contact-level
`ConsentRecord` (legal permission) — see Section 15. Global consent/legal status always wins over
per-deal routing.

---

## 12) Person identity (locked)

`User`, `TeamMember`, and `Contact` remain **separate entities with explicit links**. No shared
`Person` table at this stage — they are different business concepts, and forcing a shared identity
model early adds complexity before it is needed. A link table can be added later if a real need
appears (e.g. a guide who is also a customer); this decision is intentionally reversible.

---

## 13) Booking value allocation (locked)

The **Deal owns the total commercial value — always.** Booking supports:
- `quantity` / seats
- optional `allocatedAmountMinor`

`allocatedAmountMinor` is an *optional* informational split of value to a specific Tour. It must
**never** replace or override the Deal's total. If allocations are absent or don't sum to the Deal
total, the Deal total still governs.

---

## 14) Five locked platform recommendations

### 14.1 iCount integration contract

Clear ownership boundary across the three money layers (see Section 3):

- **GOS creates through iCount** (by API request): tax invoices (חשבונית מס), receipts (קבלה),
  combined invoice-receipts (חשבונית מס/קבלה), and credit notes (זיכוי). GOS **requests**
  issuance; it never generates the legal document itself.
- **iCount owns (canonical, never in GOS):** the legal document, sequential document numbering,
  VAT/tax calculation, the official PDF, the bookkeeping ledger, and legal/tax retention.
- **GOS mirrors (read-only `FinanceDocument`):** document number, type, issue date, total,
  status, customer ref, and a link to the iCount PDF — so a Deal can display "Invoice #1234,
  ₪X, issued."
- **GOS stores independently (GOS-native, not in iCount):** quotes, payment links, collection
  progress and workflow, reminders, and which `DealContact` received which link. This is
  operational finance and belongs to GOS only.

**Rules:**
- Issuance must be **idempotent** — store the external reference; never double-issue on retry.
- The **customer identity** is owned by GOS (Contact/Organization). When issuing, GOS pushes the
  minimal billing details to iCount; the iCount customer record is **derived**, not a second
  source of truth. Do not edit customers directly in iCount.
- GOS never computes VAT, assigns invoice numbers, or produces the legal PDF.

### 14.2 WhatsApp / Communications architecture

Goal: a single communication history with no duplicated conversations, across multiple WhatsApp
numbers, with provider flexibility.

- **ChannelAccount** — one external channel identity = one WhatsApp number (provider, phone,
  display name). Adding a number = adding a ChannelAccount, no model change.
- **ContactPhone (phone identity)** — maps a normalized E.164 number to a Contact. One Contact may
  have many numbers; a number resolves to at most one active Contact.
- **Conversation** — keyed uniquely by `(ChannelAccount, external participant)`. A uniqueness
  constraint here is what prevents duplicate conversations. It links to a Contact via ContactPhone.
- **Message** — belongs to a Conversation. Stores direction (inbound/outbound), status, timestamp,
  body, media reference, provider, and `providerMessageId`.

**Contact resolution:** inbound message → normalize number → look up ContactPhone → if matched,
attach to that Contact; if unmatched, hold in an **unresolved inbox** for manual linking. Never
silently create a duplicate Contact.

**Multi-number, single history:** store granular per-`(number, customer)` conversations (so two of
our numbers are never wrongly merged into one thread), but **present a unified, Contact-level
timeline** that aggregates messages across all channels. Single history is a *read view*, not a
merged store.

**Ownership:** the Communications module owns Conversation and Message. CRM and Operations **read**
them via the Contact link — they never copy message text.

**Provider flexibility:** the provider sits behind the Integration Gateway. Normalize provider
payloads into our Message shape at ingestion; never leak provider-specific structures into domain
entities. Official Cloud API vs other tools becomes a swappable detail.

### 14.3 Event architecture

The backbone that will replace Make.com. Built in Phase 0, append-only, immutable.

- **Naming:** `domain.entity.action`, lowercase, dot-namespaced, **past tense** (events are facts).
  Examples: `crm.deal.won`, `ops.tour.scheduled`, `ops.tour.guide_assigned`,
  `finance.payment.received`, `forms.response.submitted`, `team.member.hired`.
- **Payload = envelope + data.**
  - *Envelope:* `eventId` (uuid), `type`, `version`, `occurredAt`, `actor`
    (user / system / automation), `correlationId` + `causationId` (to trace automation chains),
    `source` module, and an `entityRef` (type + id).
  - *Data:* the relevant IDs plus a small denormalized snapshot of the fields automations commonly
    need — enough to act without re-reading mutated state, but not the whole object graph.
- **Versioning:** a `version` per event type. Additive optional fields do **not** bump the version;
  breaking changes emit a new version alongside the old during transition. Never repurpose a field;
  the log is append-only.
- **Domain boundaries:** each domain emits **only its own** events. Domains never call each other
  for side effects — they emit; the Automations module and other subscribers react. This is exactly
  the seam Make.com occupies today (it consumes webhooks); tomorrow the in-house Automations module
  subscribes to the same stream.
- **Delivery:** assume at-least-once; **consumers must be idempotent** (dedupe on `eventId`).
- The event log also powers the audit log and future reporting read-models.

### 14.4 Tour assignment model (recommendation)

**Recommendation: a rich `TourAssignment` entity, not a thin (TeamMember, Tour, Role) join.**

It should contain:
- `teamMember`, `tour`, `role` (lead / assistant / trainee / driver / coordinator — open enough
  for non-guide roles)
- `status` / confirmation state (proposed → offered → confirmed → declined / cancelled)
- attendance (showedUp / noShow, optional check-in time) — the operational actuals
- **pay snapshot:** `agreedAmountMinor` (or rate) for *this* assignment, plus optional
  `payrollOverride` + reason. Defaults come from TeamMember / TourType; the snapshot records what
  was actually agreed for this specific assignment.

**Reasoning:** a thin join cannot express real operations — a guide proposed but not confirmed, a
no-show, or special pay for a hard tour. A rich assignment avoids spawning a second parallel table
later. **Source-of-truth note:** the assignment stores the *inputs* (agreed amount, attendance);
the payroll process **reads** assignments to compute payouts — it does not duplicate them. "What we
pay guides" stays conceptually in Finance Ops/payroll, fed by these assignment facts.

### 14.5 Privacy / consent model (minimum for long-term operation)

Aligned to Israeli Privacy Protection Law. Keep it minimal — not a full consent platform.

- **ConsentRecord on Contact:** lawful basis + data source, and consent state per channel
  (WhatsApp, email), each with timestamp and source. Distinguish **operational** communication
  (tour confirmations — contractual/legitimate interest) from **marketing** (requires opt-in).
- **Consent gates routing:** the per-deal `DealContact` preferences route messages; the
  Contact-level ConsentRecord decides whether we may contact at all. Legal status wins.
- **Retention policy (config per data type):** keep data while commercially relevant plus legal
  minimums. Note: tax-linked data has a long statutory retention (Israeli tax law ~7 years) and
  lives in iCount — it cannot be freely deleted.
- **Anonymize vs delete:** support **anonymization** (strip PII from a Contact while preserving
  linked financial/legal records) as distinct from hard delete. Data tied to iCount documents is
  anonymized in GOS, not deleted.
- **Guide/employee data** is more sensitive: stricter access control and a defined retention period
  after employment ends.
- **Access & audit:** personal data behind the permission layer; the audit log records changes,
  with access logging considered for the most sensitive fields.

Minimum entities/fields: `ConsentRecord`, a retention-policy config, and an
anonymization/deletion-request workflow. Nothing more for now.

---

## 15) Architecture review (pre-schema lock)

### 15.1 Hidden future scalability risks
- **Event log growth & replay** — append-only store grows unbounded; needs an archival/partitioning
  strategy eventually. Not now, but immutability + idempotent consumers must be right from day one.
- **Message/media volume** — WhatsApp tables grow fast; media needs the Files service, not inline
  storage.
- **Contact-resolution backlog** — the unresolved inbox can pile up at volume; dedup gets harder.
- **Reporting on transactional tables won't scale** — analytics must run on event-derived
  read-models/projections. The event architecture already enables this; just don't query the hot
  tables directly.
- **Single-currency assumption** — if tours ever go international, retrofitting currency is painful.
  **Cheap insurance: store a `currency` code alongside every money field now**, even while it's
  always ILS.

### 15.2 Source-of-truth conflicts still to watch
- **iCount customer vs GOS Contact/Org** — both hold "customer." Resolved by: GOS owns identity and
  pushes to iCount; iCount's customer is derived. Must stay one-directional or it becomes dual-write.
- **WhatsApp provisional contacts** — auto-creating contacts from inbound numbers would conflict
  with CRM Contact ownership. Mitigated by the unresolved inbox + manual merge.
- **Three "amounts"** — TourType default price (suggested) vs Deal total (owner) vs Booking
  `allocatedAmountMinor` (optional split). Restated to prevent drift: only the **Deal** total is
  authoritative.
- **DealContact preferences vs Contact consent** — operational routing vs legal permission. Defined
  precedence: **consent/legal gate wins**.
- **Guide pay** — per-assignment `agreedAmountMinor` is the operational record; payroll reads it.
  Keep payroll a reader, never a second writer of the agreed amount.

### 15.3 Missing core entities (surface now)
- `currency` code on money fields (or a Currency reference) — add now as insurance.
- `FinanceDocument` (iCount mirror), `ContactPhone`, `ChannelAccount`, `ConsentRecord`,
  `DealContact`, `TourAssignment` — now added above.
- **Deal stage / Pipeline configuration** — CRM needs configurable stages as data, not hardcoded.
- **Participant / Attendee (manifest)** — for tours with named participants; decide if it's an
  entity or a form-fed list.
- *Future (named, not built now):* `AutomationRule`/`Subscription`, `PayrollRun`/`GuidePayout`,
  `Tag`/`Label`.

### 15.4 Assumptions likely wrong
- **"Deal always precedes Tour"** — false for open/public tours, where the Tour exists first and
  Deals attach as people buy. Booking already allows this; workflows must not assume Deal-first.
- **"Every Tour has a Deal"** — false for internal, training, free, or marketing tours. Booking is
  **optional**, never a required FK on Tour. (Confirmed correct in the model.)
- **"A phone number maps to one person forever"** — false: shared/office numbers, reassigned
  numbers. ContactPhone resolution must allow re-mapping over time.
- **"Guides are the only assigned team"** — false: drivers, photographers, coordinators. The
  TourAssignment `role` is intentionally open.
- **"Candidate vs confirmed splits cleanly"** — rehires and seasonal returns mean the
  "candidate → hired" handoff can fire more than once for the same person. Handoff must be
  idempotent on the canonical TeamMember.

### 15.5 Decisions that will be very hard to change later
- **Event schema conventions & immutability** — after thousands of events exist, naming/envelope/
  versioning are near-impossible to change. Locked here.
- **Money representation** (integer minor units) + **including a currency code** — adding currency
  after data exists is costly; do it now.
- **Booking as the Deal↔Tour join** — central; changing cardinality post-migration is very costly.
  Locked.
- **Source-of-truth ownership flips** — once legacy is retired for a concept, reversing is
  extremely expensive.
- **Canonical TeamMember ID independent of recruitment** — correct and deliberate; hard to reverse,
  which is why it's locked now.
- **Phone-identity resolution model** — once conversations are bound to contacts, re-keying is
  painful; get normalization (E.164) right from the start.

---

## Locked decisions (this approval)

1. Deal owns the commercial agreement: price, discount, payment terms.
2. Tour owns operational execution only.
3. Deal and Tour are linked through **Booking**.
4. Booking supports: one Deal → one Tour, one Deal → many Tours, many Deals → one Tour.
5. TeamMember source of truth moves to GOS.
6. Recruitment keeps candidate/training-specific data; confirmed team members belong to GOS.
7. iCount remains the legal accounting source of truth.
8. GOS owns operational finance only.
9. Activity = Pipedrive-style CRM activity, not a generic task.
10. CRM Activity, operational Task, and Procedure Checklist Item stay separate concepts.
11. Forms are a shared platform capability with domain bindings, not a standalone silo.
12. Events must exist from the foundation stage, before automations are rebuilt.
13. The Guide Portal composes data from GOS modules and is never its own source of truth.
14. A Deal supports multiple Contacts via `DealContact` (multiple roles, isPrimary, comm
    preferences). No single-main-contact assumption.
15. `User`, `TeamMember`, `Contact` stay separate with explicit links — no shared `Person` table yet.
16. Deal owns total commercial value; Booking carries quantity + optional `allocatedAmountMinor`,
    never replacing the Deal total.
17. GOS generates its own TeamMember ID; recruitment IDs are external references only.
18. Money stored as integer minor units (₪1,250.50 → 125050); a `currency` code is stored alongside
    every money field; UI formats for display; no floating-point money.
19. iCount contract: GOS requests document issuance and mirrors them read-only (`FinanceDocument`);
    GOS owns quotes/payment-links/collection independently; iCount owns numbering, VAT, PDF, ledger.
20. WhatsApp: `ChannelAccount` per number, `ContactPhone` identity, `Conversation` unique per
    (channel, participant), unified Contact-level history; provider swappable behind the Gateway.
21. Event naming `domain.entity.action` past-tense; envelope+data payload; per-type versioning;
    domains emit only their own events; consumers idempotent.
22. `TourAssignment` is a rich entity (role, status, attendance, pay snapshot), not a thin join.
23. Privacy: `ConsentRecord` per Contact/channel; consent gates per-deal routing; anonymize-vs-delete;
    tax-linked data retained per iCount/Israeli law.
