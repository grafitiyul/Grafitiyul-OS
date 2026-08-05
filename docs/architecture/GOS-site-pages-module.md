# GOS — "דפי אתר" (Website Pages) module

**Date:** 2026-08-05
**Status:** shipped in GOS; the WordPress half needs one install step (§7).
**First record:** `restaurant-recommendations` — המלצות למסעדות שוות, recovered
from the previous website.

---

## 1) What this module is

A reusable module for website content pages that GOS owns and the public website
renders. It is **not** a restaurant feature. The restaurant page is record #1.

Intended for: information pages, logistics pages, recommendations, FAQ pages,
landing/campaign pages, SEO content. `pageType` is presentation metadata only —
every type uses the same model, editor and renderer.

Where it lives: **הגדרות → מודולים לניהול → דפי אתר** (`/admin/site-pages`), a
management module, out of the nav rail by default like the other management
modules, and addable to the rail from `/admin/settings/navigation`.

---

## 2) Source of truth — the boundary

| Thing | Owner |
|---|---|
| Drafts | **GOS only.** Never leave the admin API. |
| Published versions | **GOS.** Immutable rows, identified by `versionId`. |
| What the public sees | The version `SitePage.publishedVersionId` points at. |
| Rendering into the site | WordPress, from the GOS payload. |
| Editing | **GOS only.** WordPress holds no editable copy. |

The WordPress page exists to own the URL, the theme chrome and `<head>`. Its
post content is left **empty**, and the plugin only takes over a page whose
content is empty — so it can never silently replace something written in WP, and
there is never a second editable copy to drift.

**If GOS is unavailable:** WordPress serves the last successful payload from a
permanent `wp_option`. The page stays up; it is simply not yet aware of a newer
publish.

---

## 3) Data model

Two additive tables (migration `20261002090000_site_pages`). Nothing existing changed.

```
SitePage
  id, internalName, pageType, slug (unique)
  draft            Json   ← the mutable working copy
  status           draft | published
  publishedVersionId (unique FK)  ← THE pointer that decides what is public
  publishedAt, draftDirty
  createdAt, updatedAt, updatedById, updatedByName

SitePageVersion            ← immutable; never UPDATEd after insert
  id, pageId, versionNo (unique per page)
  content          Json   ← frozen snapshot of the whole document
  note, publishedAt, publishedById, publishedByName
```

Three invariants, each covered by a test in `service.test.js`:

1. **A draft edit never changes the live page.** `saveDraft` touches `draft`
   only; the public read follows `publishedVersionId`.
2. **A published version is immutable.** Publishing INSERTs. Rollback re-points
   the pointer at an existing row — it never copies content backwards, and the
   version rolled past is retained.
3. **Everything stored is sanitized.** `sanitizeDocument` runs on save *and* on
   publish, so a row written before a rule was tightened cannot leak through.

Publish is **idempotent by content**: publishing twice with no edit in between
returns the same version instead of minting a duplicate.

### The content document

Shape is defined once, in `shared/sitePage.mjs`, and imported by both server and
client — the editor cannot produce a shape the renderer does not know.

```
{ titleHe, titleEn,
  sections: [ { id, type, hidden, …type fields } ],
  seo: { titleHe/En, descriptionHe/En, canonicalUrl, noindex,
         ogTitleHe/En, ogDescriptionHe/En, ogImage } }
```

Section types: `hero`, `richText`, `image`, `imageText`, `cards`, `faq`, `cta`,
`divider`. `normalizeDocument` drops unknown types, so a stored document can
never carry something the renderer would have to guess about.

A `cards` entry (the recommendation card) carries: name, description He/En,
category, address, phone, hours, kosher, notes, website, mapUrl, image, plus
`hidden`. Empty fields render nothing at all — the recovered data is uneven and
empty labels would look broken.

---

## 4) Editor

`/admin/site-pages/:id` — three tabs: **תוכן · SEO · היסטוריה**.

- Sections: add (one button per type), drag to reorder (shared
  `ReorderableList`), duplicate, hide/show, delete behind a `ConfirmDialog`.
- Cards: the same four operations, nested.
- Bilingual editing everywhere: Hebrew and English side by side with the shared
  `TranslateButton` between them.
- Rich text uses the shared `RichEditor`.
- **Explicit save** — no auto-save. Publishing is deliberate here, and a
  half-typed sentence must never become the live page. A save bar shows
  dirty / saving / saved, and leaving with unsaved work warns.
- Preview (desktop / mobile / English) renders through the **real public
  renderer** in a sandboxed iframe, so what is previewed is produced by the code
  that will serve the page.
- History: every version with its author and note, and one-click rollback. The
  working draft is untouched by a rollback.

---

## 5) Public rendering

`GET /api/public/site-pages/:slug?locale=he|en` → the frozen payload:

```
{ slug, pageType, versionId, versionNo, publishedAt, locale,
  html,            ← server-rendered, semantic, already sanitized
  seo,             ← title, description, canonical, noindex, og*, locale
  structuredData,  ← FAQPage JSON-LD, only when FAQ items exist
  stylesheet }     ← the one stylesheet the fragment needs
```

Rendering is **server-side**: WordPress needs real HTML (no client-side iframe),
search engines need the metadata in the response, and the page works with
JavaScript off.

There is no id lookup, no `?draft=` parameter and no "include unpublished" flag.
A draft is simply **not addressable** on this router — draft privacy is a
property of the routing table, not of a conditional someone could later break.

### Caching, stated explicitly (project rule 15)

- GOS answers **`Cache-Control: no-store`**. It is the source of truth and never
  serves a stale body.
- The response carries **`ETag: "<versionId>.<locale>"`**. A published version is
  immutable, so *the id changing is the invalidation signal*.
- WordPress caches the payload in a transient (**5 min**) and revalidates with
  `If-None-Match`; a 304 is free and refreshes the TTL. A cache hit can never be
  stale in the dangerous sense — only "not yet aware of a newer publish", bounded
  by the TTL and clearable instantly from the plugin's settings screen.
- A **separate permanent option** holds the last good payload and is used *only*
  when GOS is unreachable.
- A `404` from GOS **clears** both caches, so an unpublished page disappears
  rather than lingering.
- Optional instant purge: `POST /wp-json/gos/v1/purge` with `x-gos-secret`.

---

## 6) Security

- Public endpoint serves published content only; drafts are behind
  `requireAdminAuth` on a separate router.
- `sanitize-html` allowlist (`sitePages/sanitize.js`), narrower than the email
  one: no scripts, styles, iframes, objects, embeds, forms, event handlers.
- Non-`http(s)` URLs are **rejected**, not "cleaned" — including `javascript:`
  and protocol-relative `//evil`.
- Every outbound link is forced to `target="_blank" rel="noopener noreferrer nofollow"`.
- `plainText` decodes entities so storage holds true plain text and the renderer
  escapes exactly once (no `&amp;quot;` on the live page).
- The payload contains no admin URL, no internal id beyond the version, and no
  draft — asserted by test #13.

---

## 7) Install (the one remaining step)

GOS cannot create WordPress pages: the only credential in the estate is a
**WooCommerce** consumer key, which authenticates `wc/*` and returns
`401 rest_cannot_create` on `POST /wp/v2/pages`. Someone with WP admin must:

1. Copy `docs/wordpress/gos-site-pages.php` to
   `wp-content/plugins/gos-site-pages/gos-site-pages.php` and activate it.
2. Settings → GOS Site Pages → API base `https://app.grafitiyul.co.il/api/public`
   (and optionally a purge secret).
3. Create a Page with slug **`restaurant-recommendations`**, title
   "המלצות למסעדות שוות", and leave its content **empty**.
4. Publish it, then purge WP Rocket's cache.

The page then serves at `https://grafitiyul.co.il/restaurant-recommendations/` —
the exact URL GOS already sends customers.

---

## 8) Links

`server/src/publicLinks.js` is the one owner of customer-facing website URLs.
Pages are identified by **slug**, and URLs are derived:

```js
SITE_PAGE_SLUGS.restaurantRecommendations === 'restaurant-recommendations'
PUBLIC_LINKS.restaurantRecommendations    === 'https://grafitiyul.co.il/restaurant-recommendations/'
```

So a page has one identity across the estate: the slug the SitePage row carries
is what the website serves, what the public API answers on, and what operational
messages resolve to. The website origin is overridable via
`PUBLIC_WEBSITE_ORIGIN` and is deliberately distinct from `PUBLIC_ORIGIN`
(the GOS app) — content pages and capability links are different properties.

---

## 9) Tests

`server/src/sitePages/sitePages.test.js` (25) and `service.test.js` (10) cover
all thirteen required behaviours: draft privacy, published rendering, draft
isolation, publish-once, rollback, RTL/LTR, SEO/canonical, unsafe HTML, section
ordering/duplicate/hide/delete, cached-snapshot self-containment, safe
links/images, GOS link resolution, and no-duplicate-editable-copy.
