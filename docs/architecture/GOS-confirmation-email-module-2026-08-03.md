# GOS — Confirmation Email Module (מייל אישור) — Audit + Architecture Proposal

Date: 2026-08-03
Status: PROPOSED — awaiting owner approval. No code written yet.

---

## Part A — Full audit (what exists today)

### A1. There is NO confirmation email in GOS today

- The only trace is a **disabled placeholder**: `TOUR_PLACEHOLDER_ACTIONS = ['שליחת מייל אישור']`
  (`client/src/admin/deals/DealDetail.jsx:2089`), rendered as a `בקרוב` item inside the
  "פרטי הסיור" card kebab (`DealDetail.jsx:772-774`, `MenuSoonItem` at `:2093-2105`).
- No trigger, template, route, worker or client action composes a confirmation email.
- The production confirmation email currently lives **outside GOS** in Make.com scenario 440477
  (WooCommerce order → Make webhook → Gmail send → Calendar → iCount → Pipedrive), documented in
  `docs/architecture/GOS-make-com-audit-2026-07-29.md:206-220`.
- Legacy Pipedrive had a per-product field "נקודת המפגש באימייל אישור" — i.e. the legacy email
  carried a meeting-point image per product.

### A2. Communication Center (stays untouched as the generic comms system)

- Models: `CommunicationEvent` → `CommunicationMessage` (`publicNumber` #N, bilingual
  `draftContent {he,en,enState}`) → immutable `CommunicationMessageVersion` → `CommunicationDelivery`
  (frozen `messageNumber`, `versionId`, `recipientSnapshot`, `triggerData`, `renderedContent` at send).
- 9 built-in triggers (`server/src/communication/triggers.js`); engine `engine.js`; worker
  `deliveryWorker.js` (60s tick, window/dependency/retry ladder); render `render.js`
  (email = `substituteHtmlTokens` + `sanitizeEmailHtml`).
- Scoping vocabulary already exists on `CommunicationEvent`: `activityMode/activityTypes`
  (group|private|business), `orgTypeIds`, `orgSubtypeIds`, generic `conditions`.
- **CC fires ALL matching events** — it has no "exactly one template" selection. Operator review
  happens once at publish; deliveries then send automatically.
- Anthropic is used for HE→EN translation only (`translate.js`, `enState:'ai_draft'`, never
  auto-published).

### A3. Email transport

- `server/src/email/simpleSend.js` — `sendCrmEmail({to, subject, bodyText, bodyHtml, attachments,
  dealId, contactId})` → `mime.buildRawMessage` → `gmail.sendRaw`, mirrors the sent message into the
  CRM thread. Product rule in code: *"no email text is ever sent without operator approval"*.
- The proven propose→review→send precedent: iCount Gmail fallback
  (`routes/icountDocs.js:272-356` + `SendDocumentModal.jsx`) and the quote email review phase
  (`GenerateQuoteModal.jsx` phases `preview → email → done` → `POST /:id/send-quote-email`).
- **MIME limitation:** `mime.js` has no `multipart/related`/`Content-ID` support — inline `cid:`
  images cannot be sent; attachments only. Outbound HTML gets `stampBlockDirections()` +
  `wrapEmailDocument()` automatically.

### A4. Meeting point + the divergent reader

- Canonical resolver exists: `server/src/tours/meetingPoint.js` → `resolveMeetingPoint(tourEventId, lang)`
  — text: SharedContent on variant → Location default → legacy variant cols → legacy location cols;
  image (separate chain): variant image → location image.
- The CC `{{meeting_point}}` variable (`variables.js:146-150`) **bypasses** this resolver (reads
  variant columns only, no image). The new module must use the canonical resolver.

### A5. Customer language

- SSOT: `Contact.communicationLanguage` (`he|en`), fallback `Deal.communicationLanguage`, then `he`.
- Quote precedent for role priority: `resolveQuoteLanguage` (`quote/quoteDocument.js:40-55`):
  payer → decisionMaker → coordinator → isPrimary → Deal.communicationLanguage → `he`.

### A6. Duration

- **The Deal has no duration field.** Canonical chain: `OpenTourTemplate.durationHoursOverride` →
  `ProductVariant.durationHours` → `DEFAULT_DURATION_HOURS`; resolver
  `server/src/tours/tourTime.js:23-29 tourDurationHours(tour)`.
- Display formatting client-side: `client/src/lib/duration.js` (`durationHe/durationEn`).
- The quote composer is already future-proofed for a deal override:
  `composer.js:314` — `deal?.durationHours ?? variant?.durationHours` with the comment
  *"deal override is future-proofing"*.

### A7. Cancellation policy — four unconnected stores

1. `AccountingDocSettings.cancellationTemplate` (accounting docs notes, operator-editable, HE only).
2. `QuoteSection` rows with `category='cancellation'` (bilingual, quote-only).
3. Agent-reservation frozen legal texts (`reservations/legalTexts.js`, versioned, immutable).
4. Nothing on Deal/TourEvent/Product/Variant.

None is "the" reusable customer-facing policy library. The new module needs its own predefined-policy
list; consolidation of the four stores is explicitly **out of scope**.

### A8. Deal right panel

- Right panel stack = `dealProperties` in `DealDetail.jsx:729-1005`; the Tour Details card
  ("פרטי הסיור") closes at `:937`; **insertion point for the new card is `DealDetail.jsx:938`**.
- Card shell: `PanelCard` (`variant="panel"`, `action` header slot). Kebab: `CardKebabMenu`
  (render-prop `close()`, portal `AnchoredMenu`).
- There is **no existing "menu-reveals-card" pattern** — closest are `LegacyInfoCard`
  (returns null with no data) and data-driven presence (LOST card, MarketingCard).
- Deal structured-JSON precedent: `Deal.noPaymentWaiver` + pure module `deals/waiver.js`;
  richer per-deal side data precedent: `DealTourPlan` (dealId @unique + child rows).
- Changelog: `timeline/dealChangelog.js` `TRACKED_FIELDS` (scalar/fk fields only) → one
  `kind:'change'` entry; manual `emitTimelineEvent` for non-scalar events.

### A9. Quote Preview — the philosophy to copy

- `GenerateQuoteModal.jsx` (Dialog `size="2xl"`): hover ✎ "עריכה להצעה זו" per section; nested
  `OverrideEditor` with the decisive checkbox **"החל שינוי זה גם על גרסאות עתידיות של עסקה זו"**;
  purple `זמני` / teal `מותאם` badges; `↺ שחזר טקסט ברירת מחדל`.
- Two layers: **persistent** = sparse JSON `overrideState.blocks[key]={html?,title?}` on the deal's
  draft `QuoteDocument` (server-merged via pure `mergeOverrideState`); **temporary** = client state
  only, sent as `temporaryOverrideState` to the produce call, consumed once, never stored.
- Snapshot: produce creates a NEW row with `renderModelSnapshot` = fully resolved values
  (`toPublicModel` strips admin fields); public read renders the snapshot forever.
- "Exactly one" resolution precedent: pricing engine (`pricing/engine.js`) — `specificity desc →
  priority desc → refuse ambiguity` (`ambiguous_price_rule`).

### A10. Settings + bilingual editing + reusable content

- Adding a CRM settings module = 5 touch points (SharedContentLibrary is the worked example):
  page component, `App.jsx` route, `settingsNav.js` tree entry, `CrmSettingsHome.jsx` card,
  server route mount + `api.js` namespace.
- `Location` model already has `nameHe/En`, `meetingPointHe/En` (+image), `marketingDescHe/En`,
  SharedContent default FKs. Editor: `LocationsSettings.jsx` (bilingual fields currently stacked).
- **Side-by-side bilingual pattern exists**: `BiEditor` (`VariantEditor.jsx:491-502`) — `lg:grid-cols-2`,
  HE editor + `dir="ltr"` EN editor, labels "עברית"/"English".
- **Shared Content Library** (`SharedContent` model + `ProductVariantSharedContent` join): the
  platform SSOT for reusable bilingual rich content. Types validated in
  `sharedContentTypes.js`; consumers reference via join rows (Restrict) or named FKs (SetNull);
  where-used + fork semantics + editor dialog + library screen already exist.

---

## Part B — Proposed architecture

### B1. Module identity

New dedicated module, **not** part of the Communication Center:

- Settings: **CRM Settings → מייל אישור** (`/admin/settings/crm/confirmation-email`).
- Server: `server/src/confirmation/` (composer, fillers, template resolution, send) +
  `server/src/routes/confirmationEmail.js` mounted at `/api/confirmation-email` (+ deal-scoped
  endpoints under `/api/deals/:id/confirmation`).
- Client: settings screen under `client/src/admin/crm/settings/`, deal-side components under
  `client/src/admin/deals/confirmation/`.
- Transport: **direct `sendCrmEmail`** on explicit operator action (like the quote email path) —
  NOT the CC delivery worker. Rationale: this is an operator-initiated, immediate, reviewed send;
  the CC pipeline is for trigger-driven scheduled sends. The send is idempotency-safe by being
  operator-explicit, and every send writes a snapshot row + timeline event.

### B2. Data model (Prisma)

```prisma
/// One confirmation-email template. Exactly one resolves per deal (see resolver).
model ConfirmationEmailTemplate {
  id            String   @id @default(cuid())
  internalName  String                    // admin-facing
  isDefault     Boolean  @default(false)  // exactly one; the all-wildcard fallback
  active        Boolean  @default(true)
  // scoping — empty array = wildcard (matches all), same vocabulary as CommunicationEvent
  productIds    String[]
  activityTypes String[]                  // group | private | business
  orgTypeIds    String[]
  priority      Int      @default(0)      // tiebreak inside equal specificity
  // structure: ordered sections; auto sections referenced by key, blocks by SharedContent id
  // [{ kind:'auto', key:'greeting'|'tour_details'|'meeting_point'|'meeting_point_image'
  //     |'location_logistics'|'special_terms'|'closing', hidden:false },
  //  { kind:'block', sharedContentId, hidden:false }]
  sections      Json?
  subjectHe     String?
  subjectEn     String?
  greetingHe    String?                   // optional wording overrides for auto sections
  greetingEn    String?
  closingHe     String?
  closingEn     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  blockLinks    ConfirmationTemplateBlock[]
}

/// Explicit join — which reusable blocks a template includes (Restrict like the variant join).
model ConfirmationTemplateBlock {
  id              String @id @default(cuid())
  templateId      String
  template        ConfirmationEmailTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  sharedContentId String
  sharedContent   SharedContent @relation(fields: [sharedContentId], references: [id], onDelete: Restrict)
  sortOrder       Int    @default(0)
  @@unique([templateId, sharedContentId])
}

/// Per-deal confirmation state — fillers + persistent preview overrides (DealTourPlan pattern).
model DealConfirmation {
  id            String   @id @default(cuid())
  dealId        String   @unique
  deal          Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  // fillers: [{ kind:'cancellation_policy'|'activity_duration'|'new_guide'|'other_note',
  //             ...structured payload per kind (registry-defined) }]
  fillers       Json?
  // persistent per-deal preview overrides: { sections: { [key]: { html?, title? } } }
  overrideState Json?
  updatedById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

/// Immutable snapshot of every sent confirmation email.
model ConfirmationEmailSend {
  id                String   @id @default(cuid())
  dealId            String                    // loose (audit outlives entities), indexed
  templateId        String?                   // loose
  templateName      String
  language          String                    // he | en — the ACTUAL sent language
  recipientSnapshot Json                      // { name, email, contactId }
  subject           String
  bodyHtml          String                    // final rendered HTML as sent
  fillersSnapshot   Json?                     // fillers at send time
  overridesSnapshot Json?                     // persistent+temporary merged, for audit
  imagesSnapshot    Json?                     // [{ role, mediaFileId, r2Key, url }]
  providerMessageId String?
  sentAt            DateTime @default(now())
  createdById       String?
  @@index([dealId, sentAt])
}
```

`Location` gains two columns (edited side-by-side in LocationsSettings):

```prisma
  logisticsHe String?   // rich HTML — location logistics for the confirmation email
  logisticsEn String?
```

`Deal` gains one structured column (see decision D2):

```prisma
  durationHours Float?  // operator-confirmed duration override; null = canonical chain
```

Reusable blocks = **SharedContent rows with new types** (no new content model):
`sharedContentTypes.js` gains `confirmation_block` (list — What to Bring, Special Notes, future
blocks) and `cancellation_policy` (list — the predefined policies; the template's cancellation
block references one as its default). They get bodyHe/bodyEn, image, active, where-used, Restrict
deletion guard, and the existing editor dialog for free.

### B3. Template resolution — exactly ONE

Pure module `server/src/confirmation/resolveTemplate.js`, modeled on the pricing engine:

1. Candidates = active templates where every non-empty scope list contains the deal's value
   (product, activityType via `classification.js` semantics — linked org forces `business`;
   orgType via `effectiveOrgTypeId`).
2. Sort by specificity (count of constrained dimensions) desc, then `priority` desc.
3. Tie at the top → **refuse with a clear operator-facing error** (like `ambiguous_price_rule`);
   the settings screen warns about overlapping scopes at save time.
4. No candidate → the `isDefault` template (enforced to exist, all-wildcard).

### B4. Composition pipeline

`server/src/confirmation/composer.js` — quote-composer pattern: a section registry dispatching to
pure builders, output = ordered blocks `{key, kind, data, editable, overridden}` + warnings.

Auto sections and their canonical sources:

| Section | Source |
|---|---|
| `greeting` | template wording (default: bilingual code default) + contact first name |
| `tour_details` | Deal (date/time/participants/group/product/city) + duration: `Deal.durationHours` → `tourDurationHours(tour)` chain; duration filler note rendered beneath |
| `meeting_point` | **`resolveMeetingPoint(tourEventId, lang)`** — the canonical resolver, never `variables.js` |
| `meeting_point_image` | same resolver's image chain (variant → location) |
| `location_logistics` | `Location.logisticsHe/En` (deal's location → variant's location) |
| `special_terms` ("תנאים מיוחדים שסוכמו") | synthesized from `new_guide` + `other_note` fillers; hidden when none |
| `closing` | template wording |

Reusable blocks render their SharedContent body in the send language. The cancellation block content
= deal filler choice (chosen policy / override) → template default policy.

Language: `resolveConfirmationLanguage(deal)` reuses the quote role-priority ladder → `he` fallback.
No cross-language fallback inside a section: a missing-language block yields a warning shown in the
preview, exactly like quote composition.

Images in email HTML: **hosted R2 URLs** (`MediaFile.url`, already publicly served for quote pages)
— no MIME changes needed. `cid:` inline embedding stays a documented future option (requires
`multipart/related` support in `mime.js`).

### B5. Fillers — registry, structured, future-proof

`server/src/confirmation/fillers.js` — code-defined `FILLER_KINDS` registry (the
detectors/adminReports pattern): each kind declares `{ kind, labelHe, payloadSchema,
affects: [sectionKeys], validate(payload), summarize(payload) }`.

V1 kinds:

- `cancellation_policy` — `{ mode:'default'|'policy'|'override', policyId?, noteHe?, noteEn? }`.
  Replaces the cancellation block entirely.
- `activity_duration` — `{ durationHours, noteHe?, noteEn? }`. Writes `Deal.durationHours`
  (structured, changelog-tracked) and shows the current canonical duration when editing.
- `new_guide` — `{ noteHe, noteEn }`, pre-filled with a default wording (template-configurable
  later); feeds `special_terms`.
- `other_note` — `{ noteHe, noteEn }`, empty editor; feeds `special_terms`. Multiple special-note
  kinds are just more registry entries — the section renders all of them in order.

Every operator-facing editable text area is headed **"הערה ללקוח" (Customer Note)** — never "Note".
Filler changes emit a timeline event (manual `emitTimelineEvent`, kind `change`, grouped title),
and `durationHours` is added to `TRACKED_FIELDS`.

Quote reuse (Part 14): the registry + payload shapes live in their own dependency-free module so the
quote composer can later consume the same fillers. **No quote code is touched in this project.**
Note the one deliberate side effect of decision D2 below.

### B6. Deal card — "תנאי עסקה מיוחדים (פילרים)"

- New `PanelCard` inserted at `DealDetail.jsx:938` (immediately below פרטי הסיור).
- Visibility = data-driven + ephemeral reveal (new pattern, minimal):
  - fillers exist → card always renders, no Hide button;
  - no fillers → card hidden; kebab item "תנאי עסקה מיוחדים (פילרים)" reveals it (local state);
    revealed-empty card shows a Hide button returning it to the kebab. No persistence needed —
    an empty card simply disappears on next visit, matching the spec.
- Card content: the question **"איזה תנאים של העסקה השתנו?"** with multi-select filler chips;
  selecting a kind opens its editor (duration shows current canonical value; cancellation shows
  default/policy/override choice; notes show bilingual "הערה ללקוח" editors — side-by-side
  `BiEditor` pattern).

### B7. Preview + send flow

Kebab action "שליחת מייל אישור" goes live:

1. Server composes (`POST /api/deals/:id/confirmation/compose-preview`, supports a one-shot
   `overrideOverlay` like quotes) → resolved template, language, sections, warnings.
2. **No fillers** → per spec, sends without the large preview (still an explicit operator click;
   see decision D3).
3. **Fillers exist** → large preview dialog (`Dialog size="2xl"`, GenerateQuoteModal philosophy):
   - header "תצוגה מקדימה — עברית" / "Preview — English"; **only the sending language**, never both;
   - hover ✎ per editable section → nested editor with the checkbox
     "החל שינוי זה גם על מיילי אישור עתידיים של עסקה זו" (persistent → `DealConfirmation.overrideState`,
     unchecked → client-side temp layer consumed by this send only) — exact quote semantics,
     including the temp-never-silently-promoted rule and `↺ שחזר` reset;
   - recipient + subject editable in the send step.
4. `POST /api/deals/:id/confirmation/send` → re-compose server-side with overlays → `sendCrmEmail`
   → write `ConfirmationEmailSend` snapshot → `emitTimelineEvent` (kind `communication`) +
   `touchDealActivity`.

Historical sends are immutable: the snapshot stores final rendered HTML + image identities; template
edits never touch it. A snapshot viewer (read-only, amber archive banner like `QuoteSnapshotView`)
opens from the timeline entry.

### B8. What is deliberately NOT built

- No Communication Center coupling (no trigger, no #N number, no delivery worker involvement).
- No quote-module changes.
- No consolidation of the four cancellation-text stores (future cleanup).
- No cid-inline images (hosted URLs first).
- No automation/auto-send — operator-initiated only, honoring the no-auto-email rule.

---

## Part C — Reusable components inventory

| Need | Reused component |
|---|---|
| Large preview dialog | `Dialog size="2xl"` (`admin/common/Dialog.jsx`) — Esc stack + focus trap |
| Preview override UX | GenerateQuoteModal patterns: hover ✎ pill, `OverrideEditor` checkbox semantics, `זמני`/`מותאם` badges, merge helpers |
| Rich text authoring | `RichEditor` (`client/src/editor/RichEditor.jsx`) |
| Rich text display | `RichText` (`.gos-prose`) — canonical renderer rule |
| Side-by-side HE/EN | `BiEditor` pattern (`VariantEditor.jsx:491`) — promote to a shared component |
| Reusable bilingual blocks | `SharedContent` + editor dialog + library screen + Restrict join pattern |
| Meeting point + image | `resolveMeetingPoint` (`server/src/tours/meetingPoint.js`) |
| Duration | `tourDurationHours` (`server/src/tours/tourTime.js`) + `duration.js` formatting (move to `shared/` for server use) |
| Language resolution | quote role-priority ladder (`quote/quoteDocument.js:40-55`) — extract to shared helper |
| Exactly-one matching | pricing engine specificity/priority/ambiguity pattern (`pricing/engine.js`) |
| Email send | `sendCrmEmail` (`email/simpleSend.js`) + `sanitizeEmailHtml` + `wrapEmailDocument` |
| Card shell / kebab | `PanelCard`, `CardKebabMenu`, `AnchoredMenu` |
| Timeline | `emitTimelineEvent`, `touchDealActivity`, `dealChangelog.TRACKED_FIELDS` |
| Settings chrome | `SettingsChrome`, `CategoryCard`, `catalogKit` primitives |
| Product/orgType scoping UI | `CommunicationEvent` editor scoping controls + `MultiSelectFilter` |

## Part D — Decision points (owner call needed)

- **D1 — Reusable blocks as SharedContent types** (recommended) vs a new dedicated model.
  SharedContent gives editor, library, where-used, deletion guard for free; new types
  `confirmation_block`, `cancellation_policy`. Alternative keeps confirmation content isolated but
  duplicates infrastructure.
- **D2 — `Deal.durationHours` as a real column** (recommended) vs JSON-only inside the filler.
  A real column = structured, changelog-tracked, and the quote composer **already reads
  `deal.durationHours`** — so a confirmed duration override would automatically appear in future
  quote documents. I consider that correct behavior (one truth), but it is a quote-visible side
  effect and Part 14 says "no quote integration" — needs an explicit yes/no.
- **D3 — No-fillers send without preview.** Spec says send normally. Recommended: a minimal confirm
  step (recipient + subject + language line, one click) rather than fully blind send — consistent
  with the operator-review rule. Approve spec-as-written or the minimal confirm.
- **D4 — Ambiguous template match** → refuse at send with a clear message (pricing-engine style,
  recommended) vs deterministic silent tiebreak.

## Part E — Slice plan

1. **Foundation (server-only):** Prisma models + migration; `sharedContentTypes` additions;
   pure modules `resolveTemplate.js`, `fillers.js` + tests; `Location.logisticsHe/En`;
   `Deal.durationHours` (per D2) + changelog entry.
2. **Settings module:** `/settings/crm/confirmation-email` (template list + editor: scoping,
   section order/hide, block picker, subject/greeting/closing, default-template enforcement,
   overlap warnings); Location logistics fields in LocationsSettings (side-by-side);
   the 5 settings touch points + api namespace.
3. **Composer + preview endpoint:** `composer.js` auto-section builders, language resolution,
   compose-preview route with overlay support; shared duration formatting to `shared/`.
4. **Deal card + fillers UI:** the פילרים card, kebab reveal/hide behavior, filler editors
   ("הערה ללקוח" headings, BiEditor), `DealConfirmation` CRUD, timeline events.
5. **Preview dialog + send:** the 2xl preview (single language, temp/persistent overrides),
   send endpoint + `ConfirmationEmailSend` snapshot + timeline entry + snapshot viewer;
   wire "שליחת מייל אישור" live.
6. **QA + polish:** test-send to self, empty/edge states, contract tests (api namespace guard),
   docs update, deploy.

Each slice ships independently (settings usable before the deal card; card usable before send).

## Part F — Risks

- Gmail remote-image display: hosted R2 images may be proxied/blocked by some clients; acceptable
  V1 (Gmail shows them by default), cid-inline is the documented upgrade path.
- `{{meeting_point}}` divergence stays in CC (out of scope) — the new module uses the canonical
  resolver; flagged for a future CC fix.
- English content gaps: preview warnings (quote-style) make gaps visible; sending language with a
  missing block shows the warning and lets the operator fill via override.
- Template overlap misconfiguration: mitigated by save-time warnings + D4 refusal behavior.
