// THE registry of public marketing-site URLs GOS sends to customers.
//
// These are not application routes and not capability links — they are pages on
// the public website that operational messages point at. They live in one place
// for the ordinary reason: when the marketing site moves a page, exactly one
// line changes, and no one has to grep for a raw URL scattered across report
// definitions.
//
// ── Relationship to the "דפי אתר" module ────────────────────────────────────
// Pages migrated into GOS are identified here by their SLUG, and the URL is
// derived from it — the same slug the SitePage row carries. So a page has one
// identity across the estate: `SitePage.slug` is what the website serves, what
// the public API answers on, and what these links resolve to. Renaming a page
// means changing the slug in the module and this one constant, and nothing else
// in the codebase holds a copy of that path.
//
// Not configurable in the UI on purpose. A public page URL is not an operator
// decision, and making it editable would mean a typo can send every customer to
// a dead link with no review. Changing one is a code change, like the reports
// that use them.

// The public marketing website. Distinct from PUBLIC_ORIGIN, which is the GOS
// app itself (app.grafitiyul.co.il) — customer-facing content pages and
// capability links are different properties and must never be conflated.
const SITE = (process.env.PUBLIC_WEBSITE_ORIGIN || 'https://grafitiyul.co.il').replace(/\/+$/, '');

/** logical name -> the SitePage slug that owns it. */
export const SITE_PAGE_SLUGS = {
  restaurantRecommendations: 'restaurant-recommendations',
};

/** Absolute public URL of a website page, by slug. Always a trailing slash. */
export function sitePageUrl(slug) {
  const clean = String(slug || '').replace(/^\/+|\/+$/g, '');
  return clean ? `${SITE}/${clean}/` : `${SITE}/`;
}

export const PUBLIC_LINKS = Object.fromEntries(
  Object.entries(SITE_PAGE_SLUGS).map(([name, slug]) => [name, sitePageUrl(slug)]),
);

/** The links block merged into a report context. */
export function publicLinksContext() {
  return { ...PUBLIC_LINKS };
}
