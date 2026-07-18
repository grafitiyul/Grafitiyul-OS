// Shared opt-in list pagination for the CRM list screens (Deals/Contacts/Orgs).
//
// The list endpoints are DUAL-PURPOSE: the list screens page through them, but
// many pickers/cross-refs call them with no params and iterate the full array.
// So pagination is OPT-IN: a request WITH `page` gets a { rows, total, page,
// pageSize } envelope; a request WITHOUT `page` keeps the legacy full-array
// behavior. No existing consumer breaks.
export const PAGE_SIZES = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Pure parse of the pagination/search params. */
export function parseListQuery(query = {}) {
  const q = query || {};
  const paginated = q.page != null && String(q.page) !== '';
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  let pageSize = parseInt(q.pageSize, 10) || DEFAULT_PAGE_SIZE;
  pageSize = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const search = String(q.search ?? q.q ?? '').trim();
  return { paginated, page, pageSize, skip: (page - 1) * pageSize, take: pageSize, search };
}

/** Case-insensitive contains for a text column (leading-wildcard ILIKE). */
export const containsI = (value) => ({ contains: value, mode: 'insensitive' });

/** Digits-only variant for phone matching. */
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
