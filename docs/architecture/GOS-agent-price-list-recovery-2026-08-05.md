# מחירון סוכנים — recovery, modelling and republication · 2026-08-05

The legacy agents price list is now **SitePage record #2** on the generic
"דפי אתר" engine: GOS-owned, versioned, bilingual, fully editable in the admin,
frozen-on-publish, with pricing-card drift detection. Live payload:
`GET https://app.grafitiyul.co.il/api/public/site-pages/agent-price-list?locale=he|en`
(published **version #3**, verified in production). The WordPress shell is the
one remaining manual step (§7 of `GOS-site-pages-module.md`).

---

## 1) The old page — what was found

| | Hebrew | English |
|---|---|---|
| URL | `grafitiyul.co.il/pricingagent/` | `grafitiyul.co.il/en/pricingagent-en/` |
| WP page id | 7635 | 11680 |
| Title | מחירון סוכנים - גרפיטיול | Agents Price List - גרפיטיול |
| Last modified | **2025-11-07** | **2026-02-19** (the newest page on the legacy site) |
| Indexing | **noindex,nofollow + excluded from sitemap** (deliberately hidden; per the 2026-07-31 legacy inventory) | indexable, canonical present, in sitemap |
| Lead capture | contact popup 7195 only → Make 430346 | popup + WhatsApp CTA (055-663-8970) |
| Recovered from | Wayback 2025-11-11 snapshot | Wayback 2026-04-13 snapshot |
| Today | **404** on the new store | **404** on the new store |

Both snapshots postdate the pages' last edits, so the recovered content is the
**exact final version**. Raw HTML + extractions preserved during the work; the
recovered inventory that matters is embedded in
`server/scripts/data/agent-price-list.recovered.json`.

**Critical finding: the two languages disagreed.** The HE page (2025-11) carried
an older price generation; the EN page (2026-02) was the actively maintained
sales asset. Where GOS models the item, GOS agrees with the **EN** page — so HE
was simply stale.

**References to the old URL:** no live template/message references anywhere in
GOS — only 61 historical sent `EmailMessage` rows (never rewritten, per policy).
The agent-reservation engine's fallback message ("המחיר יהיה כפי שכתוב במחירון
לסוכנים", `pricing/agentPricing.js`) is the standing operational consumer of
this page.

## 2) Old vs current canonical pricing (all before VAT)

| Item | HE page (2025-11) | EN page (2026-02) | GOS agents card today | Published as |
|---|---|---|---|---|
| TA underground tour 1.5h | 1200 | 1,300 | **1300** (`card_4d4c8116`, fixed, VAT excl) | **1300 — live ref** |
| TA 7/10-focused tour 1.5h | — | — | **1300** (same card, קרית המלאכה variant) | **1300 — live ref** |
| J-m/Haifa underground 1.5h | 1500 | 1,500 | **1500** (`card_4abac60c`) | **1500 — live ref** |
| Tour+basic workshop ~2.5h | ≤5: 1200 · 10: 1400 · +100 | ≤5: 1,400 · ≤10: 1,650 · +120 | **≤5: 1400 · ≤10: 1650 · +120** (`card_875fca37`) | **live ref** |
| Tour+professional workshop 3h | ≤10: 2400 · +150 | ≤10: 2,800 · +150 | **≤10: 2800 · +150** (`card_03586e1e`) | **live ref** |
| War tour + hands-on | ≤10: 1400 · +50 | ≤10: 1,650 · **+100** | **≤5: 1400 · ≤10: 1650 · +120** (`card_a3017097`) | **GOS values — live ref** ⚠ see §3.1 |
| Short tour TA 1h | 900 | 1,000 | **not modeled** | **1000 — editorial** ⚠ §3.2 |
| Short tour J-m/Haifa 1h | "120" (typo) | 1,200 | **not modeled** | **1200 — editorial** ⚠ §3.2 |
| Kosher tasting add-on | — | ≤5: 200 · ≤10: 300 | **not modeled** | **editorial** ⚠ §3.2 |
| Grafoodiez tour 2.5h | ≤10: 2300 · +150 | ≤10: 2,800 · +180 | **not modeled in agents segment** | **2800/+180 — editorial** ⚠ §3.2 |
| Grafoodiez full experience 3.5h | ≤10: 2900 · +200 | ≤10: 3,450 · +250 | **not modeled in agents segment** | **3450/+250 — editorial** ⚠ §3.2 |
| Bar/bat mitzvah activity 3h | ≤10: 5000 · +150 | **dropped** | private-segment card only | **not on the page** ⚠ §3.3 |
| Food tours (world/Asian) 2.5h | ≤10: 3500 · +230 | **dropped** | not modeled | **not on the page** ⚠ §3.3 |
| Shabbat surcharge | 250 | 250 (from Fri 15:00) | **250** (system addon) | 250 ✓ agrees everywhere |
| Language surcharge ES/FR/RU | 200 | 200 | **200** (`language_surcharge`, es/fr/ru) | 200 ✓ agrees everywhere |
| Pickup ≤15min / >15min-hotel | 120 / 200 | 120 / **250** | not modeled | **120/250** (EN newer) ⚠ §3.2 |
| Group-size policy | max 45/50/18/20 per product | ideal 25 · split at 30 · max 45 tours-only | not modeled | EN wording |

Verified post-publish: the drift endpoint reports **6/6 referenced rows =
match, VAT excluded** against production cards.

## 3) Owner decisions (nothing here blocks the page; it is live with the safest reading)

1. **War tour extra participant — page said +100, GOS card says +120 (and has a
   ≤5→1400 tier the page didn't show).** Per the "GOS is the commercial
   authority" rule the page now shows the GOS card values. If +100 was a real
   agent concession, edit `card_a3017097` — the page will flag drift and offer
   one-click refresh.
2. **Five editorial items have no agents Pricing Card** (short tours 1000/1200,
   kosher tasting 200/300, both Grafoodiez packages, pickup fees). They are
   frozen at the EN page's 2026-02 values. Recommended: model them as
   agents-segment cards, then link the rows (each row has a card-reference
   field) so they join drift detection.
3. **Bar/bat-mitzvah and the two food tours were dropped from the newer EN page**
   and are not on the new page. Say the word and they return as rows.
4. **Indexing**: published **noindex,nofollow, out of sitemap** — preserving the
   HE page's deliberate hiding. The EN legacy page *was* indexable; if you want
   the EN audience to find it via Google, flip the one SEO checkbox and
   republish.
5. **Old-URL redirects**: `/pricingagent/` and `/en/pricingagent-en/` already
   404 on the new store (nothing to preserve was working). If old shared links
   still circulate, add two 301s in WordPress (§7 step 6 of the module doc).

## 4) What was built (generic, not agent-specific)

- `pricing` section type in `shared/sitePage.mjs` — structured rows with typed
  price lines (`fixed|tier|extra|custom`, integer minor units); renderer emits
  `1,400 ₪` / `1,400 NIS` per locale from the same number; sanitizer keeps
  amounts numeric; hidden rows filtered by `visibleDocument`.
- Optional canonical refs per row (`cardGroupId`+`variantId`) →
  `GET /api/site-pages/:id/pricing-drift` (`sitePages/pricingDrift.js`)
  compares frozen lines to the live cards via `describeStructure`. Refs never
  render (test-asserted).
- Editor: `PricingEditor` (reorder/duplicate/hide/delete rows and lines,
  bilingual with TranslateButton, drift badges + "עדכון מהמחירון",
  missing-English badges and a publish-time warning summary).
- WP plugin v1.1.0: `seo.noindex` → `noindex,nofollow` meta, Yoast robots
  override, Yoast sitemap exclusion — generic for any unlisted page.
- `publicLinks.js`: `PUBLIC_LINKS.agentPriceList`.
- Importer `server/scripts/importSitePageAgentPricing.mjs` (idempotent;
  referenced rows priced from the LIVE cards at run time; images re-hosted to
  R2 with content-stable keys).
- Tests: 48 in the sitePages suite (pricing normalize/sanitize/render He+En/
  hidden-rows/no-internal-id-leak/frozen-after-publish) + 5 drift tests; full
  server & client suites green.

## 5) Production proof (2026-08-05)

- `?locale=he` → 200, version 3: `1,300 ₪`, `1,500 ₪`, `עד 10 משתתפים — 1,650 ₪`,
  `2,800 ₪`, hero + gallery images 200 from R2, `noindex: true`, canonical
  `https://grafitiyul.co.il/agent-price-list/`.
- `?locale=en` → `1,300 NIS`, `Up to 10 participants`, English titles, notes.
- `Cache-Control: no-store`; `If-None-Match` with the current ETag → **304**.
- No `cmquk*` variant ids, no `card_*` group ids, no `/admin/`, no app origin
  in the payload.
- Public index lists the page with `noindex: true` (feeds the WP-side sitemap
  exclusion).
- Old EN-page hero image was never archived & is dead → hero uses the HE page's
  war-graffiti photo (full-size original recovered; the `-1024x1024` thumbnail
  was never captured).

## 6) Remaining manual step (WP admin, ~5 minutes)

§7 of `GOS-site-pages-module.md`: install/activate plugin v1.1.0, create TWO
empty pages (`restaurant-recommendations`, `agent-price-list` — the latter in no
menu), optional 301s. Verified: the store's Woo key can READ `wp/v2/pages` but
`POST` → `401 rest_cannot_create`, so GOS cannot do this itself.
