# GOS — Source-of-Truth Register

**Status:** Governing document. Documentation only — no schema, no migrations, no implementation yet.
**Purpose:** For every major business concept, state exactly one writer at any moment and the
direction data flows. This document enforces the GOS invariant.
**Last updated:** 2026-06-24

---

## The invariant

> Single ownership with an explicit sync direction at every moment in time.
> For any concept, exactly one system is the **writer**; everyone else is a **reader**.
> No field is ever written by two systems at once. "No duplicate systems" is the destination;
> "single writer + known sync direction" is the rule during migration.

**Sync-direction notation**
- `Legacy → GOS` — GOS mirrors legacy (read-only in GOS). Legacy is the writer.
- `GOS → Legacy` — GOS is the writer; legacy consumes (read-only in legacy).
- `GOS only` — GOS is sole owner; no legacy involved.
- `External ↔ GOS (bounded)` — an external system of record stays canonical for its legal/native
  scope; GOS mirrors it and sends bounded requests (e.g. iCount).

**Migration stage**
- `Stage 0` — not started; legacy is sole writer.
- `Stage 1 — Mirror` — GOS imports/reads legacy; legacy still the writer.
- `Stage 2 — Flip` — GOS becomes the writer; legacy becomes reader.
- `Stage 3 — Retired` — legacy decommissioned for this concept.
- `N/A — External` — concept permanently owned by an external system of record (iCount).

---

## Register

| Concept | Current owner system | Future owner system | Current sync direction | Final sync direction | Migration stage | Notes / risks |
|---|---|---|---|---|---|---|
| **Organizations** | Pipedrive | GOS (CRM) | Pipedrive → GOS | GOS only | Stage 0 | Dedup on import; org identity is the anchor for Contacts & Deals. |
| **Contacts (external people)** | Pipedrive | GOS (CRM) | Pipedrive → GOS | GOS only | Stage 0 | Identity resolution is the key risk (phone/email dedup; a contact may also be a guide — keep separate, link optionally). `User`/`TeamMember`/`Contact` stay separate — no shared `Person` table. |
| **ContactPhone (phone → Contact identity)** | (WhatsApp tools, implicit) | GOS (CRM) | Legacy → GOS | GOS only | Stage 0 | **Locked:** one Contact, many numbers; a number maps to ≤1 active Contact. Normalize to E.164. Must allow re-mapping over time (reassigned/shared numbers). |
| **Deals (commercial agreement: total value, price, discount, payment terms, stage, quote ref, collection status)** | Pipedrive | GOS (CRM) | Pipedrive → GOS | GOS only | Stage 0 | **Locked:** Deal owns ALL commercial terms and the **total commercial value**. Tour must never own price. |
| **DealContact (Deal ↔ Contact link: roles, isPrimary, comm preferences)** | (none — implicit today) | GOS (CRM) | N/A | GOS only | Stage 0 | **Locked:** a Deal supports MULTIPLE contacts. Roles: coordinator/payer/decisionMaker/participant/invoiceContact/other. Prefs: receiveConfirmations/OperationalUpdates/PaymentLinks/Quotes. Gated by Contact-level consent. |
| **CRM Activities (call, follow-up, send quote, check payment, meeting, CS reminder)** | Pipedrive | GOS (CRM) | Pipedrive → GOS | GOS only | Stage 0 | **Locked:** Pipedrive-style activity, NOT a generic task. Must stay separate from Operational Task and Procedure Checklist Item. |
| **Notes & Attachments (CRM)** | Pipedrive | GOS (CRM + Files platform) | Pipedrive → GOS | GOS only | Stage 0 | Files go through the platform Files service, not ad-hoc per module. |
| **Tours (date, time, location, type, operational status, assigned guides)** | Airtable | GOS (Operations) | Airtable → GOS | GOS only | Stage 0 | **Locked:** operational execution only — no commercial data on Tour. |
| **TourType / Service catalog (default duration, required skills, default price)** | Airtable / spreadsheets | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | Default price ≠ agreed price. Agreed price lives on Deal. Catalog drives flexibility, not the spine. |
| **Booking (Deal ↔ Tour link: seats/qty, optional allocatedAmountMinor)** | (none — implicit today) | GOS (Operations) | N/A | GOS only | Stage 0 | **Locked:** the join entity. Supports 1→1, 1→many, many→1. No `deal_id` on Tour, no `tour_id` on Deal. `allocatedAmountMinor` is optional and never replaces the Deal total. Booking is optional — not every Tour has a Deal. |
| **TourAssignment (TeamMember ↔ Tour)** | Airtable / spreadsheets | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | **Locked:** rich entity — role (lead/assistant/trainee/driver/coordinator), confirmation status, attendance, and a per-assignment pay snapshot (agreedAmountMinor + optional override). Payroll READS it; never a second writer. |
| **Locations / Venues** | Airtable / spreadsheets | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | Reusable entity; avoid free-text location strings. |
| **Guide availability & scheduling (double-booking prevention)** | Airtable / spreadsheets | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | A real subsystem, not a field. Depends on TeamMember identity. |
| **Participant manifest / capacity** | Airtable / forms | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | Capacity on Tour; attendees may arrive via Forms. |
| **TeamMember (confirmed internal staff: identity, role, skills, availability)** | Recruitment system | GOS (Team) | Recruitment → GOS | GOS → Recruitment | Stage 0 | **Locked:** source of truth moves to GOS. **GOS generates its own canonical TeamMember ID**; recruitment IDs are external references only — never derive from them. Recruitment flips to reader. "candidate → hired" handoff must be idempotent (rehires/seasonal returns can fire it twice). |
| **Candidates / training-specific & recruitment-pipeline data** | Recruitment system | Recruitment system | Recruitment only | Recruitment only | N/A — External (bounded) | **Locked:** recruitment keeps candidate + training-specific data. "Candidate → hired" is the explicit handoff event into GOS Team. |
| **Guide payroll / compensation (what we pay guides)** | Spreadsheets | GOS (Finance Ops / Team) | Legacy → GOS | GOS only | Stage 0 | Distinct money flow from customer collection. Do not conflate. |
| **Quotes** | Pipedrive / Cognito / manual | GOS (Finance Ops) | Legacy → GOS | GOS only | Stage 0 | Derived from Deal; Deal owns the agreed numbers. |
| **Payment links & collection status (operational finance)** | Make / manual / spreadsheets | GOS (Finance Ops) | Legacy → GOS | GOS only | Stage 0 | **Locked:** GOS owns operational finance only. "Paid 60%" lives here, not in iCount. |
| **Invoices & receipts (legal/tax documents)** | iCount | iCount | iCount → GOS (mirror) | iCount ↔ GOS (bounded) | N/A — External | **Locked:** iCount is the legal source of truth forever. GOS requests issuance (invoice/receipt/invoice-receipt/credit note) and mirrors a read-only `FinanceDocument` (number, type, date, total, status, PDF link). Never build tax logic, numbering, or VAT in GOS. Issuance must be idempotent. |
| **FinanceDocument (GOS mirror of iCount docs)** | (none) | GOS (Finance Ops) | iCount → GOS | iCount → GOS | N/A — External | Read-only mirror only. GOS displays it on the Deal; never edits it. |
| **iCount customer record** | iCount | GOS identity, pushed to iCount | iCount → GOS | GOS → iCount | Stage 0 | **Conflict watch:** GOS Contact/Org owns identity; GOS pushes minimal billing data on issuance; iCount customer is derived. Do not edit customers directly in iCount (would create dual-write). |
| **Accounting / bookkeeping** | iCount | iCount | iCount only | iCount only | N/A — External | Never replicate in GOS. |
| **ChannelAccount (one WhatsApp number)** | WhatsApp tools | GOS (Communications) | Legacy → GOS | GOS only | Stage 0 | One ChannelAccount per number. Adding a number = adding a row, no model change. Provider swappable behind the Gateway. |
| **Conversations & message history (WhatsApp, multiple numbers)** | WhatsApp tools | GOS (Communications) | WhatsApp tools → GOS | GOS only | Stage 0 | **Locked:** Conversation unique per (ChannelAccount, participant) → prevents duplicates. Resolve via ContactPhone; unmatched → unresolved inbox (never auto-create duplicate Contact). Granular per-channel storage, **unified Contact-level history as a read view**. Store once; CRM & Ops read, never copy. |
| **Scheduled / outgoing messages** | Make / WhatsApp tools | GOS (Communications) | Legacy → GOS | GOS only | Stage 0 | Depends on Communications + Events. |
| **Forms (definitions & responses)** | Cognito Forms | GOS (Forms platform) | Cognito → GOS | GOS only | Stage 0 | **Locked:** shared platform capability with domain bindings; emits `FormSubmitted` events. Not a silo. |
| **Procedures / Knowledge / lessons learned** | Project brain doc | GOS (Knowledge) | Doc → GOS | GOS only | Stage 0 | Contextual & executable (checklists tied to entities/triggers), not a passive wiki. |
| **Procedure Checklist Items** | (doc) | GOS (Knowledge) | Doc → GOS | GOS only | Stage 0 | **Locked:** separate concept from CRM Activity and Operational Task. |
| **Operational Tasks (ops work on a tour)** | Airtable / spreadsheets | GOS (Operations) | Legacy → GOS | GOS only | Stage 0 | **Locked:** separate from CRM Activity and Procedure Checklist Item. |
| **Automations / triggers** | Make.com | GOS (Events & Automations) | Make → GOS (via webhooks) | GOS only | Stage 0 | **Locked:** Events must exist from foundation. Make consumes GOS webhooks during transition; retired flow-by-flow last. |
| **Domain events / event log** | (none) | GOS (platform) | N/A | GOS only | Stage 0 | Foundation backbone. Built before automations. Also powers audit & integration. |
| **Identity / Auth / Users / Permissions** | (none / ad-hoc) | GOS (Identity & Access) | N/A | GOS only | Stage 0 | Separate from TeamMember and Contact. Permission guard from Phase 0. |
| **Audit log (who changed what)** | (none) | GOS (platform) | N/A | GOS only | Stage 0 | Mandatory for a source-of-truth system. |
| **ConsentRecord (privacy/consent per Contact + channel)** | (none / implicit) | GOS (Identity / Privacy) | N/A | GOS only | Stage 0 | **Locked:** lawful basis + per-channel consent (timestamp + source). Operational vs marketing distinction. Consent gates per-deal routing (legal wins). Supports anonymize-vs-delete; tax-linked data retained per iCount/Israeli law. |
| **Money representation & currency (convention)** | n/a | GOS (all money fields) | N/A | GOS only | N/A — Convention | **Locked:** integer minor units only (₪1,250.50 → 125050); store a `currency` code alongside every amount (always ILS for now, insurance against future multi-currency); UI formats for display; no floating-point. |
| **Files / Attachments (global)** | Scattered | GOS (Files platform) | Legacy → GOS | GOS only | Stage 0 | One file service for all modules. |
| **Guide Portal data** | Existing portal work | GOS (Experience layer) | — | Composition only | Stage 0 | **Locked:** composes Team + Tours + Forms + Procedures + Finance. Never its own source of truth. |
| **Notifications (internal)** | (none / Make) | GOS (platform) | Legacy → GOS | GOS only | Stage 0 | Distinct from external Communications. |
| **Operational spreadsheets (misc)** | Spreadsheets | GOS (various) | Spreadsheets → GOS | GOS only | Stage 0 | Migrate per-concept; do not lift-and-shift a spreadsheet as a table. |

---

## How to use this register

1. **Before building any module**, find its concepts here and confirm the current writer.
2. **A cutover = advancing the Migration stage** for that concept, in order (0 → 1 → 2 → 3),
   never skipping the verification of the previous stage.
3. **No code may introduce a second writer** for a concept already owned. If a need appears,
   update this register first and get sign-off — the register changes before the code does.
4. **External-owned concepts (iCount, recruitment-candidate data)** never move to a GOS-writer
   stage; they stay bounded.

---

## Resolved architecture questions (locked 2026-06-24)

All previously-open questions that blocked schema design are now resolved:

1. **Person identity** — RESOLVED: `User`/`TeamMember`/`Contact` separate with explicit links;
   no shared `Person` table at this stage (reversible later).
2. **Booking value allocation** — RESOLVED: Deal owns the total; Booking carries quantity +
   optional `allocatedAmountMinor`, never replacing the Deal total.
3. **Deal ↔ Contact cardinality** — RESOLVED: multiple Contacts via `DealContact` (multiple roles,
   isPrimary, comm preferences). No single-main-contact assumption.
4. **Canonical TeamMember ID** — RESOLVED: GOS generates its own ID; recruitment IDs are external
   references only.
5. **Money representation & currency** — RESOLVED: integer minor units + a stored `currency` code
   on every money field; single currency (ILS) now; no floats.
6. **iCount integration contract** — RESOLVED: GOS requests issuance and mirrors read-only
   (`FinanceDocument`); GOS owns quotes/payment-links/collection; iCount owns numbering/VAT/PDF/
   ledger; idempotent issuance; GOS owns customer identity and pushes to iCount.
7. **WhatsApp architecture** — RESOLVED: `ChannelAccount` per number, `ContactPhone` identity,
   `Conversation` unique per (channel, participant), unified Contact-level history, provider
   swappable behind the Gateway. (Provider *vendor* choice remains an ops decision, not a schema
   blocker.)
8. **Event schema conventions** — RESOLVED: `domain.entity.action` past-tense; envelope+data
   payload; per-type versioning; domains emit only their own events; idempotent consumers.
9. **Tour assignment semantics** — RESOLVED: rich `TourAssignment` (role, status, attendance, pay
   snapshot), not a thin join.
10. **Privacy/consent** — RESOLVED: `ConsentRecord` per Contact/channel; consent gates routing;
    anonymize-vs-delete; tax-linked retention via iCount.

## Remaining decisions before schema (small, non-blocking)

Detail-level — settle during schema design, not architecture blockers:

- **Deal stage / pipeline** — confirm stages are configuration data (not hardcoded enums).
- **Participant / Attendee manifest** — decide if named attendees are a first-class entity or a
  form-fed list per Tour.
- **WhatsApp provider vendor** — official Cloud API vs current tooling (operational choice; the
  model already abstracts it).
- **Retention periods** — exact durations per data type (legal input needed), within the locked
  anonymize-vs-delete framework.
