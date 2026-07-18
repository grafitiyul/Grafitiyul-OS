// Pricing Card → builder-line note application. Pure, no Prisma/IO.
//
// Contract (card first-line note):
//   * Automatic calculation REBUILDS card-produced lines from the CURRENT
//     canonical Pricing Card data: the card's `firstLineNote` lands on the FIRST
//     output line produced by that card (output order), every OTHER line produced
//     by the same card gets an empty note, and lines with no card provenance
//     (manual/addon/discount lines) are never touched.
//   * "First line" is per CARD, not per quote — with several cards in one result
//     each card's note goes only to the first line of its own card.
//   * A blank template (including empty rich-text markup) means NO automatic note.

// Rich-text emptiness — the server-side twin of the client's isRichEmpty (strip
// tags + &nbsp; + whitespace). Used so blank markup is never stored or applied.
export function richTextIsEmpty(html) {
  if (!html) return true;
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}

// Normalize a template for storage: blank rich text → null.
export function normalizeFirstLineNote(html) {
  return richTextIsEmpty(html) ? null : String(html);
}

// Apply canonical card notes onto composed builder lines (already in output
// order). `noteByCard` is a Map of cardGroupId → firstLineNote (null = none).
// Returns new line objects for card-produced lines; others pass through as-is.
export function applyCardFirstLineNotes(lines, noteByCard) {
  const seen = new Set();
  return (lines || []).map((ln) => {
    const cardGroupId = ln?.sourceCardGroupId;
    if (!cardGroupId) return ln;
    const first = !seen.has(cardGroupId);
    seen.add(cardGroupId);
    const template = first ? noteByCard?.get(cardGroupId) : null;
    return { ...ln, note: richTextIsEmpty(template) ? '' : String(template) };
  });
}
