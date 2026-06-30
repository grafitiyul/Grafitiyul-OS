# GOS — Quote Content Model

**Status:** Governing document. Documentation only — no schema, no migrations, no implementation yet.
**Scope:** Defines every block that can appear inside a Quote document, its governing attributes, the
Preview/Override behavior, and the default section order.
**Companion to:** `GOS-quote-module-architecture.md` (Architecture B; §7B Preview & Override Layer).
**Last updated:** 2026-06-30

---

## 0. Taxonomy — three sourcing patterns

The Composer has **two block kinds**, but "Dynamic" splits into two *sourcing* patterns. Naming this
prevents confusion:

| Block kind | Sourcing pattern | Content lives in | "Multilingual" means |
|---|---|---|---|
| **Dynamic — computed** | Built by a registry renderer from system data | Nothing stored; computed at produce | Labels/templates localized; values from bilingual fields |
| **Dynamic — instance-authored** | Free text written per quote | On the `QuoteDocument` instance | **Single language per instance** (written in the resolved quote language) |
| **Content — library** | References a reusable CRM content row | The owning catalog entity (bilingual) | **Bilingual stored** (He+En); renderer picks the side |

Every block is **resolved and frozen into the render-model at produce time.** The catalog below
describes the block *definition*; the snapshot is what the customer sees.

---

## 1. Dynamic blocks

| # | Block | Kind | Source of Truth | Mand/Opt | Hide | Reorder | Multilingual | Owning entity | Multiple |
|---|---|---|---|---|---|---|---|---|---|
| D1 | **Cover** | Dynamic — computed | `Deal` + `QuoteDocument` (no., date, validity) + `BusinessField` (identity/logo) + primary `Contact`/`Organization` | Mandatory | **No** | Yes* | Labels localized; names bilingual | Business identity + Deal | **Once** |
| D2 | **Personal Introduction** | Dynamic — instance-authored | `QuoteVersion.quoteEmailIntro` (→ move to `QuoteDocument`) | Optional (on) | Yes | Yes | Single language per instance | The quote instance | Once |
| D3 | **Tour Details** | Dynamic — computed | `Deal` + `ProductVariant` + `Location` (meeting/ending point, duration) | Mandatory | Guarded | Yes | Labels localized; content bilingual | Product/Variant + Location | Once (v1) |
| D4 | **Pricing** | Dynamic — computed-from-frozen | **`QuoteVersion` + `QuoteLine`** (renders, never recalculates — §2) | Mandatory | **No** | Yes* | Line labels bilingual where catalog-sourced; row notes as authored | `QuoteVersion` (commercial) | **Once** |
| D5 | **Payment Terms & Schedule** | Dynamic — computed (+ live overlay) | `Deal.paymentTermId`/`paymentMethodId` + catalogs; deposits/links from future Finance | Optional (on, Business) | Yes | Yes | Labels localized; names bilingual | Deal + Payment catalogs | Once |
| D6 | **Signature** | Dynamic — interactive | `SignerPerson`/`SignerAsset` + `SignatureRequest` + `DealContact` | Optional (on) | Yes | Yes* | Labels localized | Signer infrastructure | Once block, many signer slots |
| D7 | **Acceptance / Call-to-Action** | Dynamic — interactive | `QuoteDocument` (records acceptance) + Deal owner/`BusinessField` | Optional (recommended) | Yes | Yes | Labels localized | The quote instance | Once |
| D8 | **Finance Summary** *(future)* | Dynamic — computed (live) | Future Finance (balance, deposits, paid %, links) | Optional (deferred) | Yes | Yes | Labels localized | Future Finance | Once |

\* *Cover/Pricing/Signature are technically reorderable (no hardcoded order — arch §9) but carry
strong recommended positions enforced by the default template, not by code.*

**Why the blocks beyond the required minimum (Cover/Tour Details/Pricing/Signature) exist:**

- **D2 Personal Introduction** — every strong proposal opens with a human, deal-specific message; its
  data is per-quote, so it is system/instance-sourced, not a reusable library item. (Already exists
  as `quoteEmailIntro`.)
- **D5 Payment Terms & Schedule** — "*how and when you pay*" ≠ "*what it costs*." Keeping it separate
  lets the Pricing block stay purely the frozen Builder table and gives deposits / installments /
  payment links a home later. This is where the **frozen-offer vs live-payment-state** boundary lives.
- **D7 Acceptance / CTA** — customer *approval* (a click) is distinct from a *drawn signature*
  (arch §16: accepted quote ≠ signed proposal ≠ WON). Some quotes need approval without a legal
  signature; some need both.
- **D8 Finance Summary** — reserved in the registry; explicitly deferred.

### Future extensions (per block)

- **Cover:** themes/branding per org type; dynamic validity countdown; multiple cover variants A/B.
- **Personal Introduction:** templated openers by classification; reusable intro snippets.
- **Tour Details:** multi-tour/itinerary quotes (becomes "multiple"); map embed; weather/season notes.
- **Pricing:** alternative-options comparison view (still from sibling QuoteVersions); deposit line
  breakdown; multi-currency (insurance — single currency now).
- **Payment Terms:** payment-link buttons; installment schedule table; outstanding-balance overlay.
- **Signature:** multi-party sequential signing; witness/stamp slots; signing order rules.
- **Acceptance/CTA:** "request changes" path; scheduled call booking; counter-offer capture.
- **Finance Summary:** full finance timeline; receipts mirror from iCount.

---

## 2. The Pricing block (critical — exact specification)

**Hard rule: the Pricing block never computes a price. It renders the frozen Builder result,
faithfully.** Source of Truth = **`QuoteVersion` + `QuoteLine`** as they existed at produce time.

At `produce()`, these are snapshotted into the render-model and never re-read or recomputed:

| Rendered element | Frozen from |
|---|---|
| Each pricing line, in Builder order | `QuoteLine` (by `sortOrder`) |
| Line kind (product/addon/discount/credit/manual/ticket) | `QuoteLine.kind` |
| Line label | `QuoteLine.label` (+ resolved catalog name) |
| Quantity | `QuoteLine.quantity` |
| Unit price | `QuoteLine.unitPriceMinor` |
| Line total | unit × qty (frozen value) |
| **Manual override indicator** | `QuoteLine.overridden` |
| **Row notes (yellow sticky notes)** | `QuoteLine.note` — **commercial content; frozen and rendered** |
| Group-ticket identity | `QuoteLine.sourceKind` / `sourceCardGroupId` / `ticketTypeId` |
| Per-line VAT | `QuoteLine.vatMode` / `vatRate` |
| Subtotal (net) · VAT · Total (gross) | Builder totals, frozen (Σ per-line `splitVat`) |
| Currency | frozen (`ILS`) |
| Inactive lines | excluded (recorded as excluded, not silently dropped) |

**Guarantees:**
- Row notes are **commercial content** (they justify line items to the customer) → first-class
  snapshot data.
- Deal / price-list / catalog / Builder changes after produce **cannot** alter a produced quote.
- VAT is shown as an **estimate**; **iCount is the legal authority** (arch §16). The quote is never a
  tax document.

**Editing (LOCKED — Builder-owned, one place):** the Pricing block is **read-only in the Preview**.
The Preview may NEVER edit quantities, prices, VAT, totals, or pricing-line notes. **Click anywhere
in the block (or Edit) → opens the correct Builder** (`PriceBuilderDialog` /
`GroupTicketBuilderDialog`, via `resolveFinanceWorkspace()`); **after Builder save the Preview
auto-refreshes.** There is never a second place to edit commercial data.

**Display Product Name:** the product line's *displayed name* uses the quote-level
`displayProductName` when set (display-only substitution — §5); all amounts/notes still render
verbatim from the Builder.

---

## 3. Content blocks (reusable library)

| # | Block | Kind | Source of Truth | Mand/Opt | Hide | Reorder | Multilingual | Owning entity | Multiple |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **Product Marketing** | Content | `Product.marketingDesc*` + `ProductVariant.marketingDesc*` | Optional | Yes | Yes | Bilingual | Product / Variant | Once (multiple if multi-product, future) |
| C2 | **City / Location Content** | Content | `Location` (see gap §4) | Optional | Yes | Yes | Bilingual | Location | Once per city |
| C3 | **Classification Content** (School/Corporate/Agency/…) | Content | `OrganizationSubtype.quoteContent*` → overrides → `OrganizationType.quoteContent*` | Optional | Yes | Yes | Bilingual | OrgType / Subtype | Once (resolved per deal) |
| C4 | **FAQ** | Content | `QuoteSection` (category=faq) | Optional | Yes | Yes | Bilingual | CRM global content | **Multiple** |
| C5 | **Cancellation Policy** | Content | `QuoteSection` (category=cancellation), classification-overridable (§4) | Optional (recommended) | Yes | Yes | Bilingual | CRM global content | Once |
| C6 | **Participant Policy** | Content | `QuoteSection` (category=participant_policy) | Optional | Yes | Yes | Bilingual | CRM global content | Once |
| C7 | **Why Grafitiyul** | Content | `QuoteSection` (category=why_us) | Optional (recommended) | Yes | Yes | Bilingual | CRM brand content | Once |
| C8 | **Rich Marketing Section** (generic) | Content | `QuoteSection` (category=marketing) | Optional | Yes | Yes | Bilingual | CRM content library | **Multiple** |
| C9 | **Custom / Ad-hoc Section** | Content (instance-attached) | A section authored inline for this quote | Optional | Yes | Yes | Bilingual or single-language | CRM content library | **Multiple** |
| C10 | **Media — Image / Gallery** | Content | `MediaFile` / `ProductVariantImage` | Optional | Yes | Yes | Captions bilingual | Files platform | **Multiple** |
| C11 | **Media — Embedded Video** | Content | `MediaFile` / external URL | Optional | Yes | Yes | Captions bilingual | Files platform | **Multiple** |
| C12 | **Attachment** (brochure/PDF) | Content | `MediaFile` | Optional | Yes | Yes | n/a | Files platform | **Multiple** |

**Additional reusable content blocks worth seeding** (all `QuoteSection`-backed, optional, multiple):
What's included / not included · Terms & Conditions (commercial, not the legal contract) ·
Testimonials / social proof · Guide / Team introduction · Logistics & accessibility ·
Safety / insurance.

### Future extensions (content)

- Block-level visibility rules by classification/activity (conditional sections).
- Promote a polished ad-hoc section → reusable `QuoteSection` (explicit "save to library").
- Versioned content with effective dates; A/B marketing variants.
- Per-classification policy overrides (cancellation/participant).

---

## 4. Content-ownership gaps to resolve

1. **City content has no marketing home today.** `Location` has only `meetingPoint*` (operational).
   **Recommendation:** add `Location.marketingDescHe/En` (city marketing owned by the city), or route
   C2 through `QuoteSection`.
2. **`QuoteSection` needs a `category`** (faq / cancellation / participant_policy / why_us /
   marketing) so the block picker groups them and blocks can reference a policy semantically. Additive.
3. **Cancellation / Participant policy scope** — global `QuoteSection` default + optional
   per-`OrganizationType/Subtype` override (same pattern as `quoteContent`).
4. **"School content" must not be hardcoded** — it is one case of **Classification Content** (C3),
   owned by `OrganizationType/Subtype`. Generic by design (Corporate/Agency/Producer work the same).

---

## 5. Quote Display Product Name (LOCKED)

**One** quote-level override field — `QuoteDocument.displayProductName` (single-language, resolved
quote language; null → Deal product name).

- **Render-time substitution** wherever the *product identity name* appears: **Cover/Hero, Tour
  Details, section headers, and the product line's displayed name in the Pricing table.**
- **One override, whole document.** No independent per-block product-name overrides.
- **Display-only:** never changes `Deal.product`, the Product catalog, or Builder commercial data.
  In Pricing, only the shown product name is substituted; amounts/notes render verbatim.
- Addon/discount/credit/manual labels are not product names → unaffected.

> Example: Deal product = "סיור וסדנת גרפיטי"; this quote's `displayProductName` =
> "השתלמות מקצועית באומנות אורבנית". The whole quote shows the new name; the Deal and catalog are
> untouched; other quotes are unaffected.

---

## 6. Preview & Override Layer (summary — full detail in arch §7B)

**Source → Preview (editable) → Produced (frozen).** Auto-compose from Deal/Builder/Content, polish
like a document, then freeze. The Preview never mutates the Source.

- **Two sparse layers:** composition draft (order/hide/add/remove/ad-hoc) + content overrides
  (text/title/paragraph edits). Neither writes back.
- **Materialized working copy** (stable WYSIWYG; `overridden` flag per field/block) — matches the
  "sticky value + explicit recalc" convention. **Produce freezes the draft exactly as shown.**
- **Two refresh actions:** **(A) Refresh non-overridden content** (re-pull untouched fields; keep all
  overrides + structural edits) · **(B) Reset to Source** (drop everything; re-compose).
- **Override transparency:** each overridden field/block is marked ("edited / modified from source")
  with a per-field **↺ Reset to Source**.
- **Pricing is read-only here** → click opens the Builder; Preview auto-refreshes on save.
- **Revise = clone.**

Editable in Preview: visible text, titles, paragraphs (add/remove), hide blocks, reorder blocks,
add ad-hoc rich blocks, and later images/videos/attachments — **except** the Pricing block's
commercial data (Builder-owned).

---

## 7. Categorization

**Always exactly once (singletons):** Cover · Personal Introduction · Tour Details (v1) · **Pricing**
· Payment Terms · Signature (one block, many signer slots) · Acceptance/CTA · Classification Content.

**Can appear multiple times:** FAQ · Rich Marketing Sections · Custom/Ad-hoc Sections · Images/
Galleries · Videos · Attachments (Product Marketing & City Content become multiple only in future
multi-product / multi-city quotes).

**Never removable (hard guardrail):** **Pricing** (the document is meaningless without the offer) ·
**Cover** (carries identity, quote number, validity, customer name).

**Effectively never removable (strong guardrail; removable only via explicit override):**
Tour Details (the offer's context).

**Optional (freely composable / hideable):** everything else — all Content blocks, Payment Terms,
Signature, Acceptance/CTA, Personal Introduction, Finance Summary, media/attachments. Signature is
**default-on but configurable off** (an Acceptance click may suffice).

---

## 8. Ideal default Quote order

> The spine: **build value before revealing price, then remove every objection before asking for
> commitment.**

| Pos | Block | Why here |
|---|---|---|
| 1 | **Cover** | First impression and context: who, for whom, quote no., date, validity. Establishes professionalism. |
| 2 | **Personal Introduction** | A warm, deal-specific opener. Connection precedes information. |
| 3 | **Tour Details** | *What you get* — anchors the proposal in the experience, not a number. |
| 4 | **Product Marketing** | Deepens desire while interest is high. |
| 5 | **Why Grafitiyul** | Credibility — *why us* — before price. |
| 6 | **Classification / School / City content** | Relevance — content tuned to their context. |
| 7 | **Pricing** | The number appears **only after value and trust** — judged against demonstrated value, not in a vacuum. |
| 8 | **Payment Terms & Schedule** | Answers the next question — "*how/when do I pay?*" — at the moment it arises. |
| 9 | **FAQ** | Pre-empts objections right after the ask, where doubt peaks. |
| 10 | **Cancellation / Participant Policy** | Risk reversal and clear expectations — makes "yes" feel safe. |
| 11 | **Acceptance / CTA + Signature** | The close — one clear commitment, **last**, after every objection is handled. |

**Why this is the strongest customer experience:** value-before-price prevents sticker shock (price
after value reads as investment, not expense); trust is front-loaded so the customer is receptive
when the offer lands; objections are handled immediately after the ask (payment → FAQ → policies);
and a single clear commitment at the very end asks for "yes" only after it has been earned.

This is the **default template** only — admins reorder per deal (arch §9). The default encodes best
practice while preserving full composition freedom.

---

## 9. Locked decisions (2026-06-30)

1. Preview & Override Layer (Source → Preview → Produced) — approved.
2. **One** quote-level Display Product Name (display-only, whole document). — §5
3. Pricing block Builder-owned; click-to-open the Builder; Preview auto-refreshes; never two places
   to edit commercial data. — §2
4. **Two** refresh actions (Refresh non-overridden / Reset to Source); draft is a materialized
   working copy; produce freezes WYSIWYG. — §6
5. Override indicators + per-field/block Reset to Source. — §6

## 10. Open decisions remaining

1. **City content home** — add `Location.marketingDescHe/En` (recommended) or use `QuoteSection`? (§4.1)
2. **`QuoteSection.category`** — approve adding it. (§4.2)
3. **Cancellation/Participant policy scope** — global only, or global + classification override? (§4.3)
4. **Multi-tour / multi-product quotes** — out of scope for v1 (Tour Details & Product Marketing =
   once); model leaves room to make them "multiple" later — confirm.
5. (Arch-doc carry-overs) Instance table naming; `Deal.quoteEmailIntro` → per-`QuoteDocument`.

---

## 11. What this document does NOT authorize

- No schema, no migrations, no code, no UI — content modeling only.
- No generic Document Platform (arch §4).
- No delivery channel design.

Implementation begins only after an approved Slice plan that cites this document and
`GOS-quote-module-architecture.md`.
