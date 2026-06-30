# GOS — Native Quote Module Architecture

**Status:** Governing document. Documentation only — no schema, no migrations, no implementation yet.
**Decision:** Architecture **B** — build the native Quote Module concretely, on the future-proof
composed-document *shape*, without building a generic Document Platform.
**Supersedes:** the "generic Document Platform now" direction explored during the audit.
**Builds on:** `GOS-deal-quote-pricing-spec.md`, `GOS-source-of-truth-register.md`,
`GOS-products-pricing-architecture.md`.
**Last updated:** 2026-06-30

---

## 0. One-line summary

> Build the Quote Module concretely on the **proven composed-document shape**
> (freeze a resolved render-model at produce time → one renderer → HTML page + PDF from the same
> source → reuse existing signers and files). Do **not** build the generic dispatch layer
> (`DocumentDefinition` registry, polymorphic routing, renderer abstraction) until a real second
> document type defines its contract. The platform is reached later by **addition, never rewrite.**

---

## 1. Final decision: Architecture B

We are replacing the external proposal tool (Prospero) with a **native GOS Quote Module**.

We implement it **concretely for Quote**, but shaped exactly like the long-term composed-document
platform, so that future generalization is purely additive.

This is **not a temporary shortcut.** It is the proven platform *shape*, implemented concretely for
its first and only current consumer. The distinction that governs every decision below:

- **Shape** (the document lifecycle: template → frozen instance → append-only renders + signatures)
  — proven, already runs in the existing overlay `DocumentInstance`/`FinalDocument`. **We build it now.**
- **Dispatch** (a registry of document *types*, polymorphic storage/routing, a renderer-strategy
  interface spanning unrelated renderers) — speculative, has exactly one consumer today.
  **We defer it.**

---

## 2. Why we rejected the generic Document Platform for now

The generic platform was rejected **today** (not forever) for these reasons:

1. **The valuable part is the shape, and the shape is free.** Building the composed-document
   lifecycle for Quote *is* building the platform's core. It does not become "more generic" later.
2. **The dispatch layer is a guess.** It would generalize Quote and a future Contract along an axis
   we cannot validate, because we have never seen Contract. The wrong abstraction is more expensive
   than a future rename.
3. **No second type is near-term or specified.** The roadmap is Phase 4 = quote document generation,
   Phase 5 = delivery. Contracts/work-orders/confirmations are listed only as "in the future" — no
   shape, no phase, no timeline. A dispatch layer's contract is defined by its *second* consumer; we
   don't have one.
4. **Speculative generality is itself debt.** A one-row registry, a single-implementation interface,
   and `WHERE docType = 'quote'` on every query are maintenance interest paid now, indefinitely, to
   insure against a refactor that may never occur and, if it does, is cheap.
5. **Governance already prevents duplication.** The Source-of-Truth Register would force
   *generalization over duplication* if a second document type ever appears — so we don't need the
   abstraction in code to protect the invariant.

**Conclusion:** building the platform now buys fake extensibility along a guessed axis and charges
real, compounding complexity for it. We build the concrete Quote Module on the shared shape instead.

---

## 3. What parts of the future platform shape we ARE building now

These are the durable, proven, additive pieces — building them concretely for Quote incurs **no
undo** later:

1. **Frozen instance** — a `QuoteDocument` that, at **produce time**, freezes a fully-resolved
   render-model as JSON (not references). This is what makes a quote immortal; identical for any
   future type.
2. **Append-only renders** — rendered PDFs stored in **R2 via the `MediaFile` convention**, with a
   metadata + content-hash row per render (not bytes-in-Postgres).
3. **Composer / block descriptor shape** — blocks described uniformly
   (`kind` / `type` / `sourceRef` / `config` / `order`), assembled by a **code-level renderer map**
   (a map keyed by block type — the natural implementation, not extra generality).
4. **One renderer source** — a single template + stylesheet that produces the **HTML page**, and the
   **PDF from that same HTML** (headless Chromium print).
5. **Reused signer infrastructure** — the existing `SignerPerson` / `SignerAsset` (canonical PNG
   `renderedBytes`), not a quote-private copy.
6. **Public token** — `QuoteDocument.publicToken` mirroring the proven `PersonRef.portalToken`
   pattern (high-entropy capability token + a kill switch).
7. **A `docType` discriminator** (string, defaulted to `"quote"`) — house style, same as
   `QuoteVersion.status` / `TimelineEntry.kind`. A discriminator is a column, not an abstraction; it
   is the cheap insurance that future generalization never requires undoing this table.
8. **A clean Quote service boundary** — so any later generalization is internal and mechanical, never
   a contract break.

---

## 4. What parts we are explicitly deferring

Not built now (each would be premature with a single document type):

- ❌ A generic **`DocumentDefinition` registry table** — replaced by the `docType` string + a
  code-level config map.
- ❌ A **polymorphic multi-document storage/platform** — the Quote uses **real FKs**
  (`quoteVersionId`, `dealId`), not polymorphic `subjectType`/`subjectId`.
- ❌ A **generic renderer dispatch layer / `DocumentRenderer` interface** across overlay + composed.
  The existing `pdfRender.js` (pdf-lib overlay) stays standalone and untouched; the composed renderer
  is built concretely. They share *philosophy*, not *runtime*.
- ❌ **Contracts / work-orders / confirmations infrastructure** — no models, no renderers, no flows.
- ❌ **Multi-document admin UI** — no document-type switcher, no generic document list.
- ❌ Any **speculative abstraction** introduced "to be ready" for a type that does not yet exist.

---

## 5. Quote lifecycle

```
Deal
  │  (operational + commercial context: product, city, participants, activityType,
  │   payment terms, contacts, communicationLanguage)
  ▼
QuoteVersion                       ← the PRICED version (exists today)
  │  status: draft | produced | accepted | rejected
  │  isWorking (the builder's working version) · isSelected (the accepted/main version)
  │  lines: QuoteLine[] (frozen unitPriceMinor, vatMode, structured group-ticket identity)
  │
  │  produce()  ── resolves composition + data + language into a frozen render-model
  ▼
QuoteDocument                      ← the PRODUCED, FROZEN proposal (new)
  │  renderModelSnapshot (JSON, frozen at produce time)
  │  docType="quote" · language · status · publicToken · expiresAt · producedAt
  │  references the QuoteVersion it priced from
  │
  ├── Public Quote Page  ── served from renderModelSnapshot via the ONE renderer (token URL)
  │        │
  │        ▼
  │     Signature  ── captured on the public page → stored as SignerAsset
  │        │           + SignatureRequest (multi-signer ready) + audit (ip/ua/time)
  │        ▼
  └── PDF  ── same HTML → Chromium print → stored in R2 (MediaFile) → QuoteDocumentRender (append-only)
```

A Deal may have **many** `QuoteVersion`s (alternatives). Each producible `QuoteVersion` yields one or
more **immutable** `QuoteDocument`s (e.g. re-produced after a content fix). Accepting a version and
marking the Deal **WON** remain **separate** actions (§16).

---

## 6. Snapshot strategy

**Freeze at *produce* time, never at edit time. Freeze the fully-resolved render-model, not
references.**

```
QuoteDocument.renderModelSnapshot = {
  meta:   { language, currency, dealId, quoteVersionId, producedAt },
  blocks: [   // already ordered, already filtered by conditions, already language-resolved
    { type:'cover',         data:{ … } },
    { type:'tour_details',  data:{ … } },
    { type:'content',       data:{ html:"<resolved He-or-En HTML>", title } },
    { type:'price_summary', data:{ lines:[…frozen QuoteLine snapshot…], net, vat, gross } },
    { type:'signature',     data:{ signerSlots:[…] } },
    …
  ]
}
```

Why **resolved**, not references:

- A later edit to a `QuoteSection`, product/city content, a price rule, or the Deal **cannot** change
  a produced quote — the HTML and numbers are already materialized (the same discipline as
  `DocumentInstance.businessSnapshot`, applied to the whole document).
- A later change to a **dynamic block's renderer code** **cannot** change old quotes — the snapshot
  stored *data*, and each render row pins its `rendererVersion`. Old data → same content forever; new
  code only affects new quotes.

**Draft** documents may re-resolve on each preview. **Only `produce()` freezes.** Produced/accepted
documents are immutable — to change, **clone** (consistent with the locked "produced/accepted
immutable, clone to revise" rule).

**The one intentional live region:** the commercial *offer* is frozen, but **payment state**
(paid %, outstanding balance, link status) is **live**, read at view time and rendered in a
visually-and-architecturally separate finance strip. Freezing payment state would be wrong. This
boundary is a first-class rule, not an exception to be discovered later.

---

## 7. Composer / block architecture

Three layers, one direction of truth:

```
Quote template (admin-managed default block list, ordered)
        │   copy on quote open
        ▼
QuoteDocument.compositionDraft (JSON: per-instance block list, still referencing sources)
        │   admin may reorder / toggle optional / add ad-hoc / set conditions
        │   produce()
        ▼
QuoteDocument.renderModelSnapshot (FROZEN, fully resolved — §6)
```

- The **template** is the reusable default order/content for "Quote".
- Each Deal's working quote starts as a **copy** of the template into a per-instance
  `compositionDraft`, which the admin can reorder (drag), toggle optional blocks, drop in an ad-hoc
  content block, or attach a condition. (Reuses the existing `@dnd-kit` `ReorderableList` and the
  `FlowEditor` composer mental model already in the codebase.)
- **`produce()` is a pure function:** `(compositionDraft, dealData, quoteVersion, language,
  contentSources) → renderModel`. Pure = deterministic and testable, like the pricing engine.

A block is a uniform descriptor — never a hardcoded template slot:

```
Block = {
  id, order,
  kind:      'dynamic' | 'content',
  type:      'cover' | 'tour_details' | 'price_summary' | 'signature' | 'finance_summary'
           | 'faq' | 'cancellation' | 'participant_policy' | 'why_us' | 'product_content'
           | 'city_content' | 'marketing' | 'image' | 'video' | 'attachment' | …,
  sourceRef: { kind, id } | null,   // content blocks point at QuoteSection / classification / product
  config:    { … layout/options … },
  optional:  bool,
  condition: { field, op, value } | null   // conditional sections, evaluated at produce time
}
```

A server-side **Block Registry** maps `type → renderer(block, ctx) → renderModelNode`. Adding a new
block (deposit schedule, embedded video, outstanding balance) = **registering one renderer** — no
schema migration, no template rewrite. `optional` and `condition` are **data**, never hardcoded
`if (activityType === …)` in a renderer.

---

## 8. Dynamic vs content blocks

| | **Dynamic blocks** | **Content blocks** |
|---|---|---|
| Source | System data (Deal, QuoteVersion, Finance) | Reusable CRM content |
| Examples | Cover, Tour Details, Price Summary, Signature, Finance Summary | FAQ, Cancellation, Participant Policy, Why Grafitiyul, classification content, Product content, City content, Marketing |
| Content stored? | No — computed by a registry renderer from snapshot data | Yes — references existing bilingual rich HTML (`QuoteSection`, `OrganizationType/Subtype.quoteContent*`, Product/Variant/Location HTML) |
| Language | Renderer formats data in target language | Picks the `*He` / `*En` field |
| On produce | Frozen into render-model | Frozen into render-model |

Both are the same `Block` shape with a different `kind`, both flow through the registry, both freeze
into the same render-model. **One pipeline, two block kinds** — no duplicated rendering, no duplicated
logic. That uniformity is precisely what guarantees the page and the PDF cannot diverge (§12).

---

## 9. Admin-controlled order

Section order is **data, never code**:

- The template's block list has an `order` field; admins reorder it (drag-to-reorder).
- Each quote instance copies the template and may **reorder per deal** (instance override on top of
  the template default — confirmed: admins reorder per deal, not template-only).
- `optional` blocks are included/excluded per instance; `condition` blocks are evaluated against the
  resolved data at produce time.

There is **no hardcoded final section order anywhere.**

---

## 10. Language resolution from Contact.communicationLanguage

- **`Contact.communicationLanguage` is the language SSOT.** Quote language is resolved
  **automatically** at produce time — never a manual default dropdown.
- **Which contact, when a Deal has several:** resolve by `DealContact.roles` priority —
  **payer → decisionMaker → coordinator → isPrimary** — and (when the delivery layer exists) gate by
  `DealContact.receiveQuotes`. The resolved language is stored on `QuoteDocument.language` (frozen).
- An explicit admin override is allowed, but is recorded **as an override**, not as the source of
  truth.
- Every content source is already bilingual (`*He` / `*En`); the renderer reads one side. No i18n
  framework is required for documents (consistent with the app's Hebrew-native + per-field-English
  approach).

---

## 11. Missing translation behavior

**No auto-translation, ever.**

- A **pre-produce validation pass** walks the resolved composition and checks that every *included*
  block has non-empty content in the **target language**.
- If any are missing → **block produce** and return the exact list (e.g. "Cancellation Policy has no
  English text", "Product X marketing (En) is empty") so the admin fills them.
- This validator is a pure pass over the same composer model — cheap and deterministic.

---

## 12. Rendering architecture — one HTML renderer, PDF from the same HTML

This is structurally enforced, not left to discipline:

```
renderModelSnapshot (JSON)
        │
        ▼
   ONE template layer  =  block components + ONE stylesheet (screen + @media print)
        │
        ├── HTML string ─────────────►  Public Quote Page (server-rendered, minimal hydration)
        │
        └── same HTML ──► headless Chromium (print CSS) ──► PDF ──► R2 (MediaFile)
```

- There is exactly **one** set of block components and **one** stylesheet. The PDF is *that HTML
  printed*, not a second template. Drift is impossible because there is only one template module.
- The render-model is the contract: every consumer (page, PDF, future email-inline) takes the same
  JSON and the same components.
- **Why headless Chromium and not `react-pdf`/`pdfkit`:** a second PDF component tree would be a
  second template = exactly the divergence we forbid. Chromium-print means PDF == page + print
  stylesheet.
- This is a **new** pipeline; it does **not** touch the existing pdf-lib overlay renderer
  (`services/pdfRender.js`), which keeps serving overlay documents.
- **Ops:** render the PDF **asynchronously** (off the request path); serve the HTML page instantly and
  attach the PDF when ready. Verify Hebrew/RTL font embedding in Chromium-print early.

---

## 13. Signature architecture — reuse existing SignerPerson / SignerAsset

- **Reuse `SignerPerson` / `SignerAsset`** (they already store canonical PNG `renderedBytes`). No new
  signer store.
- A **`SignatureRequest`** links a `QuoteDocument` to one-or-more signers (multi-signer ready) with
  `role`, `status`, `signedAt`, the captured `SignerAsset`, and audit (ip / user-agent / time).
- **Flow:** the public page shows a signature block (a dynamic block) → the customer draws → saved as
  a `SignerAsset` + `SignatureRequest.signed` → triggers a **new** append-only `QuoteDocumentRender`
  with the signature embedded (the unsigned render is preserved). The offer snapshot is never mutated;
  signing **adds**.
- Signing the **proposal** is a sales artifact — kept distinct from a legally binding **contract**
  (§16).

---

## 14. R2 / MediaFile PDF storage

- Rendered quote PDFs are stored in **Cloudflare R2 via the `MediaFile` convention**; the database
  row holds **metadata + `r2Key`/`url` + `contentHash`**, never the bytes.
- **Why, with precedent:** the schema already has both patterns — `MediaAsset` (learning module)
  stores raw bytes in Postgres; the newer `MediaFile` (products/pricing) stores metadata + R2 keys.
  The overlay `Document*` engine followed the old bytes-in-DB path; quotes follow the **newer, better**
  convention. Avoids Postgres blob bloat, slow rows, and backup pain across many versions/images.
- Each produce (and each explicit re-render) appends a `QuoteDocumentRender` row → an immutable audit
  trail of every rendered artifact.

---

## 15. Versioning — QuoteVersion vs QuoteDocument

Two distinct axes, deliberately separated:

1. **`QuoteVersion`** = the **priced** version (exists today). The numbers. `isWorking`,
   `isSelected`, `status`, `QuoteLine[]`.
2. **`QuoteDocument`** = a **produced, frozen proposal** rendered from a `QuoteVersion`.

Relationships:

- Deal → many `QuoteVersion` (alternatives). One is the **working** draft; accepting one sets
  `isSelected` ("main/accepted" — still **not** WON).
- `QuoteVersion` → 0..n `QuoteDocument` (re-produce after a content fix → a new immutable document;
  old ones retained).
- **Alternative offers** = sibling `QuoteVersion`s, each producible into its own document.
- Editing prices is a `QuoteVersion`/`QuoteLine` concern; producing/snapshotting/rendering/signing is
  a `QuoteDocument` concern. They never overlap.

---

## 16. Clear separation of states

These are **five distinct states/objects.** Conflating any two is the classic CRM mistake; we keep
them structurally separate:

| State / object | What it means | Where it lives |
|---|---|---|
| **Accepted quote** | The commercial version the customer agreed to; the commercial source of truth for the Deal. | `QuoteVersion.isSelected` / `status='accepted'` |
| **WON deal** | A **separate, subsequent** sales-status action. Accepting does **not** auto-WON. | `Deal.status='won'` + `wonAt` |
| **Signed proposal** | The customer signed the *proposal* on the public page — a sales artifact, not legally binding. | `SignatureRequest` on a `QuoteDocument` |
| **Contract** | A legally binding document — a **different future document type** (possibly overlay-based), produced later. **Not built now.** | (future) |
| **Invoice / receipt** | A legal/tax document. **iCount is the legal authority forever**; GOS only mirrors a read-only `FinanceDocument` and shows estimates. | iCount (mirror in GOS) |

GOS computes the commercial/quote VAT as an **estimate**; iCount owns the legal VAT, numbering, and
binding PDF. The quote never becomes a tax document.

---

## 17. Future additive path to a generic Document Platform

If and when a **real second composed-document type** appears (and we know its actual shape), the
platform is reached by **addition, not rewrite**, because the shape is already correct:

1. **Promote the type discriminator.** The existing `docType` string becomes backed by a
   `DocumentDefinition` row (or stays a string + config map) — additive; existing quote rows already
   carry `docType="quote"`.
2. **Generalize storage if needed.** Add the new type's subject linking additively; the quote keeps
   its real FKs (`quoteVersionId`, `dealId`). The frozen-render-model, append-only renders, signers,
   and public-token mechanics are **already generic** and unchanged.
3. **Add the new type's block renderers** to the existing registry map — no change to existing
   renderers.
4. **Introduce a renderer interface only if a third renderer appears.** Overlay and composed remain
   separate until there's a real reason to unify.
5. **Generalize the service boundary internally** — callers of the Quote service are unaffected.

The only operation this may include is a **model rename** (`QuoteDocument` → a shared `Document`),
which — with no data transformation, a single consumer, full test coverage, and a clean service
boundary — is the cheapest class of change and is explicitly **not** the debt this decision avoids
(see §18). The `docType` discriminator + clean boundary shrink even that to near-zero.

**Guardrail:** when that second type arrives, the **Source-of-Truth Register must be updated first**,
and generalization must be chosen **over** building a parallel document system.

---

## 18. Risks and guardrails

| # | Risk | Guardrail |
|---|---|---|
| 1 | **Headless Chromium on Railway** (memory, cold start, cost) | Async render off the request path; cap concurrency; serve HTML instantly, attach PDF when ready; consider a dedicated render path if volume grows. |
| 2 | **Snapshot/byte bloat in Postgres** | Rendered PDFs → R2/`MediaFile`; DB stores JSON render-model + metadata + hash only (§14). |
| 3 | **Frozen-vs-live confusion** (someone freezes payment state, or renders live prices into a produced quote) | `produce()` is the only freeze point; payment is a separate **live** region by construction (§6). |
| 4 | **Renderer/registry versioning** (a redesigned block silently alters old quotes) | Snapshot the **resolved** model; pin `rendererVersion` per render; retain old render rows (§6). |
| 5 | **Hebrew/RTL fidelity in Chromium-print PDF** | Verify font embedding + RTL layout early, before building many blocks. |
| 6 | **Public token leakage** (offers/prices exposed) | High-entropy token, `expiresAt`, optional revoke (kill switch), no PII in URL, rate-limit, audit views via domain events. |
| 7 | **Multi-signer tampering / races** | Server-side signature capture; audit trail; re-render as a **new** append-only artifact; never in-place edits. |
| 8 | **Caching / stale app** (project §15 rules) | Public page **shell `no-store`**; immutable rendered content is content-addressed (`contentHash`) and may be cached by hash. Document exactly what is cached, where, for how long, why safe — when built. |
| 9 | **Scope creep toward the generic platform** | §4 deferral list is binding; building any deferred item requires an explicit decision + a Source-of-Truth Register update. |
| 10 | **Premature delivery assumptions** ("sent") | Document status is delivery-agnostic (`draft → produced → accepted/rejected`); delivery (channel + timestamp) is a separate, later concept (locked). |

---

## 19. Open decisions to confirm before implementation planning

1. **Composition ownership** — confirmed: admins reorder blocks **per deal** (instance override on a
   template default), not template-only.
2. **State separation** — confirmed: accepted quote · WON · signed proposal · contract · invoice are
   five distinct states (§16).
3. **Instance table naming** — to eliminate even the future rename in §17, decide now whether to name
   the instance at lifecycle altitude rather than `QuoteDocument`. (Five-minute decision; not an
   architecture change. Default: `QuoteDocument`, accepting the cheap future rename.)
4. **Email-intro text home** — move `Deal.quoteEmailIntro` → per-`QuoteDocument` (with a Deal-level
   default), per the already-flagged temporary placement.

---

## 20. What this document does NOT authorize

- No schema, no migrations, no code, no UI — this is design only.
- No generic Document Platform (see §4).
- No delivery channel (email / WhatsApp / portal) design — deferred to a later phase.

Implementation begins only after a separate, approved implementation plan that cites this document.
