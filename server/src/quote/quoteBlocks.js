// Default quote block sequence — the approved content-model order. Kept in its
// own tiny module (no imports) so BOTH the composer and the quote-template
// service can read it without a circular import. `type` selects the builder;
// `kind` is dynamic|content; `removable:false` marks the never-removable blocks.
// This is the DEFAULT seed only — a stored composition (per-quote draft or the
// global template) controls order + hidden, so nothing is hardcoded downstream.
export const DEFAULT_QUOTE_BLOCKS = [
  // Hero is the ONLY non-removable block (the document header — see composer heroFirst).
  // Every other section is fully controlled by Quote Structure → Sections (order +
  // show/hide). `removable` just means "can be hidden from the sections list".
  { key: 'hero', type: 'hero', kind: 'dynamic', optional: false, removable: false },
  // "אז מה בתוכנית?" — variant-specific programme copy. TITLE comes from the Quote
  // Template (one source of truth); CONTENT comes from the selected Product Variant.
  // Sits immediately before Technical Details in the default order.
  { key: 'program', type: 'program', kind: 'content', optional: true, removable: true },
  { key: 'tour_details', type: 'tour_details', kind: 'dynamic', optional: true, removable: true },
  { key: 'product_marketing', type: 'product_marketing', kind: 'content', optional: true, removable: true },
  // Video (YouTube) — shown only in quotes whose Product Variant is selected in the
  // Quote Structure → Video tab. Config lives in the template; content is the URL.
  { key: 'video', type: 'video', kind: 'content', optional: true, removable: true },
  { key: 'why_grafitiyul', type: 'why_us', kind: 'content', optional: true, removable: true },
  { key: 'classification', type: 'classification', kind: 'content', optional: true, removable: true },
  // Pricing owns the payment terms/method too (rendered inside the pricing section).
  { key: 'pricing', type: 'pricing', kind: 'dynamic', optional: true, removable: true },
  { key: 'faq', type: 'faq', kind: 'content', optional: true, removable: true },
  { key: 'cancellation', type: 'cancellation', kind: 'content', optional: true, removable: true },
  { key: 'participant_policy', type: 'participant_policy', kind: 'content', optional: true, removable: true },
  { key: 'signature', type: 'signature', kind: 'dynamic', optional: true, removable: true },
];

// Reconcile a saved ordered key list against the canonical order. Keeps the saved
// order for known keys, drops unknown/stale keys, and INSERTS any missing canonical
// key at its canonical position — right after its nearest canonical predecessor
// that is present (or at the front if none is). This is the ONE place a newly-added
// block (e.g. program, video) is slotted into an existing composition, so it lands
// in the right spot for BOTH the global template (section list) and an existing
// per-quote draft — instead of being dropped or appended at the very end.
export function reconcileKeyOrder(savedKeys, canonicalKeys) {
  const canonical = canonicalKeys;
  const canonicalSet = new Set(canonical);
  const result = [];
  const seen = new Set();
  for (const k of savedKeys) {
    if (canonicalSet.has(k) && !seen.has(k)) { seen.add(k); result.push(k); }
  }
  for (let i = 0; i < canonical.length; i++) {
    const key = canonical[i];
    if (seen.has(key)) continue;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.indexOf(canonical[j]);
      if (idx !== -1) { insertAt = idx + 1; break; }
    }
    result.splice(insertAt, 0, key);
    seen.add(key);
  }
  return result;
}
