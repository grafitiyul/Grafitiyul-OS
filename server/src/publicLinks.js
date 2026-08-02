// THE registry of public marketing-site URLs GOS sends to customers.
//
// These are not application routes and not capability links — they are pages on
// the public website that operational messages point at. They live in one place
// for the ordinary reason: when the marketing site moves a page, exactly one
// line changes, and no one has to grep for a raw URL scattered across report
// definitions.
//
// Not configurable in the UI on purpose. A public page URL is not an operator
// decision, and making it editable would mean a typo can send every customer to
// a dead link with no review. Changing one is a code change, like the reports
// that use them.

const SITE = 'https://grafitiyul.co.il';

export const PUBLIC_LINKS = {
  restaurantRecommendations: `${SITE}/restaurant-recommendations/`,
};

/** The links block merged into a report context. */
export function publicLinksContext() {
  return { ...PUBLIC_LINKS };
}
