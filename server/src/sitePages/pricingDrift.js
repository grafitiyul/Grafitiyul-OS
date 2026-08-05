import { prisma as realPrisma } from '../db.js';
import { normalizeDocument } from '../../../shared/sitePage.mjs';
import { describeStructure } from '../pricing/pricingDisplay.js';

// Drift detection for pricing sections ("דפי אתר").
//
// A pricing row may REFERENCE the canonical Pricing Card it was authored from
// (cardGroupId, optionally variantId). The published page always shows the
// FROZEN amounts inside the SitePageVersion — this module never changes them.
// What it does is tell the EDITOR when the live Pricing Card no longer matches
// the draft's frozen lines, so republishing with fresh numbers is a deliberate
// operator act instead of a silent live dependency.
//
// Pure comparison over data the caller can inject — tests pass a fake db.

/** describeStructure row → the pricing-line shape the page document stores. */
function structureToLines(structure) {
  const lines = [];
  for (const r of structure.rows) {
    if (r.type === 'tier_up_to') lines.push({ kind: 'tier', upto: r.threshold ?? null, amountMinor: r.unitAmountMinor });
    else if (r.type === 'extra_participant') lines.push({ kind: 'extra', upto: null, amountMinor: r.unitAmountMinor });
    else if (r.type === 'fixed_price') lines.push({ kind: 'fixed', upto: null, amountMinor: r.unitAmountMinor });
    else if (r.type === 'per_participant') {
      lines.push({ kind: 'custom', upto: null, amountMinor: r.unitAmountMinor, labelHe: 'למשתתף', labelEn: 'Per participant' });
    } else if (r.type === 'ticket') {
      lines.push({ kind: 'custom', upto: null, amountMinor: r.unitAmountMinor, labelHe: r.labelHe || 'כרטיס', labelEn: '' });
    }
  }
  return lines;
}

/** Canonical comparison key. Custom lines are editorial — never compared. */
const comparable = (lines) =>
  lines
    .filter((l) => l.kind !== 'custom' && l.amountMinor != null)
    .map((l) => `${l.kind}:${l.upto ?? ''}:${l.amountMinor}`)
    .sort()
    .join('|');

/**
 * Compare every referenced pricing row in `document` against the live Pricing
 * Cards. Returns { rows: [{ sectionId, rowId, status, live? }] } where status is
 * 'match' | 'drift' | 'missing_card'. Unreferenced rows (editorial prices) are
 * not reported — they have nothing to drift from.
 */
export async function computePricingDrift(document, db = realPrisma) {
  const doc = normalizeDocument(document);
  const refs = [];
  for (const section of doc.sections) {
    if (section.type !== 'pricing') continue;
    for (const row of section.rows) {
      if (row.cardGroupId) refs.push({ sectionId: section.id, row });
    }
  }
  if (!refs.length) return { rows: [] };

  const cardGroupIds = [...new Set(refs.map((r) => r.row.cardGroupId))];
  const rules = await db.priceRule.findMany({
    where: { cardGroupId: { in: cardGroupIds } },
    include: { tiers: true, ticketPrices: true, priceList: true },
  });

  const byGroup = new Map();
  for (const rule of rules) {
    if (!byGroup.has(rule.cardGroupId)) byGroup.set(rule.cardGroupId, []);
    byGroup.get(rule.cardGroupId).push(rule);
  }

  const out = [];
  for (const { sectionId, row } of refs) {
    const siblings = (byGroup.get(row.cardGroupId) || []).filter((r) => r.active);
    // A card's amounts are replace-synced across its sibling rules (one per
    // location); prefer the exact variant when the row pinned one.
    const rule = siblings.find((r) => r.productVariantId === row.variantId) || siblings[0] || null;
    if (!rule) {
      out.push({ sectionId, rowId: row.id, status: 'missing_card' });
      continue;
    }
    const liveLines = structureToLines(describeStructure(rule));
    const vatMode = rule.vatMode || rule.priceList?.defaultVatMode || 'included';
    const status = comparable(liveLines) === comparable(row.lines) ? 'match' : 'drift';
    out.push({ sectionId, rowId: row.id, status, live: { lines: liveLines, vatMode } });
  }
  return { rows: out };
}
