// Shared Content Library — Slice 1 backend foundation.
//
// Two concerns, kept separate the same way composer.js does it:
//   * PURE logic (no DB) — resolution precedence + "where used" shaping. Fully
//     unit-tested without a database.
//   * Thin client-injected loaders — read rows and delegate to the pure logic.
//
// This slice wires NOTHING into runtime (no routes, no composer change). It is the
// tested foundation the next slices build on. Nothing here copies content: every
// consumer references a SharedContent row by id (SSOT).

import { isValidSharedContentType, isSingleType } from './sharedContentTypes.js';

const filled = (v) => typeof v === 'string' && v.trim() !== '';

function err(code, extra = {}) {
  const e = new Error(code);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

// ── PURE: resolution ─────────────────────────────────────────────────────────

// Resolve the SharedContent a variant should use for one `type`, with EXPLICIT,
// documented precedence (no hidden `||` on strings — the whole point of the audit):
//   1. an explicit variant link whose row.type === type     → via: 'variant'
//   2. the location default for that (location, type)        → via: 'location_default'
//   3. nothing                                               → via: null (caller warns)
//
// Inputs are plain data so this is trivially testable:
//   linkedRows      — SharedContent rows the variant links (its override, if any)
//   locationDefault — the Location's default SharedContent for this type (or null)
// A variant link (override) wins; otherwise the Location default; otherwise null
// (the caller falls back to legacy columns / warns).
export function resolveForVariant({ linkedRows = [], locationDefault = null }, type) {
  const active = (r) => r && r.active !== false && r.type === type;

  const linked = linkedRows.find(active);
  if (linked) return { block: linked, via: 'variant' };

  if (active(locationDefault)) return { block: locationDefault, via: 'location_default' };

  return { block: null, via: null };
}

// Which Location column holds the default for a type.
const LOCATION_DEFAULT_FIELD = {
  meeting_point: 'defaultMeetingPointId',
  ending_point: 'defaultEndingPointId',
};

// The Location's default SharedContent block for a type (or null). `withInclude`
// returns the block with image/location/_count for display.
export async function getLocationDefaultBlock(client, locationId, type, withInclude = false) {
  const field = LOCATION_DEFAULT_FIELD[type];
  if (!field || !locationId) return null;
  const loc = await client.location.findUnique({ where: { id: locationId }, select: { [field]: true } });
  const scId = loc?.[field];
  if (!scId) return null;
  const sc = await client.sharedContent.findUnique({
    where: { id: scId },
    ...(withInclude ? { include: BLOCK_INCLUDE } : {}),
  });
  return sc && sc.active !== false ? sc : null;
}

// ── PURE: "where used" ───────────────────────────────────────────────────────

// Shape a "used by X variants" report from raw variant-link rows. This is a SAFETY
// mechanism: before editing shared content the admin must see every impacted
// consumer. Structured as a list of typed consumer groups so future consumers
// (deals, documents, …) slot in without changing the shape.
//
// `linkRows` = ProductVariantSharedContent rows, each including productVariant →
// product + location. `lang` picks the display side of bilingual names.
export function buildWhereUsed(linkRows = [], lang = 'he') {
  const pick = (he, en) => (lang === 'en' ? en || he : he) || null;

  const variants = linkRows
    .map((row) => {
      const v = row.productVariant;
      if (!v) return null;
      return {
        productVariantId: v.id,
        productId: v.productId ?? v.product?.id ?? null,
        productName: pick(v.product?.nameHe, v.product?.nameEn),
        locationId: v.locationId ?? v.location?.id ?? null,
        locationName: pick(v.location?.nameHe, v.location?.nameEn),
        active: v.active !== false,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        String(a.productName || '').localeCompare(String(b.productName || '')) ||
        String(a.locationName || '').localeCompare(String(b.locationName || '')),
    );

  return {
    count: variants.length,
    consumers: [{ kind: 'product_variant', items: variants }],
  };
}

// ── Client-injected loaders (thin; DB shape lives here so callers agree) ──────

const VARIANT_LINK_INCLUDE = {
  productVariant: { include: { product: true, location: true } },
};

// "Where used" for one SharedContent id — categorized (Location Defaults slice):
//   consumers/count       — variants DIRECTLY linked (override)
//   asLocationDefault[]   — locations that use it as their default (per type) +
//                           how many variants INHERIT it there (no own override)
//   inheritedCount        — total inherited variants across those locations
// Read-only.
export async function getWhereUsed(client, sharedContentId, lang = 'he') {
  const rows = await client.productVariantSharedContent.findMany({
    where: { sharedContentId },
    include: VARIANT_LINK_INCLUDE,
  });
  const direct = buildWhereUsed(rows, lang);
  const pick = (he, en) => (lang === 'en' ? en || he : he) || null;

  const locs = await client.location.findMany({
    where: { OR: [{ defaultMeetingPointId: sharedContentId }, { defaultEndingPointId: sharedContentId }] },
    select: { id: true, nameHe: true, nameEn: true, defaultMeetingPointId: true, defaultEndingPointId: true },
  });

  const asLocationDefault = [];
  let inheritedCount = 0;
  for (const l of locs) {
    // A block could (rarely) be a default for both types in one location — record each.
    const typesHere = [];
    if (l.defaultMeetingPointId === sharedContentId) typesHere.push('meeting_point');
    if (l.defaultEndingPointId === sharedContentId) typesHere.push('ending_point');
    for (const type of typesHere) {
      const variantsInLoc = await client.productVariant.findMany({ where: { locationId: l.id }, select: { id: true } });
      const ids = variantsInLoc.map((v) => v.id);
      let inherited = 0;
      if (ids.length) {
        const linked = await client.productVariantSharedContent.findMany({
          where: { productVariantId: { in: ids }, sharedContent: { type } },
          select: { productVariantId: true },
        });
        const linkedSet = new Set(linked.map((x) => x.productVariantId));
        inherited = ids.filter((id) => !linkedSet.has(id)).length;
      }
      inheritedCount += inherited;
      asLocationDefault.push({ locationId: l.id, locationName: pick(l.nameHe, l.nameEn), type, inheritedVariantCount: inherited });
    }
  }

  return { ...direct, asLocationDefault, inheritedCount };
}

// ── Location Defaults management ──────────────────────────────────────────────

// The Location's current defaults (resolved blocks) per type.
export async function getLocationDefaults(client, locationId) {
  const loc = await client.location.findUnique({
    where: { id: locationId },
    select: { id: true, defaultMeetingPointId: true, defaultEndingPointId: true },
  });
  if (!loc) return null;
  const load = (id) => (id ? client.sharedContent.findUnique({ where: { id }, include: BLOCK_INCLUDE }) : null);
  const [mp, ep] = await Promise.all([load(loc.defaultMeetingPointId), load(loc.defaultEndingPointId)]);
  return { locationId, meeting_point: publicBlock(mp), ending_point: publicBlock(ep) };
}

// Set (or clear, sharedContentId=null) the Location default for a type. Choosing
// an existing block is a pure reference — the block is NOT mutated.
export async function setLocationDefault(client, locationId, type, sharedContentId) {
  const field = LOCATION_DEFAULT_FIELD[type];
  if (!field) throw err('invalid_type');
  if (sharedContentId) {
    const sc = await client.sharedContent.findUnique({ where: { id: sharedContentId }, select: { id: true, type: true } });
    if (!sc) throw err('shared_content_not_found');
    if (sc.type !== type) throw err('type_mismatch');
  }
  await client.location.update({ where: { id: locationId }, data: { [field]: sharedContentId || null } });
  return getLocationDefaults(client, locationId);
}

// PURE: from the location's variant links (of one type), the blocks used by ≥2
// variants that are NOT already the current default — the safe consolidation
// candidates ("make this the location default").
export function buildConsolidationSuggestions({ links, currentDefaultId }) {
  const byBlock = new Map();
  for (const l of links) {
    const k = l.sharedContentId;
    if (!byBlock.has(k)) byBlock.set(k, { sharedContentId: k, internalName: l.sharedContent?.internalName || null, variantCount: 0 });
    byBlock.get(k).variantCount += 1;
  }
  return [...byBlock.values()]
    .filter((s) => s.variantCount >= 2 && s.sharedContentId !== currentDefaultId)
    .sort((a, b) => b.variantCount - a.variantCount);
}

export async function getConsolidationSuggestions(client, locationId, type) {
  const field = LOCATION_DEFAULT_FIELD[type];
  if (!field) return { locationId, type, currentDefaultId: null, suggestions: [] };
  const loc = await client.location.findUnique({ where: { id: locationId }, select: { [field]: true } });
  const currentDefaultId = loc?.[field] || null;
  const variantsInLoc = await client.productVariant.findMany({ where: { locationId }, select: { id: true } });
  const ids = variantsInLoc.map((v) => v.id);
  const links = ids.length
    ? await client.productVariantSharedContent.findMany({
        where: { productVariantId: { in: ids }, sharedContent: { type } },
        include: { sharedContent: { select: { id: true, internalName: true } } },
      })
    : [];
  return { locationId, type, currentDefaultId, suggestions: buildConsolidationSuggestions({ links, currentDefaultId }) };
}

// Safe consolidation: make `sharedContentId` the location default for `type`, and
// remove the now-redundant variant overrides in THIS location that point at the
// SAME block. Variants with DIFFERENT content are left untouched. Returns a
// report of exactly what was removed. Non-destructive to content (only links).
export async function consolidateToLocationDefault(client, locationId, type, sharedContentId) {
  const field = LOCATION_DEFAULT_FIELD[type];
  if (!field) throw err('invalid_type');
  const sc = await client.sharedContent.findUnique({ where: { id: sharedContentId }, select: { id: true, type: true } });
  if (!sc) throw err('shared_content_not_found');
  if (sc.type !== type) throw err('type_mismatch');

  const variantsInLoc = await client.productVariant.findMany({ where: { locationId }, select: { id: true } });
  const ids = variantsInLoc.map((v) => v.id);
  const redundant = ids.length
    ? await client.productVariantSharedContent.findMany({
        where: { productVariantId: { in: ids }, sharedContentId },
        include: { productVariant: { include: { product: true, location: true } } },
      })
    : [];

  await client.$transaction(async (tx) => {
    await tx.location.update({ where: { id: locationId }, data: { [field]: sharedContentId } });
    if (redundant.length) {
      await tx.productVariantSharedContent.deleteMany({ where: { id: { in: redundant.map((r) => r.id) } } });
    }
  });

  const removed = redundant.map((r) => ({
    productVariantId: r.productVariant.id,
    productName: r.productVariant.product?.nameHe || null,
    locationName: r.productVariant.location?.nameHe || null,
  }));
  return { locationId, type, sharedContentId, removedCount: removed.length, removed };
}

// Resolve one variant's Shared Content for a given type (variant link → location
// default → null). Read-only; used by the composer in a later slice.
export async function resolveVariantSharedContent(client, variantId, type) {
  if (!isValidSharedContentType(type)) return { block: null, via: null };

  const variant = await client.productVariant.findUnique({
    where: { id: variantId },
    select: { locationId: true },
  });
  if (!variant) return { block: null, via: null };

  const links = await client.productVariantSharedContent.findMany({
    where: { productVariantId: variantId, sharedContent: { type, active: true } },
    include: { sharedContent: true },
  });
  const linkedRows = links.map((l) => l.sharedContent);

  const locationDefault = variant.locationId ? await getLocationDefaultBlock(client, variant.locationId, type) : null;

  return resolveForVariant({ linkedRows, locationDefault }, type);
}

// ── PURE: per-variant state classification ───────────────────────────────────
// The state a variant is in for one content type (Location default = source of
// truth; a variant link = override):
//   'override'   — variant links its own block, different from the location default
//   'redundant'  — variant links the SAME block as the location default (→ offer
//                  "use location default" to drop the pointless override)
//   'inherited'  — no link; uses the location default
//   'legacy'     — no link/default; only the pre-Slice-2 columns hold content
//   'empty'      — nothing anywhere
export function classifyVariantType({ link, linkMatchesDefault, hasLocationDefault, legacyFilled }) {
  if (link) return linkMatchesDefault ? 'redundant' : 'override';
  if (hasLocationDefault) return 'inherited';
  if (legacyFilled) return 'legacy';
  return 'empty';
}

// ── Public block shape (safe subset returned by the API) ─────────────────────
function publicBlock(b) {
  if (!b) return null;
  return {
    id: b.id,
    type: b.type,
    internalName: b.internalName,
    description: b.description ?? null,
    bodyHe: b.bodyHe ?? null,
    bodyEn: b.bodyEn ?? null,
    image: b.image ? { id: b.image.id, url: b.image.url } : null,
    imageId: b.imageId ?? null,
    mapUrl: b.mapUrl ?? null,
    location: b.location ? { id: b.location.id, nameHe: b.location.nameHe, nameEn: b.location.nameEn } : null,
    locationId: b.locationId ?? null,
    isLocationDefault: !!b.isLocationDefault,
    active: b.active !== false,
    usedByCount: b._count?.variantLinks ?? undefined,
    updatedAt: b.updatedAt ?? null,
    updatedById: b.updatedById ?? null,
  };
}

// ── Library CRUD (Slice 4) ───────────────────────────────────────────────────
const BLOCK_INCLUDE = {
  image: true,
  location: { select: { id: true, nameHe: true, nameEn: true } },
  _count: { select: { variantLinks: true } },
};

export async function listSharedContent(client, { type, locationId, active, q } = {}) {
  const where = {};
  if (type) where.type = type;
  if (locationId) where.locationId = locationId;
  if (active === true || active === false) where.active = active;
  if (filled(q)) {
    where.OR = [
      { internalName: { contains: q, mode: 'insensitive' } },
      { bodyHe: { contains: q, mode: 'insensitive' } },
      { bodyEn: { contains: q, mode: 'insensitive' } },
    ];
  }
  const rows = await client.sharedContent.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    include: BLOCK_INCLUDE,
  });
  return rows.map(publicBlock);
}

export async function getSharedContent(client, id) {
  const row = await client.sharedContent.findUnique({ where: { id }, include: BLOCK_INCLUDE });
  return row ? publicBlock(row) : null;
}

function writableFields(body = {}) {
  const data = {};
  const str = (v) => (filled(v) ? String(v).trim() : null);
  if (body.internalName !== undefined) data.internalName = String(body.internalName || '').trim();
  if (body.description !== undefined) data.description = str(body.description);
  if (body.bodyHe !== undefined) data.bodyHe = filled(body.bodyHe) ? body.bodyHe : null;
  if (body.bodyEn !== undefined) data.bodyEn = filled(body.bodyEn) ? body.bodyEn : null;
  if (body.imageId !== undefined) data.imageId = body.imageId || null;
  if (body.mapUrl !== undefined) data.mapUrl = str(body.mapUrl);
  if (body.locationId !== undefined) data.locationId = body.locationId || null;
  if (body.isLocationDefault !== undefined) data.isLocationDefault = !!body.isLocationDefault;
  if (body.active !== undefined) data.active = !!body.active;
  return data;
}

export async function createSharedContent(client, body, actorId = null) {
  const type = String(body?.type || '');
  if (!isValidSharedContentType(type)) throw err('invalid_type');
  const data = writableFields(body);
  if (!filled(data.internalName)) throw err('internalName_required');
  const row = await client.sharedContent.create({
    data: { ...data, type, updatedById: actorId },
    include: BLOCK_INCLUDE,
  });
  return publicBlock(row);
}

export async function updateSharedContent(client, id, body, actorId = null) {
  const data = writableFields(body);
  if (body?.internalName !== undefined && !filled(data.internalName)) throw err('internalName_required');
  const row = await client.sharedContent.update({
    where: { id },
    data: { ...data, updatedById: actorId },
    include: BLOCK_INCLUDE,
  });
  return publicBlock(row);
}

// Guarded delete: a referenced block is never silently deletable (matches the
// Product delete pattern). The FK is Restrict too, but this returns a clean 409.
export async function deleteSharedContent(client, id) {
  const count = await client.productVariantSharedContent.count({ where: { sharedContentId: id } });
  if (count > 0) throw err('has_references', { count });
  await client.sharedContent.delete({ where: { id } });
}

// ── Variant linking / fork / detach (Slice 3) ────────────────────────────────

// PURE: decide what linking should do. 'noop' = already linked to this block;
// 'conflict' = a single-cardinality type already links a DIFFERENT block and the
// caller did not confirm replace (→ never overwrite silently); 'link' otherwise.
export function linkDecision({ single, currentBlockId, targetId, replace }) {
  if (currentBlockId === targetId) return 'noop';
  if (single && currentBlockId && !replace) return 'conflict';
  return 'link';
}

// Link an existing block to a variant. For single-cardinality types the variant
// may hold only one block of that type: linking a DIFFERENT one requires an
// explicit `replace` (else a `type_conflict` is thrown, carrying the current
// block so the UI can confirm). Content is never copied — only a reference row.
export async function linkVariant(client, sharedContentId, variantId, { replace = false } = {}) {
  const sc = await client.sharedContent.findUnique({ where: { id: sharedContentId }, select: { id: true, type: true } });
  if (!sc) throw err('shared_content_not_found');
  const single = isSingleType(sc.type);

  const existing = single
    ? await client.productVariantSharedContent.findMany({
        where: { productVariantId: variantId, sharedContent: { type: sc.type } },
        include: { sharedContent: { select: { id: true, internalName: true } } },
      })
    : [];
  const current = existing.find((e) => e.sharedContentId !== sharedContentId);
  const decision = linkDecision({ single, currentBlockId: current?.sharedContentId || null, targetId: sharedContentId, replace });
  if (decision === 'conflict') {
    throw err('type_conflict', {
      current: { id: current.sharedContent.id, internalName: current.sharedContent.internalName },
    });
  }

  await client.$transaction(async (tx) => {
    if (single) {
      const toRemove = existing.filter((e) => e.sharedContentId !== sharedContentId).map((e) => e.id);
      if (toRemove.length) await tx.productVariantSharedContent.deleteMany({ where: { id: { in: toRemove } } });
    }
    await tx.productVariantSharedContent.upsert({
      where: { productVariantId_sharedContentId: { productVariantId: variantId, sharedContentId } },
      create: { productVariantId: variantId, sharedContentId },
      update: {},
    });
  });
}

// Fork = clone the block into a NEW standalone row and repoint THIS variant's
// link to the clone. Every other linked variant stays on the original. This is
// the ONLY meaning of "change only this variant" — never a silent in-place copy.
export async function forkForVariant(client, sharedContentId, variantId) {
  const src = await client.sharedContent.findUnique({ where: { id: sharedContentId } });
  if (!src) throw err('shared_content_not_found');
  const clone = await client.sharedContent.create({
    data: {
      type: src.type,
      internalName: `${src.internalName} (עותק)`,
      description: src.description,
      bodyHe: src.bodyHe,
      bodyEn: src.bodyEn,
      imageId: src.imageId,
      mapUrl: src.mapUrl,
      locationId: src.locationId,
      isLocationDefault: false,
      active: true,
    },
  });
  // Fork intentionally repoints THIS variant from the original to the clone.
  await linkVariant(client, clone.id, variantId, { replace: true });
  return getSharedContent(client, clone.id);
}

// Promote a variant's LEGACY column content into a Shared Content block + link.
// Old columns are NOT cleared (dual-read now prefers the link; Slice 5 removes them).
export async function convertLegacyToShared(client, variantId, type) {
  if (!isValidSharedContentType(type)) throw err('invalid_type');
  const v = await client.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { select: { nameHe: true } }, location: { select: { nameHe: true } } },
  });
  if (!v) throw err('variant_not_found');
  const isMeeting = type === 'meeting_point';
  const he = isMeeting ? v.meetingPointHe : v.endingPointHe;
  const en = isMeeting ? v.meetingPointEn : v.endingPointEn;
  const imageId = isMeeting ? v.meetingPointImageId : null;
  if (!filled(he) && !filled(en) && !imageId) throw err('no_legacy_content');
  const label = `${v.product?.nameHe || 'מוצר'} / ${v.location?.nameHe || 'מיקום'} — ${isMeeting ? 'נקודת מפגש' : 'נקודת סיום'}`;
  const block = await client.sharedContent.create({
    data: { type, internalName: label, bodyHe: he || null, bodyEn: en || null, imageId, locationId: v.locationId, active: true },
  });
  await linkVariant(client, block.id, variantId);
  return getSharedContent(client, block.id);
}

// Detach: remove the variant's link of a type. The block itself stays in the
// library (it may be used elsewhere / reused later).
export async function detachVariant(client, variantId, type) {
  const links = await client.productVariantSharedContent.findMany({
    where: { productVariantId: variantId, sharedContent: { type } },
    select: { id: true },
  });
  if (links.length) {
    await client.productVariantSharedContent.deleteMany({ where: { id: { in: links.map((l) => l.id) } } });
  }
}

// Full per-variant state for the variant editor: for each relevant type, the
// current state + resolved block + explicit-link usage count + legacy fallback.
export async function getVariantSharedContentState(client, variantId, types = ['meeting_point', 'ending_point']) {
  const variant = await client.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true, locationId: true,
      meetingPointHe: true, meetingPointEn: true, meetingPointImageId: true,
      endingPointHe: true, endingPointEn: true,
    },
  });
  if (!variant) return null;

  const out = {};
  for (const type of types) {
    const isMeeting = type === 'meeting_point';
    const linkRow = await client.productVariantSharedContent.findFirst({
      where: { productVariantId: variantId, sharedContent: { type } },
      include: { sharedContent: { include: BLOCK_INCLUDE } },
    });
    let linkBlock = null;
    let usedByCount = 0;
    let linkId = null;
    if (linkRow) {
      linkBlock = linkRow.sharedContent;
      linkId = linkRow.id;
      usedByCount = linkBlock._count?.variantLinks ?? 0;
    }
    // Location default for this type (source of truth). Always loaded so we can
    // tell inherited vs override vs redundant, and offer "use location default".
    const locDefault = variant.locationId ? await getLocationDefaultBlock(client, variant.locationId, type, true) : null;

    const legacy = isMeeting
      ? { he: variant.meetingPointHe, en: variant.meetingPointEn, imageId: variant.meetingPointImageId }
      : { he: variant.endingPointHe, en: variant.endingPointEn, imageId: null };
    const legacyFilled = filled(legacy.he) || filled(legacy.en) || !!legacy.imageId;

    const linkMatchesDefault = !!(linkRow && locDefault && linkRow.sharedContentId === locDefault.id);
    const state = classifyVariantType({
      link: linkRow ? { usedByCount } : null,
      linkMatchesDefault,
      hasLocationDefault: !!locDefault,
      legacyFilled,
    });
    out[type] = {
      state,
      linkId,
      usedByCount, // explicit links to the linked (override) block
      // Shown block: the override block for override/redundant, else the location default.
      block: publicBlock(linkRow ? linkBlock : locDefault),
      locationDefault: locDefault ? { id: locDefault.id, internalName: locDefault.internalName } : null,
      legacy: legacyFilled ? { he: legacy.he || null, en: legacy.en || null, imageId: legacy.imageId || null } : null,
    };
  }
  return { variantId, locationId: variant.locationId, types: out };
}

// ── Link candidates (Library → "use in additional variants") ─────────────────

// PURE: shape the candidate list for one shared item + type. Each variant reports
// its current status for THAT type so the UI can warn before overwriting:
//   linkedToThis  — already references this exact item (shown as "linked")
//   currentBlockId/Name — a DIFFERENT block it currently uses (→ replace warning)
//   legacyFilled  — still has legacy columns for this type (→ "will now use shared")
export function buildLinkCandidates({ variants, links, sharedContentId, type, lang = 'he' }) {
  const pick = (he, en) => (lang === 'en' ? en || he : he) || null;
  const isMeeting = type === 'meeting_point';
  const isEnding = type === 'ending_point';
  const byVariant = new Map();
  for (const l of links) byVariant.set(l.productVariantId, l);

  return variants
    .map((v) => {
      const l = byVariant.get(v.id);
      const legacyFilled = isMeeting
        ? !!(filled(v.meetingPointHe) || filled(v.meetingPointEn) || v.meetingPointImageId)
        : isEnding
          ? !!(filled(v.endingPointHe) || filled(v.endingPointEn))
          : false;
      const currentBlockId = l?.sharedContentId || null;
      return {
        productVariantId: v.id,
        productId: v.productId ?? v.product?.id ?? null,
        productName: pick(v.product?.nameHe, v.product?.nameEn),
        locationId: v.locationId ?? v.location?.id ?? null,
        locationName: pick(v.location?.nameHe, v.location?.nameEn),
        variantActive: v.active !== false,
        currentBlockId,
        currentBlockName: l?.sharedContent?.internalName || null,
        linkedToThis: currentBlockId === sharedContentId,
        legacyFilled,
      };
    })
    .sort(
      (a, b) =>
        String(a.productName || '').localeCompare(String(b.productName || '')) ||
        String(a.locationName || '').localeCompare(String(b.locationName || '')),
    );
}

// Loader: all variants + their status for this item's type. Read-only.
export async function getLinkCandidates(client, sharedContentId, lang = 'he') {
  const sc = await client.sharedContent.findUnique({ where: { id: sharedContentId }, select: { id: true, type: true } });
  if (!sc) return null;
  const variants = await client.productVariant.findMany({
    include: {
      product: { select: { id: true, nameHe: true, nameEn: true } },
      location: { select: { id: true, nameHe: true, nameEn: true } },
    },
  });
  const links = await client.productVariantSharedContent.findMany({
    where: { sharedContent: { type: sc.type } },
    include: { sharedContent: { select: { id: true, internalName: true } } },
  });
  return { sharedContentId, type: sc.type, variants: buildLinkCandidates({ variants, links, sharedContentId, type: sc.type, lang }) };
}
