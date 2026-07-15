// THE canonical global search service.
//
// One entry point — search() — for every category. Nothing else in GOS should
// grow its own cross-entity search logic; new surfaces call this.
//
// Design notes:
//   - PostgreSQL-native. Every match is an indexed lookup or a bounded ILIKE.
//     No external search engine: GOS is a single-tenant CRM, and no evidence
//     was found that Postgres is insufficient at this scale. Revisit only with
//     a real query plan that proves otherwise.
//   - Each provider runs a FIXED number of queries regardless of result count.
//   - Results are bounded per category, and the payload carries only the
//     fields the result UI renders.
//
// SECURITY: providers select explicit fields only. No portal tokens, no
// secrets, no credentials, no raw LegacyRecord.payload — only curated
// LegacyRecord.cardData. See lookups.lookupLegacy.

import { prisma } from '../db.js';
import { phoneQuery } from './phoneQuery.js';
import { compareHits, REASON_LABEL, scoreFor, IDENTIFIER_TIER_MIN } from './ranking.js';
import { searchDeals } from './providers/deals.js';
import { searchContacts } from './providers/contacts.js';
import { searchOrganizations } from './providers/organizations.js';
import { searchTasks } from './providers/tasks.js';
import { searchTimeline } from './providers/timeline.js';

export const CATEGORIES = ['deals', 'contacts', 'organizations', 'tasks', 'timeline'];
export const DEFAULT_CATEGORY = 'deals';

export const CATEGORY_LABEL = {
  deals: 'עסקאות',
  contacts: 'אנשי קשר',
  organizations: 'ארגונים',
  tasks: 'משימות',
  timeline: 'הערות / ציר זמן',
  all: 'הכל',
};

const PROVIDERS = {
  deals: searchDeals,
  contacts: searchContacts,
  organizations: searchOrganizations,
  tasks: searchTasks,
  timeline: searchTimeline,
};

// Below this, a query is noise — a single character matches most of the DB.
// Digits are exempt: "27" is a meaningful deal-number prefix.
export const MIN_QUERY_LENGTH = 2;

export const LIMIT_SINGLE = 20;
export const LIMIT_PER_CATEGORY_IN_ALL = 5;

export function isMeaningfulQuery(q) {
  const t = String(q ?? '').trim();
  return t.length >= MIN_QUERY_LENGTH;
}

function todayIsoUtc(now = new Date()) {
  // Tour dates are stored as plain "YYYY-MM-DD" strings with no timezone. The
  // business runs in Israel, so "today" is resolved in Asia/Jerusalem to avoid
  // a tour flipping between "future" and "past" around UTC midnight.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Reasons are ranked strongest-first and capped: the row shows WHY it matched,
// not an audit log.
function formatReasons(reasons) {
  return [...(reasons || [])]
    .sort((a, b) => scoreFor(b.key) - scoreFor(a.key))
    .slice(0, 2)
    .map((r) => ({
      key: r.key,
      label: REASON_LABEL[r.key] || r.key,
      text: r.text ? String(r.text).slice(0, 160) : null,
      strong: scoreFor(r.key) >= IDENTIFIER_TIER_MIN,
    }));
}

function finalize(hit) {
  const dto = hit.dto();
  return { ...dto, reasons: formatReasons(dto.reasons), score: hit.score };
}

async function runCategory(category, q, pq, limit, todayIso, db) {
  const provider = PROVIDERS[category];
  const { hits, truncated } = await provider(q, pq, limit, todayIso, db);
  const sorted = hits.sort(compareHits);
  return {
    category,
    label: CATEGORY_LABEL[category],
    total: sorted.length,
    // Honest signalling: `truncated` means the candidate cap was hit, so the
    // count is a floor, not a total. The UI says so rather than implying
    // completeness.
    truncated,
    results: sorted.slice(0, limit).map(finalize),
  };
}

// search({ q, category }) → { query, category, groups: [...] }
//
// category: one of CATEGORIES, or 'all' to group across every entity type.
export async function search({ q, category = DEFAULT_CATEGORY, db = prisma, now = new Date() } = {}) {
  const query = String(q ?? '').trim();
  const cat = category === 'all' || CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;

  if (!isMeaningfulQuery(query)) {
    return { query, category: cat, groups: [], tooShort: true };
  }

  const pq = phoneQuery(query);
  const todayIso = todayIsoUtc(now);

  if (cat !== 'all') {
    const group = await runCategory(cat, query, pq, LIMIT_SINGLE, todayIso, db);
    return { query, category: cat, groups: [group] };
  }

  const groups = await Promise.all(
    CATEGORIES.map((c) => runCategory(c, query, pq, LIMIT_PER_CATEGORY_IN_ALL, todayIso, db)),
  );
  return { query, category: cat, groups: groups.filter((g) => g.results.length) };
}
