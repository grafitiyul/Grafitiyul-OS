# GOS — Deal Quote / Pricing / Tour-Details — Consolidated Specification (v2)

> Status: **SPECIFICATION ONLY — not implemented.** No code/schema/migration for the
> quote feature. (One small, separate UI bug fix WAS applied — see §13.)
> v2 folds in the final product decisions: **Accepted ≠ WON**, **Quotes are
> Business-only**, the **two-card (Operational vs Commercial) right-panel split**, and the
> clarification that the **base tour price is operational** (Tour Details, all activity types) while
> the Quote card is the commercial layer on top.
> Companion file: `GOS-deal-quote-pricing-questionnaire.md` (decided answers + open items).

---

## 0. Core principle — Auto-fill first, override always

Every field that **can** be filled automatically **is** filled automatically; every
auto-filled value is **overridable**. On override: never silently re-overwrite, mark it
**manual**, keep showing the source value, and offer a low-emphasis "return to source":

```
מחיר ידני · מקור ₪4,850 ↺
```

---

## 1. Activity type drives the layout (NEW — structural)

The Deal right panel composition is a **function of `activityType`**. This is a presentation
concern over **one** data model — no duplicated fields, no parallel logic.

| Activity type | Operational card (פרטי הסיור) — incl. **base tour price** | Commercial card (הצעה / הצעות מחיר) |
|---|---|---|
| **Business** (עסקי) | ✅ shown — base price here | ✅ **Quote workflow** (versions/adjust/discount/add-ons + payment + email), built **on top of** the base price |
| **Private** (פרטי) | ✅ shown — base price **is** the price | ❌ no commercial quote card |
| **Group** (קבוצתי) | ✅ shown (+ ticket selector) — ticket totals **are** the base price | ❌ no commercial quote card |

> The **base tour price is operational** — it is part of defining the tour, so it lives in the
> Tour Details card for **every** activity type. The Quote card (Business) is the commercial layer
> that starts from the base price and then adjusts / discounts / adds items / creates alternatives /
> communicates the offer.

Design implication: build the panel as an **activity-type → layout map** (a small config),
so future activity types can declare their own operational/commercial composition without
forking logic. This separation also matches the long-term module boundary: the operational
card feeds the future **Tour** module; the commercial card feeds the future **Quote / Finance**
module.

---

## 2. What already exists (reuse — do NOT rebuild)

| Capability | Status | Location |
|---|---|---|
| Pricing engine (pure, deterministic, unit-tested) | ✅ built | `server/src/pricing/engine.js` |
| VAT math `splitVat` — `included` / `excluded` / `exempt` (rate default 18) | ✅ built | engine.js:254 |
| Resolution: price-list → rule by scope → specificity → priority | ✅ built | engine.js + `routes/pricingCalc.js` |
| `PriceList`/`PriceRule`/`PriceTier`/`TicketType`/`Addon`/`AddonPriceRule` | ✅ schema + admin UI | schema.prisma:1094-1351 |
| `Product`/`ProductVariant` (= Product × Location)/`Location` | ✅ built | schema.prisma:940-1011 |
| `ActivityType` catalog (`key` + `priceModel`) | ✅ seeded | schema.prisma:1038 |
| `PaymentTerm`/`PaymentMethod` (bidirectional defaults) | ✅ built | schema.prisma:1053 |
| Org type/subtype → default price list / term / method | ✅ relations | schema.prisma |
| `/api/pricing/calculate` + `/preview` | ✅ built (admin only) | `pricingCalc.js` |
| Lightweight note editor (`toolbar="lite"`) | ✅ built | `client/src/editor/LiteToolbar.jsx` |
| **DealLineItem** (frozen snapshot) | 📋 designed, NOT built | products-pricing doc §2 |
| **Quote / QuoteVersion / QuoteLine / Registration / Tour** | ❌ no model | — |

---

## 3. Right panel — TWO cards (Operational vs Commercial)

> Correction (locked): we were mixing "how the tour happens" with "how we sell it".
> Split into two cards.

### 3.1 Card 1 — "פרטי הסיור" (Operational) — all activity types

How the tour will be executed, **including its base tour price** (the price is part of the
operational definition of the tour). Collapsible accordion.

```
פרטי הסיור                                   [▾]
─────────────────────────────────────────────────
Product | City | Base price (₪, emphasized)
  pricing explanation: "מחירון בתי ספר · per-head · כולל מע״מ"  or  "מחיר ידני · מקור ₪4,850 ↺"
Date (wide) | Time (narrow, quick-pick) | Participants (~3 digits)
Activity Type | Tour Language
  (group only) ▸ ticket-quantity selector — appears under Participants (its totals = base price)
מידע חשוב על הלקוח  [lite editor: Bold · Underline · Highlight · Emoji · Font size]
+ future operational fields (meeting point, guide, equipment, …)
```

- **Base tour price**: engine-calculated from Product/City/Participants/Activity (§5 engine),
  **emphasized**, **overridable** (manual → "מחיר ידני · מקור ₪X ↺"), with the pricing-explanation
  line beneath it. For **Private** this is the price; for **Group** it equals the ticket totals;
  for **Business** it is the foundation the Quote layer builds on.
- **Activity Type** here is the **same** `Deal.activityType` shown in the header badge — one source.
- **Group ticket selector** is operational (it sizes the tour AND produces the base price) → Card 1.
- **Important Customer Information** stays here (internal operational note).

### 3.2 Card 2 — "הצעה / הצעות מחיר" (Commercial) — **Business only**

How we sell the tour. Visible **only when `activityType = business`**.

```
הצעות מחיר                                   [+ הפק הצעת מחיר שונה]
─────────────────────────────────────────────────────────────────
Communication Language   ·   Payment Terms   ·   Payment Method
Personal introduction for the email           ← NEW field
[ הפק הצעת מחיר ]                               ← moved here from the old card
─────────────────────────────────────────────────────────────────
★ גרסה ראשית · ₪5,400 · טיוטה · 28.06 · עברית   [פעולות ▾]
  הצעה ב' (אנגלית) · ₪6,100 · הופקה · 28.06 · אנגלית [פעולות ▾]
```

Moved into this card: **Communication Language, Payment Terms, Payment Method**.
New field: **Personal introduction for the email** (per-quote intro text — stored on the
QuoteVersion). Moved button: **הפק הצעת מחיר**. Future: quote validity, attachments, signature flow,
email generation, customer-facing communication.

The Quote card is the **commercial communication layer**: it **starts from the operational base
price** (§3.1) and may adjust it, discount, add items/add-ons, create alternatives, and communicate
the offer — without changing the operational base.

### 3.3 Where does Price live? — RESOLVED

The **base tour price lives in the Tour Details (operational) card for every activity type**
(§3.1). The Quote card (Business only) layers the commercial offer on top.

- **Business** → base price in Tour Details; the Quote builds versions/adjustments on top; the
  **accepted** version is the agreed commercial total.
- **Private** → base price in Tour Details **is** the price.
- **Group** → ticket totals in Tour Details **are** the base price (engine `ticket_types`).

No "operational card has no money" rule — money that *defines the tour* (base price) is operational;
money that *communicates an offer* (versions, discounts, payment terms, email) is commercial.

---

## 4. Field behavior details (unchanged from v1 except placement)

- **Product → City**: pick product → auto-fill City (1 → it; many → default `sortOrder`); override allowed; City filtered by the product's variants. City = the variant's `Location`.
- **Participants**: compact width (~3 digits visually) but **no logical 3-digit cap**.
- **Date / Time**: Date wider; Time = **quick-pick** (typing `10` offers `10:00/10:15/10:30/10:45`), free typing allowed; stored `"HH:MM"`.
- **Activity Type**: header badge ⇄ Card 1 field — one source.
- **Business defaults** (in the commercial card): auto-fill Payment Terms + Payment Method from org type/subtype defaults or the term↔method catalog; overridable.
- **Group**: ticket selector (TicketType catalog filtered by city) → quantities drive Participants (sync) and price (`ticket_types`). In Card 1.
- **Languages**: Communication default Hebrew (commercial card); Tour default Hebrew (operational card); Quote Language default = Communication Language; all overridable.

### 4.1 Field dependency matrix — see v1 §2 (unchanged logic).
Only placement changed: Communication Language / Payment Terms / Payment Method now live in the
commercial card and exist **only for Business** deals. Tour Language stays operational. The
recalc / skip-recalc / return-to-source rules are identical.

### 4.2 Price-list change rule (locked)
A Settings price-list edit affects **only new** calculations. Existing Deals/quotes stay frozen;
they update **only** on explicit **"חשב מחדש"** / **"החל מחירון חדש"**. Sent/produced and
accepted versions are immutable (clone to revise).

---

## 5. Price / Quote-builder modal (Business)

The **base tour price** is shown and editable in Tour Details (§3.1). The **quote builder** opens
from the **Quote card** ("הפק הצעת מחיר") and works on the working draft version, **seeded from the
base price** as its first line(s); it then layers commercial adjustments. (Private/Group have no
builder — their base price stands alone.)

- Top bar: Quote Language (seeded from Communication Language) · order-level VAT (default
  **כולל מע״מ**) · resolved price-list name.
- **Line types:** `product` · `ticket` · `addon` · `discount` · `credit` · `manual` (free-text).
- Per line: item selector (where relevant) · price (engine-resolved or manual → override chip) ·
  quantity · VAT mode (`inherit`/`included`/`excluded`/`exempt`) · **active toggle** (default on) ·
  optional free-text note.
- **Inactive line:** gray, **not editable**, **excluded from totals**.
- **Totals:** subtotal (net) · VAT · total (gross) — each is **Σ per-line `splitVat`**.
- **VAT:** order default + per-line override; **reuse the engine** — no client-side VAT math, no
  second VAT model.

---

## 6. Accepted Quote vs WON — two separate concepts (CORRECTION)

> Accepting a quote and marking the Deal WON are **two different actions**. One does not imply
> the other.

- **Accepted Quote** = the commercial version the customer agreed to. It becomes the **commercial
  source of truth** for the Deal and is the version later **signed** (where relevant).
  Action: **"הפוך להצעה הראשית" / "סמן כהצעה שנבחרה"**.
- **WON** = a **separate, subsequent** sales-status action. After accepting a quote the user **may**
  immediately mark WON, or keep working the deal. Accepting does **NOT** auto-WON.
- Invoice / registration / tour creation later derive from the **accepted** quote — never from
  whatever is open in the builder.

This refines v1 (which had hinted accept→panel update): accept sets the commercial truth; WON is
its own explicit step.

---

## 7. Alternative quotes — "הצעות מחיר" (Business only)

> Correction (locked): never overwrite the current Deal tour details just to produce another quote.

- **Main / current** working details + price live in the cards above (the working draft version).
- The **"הצעות מחיר"** card lists multiple versions: name/number · total · status · created date ·
  language · ★ accepted/main · quick actions.
- **"הפק הצעת מחיר שונה"** opens the builder **prefilled** from the current details/lines; the user
  may change fields, add/delete lines, **"נקה טופס"**, and produce/save that quote **without
  changing the main Deal details**.
- Accepting a different version → explicit **"הפוך להצעה הראשית" / "סמן כנבחרה"** (then WON is a
  separate step, §6). History preserved; produced/accepted versions immutable.

---

## 8. Line items / source of truth — recommendation (unchanged from v1)

**Three distinct price concepts, one source of truth each — no duplication:**

1. **Base tour price** (operational, Tour Details). A **calculation** from the engine
   (Product/City/Participants/Activity + resolved price list). Stored value is **sticky** (frozen
   until inputs change or an explicit "חשב מחדש"), plus an **override** flag when set manually; the
   live source is recomputed for the "↺ מקור" display. Field: `Deal.tourBasePriceMinor` +
   `tourBasePriceOverridden`. This is the operational cost of the tour.
2. **Quote total** (commercial, Business only). The **`QuoteVersion` + `QuoteLine`** model — the one
   canonical line store (supersedes the standalone `DealLineItem`). Its first line(s) **seed from the
   base price**, then commercial adjustments (discount/credit/add-on/manual) apply. Working draft +
   sibling alternatives; produced/accepted versions immutable.
3. **Headline agreed price** (`Deal.valueMinor`) — **derived**: the **accepted** QuoteVersion total
   for Business; otherwise the **base tour price** (Private/Group, or Business before acceptance).
   One derived rollup for lists/pipeline/reports.

So Business can have base ≠ quote-total ≠ headline (base is operational; the accepted quote is the
agreed commercial figure). Private/Group: base = headline (no commercial layer).

---

## 9. Save / dirty-state — manual save, impossible to miss (locked)

No silent autosave. Save is **manual**, with an unmissable dirty state:

- **Dirty:** Save button gets a **red pulsing/wave halo** + **"יש שינויים שלא נשמרו"** (and a dirty
  mark on the collapsed accordion header).
- **Saving:** **"שומר..."**. **Saved:** **"נשמר"** (~2s) → idle.
- Reuse existing dirty tracking (`client/src/lib/dirtyForms.js`). **No** native `alert`/`confirm`.
  Nothing hard-deleted (deactivate = `active:false`); nothing invalid persisted. Same for the
  builder modal (explicit save/produce).

---

## 10. VAT / tax authority (locked)

- **GOS computes the commercial/quote VAT** (estimate) via the engine — for quotes only.
- **iCount is the legal authority** forever: invoice/receipt/credit-note, numbering, official VAT,
  binding PDF. GOS labels totals as **estimates**, requests issuance idempotently, and mirrors a
  read-only FinanceDocument. GOS never computes the legal VAT.

---

## 11. Sent / delivery — UNDECIDED (Q16, per correction)

Do **not** bake any architecture assumption about how a quote is delivered/"sent". Delivery may
later be Email / WhatsApp / customer portal / e-signature / other. Therefore:

- Model quote **status** independent of delivery channel. Use neutral states for now:
  **`draft` → `produced` → `accepted` / `rejected`** (a "produced" version is finalized/immutable).
- Keep a separate, **later** concept for *delivery* (channel + timestamp) — not designed now.
- No `sent`-specific fields, flows, or integrations until the delivery flow is designed.

---

## 12. Architecture output (re-evaluated for the two-card split)

1. **Field dependency matrix** — v1 §2 (placement updated in §4.1).
2. **Override state** — effective value + `isOverridden`; source recomputed **live** (never stored
   stale); on ↺ recompute & clear override; upstream changes apply only if not overridden.
3. **Data model (new):** `QuoteVersion` (per Deal: status `draft|produced|accepted|rejected`,
   `quoteLanguage`, order `vatMode`, `priceListId`, rollup totals, `isMain`/`isSelected`, timestamps,
   **`emailIntroText`** = the new "personal introduction for the email") + `QuoteLine` (kind, refs,
   price snapshot, qty, vat, net/vat/gross, `isOverridden`, `overrideReason`, `active`, note,
   `sortOrder`). Quote workflow is **gated to Business** in the UI; the model is per-Deal.
4. **Reuse:** entire `pricing/engine.js`, `resolvePriceListId`, PriceList/Rule/Tier/Ticket/Addon,
   Product/Variant/Location, ActivityType, Payment catalogs, org defaults, the lite editor.
5. **New fields on Deal (additive, nullable):** `productVariantId` (operational selection),
   `tourBasePriceMinor` + `tourBasePriceOverridden` (the operational base price + its override),
   `mainQuoteVersionId`, `selectedQuoteVersionId`, activity-key reconciliation, payment FKs,
   `valueMinor` as derived headline rollup.
6. **Quote version/snapshot:** draft editable; produced/accepted immutable; clone to revise.
7. **Accepted quote:** explicit mark; commercial source of truth; **WON is a separate action**;
   invoice/registration/tour derive from the accepted version.
8. **VAT:** order default + per-line override; one engine; GOS=estimate, iCount=legal.
9. **Save/dirty:** manual save + animated urgent dirty state; no autosave; no native dialogs.
10. **APIs:** deal-context pricing calc (reuse engine); QuoteVersion CRUD + recompute/applyPriceList
    + setSelected/markMain + produce; QuoteLine CRUD; Deal scalar update; catalog reads (exist).
11. **Migration:** additive only (`IF NOT EXISTS`, nullable, cascade to Deal/version); applied on
    boot via `prisma migrate deploy`; activity-key reconciliation can start as a code mapping.
12. **Single source of truth holds after the split:** each field has exactly one home (operational
    fields on Deal/Tour-side; commercial fields on Deal/QuoteVersion); the two cards are two
    **views**, not two stores. Activity Type stays one field. No duplicated logic introduced by the
    split — it actually removes mixing.

---

## 13. UI bug — FIXED (separate from the feature)

**Symptom:** editing "מידע חשוב על הלקוח" made other right-panel fields (e.g. Activity Type)
disappear.
**Root cause:** the customer-info `RichEditor` sits low in the height-constrained, scrollable right
panel and was `collapsible` with the default `maxHeight: 60vh`. Focusing it (below the fold) makes
ProseMirror scroll the panel to the caret, and typing grows the editor toward 60vh — scrolling the
upper rows out of view (they look "gone"). It is **not** a crash (the app-wide `ErrorBoundary` would
blank everything) and **not** a data bug (`set()` spreads the whole form).
**Fix applied:** bounded the panel editor (`maxHeight="220px"`) so it stays a stable box with its own
internal scroll and can't scroll-jack the panel. The upcoming two-card split also shortens Card 1,
further reducing scroll. *Verified by build; needs a quick visual confirm (no local dev server per
workflow).*

---

## 14. Phased plan (recommended)

- **Phase 0 — Foundations & mappings (tiny):** activity-key `group→public` mapping; payment
  term/method FK source-of-truth; `valueMinor` rollup; VAT authority boundary; **deal-context pricing
  endpoint**; **decide non-business price placement (D-Price)**.
- **Phase 1 — Two-card panel + auto-fill/override (mostly UI):** split into Operational + Commercial
  (business-gated) cards; Product/City selectors; Time quick-pick; field widths; business defaults;
  group ticket selector; "↺ return to source"; **manual-save dirty-state (red pulse)**; single
  auto-price.
- **Phase 2 — Quote builder + line model:** `QuoteVersion`(working draft) + `QuoteLine`; modal with
  line types, per-line VAT, active toggle, notes, engine totals.
- **Phase 3 — Alternatives card + accept/WON:** multiple versions, clone, "נקה טופס", statuses,
  "הפק הצעת מחיר שונה", "הפוך להצעה הראשית", and the **separate WON** action.
- **Phase 4 — Quote document generation:** render + language + PDF + the email intro.
- **Phase 5 — Delivery + Registration / Tour / iCount / payments** (delivery channel designed here).

---

## Updated decisions required from Dor

1. **Activity-type key** — approve mapping **`group → public`** (blocks all auto-pricing).
2. **One line model** = **`QuoteVersion` + `QuoteLine`** (supersedes standalone `DealLineItem`).
3. **Price model (CLARIFIED by Dor)** — base tour price is **operational** (Tour Details, all types);
   the Quote layer is commercial (Business). `Deal.valueMinor` = derived **headline** = accepted
   version total (Business) else the base price. Three concepts, one source each (spec §8).
4. **Product/City persistence** — (a) nullable `Deal.productVariantId` *(recommended)*, or (b) derive
   from the main version's primary line.
5. **Payment fields** — convert `paymentMethod`/`paymentTerms` to **catalog FKs** (enables business
   defaults) vs keep free strings. *(These now live only in the business commercial card.)*
6. **VAT authority** — confirm GOS = quote estimate, iCount = legal.
7. **Save model** — confirm manual save + animated urgent dirty-state; no autosave; no native dialogs.
8. **Accepted ≠ WON** — confirm: accepting sets the commercial source of truth (+ later signing); WON
   is a separate explicit step; invoice/registration/tour derive from the **accepted** version.
9. **Quotes are Business-only** — confirm Private/Group show **no** commercial quote card, and the
   panel layout is **activity-type-driven**.
10. **D-Price — RESOLVED by Dor:** the base tour price is **operational** and lives in Tour Details
    for **all** activity types; the Quote card is the commercial layer on top (Business only).
11. **"Personal introduction for the email" — CONFIRMED by Dor:** lives on the **QuoteVersion**
    (per-quote), with an optional Deal-level default.
12. **Sent/delivery deferred** — confirm quote **status** = `draft → produced → accepted/rejected`
    with **delivery channel undecided** (no `sent` assumptions yet).

Defaults I'll assume unless told otherwise: Quote Language not stored separately until the Quote model
lands (seeded from Communication Language); override = live source recompute (no stored source);
add-ons reused as-is (e.g. *"תוספת אנגלית ₪350"* is an `Addon`); produced/accepted versions immutable
(clone to revise).
