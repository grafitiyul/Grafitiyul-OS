# GOS — Website Domain Cutover Audit: grafitiyul.co.il

**Date:** 2026-08-04
**Scope:** the three website identities, every old/THEGUY dependency across WordPress,
WooCommerce, GOS, Railway and external providers, the corrections applied, and what
remains blocked on owner action.
**Posture:** read-only audit first. Exactly **three** production writes were made, each
listed in §5. Everything else is evidence.

---

## 1) The three identities — established, not assumed

The critical fact that reframes this whole cutover:

> **The domain `grafitiyul.co.il` was REUSED.** It was the legacy site's own domain.
> The new site did not move to a fresh domain — it took over the old site's address.

| | **LEGACY (previous site)** | **TEMP (developer site)** | **NEW (live now)** |
|---|---|---|---|
| Address | `grafitiyul.co.il` | `theguy4u.co.il/grafityul` | `grafitiyul.co.il` |
| Status | **Gone from this domain** | **STILL LIVE, still 200** | Live, serving customers |
| Server IP | — | `81.218.117.94` | `185.53.210.12` |
| Theme | Storefront Child 1.0.0 | Frontend 2.1.0 | Frontend 2.1.0 |
| WP / WC / PHP | 7.0.2 / 9.7.3 / 8.1.34 | 7.0.2 / 10.9.4 / **8.3.32** | 7.0.2 / 10.9.4 / **8.1.34** |
| Products | 93 in 22 categories | 4 | 4 |
| Orders | **5,671** | 0 | 0 |
| Form engine | Elementor Pro Forms | Fluent Forms | Fluent Forms |
| Multilingual | Polylang (HE + `/en/`) | none | none |
| Active plugins | 34 | 15 | **17** |

### How the identities were proven

- `GET /wp-json/` on both live hosts: `home`/`url` are **`https://grafitiyul.co.il`** and
  **`https://theguy4u.co.il/grafityul`** respectively — two independent installations,
  each with its own self-declared home.
- `GET /wc/v3/system_status`: `home_url` = `site_url` = the respective domain on each.
- **Credential matrix** (the decisive test):

  | | `WOOCOMMERCE_*` | `WP_NEW_*` | `WP_OLD_*` |
  |---|---|---|---|
  | `grafitiyul.co.il` | 200 | 200 | **401** |
  | `theguy4u.co.il/grafityul` | 200 | 200 | **401** |

  The live domain accepts the **temp site's** API keys and **rejects the legacy site's**.
  WooCommerce API keys live in the database, so this proves the live site is running a
  **clone of the temp site's database**, and that the legacy database is no longer
  behind this domain.

### Answer to "what does the new domain point to"

**A cloned, migrated installation — on a different server from the temp site.** Not the
same database, not the same host. Confirmed further by divergence: product #167's
`date_modified` was `2026-08-04T00:01:51` on LIVE but `2026-08-04T13:04:25` on TEMP,
placing the clone between 12:32 and 13:04 on 2026-08-04.

**The application-level migration was done correctly** — see §3. DNS was not the only step
taken.

---

## 2) The legacy site — the biggest open item

The legacy site is **not** reachable at `grafitiyul.co.il` any more, and its URL inventory
now 404s:

| Legacy URL | Now |
|---|---|
| `/contact_us/` | **404** |
| `/batmitzvahgraffiti/` | **404** |
| `/en/` (entire Polylang English tree) | **404** |
| `/product-category/tours/` | **404** |
| `/sitemap_index.xml` (Yoast/RankMath index) | **404** |
| `/calendar/` | 301 → `/סיורים-וסדנאות/` (a Redirection rule exists) |

The previous audit crawled **282 legacy URLs**; the new site publishes **16 pages + 4
products**. The legacy site also held **5,671 orders**.

This is real, already-live SEO and history loss. It is **not** something this cutover
caused and **not** something I can fix from outside — see §6.

---

## 3) WordPress / WooCommerce URL audit — the migration is clean

I checked for old-domain leakage rather than assuming, because a migrated WP database
usually leaks. **It does not here.**

Rendered-HTML scan of `/`, `/shop/`, the Tel Aviv product page, `/cart/`, `/checkout/`
and `/wp-sitemap.xml`:

| Check | Result |
|---|---|
| `theguy4u` occurrences | **0 on every page** (TEMP's own homepage has 169) |
| `http://` mixed-content grafitiyul URLs | **0** |
| `localhost` leakage | **0** |
| `<link rel="canonical">` | correct apex HTTPS on every page |
| Uploads / media URLs | `https://grafitiyul.co.il/wp-content/uploads/...` — rewritten |
| Sitemap index | 11 sub-sitemaps, **all** on `grafitiyul.co.il` |
| `robots.txt` | correct, points at `https://grafitiyul.co.il/wp-sitemap.xml` |
| `www` handling | `www` → apex **301**, single hop |

**Therefore no bulk search-replace was run, and none should be.** Part 5 of the brief
(serialization-aware replacement, before-snapshot, dry run) is **moot** — there is nothing
left to replace. Running a replacement here would have been a pure risk with no upside.
This is the single most important "do not touch" conclusion of the audit.

### WooCommerce store state (before-state snapshot captured)

| | LIVE | TEMP |
|---|---|---|
| Products | 4 (ids 167, 169, 170, 171) | 4 (same ids) |
| Product #167 variations | **315** | 315 |
| Woo webhooks | **0** | **0** |
| Currency / country | ILS / IL | ILS / IL |
| Global attributes | ids 1–5 (`תאריך`,`שעה`,`פעילות`,`משך`,`גיל`) | **identical ids 1–5** |
| Payment gateway | Tranzila Gateway 0.1.6 active | Tranzila active |
| Cache layer | **WP Rocket 3.21.1** + LiteSpeed | LiteSpeed only |

Full before/after JSON is in the session scratchpad (`before-state-2026-08-04.json`,
`slug-before.json`, `slug-after.json`).

---

## 4) GOS / Railway / database audit

### Code — clean

`grep` across `client/src`, `server/src`, `shared` for `theguy4u` / `theguy.co.il`:
**zero references in shipping code.** The only THEGUY exposure in the whole GOS estate was
**two Railway environment variables**.

### Production database — all historical, nothing to change

Scanned **every** `text` / `varchar` / `json` / `jsonb` column of every table in the
production database for `theguy4u` and `theguy.co.il`:

| Table.column | Rows | Classification |
|---|---|---|
| `EmailMessage.bodyHtml` / `bodyText` / `snippet` | 17 / 17 / 1 | **Safe historical snapshot** — real received/sent mail |
| `WhatsAppMessage.textContent` / `rawPayload` | 3 / 3 | **Safe historical snapshot** — real staff messages |
| `ContactEmail.value`, `EmailMessage.fromEmail`, `EmailThread.participants`, `MirrorEvent.rawPayload` | various | **Not the website** — `theguy.co.il` is the developer's personal email domain (Guy Walder) |

**Zero configuration rows. Zero template rows.** No `CommunicationTemplate`,
`WhatsAppTemplate`, confirmation-email template, quote, or document contains a THEGUY URL.
That directly satisfies "no customer-facing message contains THEGUY" — by evidence, not
by assertion. All of the above is **category 3 (immutable)** and was left untouched.

⚠️ One security note, not a cutover item: `EmailMessage.snippet` contains a historical
email with the temp site's `wp-admin` URL, a username, and a one-time-secret link. It is
correctly immutable as a record, but **those credentials should be rotated** if they are
still valid.

### Railway variables

| Variable | Before | Classification | Action |
|---|---|---|---|
| `WOOCOMMERCE_BASE_URL` | `https://theguy4u.co.il/grafityul` | **1 — MUST CHANGE NOW** | ✅ changed |
| `WP_NEW_BASE_URL` | `https://theguy4u.co.il/grafityul` | 4 — obsolete (read by no code) | ✅ changed for clarity |
| `WP_OLD_BASE_URL` | `https://grafitiyul.co.il` | **5 — NEEDS OWNER DECISION** | left as-is |
| `PUBLIC_ORIGIN` | `https://app.grafitiyul.co.il` | **2 — intentionally stays** | untouched |
| `R2_PUBLIC_BASE_URL`, `RECRUITMENT_API_BASE_URL`, `WHATSAPP_BRIDGE_URLS` | — | intentionally stay | untouched |

`WP_OLD_BASE_URL` is now actively misleading: it names the **legacy** store but its value
is the address the **new** site occupies, and its paired `WP_OLD_WC_*` credentials 401
everywhere. It is left in place deliberately — it is the last record of the legacy store's
identity, and deleting it destroys information (propose, never dispose).

### External providers

| Provider | Method | THEGUY refs | Old-site refs needing change |
|---|---|---|---|
| **Make.com** | blueprint scan of **all 233 scenarios** (119 active) | **0** | none — hits are `@grafitiyul.co.il` **email addresses** and historical payload samples |
| **WooCommerce webhooks** | `GET /wc/v3/webhooks` on both stores | **0 webhooks configured at all** | see §6 |
| **Cardcom / iCount** | Railway config + code | 0 | callbacks derive from `PUBLIC_ORIGIN` (`app.grafitiyul.co.il`) — correctly unchanged |
| **Pipedrive** | `PIPEDRIVE_COMPANY_DOMAIN=grafitiyul` | 0 | Pipedrive's own tenant name, not a website URL |

Make URLs that *are* website links (`/articles/`, `/contact-us/`, `/`) were tested and all
return **200** on the new site.

---

## 5) What was actually changed — exactly three production writes

1. **Railway `WOOCOMMERCE_BASE_URL`** → `https://grafitiyul.co.il`
   *(plus `WP_NEW_BASE_URL`, cosmetic — read by no code)*

   **Why this was urgent.** `WOOCOMMERCE_BASE_URL` is read by exactly two live modules:
   `server/src/tours/woo/wooClient.js` (tour→Woo publishing) and
   `server/src/ingress/config.js` (Woo order ingress). With `WOO_SYNC_ENABLED=true`, GOS
   was publishing every new tour occurrence to the **temp** site — a site no customer
   sees. The live storefront's dates would have silently frozen.

   **Why it was safe.** Verified *before* changing: all **252** GOS-linked
   `WooVariationLink.wooVariationId` values exist on the live store — 252/252, with
   **0 temp-only** and **0 stale**. Global attribute ids are identical (1–5). Sync queue
   was empty (0 pending, 0 failed), so no write storm on redeploy.

2. **Woo product #167 slug** → `graffiti-tour-and-workshop-tel-aviv` (§7)

3. **`client/src/public/seo/siteMeta.js`** — canonical fallback `www.` → apex, to match
   the live site's own canonical and its `www`→apex 301. Prevents GOS-rendered pages
   advertising a canonical the website redirects away from.

---

## 6) Blocked on owner action — I do not have the access

I hold **WooCommerce REST keys only**. Those authenticate `wc/*` namespaces. They cannot
read or write WordPress options, `postmeta`, menus, theme settings, the Redirection
plugin, Fluent Forms, or the WP Rocket cache. The following parts of the brief are
therefore **not done**, and I will not claim otherwise:

| # | Item | Needs |
|---|---|---|
| B1 | **Legacy 301 redirect map** — 282 legacy URLs currently 404 | WP admin (Redirection plugin) + a decision on the legacy URL inventory |
| B2 | **`theguy4u.co.il/grafityul` is still live and indexable** — a full duplicate of the live store, with its own canonical tags. It competes with the live site in search and can still take orders. | Hosting access at theguy4u — needs 301-to-live, or `noindex` + HTTP auth |
| B3 | **Where is the legacy site / its 5,671 orders?** Archived? Backed up? | Owner knowledge |
| B4 | **`/restaurant-recommendations/` 404s** and GOS **sends it to customers** in the coordination follow-up message (`server/src/publicLinks.js`). No equivalent page exists on the new site. | Owner decision: create the page, repoint the link, or drop that message |
| B5 | **Woo → GOS webhooks: none exist on either store**, and `WOO_PRIMARY_WEBHOOK_SECRET` is unset. Woo order ingress cannot fire. | WP admin + secret generation |
| B6 | Temp-site `wp-admin` credentials sitting in a historical email | Credential rotation |

---

## 7) The product slug change

**Identified product** (unambiguous — only one Hebrew-slug product matched):

| Field | Value |
|---|---|
| Woo product id / WP post id | **167** |
| Title | `סיור וסדנת גרפיטי בתל אביב` (unchanged) |
| Old slug | `%d7%a1%d7%99%d7%95%d7%a8-...` → decoded `סיור-וסדנת-גרפיטי-בתל-אביב` |
| **New slug** | **`graffiti-tour-and-workshop-tel-aviv`** |
| Type / status | variable / publish |
| Variations | 315 |

The new slug is an exact English rendering of the real product identity
("Graffiti Tour **and Workshop** in Tel Aviv"), keeps the city for local SEO, and was
verified free of collision (both candidate slugs 404'd beforehand).

Changed through the **canonical WooCommerce REST API** (`PUT /wc/v3/products/167`) with a
single field in the body: `{"slug": "..."}`.

### Proof nothing else moved — field-by-field diff

```
5 field(s) changed, 66 identical
  slug              (intended)
  permalink         (derived from slug)
  date_modified     (unavoidable)
  date_modified_gmt (unavoidable)
  related_ids       [170,171,169] -> [169,171,170]   same set, reordered
```

Untouched and verified: `id`, `name`, `type`, `status`, `catalog_visibility`, `price`,
`regular_price`, `sale_price`, `stock_status`, `manage_stock`, `menu_order`, `sku`,
`categories`, `images`, `attributes`.

```
VARIATIONS   before: 315   after: 315
             ids removed: 0   ids added: 0
             price/stock drift: 0
```

GOS mapping untouched: `WooProductMapping` still 2 rows → product 167; all 252
`WooVariationLink` rows still `synced`. No duplicate product created.

### Proof of the 301

```
GET /product/%d7%a1%d7%99%d7%95%d7%a8-%d7%95%d7%a1%d7%93%d7%a0%d7%aa-.../
  hop 1  ->  301  https://grafitiyul.co.il/product/graffiti-tour-and-workshop-tel-aviv/
  final  ->  200   num_redirects = 1        ← single hop, no chain, no loop

GET /product/graffiti-tour-and-workshop-tel-aviv/
  ->  200   num_redirects = 0
```

WordPress created the redirect itself via `_wp_old_slug` (core `wp_old_slug_redirect`) —
no plugin rule needed, and no second override introduced.

| Surface | State |
|---|---|
| Canonical on new page | `https://grafitiyul.co.il/product/graffiti-tour-and-workshop-tel-aviv/` ✅ |
| Product sitemap | contains the **English** URL, old one gone ✅ |
| Old slug anywhere in new page HTML | **0 occurrences** ✅ |
| Copy/paste readability | `https://grafitiyul.co.il/product/graffiti-tour-and-workshop-tel-aviv/` ✅ |

⚠️ The other three products still carry Hebrew slugs (Jerusalem, Haifa, "קירות של תקווה"),
as do 9 of the 16 pages. Out of scope for this task — flagged for a decision.

---

## 8) Before / after URL map

| Surface | Before | After |
|---|---|---|
| Public website | `grafitiyul.co.il` (legacy) / `theguy4u.co.il/grafityul` (new, temp) | **`grafitiyul.co.il`** (new) |
| GOS Woo target | `https://theguy4u.co.il/grafityul` | **`https://grafitiyul.co.il`** |
| Tel Aviv product | `/product/סיור-וסדנת-גרפיטי-בתל-אביב/` | **`/product/graffiti-tour-and-workshop-tel-aviv/`** (old → 301) |
| GOS app | `app.grafitiyul.co.il` | unchanged (intentional) |
| GOS SEO canonical fallback | `https://www.grafitiyul.co.il` | `https://grafitiyul.co.il` |
| Legacy pages (282) | live on `grafitiyul.co.il` | **404 — unresolved, see B1** |
| Temp site | live | **still live — unresolved, see B2** |

---

## 9) Verification performed

**Domain** — homepage 200; 0 THEGUY and 0 mixed-content URLs in rendered HTML across 6
key pages; canonicals correct; sitemap all-apex; `www`→apex single 301.

**WooCommerce** — 4 products intact with identical ids/prices/stock/menu_order; product
#167 opens; 315 variations before and after; cart and checkout pages resolve on
`grafitiyul.co.il`; `WooVariationLink` 252/252 `synced`; TourEvent sync 0 failed /
0 pending.

**Slug** — new URL 200; old URL exactly one 301 to it; canonical and sitemap updated.

**Integrations** — GOS authenticates to the live store (200); Make carries 0 THEGUY refs
across 233 scenarios; Cardcom/iCount callbacks derive from `PUBLIC_ORIGIN` and were not
touched; no customer-facing template contains a THEGUY URL.

**Not verified (cannot be, without WP admin):** Fluent Forms notification targets, menu
link targets, WP Rocket cache purge state, Redirection plugin rule list, Search Console
property configuration.

---

## 10) Honest status

`grafitiyul.co.il` **is** the site customers reach, GOS now writes to it, and the Hebrew
product URL 301s to a clean English one.

It is **not yet** the *only* active customer-facing website domain:
`theguy4u.co.il/grafityul` is still live, still serving a complete duplicate storefront,
and still indexable. Until B2 is closed, the cutover is not complete.
