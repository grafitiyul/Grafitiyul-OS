// Default quote block sequence — the approved content-model order. Kept in its
// own tiny module (no imports) so BOTH the composer and the quote-template
// service can read it without a circular import. `type` selects the builder;
// `kind` is dynamic|content; `removable:false` marks the never-removable blocks.
// This is the DEFAULT seed only — a stored composition (per-quote draft or the
// global template) controls order + hidden, so nothing is hardcoded downstream.
export const DEFAULT_QUOTE_BLOCKS = [
  { key: 'hero', type: 'hero', kind: 'dynamic', optional: false, removable: false },
  { key: 'personal_intro', type: 'personal_intro', kind: 'dynamic', optional: true, removable: true },
  { key: 'tour_details', type: 'tour_details', kind: 'dynamic', optional: false, removable: false },
  { key: 'product_marketing', type: 'product_marketing', kind: 'content', optional: true, removable: true },
  { key: 'why_grafitiyul', type: 'why_us', kind: 'content', optional: true, removable: true },
  { key: 'classification', type: 'classification', kind: 'content', optional: true, removable: true },
  { key: 'pricing', type: 'pricing', kind: 'dynamic', optional: false, removable: false },
  { key: 'payment_terms', type: 'payment_terms', kind: 'dynamic', optional: true, removable: true },
  { key: 'faq', type: 'faq', kind: 'content', optional: true, removable: true },
  { key: 'cancellation', type: 'cancellation', kind: 'content', optional: true, removable: true },
  { key: 'participant_policy', type: 'participant_policy', kind: 'content', optional: true, removable: true },
  { key: 'signature', type: 'signature', kind: 'dynamic', optional: true, removable: true },
];
