// THE ranking rules for global search. Pure functions only — no DB access —
// so the whole formula is unit-testable without a database.
//
// ---------------------------------------------------------------------------
// THE FORMULA
// ---------------------------------------------------------------------------
// Every hit carries two independent dimensions:
//
//   1. score      — HOW WELL the text matched (0-100), from MATCH_SCORE below.
//   2. groupRank  — the BUSINESS importance of the deal (0-3), from
//                   dealGroupRank(): open > won-with-future-tour >
//                   won-recently-ended > everything else.
//
// Naively sorting by groupRank first would let a vague note match on an open
// deal outrank an exact deal-number hit on an old one — the failure the spec
// explicitly forbids. Naively sorting by score first would throw away the
// business ordering entirely.
//
// So hits are split into two TIERS and the dimensions swap priority:
//
//   tier 0 — IDENTIFIER hits (score >= IDENTIFIER_TIER_MIN): the user typed
//            something that uniquely names a thing (deal number, full phone,
//            email, exact name). Intent is unambiguous, so relevance leads and
//            business order is only a tie-breaker.
//
//   tier 1 — TEXT hits (score < IDENTIFIER_TIER_MIN): the user is browsing by
//            words. Intent is ambiguous, so the business order leads and score
//            breaks ties — this is where "open deals first" applies.
//
// Final sort key:
//   tier 0 → [tier, -score, groupRank, -updatedAt]
//   tier 1 → [tier, groupRank, -score, -updatedAt]
//
// Net effect: an exact identifier match ALWAYS outranks any text match
// (tier 0 < tier 1), and within ordinary text search the business order you
// asked for is exactly respected.
// ---------------------------------------------------------------------------

// Reason key → score. Also the source of truth for the Hebrew label shown as
// "why this matched" in the UI.
export const MATCH_SCORE = {
  deal_number_exact: 100,
  org_number_exact: 100,
  contact_number_exact: 100,
  phone_exact: 95,
  email_exact: 92,
  name_exact: 90,
  tax_id_exact: 88,
  // --- identifier tier boundary ---
  name_prefix: 70,
  title_prefix: 65,
  name_partial: 60,
  title_partial: 55,
  phone_partial: 50,
  deal_number_partial: 48,
  org_name_partial: 45,
  unit_name_partial: 44,
  email_partial: 42,
  product_partial: 40,
  variant_partial: 39,
  task_title_partial: 38,
  source_partial: 35,
  status_partial: 34,
  tour_date_partial: 33,
  note_partial: 30,
  timeline_partial: 25,
  legacy_partial: 20,
};

export const IDENTIFIER_TIER_MIN = 88;

export const REASON_LABEL = {
  deal_number_exact: 'התאמה מדויקת למספר הזמנה',
  org_number_exact: 'התאמה מדויקת למספר ארגון',
  contact_number_exact: 'התאמה מדויקת למספר איש קשר',
  phone_exact: 'התאמה מדויקת לטלפון',
  email_exact: 'התאמה מדויקת לאימייל',
  name_exact: 'התאמה מדויקת לשם',
  tax_id_exact: 'התאמה מדויקת למספר ח.פ / ת.ז',
  name_prefix: 'התחלת שם תואמת',
  title_prefix: 'התחלת כותרת תואמת',
  name_partial: 'נמצא בשם',
  title_partial: 'נמצא בכותרת',
  phone_partial: 'נמצא במספר טלפון',
  deal_number_partial: 'נמצא במספר הזמנה',
  org_name_partial: 'נמצא בשם הארגון',
  unit_name_partial: 'נמצא בשם היחידה',
  email_partial: 'נמצא באימייל',
  product_partial: 'נמצא במוצר',
  variant_partial: 'נמצא בוריאנט',
  task_title_partial: 'נמצא במשימה',
  source_partial: 'נמצא במקור הליד',
  status_partial: 'נמצא בסטטוס',
  tour_date_partial: 'נמצא בתאריך הסיור',
  note_partial: 'נמצא בהערה',
  timeline_partial: 'נמצא בציר הזמן',
  legacy_partial: 'נמצא במידע היסטורי',
};

export function scoreFor(reasonKey) {
  return MATCH_SCORE[reasonKey] ?? 0;
}

export function tierFor(score) {
  return score >= IDENTIFIER_TIER_MIN ? 0 : 1;
}

// Reasons are collected per hit; the hit's score is its STRONGEST reason.
export function bestReason(reasons) {
  if (!reasons?.length) return null;
  return [...reasons].sort((a, b) => scoreFor(b.key) - scoreFor(a.key))[0];
}

export function scoreOf(reasons) {
  return reasons?.length ? Math.max(...reasons.map((r) => scoreFor(r.key))) : 0;
}

// ---------------------------------------------------------------------------
// Deal business grouping
// ---------------------------------------------------------------------------
// 0 = open
// 1 = WON with a future tour
// 2 = WON whose latest relevant tour ended within the last 2 months
// 3 = everything else (older WON, lost, WON with no tour)
//
// NOTE on dates: TourEvent.date is a String "YYYY-MM-DD", not a DateTime, so
// all comparisons here are lexicographic on zero-padded ISO strings — which is
// correct and avoids a timezone round-trip. completedAt is deliberately NOT
// used: a past-dated tour that was never explicitly completed still has
// completedAt = null, so date is the reliable signal for "has it happened".
export const TWO_MONTHS_DAYS = 62;

export function isoDaysAgo(todayIso, days) {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// tourDates: the deal's active-booking tour dates ("YYYY-MM-DD"), nulls dropped.
export function dealGroupRank(deal, tourDates, todayIso) {
  if (deal?.status === 'open') return 0;
  if (deal?.status !== 'won') return 3;

  const dates = (tourDates || []).filter(Boolean).sort();
  if (!dates.length) return 3;

  const latest = dates[dates.length - 1];
  if (dates.some((d) => d >= todayIso)) return 1;

  const cutoff = isoDaysAgo(todayIso, TWO_MONTHS_DAYS);
  if (latest >= cutoff) return 2;
  return 3;
}

// The canonical comparator. See THE FORMULA above.
export function compareHits(a, b) {
  const ta = tierFor(a.score);
  const tb = tierFor(b.score);
  if (ta !== tb) return ta - tb;

  if (ta === 0) {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.groupRank ?? 9) !== (b.groupRank ?? 9)) return (a.groupRank ?? 9) - (b.groupRank ?? 9);
  } else {
    if ((a.groupRank ?? 9) !== (b.groupRank ?? 9)) return (a.groupRank ?? 9) - (b.groupRank ?? 9);
    if (b.score !== a.score) return b.score - a.score;
  }
  return (b.updatedAt || 0) - (a.updatedAt || 0);
}
