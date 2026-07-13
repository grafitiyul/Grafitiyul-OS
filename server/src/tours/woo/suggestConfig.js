// Auto-build a WooProductMapping.config for a card + live product — so the admin
// never hand-writes ids or option strings. It resolves:
//   * attribute ids by matching the product's attribute NAMES (date/time/age/
//     activity), so nothing is hardcoded to a specific product;
//   * the EXACT option encoding the store already uses, read from the product's
//     existing variations (age as the term name, activity as the readable-dash
//     form, etc.) — never a guessed slug;
//   * this card's activity value, inferred from the card title (workshop vs
//     tour-only) and overridable;
//   * ticketAge keyed by the REAL GOS ticketTypeId → the age option, matched by
//     the ticket type's own label. Unmatched tickets are reported, never dropped.

import { cardTicketRows } from './mapping.js';

// A readable, url-safe form that matches how this store slugifies attribute
// values in its variations: runs of non-alphanumeric/non-Hebrew → single dash.
//   "סיור + סדנה" → "סיור-סדנה" ; "מבוגר" → "מבוגר" ; "08/08/2026" → "08-08-2026"
export function readableSlug(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .trim()
    .replace(/[^0-9a-z֐-׿]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Which of a product's attributes plays each role — by NAME (works across the
// per-city products, none of which are hardcoded here).
function matchAttr(attributes, patterns) {
  return (attributes || []).find((a) => patterns.some((re) => re.test(String(a.name || '')))) || null;
}

// The distinct option strings a given attribute actually uses across existing
// variations → { readableSlug(option): option }. This is the store's real
// encoding, captured rather than guessed.
function usedOptions(variations, attrId) {
  const map = new Map();
  for (const v of variations || []) {
    for (const a of v.attributes || []) {
      if (a.id === attrId && a.option) map.set(readableSlug(a.option), a.option);
    }
  }
  return map;
}

// Build the config. deps: { db, woo }. args: { cardGroupId, productId, cardTitle,
// activity }. `activity` ('workshop'|'tour') overrides the title inference.
export async function suggestWooConfig(deps, { cardGroupId, productId, cardTitle = '', activity = null }) {
  const { db, woo } = deps;
  const warnings = [];
  const ticketRows = await cardTicketRows(db, cardGroupId);
  if (!ticketRows.length) warnings.push('card has no ticket-type pricing (no sellable rows)');

  const product = await woo.getProduct(productId);
  const attributes = product.attributes || [];
  const variations = await woo.listVariations(productId);

  const dateAttr = matchAttr(attributes, [/תאריך/, /date/i]);
  const timeAttr = matchAttr(attributes, [/שעה/, /time|hour/i]);
  const ageAttr = matchAttr(attributes, [/גיל/, /age/i]);
  const activityAttr = matchAttr(attributes, [/פעילות/, /activ/i]);
  if (!dateAttr) warnings.push('no date attribute matched (תאריך/date)');

  const config = { taxonomyMode: 'global' };
  if (dateAttr) config.date = { attrId: dateAttr.id, attrName: dateAttr.name, format: 'slash-dmy' };
  if (timeAttr) config.time = { attrId: timeAttr.id, attrName: timeAttr.name };

  // Activity: pick this card's value. Classify the used options by whether they
  // read as "workshop" (contain סדנה/workshop); fall back to terms if variations
  // don't cover both.
  let availableActivities = [];
  if (activityAttr) {
    let actOpts = [...usedOptions(variations, activityAttr.id).values()];
    if (!actOpts.length) {
      const terms = await woo.listAttributeTerms(activityAttr.id).catch(() => []);
      actOpts = terms.map((t) => readableSlug(t.name));
    }
    availableActivities = actOpts;
    const isWs = (o) => /סדנ|workshop|\+/.test(o);
    const wsOpt = actOpts.find(isWs) || null;
    const tourOpt = actOpts.find((o) => o !== wsOpt) || null;
    const wantWorkshop = activity ? activity === 'workshop' : /סדנ|workshop|\+/.test(cardTitle);
    const chosen = wantWorkshop ? wsOpt : tourOpt;
    if (chosen) {
      config.activity = { attrId: activityAttr.id, attrName: activityAttr.name, option: chosen, label: chosen };
    } else {
      warnings.push('could not determine this card’s activity option');
    }
  }

  // Age split: map each REAL ticketTypeId → the age option whose label matches
  // the ticket type's own label.
  const ticketAge = {};
  if (ageAttr) {
    config.age = { attrId: ageAttr.id, attrName: ageAttr.name };
    let ageUsed = usedOptions(variations, ageAttr.id);
    if (!ageUsed.size) {
      const terms = await woo.listAttributeTerms(ageAttr.id).catch(() => []);
      for (const t of terms) ageUsed.set(readableSlug(t.name), t.name);
    }
    for (const row of ticketRows) {
      const opt = ageUsed.get(readableSlug(row.label));
      if (opt) ticketAge[row.ticketTypeId] = { option: opt, label: row.label };
      else warnings.push(`ticket type "${row.label}" (${row.ticketTypeId}) has no matching ${ageAttr.name} term`);
    }
  }
  if (ageAttr) config.ticketAge = ticketAge;

  return {
    config,
    ticketRows: ticketRows.map((r) => ({ ticketTypeId: r.ticketTypeId, label: r.label, unitPriceMinor: r.unitPriceMinor })),
    matched: {
      date: dateAttr ? { id: dateAttr.id, name: dateAttr.name } : null,
      time: timeAttr ? { id: timeAttr.id, name: timeAttr.name } : null,
      age: ageAttr ? { id: ageAttr.id, name: ageAttr.name } : null,
      activity: activityAttr ? { id: activityAttr.id, name: activityAttr.name } : null,
    },
    availableActivities,
    warnings,
  };
}
