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
// Inputs are plain arrays of SharedContent rows so this is trivially testable:
//   linkedRows        — SharedContent rows the variant links (from its join rows)
//   locationDefaults  — SharedContent rows anchored to the variant's location
// For a single-cardinality type the first match wins; callers pass rows already
// scoped to the variant / its location.
export function resolveForVariant({ linkedRows = [], locationDefaults = [] }, type) {
  const active = (r) => r && r.active !== false && r.type === type;

  const linked = linkedRows.find(active);
  if (linked) return { block: linked, via: 'variant' };

  const def = locationDefaults.find((r) => active(r) && r.isLocationDefault);
  if (def) return { block: def, via: 'location_default' };

  return { block: null, via: null };
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

// "Where used" for one SharedContent id. Read-only.
export async function getWhereUsed(client, sharedContentId, lang = 'he') {
  const rows = await client.productVariantSharedContent.findMany({
    where: { sharedContentId },
    include: VARIANT_LINK_INCLUDE,
  });
  return buildWhereUsed(rows, lang);
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

  const locationDefaults = variant.locationId
    ? await client.sharedContent.findMany({
        where: { locationId: variant.locationId, type, active: true, isLocationDefault: true },
      })
    : [];

  return resolveForVariant({ linkedRows, locationDefaults }, type);
}

// ── PURE: per-variant state classification (Slice 3) ─────────────────────────
// The state a variant is in for one content type, driving which actions the UI
// offers. Precedence mirrors resolveForVariant (link → location default → legacy):
//   'shared'     — linked to a block used by >1 variant (edit warns; fork detaches)
//   'standalone' — linked to a block used by exactly this variant
//   'inherited'  — no link; resolves to the location default (meeting_point)
//   'legacy'     — no link/default; only the pre-Slice-2 columns hold content
//   'empty'      — nothing anywhere
export function classifyVariantType({ link, locationDefault, legacyFilled }) {
  if (link) return link.usedByCount > 1 ? 'shared' : 'standalone';
  if (locationDefault) return 'inherited';
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

// Link an existing block to a variant. For single-cardinality types the variant's
// existing link of that type is replaced (one meeting/ending point per variant).
export async function linkVariant(client, sharedContentId, variantId) {
  const sc = await client.sharedContent.findUnique({ where: { id: sharedContentId }, select: { id: true, type: true } });
  if (!sc) throw err('shared_content_not_found');
  await client.$transaction(async (tx) => {
    if (isSingleType(sc.type)) {
      const existing = await tx.productVariantSharedContent.findMany({
        where: { productVariantId: variantId, sharedContent: { type: sc.type } },
        select: { id: true, sharedContentId: true },
      });
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
  await linkVariant(client, clone.id, variantId);
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
    let block = null;
    let usedByCount = 0;
    let linkId = null;
    if (linkRow) {
      block = linkRow.sharedContent;
      linkId = linkRow.id;
      usedByCount = block._count?.variantLinks ?? 0;
    }
    const locationDefault = !linkRow && isMeeting && variant.locationId
      ? await client.sharedContent.findFirst({
          where: { locationId: variant.locationId, type, isLocationDefault: true, active: true },
          include: BLOCK_INCLUDE,
        })
      : null;
    const legacy = isMeeting
      ? { he: variant.meetingPointHe, en: variant.meetingPointEn, imageId: variant.meetingPointImageId }
      : { he: variant.endingPointHe, en: variant.endingPointEn, imageId: null };
    const legacyFilled = filled(legacy.he) || filled(legacy.en) || !!legacy.imageId;

    const state = classifyVariantType({ link: linkRow ? { usedByCount } : null, locationDefault, legacyFilled });
    out[type] = {
      state,
      linkId,
      block: publicBlock(block || locationDefault),
      usedByCount, // explicit links to the linked block (0 for inherited/legacy/empty)
      legacy: legacyFilled ? { he: legacy.he || null, en: legacy.en || null, imageId: legacy.imageId || null } : null,
    };
  }
  return { variantId, locationId: variant.locationId, types: out };
}
