// Product-level PUBLIC selector reconciliation. A variation going private is not
// enough on its own: the Variable Product still DECLARES the occurrence's date
// (and time/activity/age/duration) in its attribute options, so the storefront
// keeps offering it. This module derives each GOS-managed attribute's option
// list from the ACTUAL published variation set and keeps the global date/time
// taxonomy terms chronologically ordered (the storefront sorts every attribute
// by term menu_order — with none set it falls back to lexicographic name order,
// which mis-sorts dd/mm/yyyy dates across months).
//
// Rules:
//   * an option is REMOVED when no published variation on the product uses it
//     (cancelled/replaced/expired occurrences disappear from the selector);
//   * an option is KEPT while at least one published variation uses it (a date
//     shared by a still-valid occurrence survives a sibling's cancellation);
//   * options are never ADDED here (the sync path attaches new occurrence terms
//     via ensureOccurrenceTerms) — a store-curated exclusion stays excluded;
//   * an option that cannot be attributed to any term/variation is KEPT (never
//     drop what we cannot explain);
//   * global taxonomy terms are never deleted; date/time terms get a stable
//     chronological menu_order (yyyymmdd / hhmm) so every product sharing the
//     taxonomy lists occurrences in real date/time order;
//   * only products with an active GOS mapping and only the attributes the
//     mapping configs manage are touched — unrelated products/attributes stay
//     untouched, and non-GOS published variations keep their options alive.

// "15/07/2026", "15-07-2026" → 20260715 (a stable, monotonic menu_order that
// never needs reindexing when dates are added). Null when unparsable.
export function dateMenuOrder(value) {
  const m = String(value == null ? '' : value)
    .trim()
    .match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return Number(`${y}${mo}${d}`);
}

// "18:00" / "1800" / "07:30" → 1800 / 1800 / 730. Null when unparsable.
export function timeMenuOrder(value) {
  const s = String(value == null ? '' : value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 100 + mi;
}

// WooCommerce percent-encodes Hebrew term slugs; variations carry the DECODED
// slug as their option value. Normalise both sides before comparing.
export function decodeSlug(slug) {
  const s = String(slug == null ? '' : slug);
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// The GOS-managed attributes of a product — the union of attribute ids that the
// product's active mapping configs control, tagged with the ordering kind.
export function managedAttrsFromConfigs(configs) {
  const byId = new Map();
  for (const cfg of configs || []) {
    if (!cfg) continue;
    const nodes = [
      [cfg.date, 'date'],
      [cfg.time, 'time'],
      [cfg.activity, 'other'],
      [cfg.age, 'other'],
      [cfg.duration, 'other'],
    ];
    for (const [node, kind] of nodes) {
      if (node?.attrId != null && !byId.has(node.attrId)) byId.set(node.attrId, { attrId: node.attrId, kind });
    }
  }
  return [...byId.values()];
}

// The option slugs each attribute actually uses across PUBLISHED variations.
function usedSlugsByAttr(variations) {
  const used = new Map(); // attrId → Set of option values (decoded-slug form)
  for (const v of variations || []) {
    if (v.status !== 'publish') continue;
    for (const a of v.attributes || []) {
      if (a.id == null || !a.option) continue;
      if (!used.has(a.id)) used.set(a.id, new Set());
      used.get(a.id).add(String(a.option));
    }
  }
  return used;
}

// PURE: next option list for one managed attribute. Product options carry term
// NAMES; variations carry term SLUGS — terms bridge the two.
//   options: current product option names
//   terms:   the attribute's taxonomy terms [{ name, slug }]
//   used:    Set of option slugs used by published variations
//   kind:    'date' | 'time' | 'other' (drives chronological sorting)
export function deriveAttributeOptions({ options, terms, used, kind }) {
  const bySlug = new Map();
  const byName = new Map();
  for (const t of terms || []) {
    bySlug.set(decodeSlug(t.slug), t);
    byName.set(String(t.name), t);
  }
  const isUsed = (optionName) => {
    const term = byName.get(String(optionName));
    if (term) return used.has(decodeSlug(term.slug)) || used.has(String(term.name));
    // No term found for this option — keep only if a published variation uses the
    // exact value; otherwise it is unattributable and we KEEP it (never drop what
    // we cannot explain).
    return used.has(String(optionName)) ? true : null;
  };

  const kept = [];
  const removed = [];
  for (const o of options || []) {
    const u = isUsed(o);
    if (u === false) removed.push(o);
    else kept.push(o);
  }

  if (kind === 'date' || kind === 'time') {
    const orderOf = (name) => {
      const term = byName.get(String(name));
      const parsed =
        kind === 'date'
          ? (dateMenuOrder(name) ?? (term ? dateMenuOrder(decodeSlug(term.slug)) : null))
          : (timeMenuOrder(name) ?? (term ? timeMenuOrder(decodeSlug(term.slug)) : null));
      return parsed;
    };
    // Chronological sort by PARSED value (never lexicographic on dd/mm strings);
    // unparsable options sink to the end keeping their relative order.
    kept.sort((a, b) => {
      const oa = orderOf(a);
      const ob = orderOf(b);
      if (oa == null && ob == null) return 0;
      if (oa == null) return 1;
      if (ob == null) return -1;
      return oa - ob;
    });
  }

  return { options: kept, removed };
}

// Reconcile the chronological menu_order of an attribute's date/time terms.
// Idempotent: only mismatched terms are written; unparsable terms are skipped.
export async function reconcileTermOrder(woo, attrId, kind, terms, log = null) {
  let updates = 0;
  for (const t of terms || []) {
    const want =
      kind === 'date'
        ? (dateMenuOrder(t.name) ?? dateMenuOrder(decodeSlug(t.slug)))
        : (timeMenuOrder(t.name) ?? timeMenuOrder(decodeSlug(t.slug)));
    if (want == null || Number(t.menu_order) === want) continue;
    await woo.updateAttributeTerm(attrId, t.id, { menu_order: want });
    updates += 1;
  }
  if (updates) log?.log?.(`[woo-options] attr ${attrId}: chronological menu_order set on ${updates} terms`);
  return updates;
}

// Converge ONE product's public selector: managed attribute options derived from
// the published variation set + chronological date/time term order. deps:
// { db, woo, log }. Returns a summary (also used by the one-time repair job).
export async function reconcileProductOptions(deps, productId) {
  const { db, woo, log } = deps;
  const mappings = await db.wooProductMapping.findMany({
    where: { wooProductId: productId, active: true },
  });
  const managed = managedAttrsFromConfigs(mappings.map((m) => m.config));
  if (!managed.length) return { productId, changed: false, removed: {} };

  const product = await woo.getProduct(productId);
  const attrs = product.attributes || [];
  const variations = await woo.listVariations(productId);
  const used = usedSlugsByAttr(variations);

  const removedByAttr = {};
  let changed = false;
  const nextAttrs = [...attrs];
  for (const m of managed) {
    const idx = nextAttrs.findIndex((a) => a.id === m.attrId);
    if (idx === -1) continue; // product doesn't declare this attribute
    const terms = await woo.listAttributeTerms(m.attrId);
    const { options, removed } = deriveAttributeOptions({
      options: nextAttrs[idx].options || [],
      terms,
      used: used.get(m.attrId) || new Set(),
      kind: m.kind,
    });
    if (m.kind === 'date' || m.kind === 'time') {
      await reconcileTermOrder(woo, m.attrId, m.kind, terms, log);
    }
    const prev = nextAttrs[idx].options || [];
    if (options.length !== prev.length || options.some((o, i) => o !== prev[i])) {
      nextAttrs[idx] = { ...nextAttrs[idx], options };
      changed = true;
    }
    if (removed.length) removedByAttr[m.attrId] = removed;
  }

  if (changed) {
    await woo.updateProduct(productId, { attributes: nextAttrs });
    const removedNote = Object.entries(removedByAttr)
      .map(([id, opts]) => `attr ${id}: -[${opts.join(', ')}]`)
      .join(' ; ');
    log?.log?.(`[woo-options] product ${productId} options reconciled${removedNote ? ' — ' + removedNote : ''}`);
  }
  return { productId, changed, removed: removedByAttr };
}
