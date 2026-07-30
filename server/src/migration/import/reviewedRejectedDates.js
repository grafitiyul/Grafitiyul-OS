// The 45 unusable-DATE master tours reviewed and accepted by the owner on
// 2026-07-30. Full evidence per record: docs/architecture/GOS-rejected-tour-dates-review.md
//
// WHY AN EXPLICIT LIST AND NOT A FLAG.
//
// The owner accepted THESE records, having read what each one contains. A
// blanket --accept-rejected-dates would also wave through the next broken record
// nobody has looked at, which is the opposite of what was approved. So the gate
// stays strict and this list is the only thing that relaxes it: every id was
// individually reviewed, and anything outside it still REFUSES the cutover.
//
// Verdicts, as established by scripts/migration/audit-rejected-tour-dates.mjs:
//   historical   — the tour-completion form was answered, so the tour already ran
//   cancelled    — status מבוטל; excluded by Law 2 regardless of its date
//   empty_shell  — carries NO operational marker (no raw date, product, tour type,
//                  calendar event, participant, coordination or payroll row)
//   unknown      — left in the review queue for a manual decision; deliberately
//                  NOT allowed to block the cutover (owner decision, 2026-07-30)

export const REVIEWED_ON = '2026-07-30';
export const REVIEW_DOC = 'docs/architecture/GOS-rejected-tour-dates-review.md';

// recId → what the review found. coordAtReview is the number of coordination rows
// the record had when it was reviewed; if that number CHANGES the record is no
// longer the thing that was approved, and the gate refuses it again.
export const REVIEWED_REJECTED_DATES = Object.freeze({
  rec00rxdlPCu8SBG7: { tourId: 1820, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec0lIEPGw8xylW26: { tourId: 1836, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec0wo7EPgli3J7td: { tourId: 2516, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec2D2oBLfotpgWQw: { tourId: 1799, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec48y33QmFApem9b: { tourId: 1794, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec6xH2yH5XCo6c6Z: { tourId: 1862, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec6yP5lHmm0wXkVM: { tourId: 1831, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec7iOxMyf1Qz0f0a: { tourId: 1793, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec83ibSNDJZ5t9DO: { tourId: 1858, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rec8UwdmJF9p9mHRG: { tourId: 3215, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recAfDjlspmQ8AJsl: { tourId: 873, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recB5AwIeHd7KeOmt: { tourId: 3377, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recBnaJdvbojOzFlB: { tourId: 2239, verdict: 'cancelled', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recCLgFrmuPe7ROxX: { tourId: 1790, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recFpuvYvtCEN09av: { tourId: 2274, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recGT7z4aTjmKW6PA: { tourId: 1838, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recIdq3Cr34XLKqBo: { tourId: 3465, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recInfvPpJEu8rhlZ: { tourId: 1815, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recKaYyc3IJey1dyI: { tourId: 3568, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recLU9kq91Eyfucfx: { tourId: 1835, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recQ0MoGSALaa6PfU: { tourId: 1848, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recQ9qzhkzapOCfiz: { tourId: 1830, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recSX9jmU0r1EnhuH: { tourId: 1711, verdict: 'unknown', reason: 'source_error:#ERROR!', coordAtReview: 1, note: 'markers: participants+coordination' },
  recTOOw7udRReT9VI: { tourId: 1795, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recWTjBnh3wZhKLoZ: { tourId: 1822, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recbYPw49496o9sMn: { tourId: 1814, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  receJNM7WJMDwdLVd: { tourId: 1813, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recf2Ua29BFvidoIJ: { tourId: 1827, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recgQm0lI92VctKbp: { tourId: 1861, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recgtKKci1wm2jyut: { tourId: 2671, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rechWVHN3KRcAxvKS: { tourId: 1843, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recksb1ymX6FMRSsi: { tourId: 1803, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recksv7YxnZ5nLE7V: { tourId: 3036, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recl71d4CfHCZe2QB: { tourId: 719, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recmdqhwzjkcPTmD6: { tourId: 1850, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recq4VqCVMxXmup8a: { tourId: 618, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recr9fQQ4IVr7GWra: { tourId: 1837, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recrvSt25OlapnWiq: { tourId: 2084, verdict: 'empty_shell', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recszM5z3RRhbfGNs: { tourId: 1871, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rect4iGxUK6aSlkl8: { tourId: 1834, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  rectWB4rRQMqnAEDS: { tourId: 1808, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recuRmKV2ItFsULS4: { tourId: 1817, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recvXw3HFocr3eHcM: { tourId: 1804, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recy5dfT433JkVI2i: { tourId: 857, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
  recyAlmSnUlQZ1wnA: { tourId: 1833, verdict: 'historical', reason: 'source_error:#ERROR!', coordAtReview: 0, note: 'no operational markers' },
});

/** The one record the owner left for a later manual decision. */
export const NEEDS_MANUAL_DECISION = Object.freeze(['recSX9jmU0r1EnhuH']);

/**
 * Split the planner's rejected-date list into what the owner already accepted and
 * what nobody has looked at.
 *
 * `coordRows` is passed so a reviewed record that has since GAINED operational
 * content is not waved through on the strength of a stale review: the approval
 * was for a record with N coordination rows, and a record with more than that is
 * a different question.
 *
 * @returns {{acknowledged: object[], unreviewed: object[], changed: object[]}}
 */
export function classifyRejectedDates({ rejectedDates = [], coordRows = [] } = {}) {
  const coordCount = new Map();
  for (const c of coordRows) {
    if (!c?.masterRecId) continue;
    coordCount.set(c.masterRecId, (coordCount.get(c.masterRecId) || 0) + 1);
  }

  const acknowledged = []; const unreviewed = []; const changed = [];
  for (const r of rejectedDates) {
    const seen = Object.prototype.hasOwnProperty.call(REVIEWED_REJECTED_DATES, r.recId)
      ? REVIEWED_REJECTED_DATES[r.recId]
      : null;
    if (!seen) { unreviewed.push({ ...r, why: 'not_in_reviewed_list' }); continue; }
    // A different failure mode than the one reviewed is a different finding.
    if (seen.reason !== r.reason) {
      changed.push({ ...r, why: 'reason_changed', reviewedReason: seen.reason });
      continue;
    }
    const now = coordCount.get(r.recId) || 0;
    if (now !== seen.coordAtReview) {
      changed.push({ ...r, why: 'coordination_rows_changed', reviewedCount: seen.coordAtReview, currentCount: now });
      continue;
    }
    acknowledged.push({ ...r, verdict: seen.verdict, note: seen.note });
  }
  return { acknowledged, unreviewed, changed };
}
