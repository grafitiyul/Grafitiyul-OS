# GOS Questionnaire Engine — Canonical Architecture Blueprint

> Status: **Design approved, not yet implemented.** This document is the single
> source of truth for building the GOS Questionnaire Engine. No code, migrations,
> or implementation exist yet. Supersedes nothing; complements
> `docs/architecture-audit.md` (the Challenge audit that motivated this design).

---

## 0. Scope & non-goals

**In scope:** one generic, native GOS questionnaire engine — data model, subject
binding, purpose model, versioning, snapshots, server validation, conditional
visibility, multilingual content, public token links, admin builder, and the two
first consumers (Tour Coordination, Tour Summary).

**Non-goals (reserved, not built now):** scoring, calculated fields, Google
Sheets sync, external API integrations, advanced reporting. The schema leaves
clean room for these; none is implemented in the first slices.

**Explicitly not touched:** the existing GOS **Flow / learning engine**
(`Flow`, `FlowNode`, `QuestionItem`, `Attempt`, `FlowAnswer`). That system is an
internal *learning* tool with attempt/review/approval/checkpoint semantics — the
wrong shape for one-shot subject-bound forms. The Questionnaire Engine is a
**separate, parallel system**. We do not merge them and we do not extend Flow to
cover forms. Two engines, two purposes, zero shared tables — but only **one**
questionnaire engine.

---

## 1. Overall philosophy

1. **One engine, many consumers.** There is no "Tour questionnaire" and no "CRM
   questionnaire." There is one engine. Tours, CRM, HR, surveys, inspections are
   all *consumers* that supply a `subjectType`, a `subjectId`, and a `purpose`.
2. **Single source of truth.** A questionnaire's definition lives in exactly one
   place (a published `QuestionnaireVersion`). A response lives in exactly one
   place (a `QuestionnaireSubmission`). Nothing is duplicated across consumers.
3. **Native GOS, no Challenge dependency.** We reuse Challenge's *architecture,
   concepts, and UX* — not its code, not its runtime, not its database. GOS is
   Express + Prisma + React/Vite; the engine is built in that stack.
4. **Definition is immutable once published; responses are immutable forever.**
   Editing a live form creates a *new version*. Old submissions keep pointing at
   the old version and additionally carry their own answer snapshots. History
   never mutates.
5. **The server is authoritative.** Validation, conditional visibility, and
   required-ness are decided on the server. The client mirrors the same rules
   for UX only.
6. **Generic core, thin bindings.** The engine knows nothing about Bookings or
   Deals. Each consumer registers a small **subject adapter** (existence check,
   prefill, display context, authorization, post-submit hook). This is the seam
   that keeps the engine generic while integrations stay clean.
7. **Freshness rule compliance.** All engine API responses are served under the
   existing `/api` `no-store` policy. Public form pages always reflect the live
   published version (or the frozen submission once submitted). No hidden caching.

---

## 2. Complete entity model

Two clusters: **Definition** (frozen-on-publish) and **Response** (frozen forever),
plus **Distribution** (public links). All ids are `cuid()`, all tables carry
`createdAt`/`updatedAt`, soft-delete via `isActive`/`status`, per GOS conventions.

### Definition cluster

#### `QuestionnaireTemplate` — the logical form identity
The stable identity of a form across all its versions. Holds *what kind of form
this is*, not its questions.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `key` | string @unique | Stable machine slug (e.g. `tour_coordination`). Referenced by consumers instead of a raw id. |
| `purpose` | string | Business purpose (§5). Denormalized onto submissions/links. |
| `title` | Json | Localized string map `{ he, en, … }` (§10). Admin/internal name may be separate `internalName`. |
| `internalName` | string | Admin-facing label, not shown to fillers. |
| `description` | Json? | Localized. |
| `status` | string | `draft` \| `active` \| `archived`. |
| `defaultLanguage` | string | e.g. `he`. |
| `supportedLanguages` | string[] | e.g. `["he","en","es"]`. |
| `currentVersionId` | cuid? | Points at the published version that NEW submissions use. Null until first publish. |
| `singletonPerSubject` | bool | If true, at most one active submission per `(subjectType, subjectId, purpose)`. Default true. |
| `audience` | string | `public` \| `staff` \| `both`. Governs whether public links are allowed. |

Relations: `versions[]`, `submissions[]`, `links[]`.

#### `QuestionnaireVersion` — the frozen structural snapshot
The heart of versioning. A version owns the entire structure (sections →
questions → options → conditions). **A published version is immutable.** Editing
a live form creates a new `draft` version; publishing freezes it and flips
`Template.currentVersionId`.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `templateId` | cuid | FK → Template (Cascade). |
| `versionNo` | int | 1,2,3… per template. `@@unique([templateId, versionNo])`. |
| `status` | string | `draft` \| `published` \| `archived`. |
| `publishedAt` | DateTime? | Set on publish; after this the row is treated as read-only by the service. |
| `notes` | string? | Changelog note for this version. |

Relations: `sections[]`, `questions[]`, `submissions[]`.

> Why sections/questions hang off the **version**, not the template: it makes
> "changing a template never changes old answers" structurally impossible to get
> wrong — old submissions reference an old, frozen version.

#### `QuestionnaireSection` — first-class section
Ordered grouping within a version (Customer, Arrival, Workshop, Payment, Notes…).

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `versionId` | cuid | FK → Version (Cascade). |
| `key` | string | Stable within the template (survives reorder). |
| `title` | Json | Localized. |
| `description` | Json? | Localized. |
| `sortOrder` | int | Order within version. |
| `collapsible` | bool | UI hint (default false). |
| `collapsedByDefault` | bool | UI hint. |
| `visibleWhen` | Json? | Conditional-visibility expression (§9). Null = always visible. |

Relations: `questions[]`.

#### `Question` — a field
| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `versionId` | cuid | FK → Version (denormalized for fast whole-form loads). |
| `sectionId` | cuid | FK → Section. |
| `key` | string | Stable within the template. The join key for answers + conditions. |
| `type` | string | One of the question types (§8). |
| `label` | Json | Localized. |
| `helpText` | Json? | Localized. |
| `placeholder` | Json? | Localized. |
| `required` | bool | Base required-ness (may be relaxed when hidden by a condition). |
| `sortOrder` | int | Order within section. |
| `config` | Json | Type-specific settings: `min/max/step`, `maxLength`, `regex`, `accept` (file), `scaleMin/scaleMax`, `ratingMax`, `allowOther`, `multiple`, `staticHtml` (for static_text), etc. |
| `visibleWhen` | Json? | Conditional-visibility expression (§9). |
| `validation` | Json? | Extra server rules beyond `required` + `config`. |
| `calculated` | Json? | **Reserved** for computed fields (future). Null now. |

Relations: `options[]`, `answers[]`.

#### `QuestionOption` — choice option
| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `questionId` | cuid | FK → Question (Cascade). |
| `value` | string | Stable machine value stored in answers. |
| `label` | Json | Localized display. |
| `sortOrder` | int | |

### Response cluster

#### `QuestionnaireSubmission` — one response instance
| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `templateId` | cuid | FK → Template. |
| `versionId` | cuid | FK → Version — **the exact structure this response was filled against.** |
| `subjectType` | string | Polymorphic subject (§4), e.g. `booking`. |
| `subjectId` | string | The subject's id. No DB FK (polymorphic); validated in service. |
| `purpose` | string | Denormalized from template for indexing/reporting. |
| `status` | string | `draft` \| `submitted` \| `reviewed` \| `void`. |
| `language` | string | Which language the responder filled in. |
| `submittedByType` | string | `public` \| `staff` \| `system`. |
| `submittedByRef` | string? | PersonRef id (staff) or null (anonymous public). |
| `submittedByName` | string? | Snapshot of filler name. |
| `linkId` | cuid? | The public link used, if any. |
| `subjectSnapshot` | Json? | Frozen display context of the subject at submit time (survives subject deletion/rename). |
| `structureSnapshot` | Json? | **Optional** whole-form frozen render (sections+questions+conditions as shown). Belt-and-suspenders (§7). |
| `meta` | Json? | UTM / channel / device, etc. |
| `submittedAt` | DateTime? | Set on `draft → submitted`. |

Constraints:
- `@@index([subjectType, subjectId, purpose])`
- Singleton enforced by a **partial unique index** on
  `(subjectType, subjectId, purpose)` **where status ∈ {draft, submitted, reviewed}**
  when `Template.singletonPerSubject` is true (app-enforced; Prisma models the
  partial index via raw SQL in the migration, mirroring existing GOS partial
  uniques like `Booking(dealId) where status='active'`).

Relations: `answers[]`.

#### `Answer` — one answer
| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `submissionId` | cuid | FK → Submission (Cascade). |
| `questionId` | cuid? | FK → Question. Nullable so a later version hard-delete never orphans the answer. |
| `questionKey` | string | Stable key — the durable link even if `questionId` is gone. |
| `value` | Json? | Unified value: string \| number \| string[] \| {other} \| media-ref \| null. |
| `questionSnapshot` | Json | **Frozen** `{ type, label(localized), config, options }` as shown at answer time (§7). |
| `sortOrder` | int | Render order snapshot. |

`@@index([submissionId])`, `@@index([questionId])`.

### Distribution cluster

#### `QuestionnaireLink` — public capability token
Binds a public URL to a specific `(subject, purpose, template)`.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `templateId` | cuid | FK → Template. |
| `subjectType` | string | Subject bound to this link. |
| `subjectId` | string | |
| `purpose` | string | |
| `token` | string @unique | High-entropy `crypto.randomBytes(24).toString('base64url')`. Exact-match resolve; no enumeration. |
| `tokenEnc` | string? | AES-256-GCM ciphertext (reuse `tokenCrypto.js` pattern) so admin can re-display the link. |
| `language` | string? | Force a language (e.g. from `TourEvent.tourLanguage`); null = let responder pick. |
| `label` | string? | Admin label. |
| `expiresAt` | DateTime? | Optional expiry. |
| `singleUse` | bool | If true, revoked after first successful submission. |
| `isActive` | bool | Soft-revoke. |
| `lastUsedAt` | DateTime? | Audit. |

#### `QuestionnaireLinkSession` — *(optional, deferrable to a later slice)*
Mirror of Challenge's `WorkspaceSession` / GOS admin sessions: an httpOnly
cookie minted on first open so multi-step fill + resume works without putting the
token in every request or in analytics. **v1 can skip this** and pass the token
per request (matches `publicQuote`); add sessions when resume-heavy UX demands it.

### Entity-relationship summary

```
QuestionnaireTemplate 1───∞ QuestionnaireVersion 1───∞ QuestionnaireSection 1───∞ Question 1───∞ QuestionOption
        │                          │                                                  │
        │                          └──────────────── (currentVersionId points to one published version)
        │                                                                             │
        ├───∞ QuestionnaireLink ──(subjectType, subjectId, purpose)                   │
        │                                                                             │
        └───∞ QuestionnaireSubmission ──(versionId → frozen structure) 1───∞ Answer ──┘ (questionKey + snapshot)
                        │
                        └── subjectType + subjectId + purpose  (polymorphic, no FK)
```

---

## 3. Relationships (semantics)

- **Template → Version (1:∞).** One template, many versions; exactly one is the
  `currentVersion` used for new submissions. Old versions stay for history.
- **Version → Section → Question → Option (nested 1:∞).** The whole structure is
  owned by a version and frozen on publish.
- **Template/Version → Submission (1:∞).** A submission pins `versionId` — the
  precise structure it was answered against.
- **Submission → Answer (1:∞).** Each answer carries a `questionKey` + a frozen
  `questionSnapshot`, so it's renderable forever independent of the version tree.
- **Template → Link (1:∞).** Many public links, each bound to one subject+purpose.
- **Submission ↔ Subject (polymorphic).** `(subjectType, subjectId)` — no FK; a
  service-layer **subject registry** validates existence and provides context.

---

## 4. Subject architecture

The engine never references `Booking`, `Deal`, etc. It stores
`subjectType` + `subjectId` and delegates everything subject-specific to a
**Subject Adapter Registry** — a plain server-side map keyed by `subjectType`.

Each adapter implements a small contract:

| Hook | Purpose |
|---|---|
| `exists(subjectId)` | Validate the subject before binding/submitting. |
| `prefill(subjectId, language)` | Return known values keyed by `questionKey` (e.g. customer name/phone from the `Deal`). |
| `displayContext(subjectId, language)` | What to show the filler about the subject ("Tour on 2026-07-14, 10:00, Old City"). |
| `resolveLanguage(subjectId)` | Preferred language (e.g. `TourEvent.tourLanguage`). |
| `authorize(subjectId, actor)` | Who may open/fill (public token vs staff session). |
| `onSubmitted(subjectId, submission)` | GOS-native post-submit hook (timeline event, notification). Fire-and-forget. |

Registered subject types at launch: `booking`, `tour_event`. Adding `deal`,
`person`, `organization`, `location` later is a registry entry, **not** an engine
change. `subjectType`/`subjectId` may also be **null** for pure anonymous surveys
(no subject) — the engine allows an "unbound" mode.

**Orphan handling:** if a subject is later deleted, the submission survives
(polymorphic, no cascade). `subjectSnapshot` preserves the display context so the
response stays readable. The subject registry's `exists()` returning false is
surfaced as an "orphaned response" badge, mirroring the Tours orphan-booking UX.

---

## 5. Purpose architecture

`purpose` is a **business classification**, orthogonal to subject. Same subject
type can host different purposes; same purpose can span subject types.

| Purpose | Typical subject | Audience |
|---|---|---|
| `coordination` | `booking` | public |
| `tour_summary` | `tour_event` | staff |
| `crm` | `deal` / `person` | staff |
| `employee_review` | `person` | staff |
| `customer_feedback` | `booking` / null | public |
| `inspection` | `tour_event` / `location` | staff |
| `onboarding` | `person` | both |

A **Purpose Registry** (server-side) maps each purpose to: allowed subject types,
default `singletonPerSubject`, default audience, and reporting bucket. This keeps
"what combinations are legal" declarative and in one place. Purpose is
denormalized onto `Submission` and `Link` so reporting/filtering never needs a
template join.

> **Subject ≠ Purpose.** Subject = *what the form is about* (a specific Booking).
> Purpose = *why the form exists* (coordination). The pair
> `(subjectType, subjectId, purpose)` is the natural identity of a response and
> the basis of the singleton rule.

---

## 6. Versioning strategy

- **Edit-in-draft, publish-to-freeze.** A template's structure is only editable
  through a `draft` version. Editing an `active` template auto-creates (or
  continues) a draft version cloned from `currentVersion`. Publishing sets
  `status=published`, stamps `publishedAt`, and atomically flips
  `Template.currentVersionId`.
- **New submissions use `currentVersion`; in-flight submissions keep theirs.**
  A responder mid-draft is never disrupted by a publish. On resume, if their
  `versionId` is no longer current, we show a soft notice (same pattern as
  `publicQuote`'s "a newer proposal exists") and let them continue on their
  version or restart on the new one — policy per template (`allowResumeOnOldVersion`).
- **Published versions are read-only.** The service refuses structural writes to
  a published version. Archival (not deletion) retires old versions.
- **No structural edit ever touches a submission.** Guaranteed by the model: a
  submission points at a frozen version and carries its own snapshots.

---

## 7. Snapshot strategy (immutability guarantee)

Three layers, in order of authority:

1. **Frozen version (primary).** `Submission.versionId` → an immutable published
   version. This alone guarantees "editing a template never changes old answers,"
   because edits create a *new* version and old submissions reference the old one.
2. **Per-answer snapshot (secondary).** Every `Answer` stores `questionKey` +
   `questionSnapshot` (`type`, localized `label`, `config`, `options` as shown).
   An answer is fully renderable even if the version tree is later archived or a
   question hard-deleted. This is Challenge's proven approach.
3. **Whole-submission structure snapshot (optional third layer).**
   `Submission.structureSnapshot` freezes the exact rendered form (section order,
   which questions were visible after conditions, the language shown). Use when
   pixel-exact historical reproduction matters (e.g. signed customer forms).

**Recommendation:** implement layers 1 + 2 as the canonical baseline (cheap,
bulletproof, matches Challenge). Turn on layer 3 per-template via a flag for
forms that need legal-grade reproduction (customer coordination with signature).

`subjectSnapshot` is a parallel snapshot of the *subject's* display context so
responses survive subject rename/delete.

---

## 8. Question types

**Reused from Challenge (all of them):**
`text`, `textarea`, `number`, `email`, `phone`, `url`, `date`, `time`,
`datetime`, `yesno`, `choice` (single), `multi`, `dropdown`, `scale` (1–N),
`rating` (stars), `slider` (range), `image_upload`, `file_upload`, `static_text`.

**Added for GOS (recommended):**
- `signature` — canvas/typed/uploaded, storing a PNG via the existing
  `MediaAsset`/R2 path and `QuoteSignature`-style method field. Needed for
  customer coordination consent.
- `section_note` / rich `static_text` — localized HTML block (no input).
- `currency` — number with currency formatting (tours deal in ₪; reuses number
  validation + display config).
- `address` — structured, optional (compound field; can be deferred).
- `matrix` — proper grid (Challenge declared `matrix_simple` but never rendered);
  **reserved**, not built in first slices.

Each type declares, in one server-side **type registry**: its allowed `config`
keys, its value shape, its validators, and its renderer id. Adding a type = one
registry entry + one renderer, never an engine rewrite.

`date`/`time`/`datetime` inputs must use the shared GOS **DateTimeFields**
(`DateField`/`TimeField`) components, never native inputs (standing GOS rule).

---

## 9. Server-side validation architecture

**Principle:** the server is the authority; the client mirrors for UX only.

Pipeline on every `draft → submitted` transition (drafts skip required checks):

1. **Load frozen structure** for `submission.versionId`.
2. **Evaluate conditions server-side** (§9-conditions) to compute the *visible*
   question set for the submitted answer map. Hidden questions are excluded from
   validation and their answers are dropped.
3. **Per-question validation**, driven by the type registry:
   - `required` (only if visible),
   - type/shape check (number is numeric, multi is array, date parses…),
   - `config` constraints (`min/max/step`, `maxLength`, `regex`, `accept`,
     `scaleMin/Max`, option-membership for choice/multi),
   - `validation` extra rules,
   - normalization (phone → canonical, trim, etc.).
4. **Cross-field rules** (reserved; e.g. "endDate ≥ startDate") — pluggable,
   none required at launch.
5. **Result:** structured error list keyed by `questionKey`
   (`{ questionKey, code, message(localized) }`). Client renders inline; API
   returns `422` with the error array — consistent with the GOS rule that
   provider/validation failures return `422`, never a `5xx` that Cloudflare would
   turn into an HTML error page.

A single shared validator module is the contract; the client imports the same
condition-evaluator (GOS is JS front and back, so the evaluator is written once
and used on both sides — the client copy is advisory, the server copy is binding).

---

## 10. Conditional logic (visibility) design

Deliberately **not** a rule engine. A small, declarative, JSON boolean expression
attached to a `Question.visibleWhen` or `Section.visibleWhen`. Null = always
visible.

**Grammar:**
```
Expr   := { all: Expr[] } | { any: Expr[] } | { not: Expr } | Leaf
Leaf   := { q: <questionKey>, op: <Op>, value?: <any> }
Op     := "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte"
        | "answered" | "empty" | "contains"
```

**Rules:**
- References are by **`questionKey`** (stable across reorder/version).
- Evaluated **identically** client (UX) and server (binding). One evaluator spec.
- A hidden question is never required and its answer is discarded on submit.
- **No forward references / no cycles.** The builder validates the dependency
  graph is acyclic and only references earlier-or-sibling questions; a cycle is a
  publish-time error.
- Sections evaluate first; a hidden section hides all its questions.

This covers ~95% of real forms (show "workshop details" only if
`activity_type = workshop`) without branching graphs, skip-logic jumps, or
scripting. If a future form genuinely needs computed branching, `calculated`
fields (reserved) feed values that conditions can read — still declarative.

---

## 11. Multilingual design

**Storage:** every human-facing string is a **localized JSON map**, not a column
per language:
```json
{ "he": "שם הלקוח", "en": "Customer name" }
```
Applied to template `title`/`description`, section `title`/`description`, question
`label`/`helpText`/`placeholder`, option `label`, and static content.

**Why JSON maps over `valueHe`/`valueEn` columns** (which GOS uses for
`BusinessField`): tours run in he/en/es/fr/ru (`TourEvent.tourLanguage`). A
column-per-language model needs a schema change for every new language; a JSON
map scales to any language with zero migration — consistent with the CLAUDE.md
"no hard limits / plan for scale" rule.

**Template language contract:** `defaultLanguage` + `supportedLanguages[]`. The
builder enforces that every string has at least `defaultLanguage` present before
publish.

**Resolution / fallback chain:** requested language → `defaultLanguage` →
first available key. The responder's language is chosen by:
`link.language` (forced) → subject adapter `resolveLanguage()` (e.g. tour
language) → responder picker → `defaultLanguage`.

**On submit:** `Submission.language` records what was shown; each `Answer`'s
`questionSnapshot.label` freezes the *resolved single-language* label the
responder actually saw — so historical rendering needs no re-resolution.

---

## 12. Public form architecture

Reuses Challenge's philosophy on GOS-native rails.

**Token:** `QuestionnaireLink.token` = `crypto.randomBytes(24).toString('base64url')`,
`@unique`, resolved by exact match (no id enumeration). Optional `tokenEnc`
(AES-256-GCM via `tokenCrypto.js`) lets admins re-display the link. Public API is
`no-store` (existing `/api` policy).

**Flow:**
1. Customer opens `/q/:token` (client route) → `GET /api/public/q/:token`.
2. Server resolves link → subject adapter validates subject → loads the template's
   `currentVersion` (localized to the resolved language) → runs `prefill()` →
   resolves-or-creates the singleton `draft` submission for
   `(subjectType, subjectId, purpose)`.
3. Client renders the fill runtime (step-by-step or full-list), applying
   conditions live.
4. `POST /api/public/q/:token/submit` runs the **server validation pipeline**,
   writes answers + snapshots, flips submission to `submitted`, fires the subject
   adapter's `onSubmitted()` (timeline + notification), and (if `singleUse`)
   revokes the link.

**Sessions:** v1 passes the token per request (stateless, matches `publicQuote`).
If resume-heavy UX is needed, add `QuestionnaireLinkSession` (httpOnly cookie)
later — no schema change to core.

**Booking / TourEvent integration:** the link is created bound to the subject.
Opening it *is* opening that subject's form. Prefill pulls customer identity from
the `Deal`; language comes from the tour. No login, no account, no participant
concept — exactly the GOS requirement.

---

## 13. Admin Builder architecture

A dedicated admin area (`/admin/questionnaires`) with a **template list** and a
**version builder**.

**Builder layout** (follows GOS builder conventions — leading edge = library on
the right in RTL, work area on the left):
- **Right rail (library/palette):** question-type palette + section actions.
- **Center (work area):** the version as an ordered list of **sections**, each a
  collapsible container holding ordered questions. Drag-and-drop to reorder
  questions within/between sections and to reorder sections (mobile arrow
  fallback, mirroring the learning builder).
- **Right/side panel (inspector):** per-question settings — localized
  `label`/`helpText`/`placeholder` via **language tabs** (he/en/…), type, config
  (type-specific), `required`, options editor, and a **visual `visibleWhen`
  builder** (question + operator + value).

**Language tabs:** every text field shows a tab per `supportedLanguage`; the
`defaultLanguage` tab is required before publish.

**Preview (mandatory, per GOS rule):** a Preview button opens the real fill
runtime in a new window against the draft version, **without saving** — same
engine the customer sees, conditions live, no data written.

**Versioning UX:** editing an `active` template works on a draft version. A
**Publish** action validates (localized-string completeness, acyclic conditions,
option integrity) then freezes the version and flips `currentVersion`. A version
history panel lists versions with `publishedAt`/notes; structural diff between
versions is a future enhancement.

**Publishing states:** `Template.status = active` + a `published` version make the
form live. Public links always resolve `currentVersion` for new submissions.

---

## 14. Tour integration (first consumers)

### 14.1 Tour Coordination Form
- `template.key = tour_coordination`, `purpose = coordination`,
  `subjectType = booking`, `audience = public`, `singletonPerSubject = true`.
- **One submission per Booking.** A `QuestionnaireLink` is minted per Booking
  (auto on WON/booking-create or on demand) and sent to the customer.
- Subject adapter `booking`: `prefill` customer name/phone from the `Deal`;
  `resolveLanguage` from the tour/booking; `displayContext` shows tour date/time/
  location; `onSubmitted` writes a Deal timeline event and (optionally) notifies
  the operator.
- Surfaced on the Deal/Booking screen and the operational tour screen as
  "coordination: submitted/pending."

### 14.2 Tour Summary Form
- `template.key = tour_summary`, `purpose = tour_summary`,
  `subjectType = tour_event`, `audience = staff`, `singletonPerSubject = true`.
- **One submission per TourEvent.** Filled by staff (internal, requires admin
  session), attributed to the guide's `PersonRef` via `submittedByRef`.
- Subject adapter `tour_event`: `displayContext` shows the tour; `onSubmitted`
  writes a tour timeline event and feeds future reporting.
- Surfaced on the operational tour screen.

Both consumers are **pure configuration + a subject adapter** — no engine
changes, proving the "one generic engine" claim.

---

## 15. Future CRM & other consumers

All are new `(purpose, subjectType)` pairs + a subject adapter, nothing more:
- **CRM questionnaires:** `purpose=crm`, subject `deal`/`person`/`organization`.
- **Employee evaluations:** `purpose=employee_review`, subject `person`, staff
  audience, `submittedByRef` = reviewer.
- **Customer surveys:** `purpose=customer_feedback`, subject `booking` or
  **null** (anonymous), public audience.
- **Internal checklists / inspections:** `purpose=inspection`, subject
  `tour_event`/`location`, staff audience.
- **Onboarding / HR:** `purpose=onboarding`, subject `person`.

Reserved capabilities the schema already accommodates: `calculated` fields,
scoring (add a `score` Json to submission + per-question weights in `config`),
exports/Google Sheets (a separate optional sync module reading submissions), and
API integrations (webhook on `onSubmitted`).

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| **Polymorphic subject = no DB FK integrity.** | Subject registry `exists()` validation at bind/submit; `subjectSnapshot` for orphan survival; "orphaned response" UX. |
| **Client/server condition drift.** | One shared JS evaluator module used on both sides; server is binding, client advisory. |
| **Conditional-logic scope creep.** | Cap the grammar (§9); acyclic, backward-only references enforced at publish. No scripting. |
| **Multilingual gaps (missing translation).** | Enforce `defaultLanguage` completeness at publish; runtime fallback chain never renders blank. |
| **Versioning vs singleton interaction** (publish while a draft is open). | Draft keeps its `versionId`; resume shows a "newer version" notice (publicQuote pattern); policy flag `allowResumeOnOldVersion`. |
| **Over-engineering** (building scoring/sheets/calc too early). | Reserve in schema, build nothing until a consumer needs it. Slices 1–4 ship the tour forms; the rest is deferred. |
| **Public link security.** | 24-byte token, exact-match, no enumeration, `no-store`, rate-limiting, expiry, optional single-use. |
| **Large file/signature uploads.** | Reuse existing `MediaAsset`/R2 upload path + `QuoteSignature` method model; cap sizes. |
| **Two engines confusion** (Flow vs Questionnaire). | Explicit separation (§0); no shared tables; different admin areas; documented boundary. |
| **Performance.** | Index `Submission(subjectType, subjectId, purpose, status)`; whole-form loads read one version tree; answers as JSON rows are fine at GOS scale. |

---

## 17. Migration strategy (from today's GOS — no engine exists)

GOS has **no** questionnaire engine today, so this is **greenfield & purely
additive** — the lowest-risk possible migration:

- **No changes to existing tables. No data migration.** Every new table is new;
  nothing existing is altered, so there is zero risk to Deals, Tours, Learning,
  or any live module.
- **One Prisma migration per slice** (§18), each additive, each validated by the
  existing migration validation gate (`npm run validate:migrations`).
- **Reuse existing GOS infrastructure** (no new dependencies):
  `tokenCrypto.js` (link encryption), the `crypto.randomBytes` token pattern,
  `MediaAsset`/R2 (uploads/signatures), shared `DateTimeFields` (date/time
  inputs), `asyncHandler` + Express routers, the admin session guard, and the
  `/api` `no-store` policy.
- **Deployment:** standard GOS flow (push to `main` → Railway). No risky startup
  commands; no schema mutation at boot. Each slice is independently deployable.
- **Coexistence:** the engine lives beside the Flow/learning engine with no
  shared tables and a separate admin area.

---

## 18. Suggested implementation slices

Ordered so the two tour consumers land as early as safely possible. Each slice is
independently shippable and additive.

**Slice 1 — Definition core + builder skeleton.**
Schema for `Template`/`Version`/`Section`/`Question`/`Option`. Admin CRUD API
(Express). Builder: sections + questions + drag-drop + core types +
single-language + Preview. Draft/publish + version freezing. *No conditions, no
multilingual, no submissions yet.*

**Slice 2 — Submissions + server validation + internal fill.**
`Submission`/`Answer` + snapshots + subject binding + purpose. Server validation
pipeline. Staff fill runtime (internal, admin session). Subject registry with the
`tour_event` adapter. → **Tour Summary can ship here** (staff-filled, single
language).

**Slice 3 — Public links + public runtime.**
`QuestionnaireLink` + token + `/q/:token` fill page + prefill + singleton
enforcement + `onSubmitted` hook. `booking` subject adapter. → **Tour
Coordination ships (he/en)**, customer-facing, no login.

**Slice 4 — Multilingual.**
Localized JSON everywhere + builder language tabs + fallback chain + language
resolution from tour. → Coordination form fully multilingual (es/fr/ru).

**Slice 5 — Conditional visibility.**
`visibleWhen` on questions/sections + shared evaluator (client + server) + visual
condition builder + acyclic validation.

**Slice 6 — Rich types & drafts.**
`signature`, richer `file_upload`, section collapse, public draft-save/resume
(optional `QuestionnaireLinkSession`).

**Slice 7 — Reporting / exports (future).**
Submission list/report views, CSV export, optional Google Sheets sync module,
`onSubmitted` webhooks. Scoring/calculated fields if a consumer needs them.

---

*End of blueprint. Implementation begins only after this document is approved and
a specific slice is selected.*
