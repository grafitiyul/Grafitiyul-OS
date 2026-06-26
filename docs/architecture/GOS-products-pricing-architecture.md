# GOS — Products & Pricing Architecture

**Status:** Approved architecture. Slice 1 (catalog + files + payment config) in implementation.
Pricing engine, add-ons, and deal integration are designed here but deferred to later slices.
**Last updated:** 2026-06-26

---

## 0) Locked principle

**Product = what we sell. Pricing = how the price is computed. Deal (its line items) = the frozen
snapshot of what was agreed.** Price-list edits never change existing deals — the agreed numbers
live on `DealLineItem`, not on a live rule reference.

Three CRM Settings cards: **Products**, **Locations**, **Payment Configuration** (+ **Pricing** and
**Add-ons** in later slices). Money everywhere = integer **minor units + currency** (default ILS).
Future VAT default rate = **18%**.

---

## 1) Catalog model (final — no RouteProfile)

- **Product** — `nameHe/En`, rich `marketingDescHe/En` (same editor capability as procedures).
  No pricing, no location, no operational data.
- **Location** — simple catalog: `nameHe`, `nameEn`, `active`, `sortOrder` (e.g.
  "תל אביב - פלורנטין"). No City/Area split.
- **ProductVariant = Product × Location** — owns **all** product-location detail:
  - `marketingDescHe/En` (rich), `guideDescHe/En` (internal, rich)
  - `durationHours` (numeric; He/En display derived at render, never stored)
  - `meetingPointHe/En`, `endingPointHe/En`, `meetingPointImageId` (→ MediaFile)
  - quote image gallery (→ `ProductVariantImage` join, ordered)
  - `baseGuidePaymentMinor`, `travelPaymentMinor?` (+ `currency`)
  - **`availablePublic`, `availablePrivate`, `availableBusiness`** (booleans; default all `true`)
  - `active`, `sortOrder`; `unique(productId, locationId)`

We accept some duplication if two products share the same meeting point/images. A shared
`RouteProfile`/`MeetingProfile` is a **later optimization** only if duplication becomes painful —
deliberately NOT built now.

- **MediaFile** — R2 object metadata (`r2Key`, `url`, `bucket`, `filename`, `mimeType`, `sizeBytes`,
  `kind`). No DB blobs for this module. Images reference it. This is the start of a reusable Files
  service (PDFs/documents later).

**Reversibility note:** three boolean availability columns hard-code exactly the three locked
activity types. Fine while the set is fixed; a 4th type later means a column add or a pivot to a
`VariantActivityType` join.

---

## 2) Pricing engine (designed; built in Slice 2)

- **ActivityType** — seeded `public | private | business`, each with a `priceModel`: Public =
  `per_head` (adult/child), Private/Business = `tiered` (base up to N + per-additional). Kept
  distinct. Gated per variant by `available*` flags.
- **PriceList** — `Default / Corporate / Municipality / Schools / VIP`, with default VAT mode.
- **OrganizationType.defaultPriceListId? / OrganizationSubtype.defaultPriceListId?** — choose the
  list automatically (subtype > type > system default); overridable on the Deal.
- **PriceRule** — under a PriceList; scoped by nullable `product / productVariant / activityType /
  organizationSubtype` (null = wildcard); carries price-model amounts + `vatMode` + `vatRate` +
  `priority`.
- **Resolution (deterministic):** pick the list → match candidate rules (set scope equals the deal's
  value) → rank by specificity (variant > product > activityType > subtype) → tie-break by explicit
  `priority`. No ambiguous pricing; defined fallback when nothing matches.
- **Group-ready:** tiered computation operates on a *group* unit; the Deal carries `groupCount`
  (default 1). A future `DealGroup` holds per-group participant counts. Designed-for, not built.

## Add-ons (designed; built in Slice 2)
- **Addon** — `nameHe/En`, `defaultPriceMinor (+currency)`, `vatMode`, `defaultQuantity?`. Optional
  **AddonPriceRule** (per price list). No marketing/guide/duration/meeting/images. Appear in deals as
  line items but are not products.

## Deal bridge (designed; built in Slice 3)
- **DealLineItem** — source of truth for the agreed price. `kind = product|addon`, refs Variant or
  Addon, plus the **frozen snapshot**: priceModel, unit prices, participant counts, groupCount,
  vatMode, **vatRate**, netMinor, vatMinor, grossMinor, `isOverridden`, `overrideReason`. What
  Quotes render and Payments collect against.

---

## 3) Payment configuration (Slice 1)

- **PaymentTerm** — `nameHe/En`, `defaultPaymentMethodId?`.
- **PaymentMethod** — `nameHe/En`, `defaultPaymentTermId?`.
Bidirectional nullable defaults (Net 30 → Bank Transfer; Check → Activity Day) auto-fill the Deal,
always overridable (the auto-fill happens in Slice 3).

---

## 4) Entity-relationship map

```
MediaFile (R2 object metadata)
   ▲ meetingPointImage / gallery
Product 1 ──────* ProductVariant *────── 1 Location
                  owns: marketing+guide desc, durationHours, meeting/end points,
                        images, guide-pay defaults,
                        availablePublic / availablePrivate / availableBusiness
ActivityType (seeded: public/private/business → priceModel)   ▲ gated by variant.available*

PriceList 1 ──* PriceRule *── product?/variant?/activityType?/orgSubtype?   [Slice 2]
   ├ OrganizationType.defaultPriceList
   └ OrganizationSubtype.defaultPriceList
Addon 1 ──* AddonPriceRule                                                  [Slice 2]
PaymentTerm 0..1 ⇄ 0..1 PaymentMethod                                       [Slice 1]
Deal 1 ──* DealLineItem ──> ProductVariant | Addon   [PRICE SNAPSHOT]       [Slice 3]
```

---

## 5) R2 file upload (Slice 1)

Direct-to-R2 **presigned** upload; images served as **public CDN URLs**.
1. Client → `POST /api/media-files/presign { filename, contentType }`.
2. Server (admin-auth) validates, mints an object key, returns `{ uploadUrl (presigned PUT), key,
   publicUrl }`.
3. Client PUTs the bytes directly to R2.
4. Client → `POST /api/media-files { key, filename, mimeType, sizeBytes }` to persist a `MediaFile`.
5. The `MediaFile.id` is attached to a variant (meeting image) or gallery row.

R2 is **optional at runtime**: if env vars are missing the presign route returns a clear
`r2_not_configured` error instead of crashing — the deploy is safe before R2 is configured.

**Env vars:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE_URL`. Endpoint derived as `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

**Orphan policy:** deleting a `MediaFile` should also delete the R2 object (best-effort) so storage
doesn't leak; unreferenced uploads can be swept later.

---

## 6) Duration display (derived, never stored)

`durationHours` numeric is the only source of truth. Rendered He/En:
`1 → שעה / 1 hour`, `1.5 → שעה וחצי / 1.5 hours`, `2 → שעתיים / 2 hours`,
`2.5 → שעתיים וחצי / 2.5 hours`, `3 → 3 שעות / 3 hours`.

---

## 7) Implementation slices

- **Slice 1 (this slice):** MediaFile (R2), Location, Product, ProductVariant (+ images +
  availability), ActivityType seed, PaymentTerm, PaymentMethod (+ default relation). CRM Settings
  cards/pages for Products, Locations, Payment Configuration. Additive DB only; no changes to the
  live `Deal` table.
- **Slice 2:** Pricing engine (PriceList, PriceRule, resolution, org→list defaults) + Add-ons.
  Pricing Settings card. Adds nullable `defaultPriceListId` to OrganizationType/Subtype.
- **Slice 3:** `DealLineItem` + Deal columns (activityType/priceList/payment/groupCount) + wire
  resolution & snapshot into the Deal screen + add-ons as deal lines. First slice that touches
  `Deal`.
- **Deferred further:** group module, guide payroll, quotes rendering, payments collection,
  registrations, generic Files-for-PDFs.

---

## 8) Source of truth (recap)

| Concept | Owner |
|---|---|
| Product catalog & descriptions | Products module |
| Locations | shared Location catalog |
| Variant operational data + guide-pay defaults | ProductVariant |
| Image bytes | Cloudflare R2; metadata in `MediaFile` |
| Price rules/lists | Pricing module (Slice 2) |
| **Agreed price + VAT applied** | **DealLineItem snapshot** (Slice 3) — immutable to re-pricing |
| Customer pricing vs guide pay | **separate money flows — never mixed** |
