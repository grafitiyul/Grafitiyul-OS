// Tour Content service (Phase 1a foundation).
//
// Owns all Prisma access + business rules for the Tour Content domain:
//   Tour → TourStation → ordered TourStep → (reference) → TourContentBlock → TourBlockAsset
//   plus TourStationNote (admin-only annotations).
//
// Media references R2/MediaFile only (never DB binary). Phase 1a stores an
// existing MediaFile id on assets/hero; it does NOT upload (no R2 writes here).
//
// The router is a thin shell; every rule + coded error lives here. Coded errors
// carry a `.code` the router maps to an HTTP status. See
// docs/architecture/phase1-tour-content-domain.md.

// ── Coded errors ──────────────────────────────────────────────────────────────

export function svcError(code, extra = {}) {
  const e = new Error(code);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

// ── Validation constants + pure helpers (unit-tested, no DB) ────────────────────

export const STATION_KINDS = new Set(['location', 'artwork', 'printed_material', 'content_stop']);
export const ASSET_TYPES = new Set(['video', 'image', 'file', 'link']);
export const LANGUAGES = new Set(['he', 'en']);

export function reqStr(v, code) {
  if (typeof v !== 'string' || v.trim() === '') throw svcError(code);
  return v.trim();
}

// Optional string: undefined → leave unset; null/'' → null; else trimmed value.
export function optStr(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v);
}

export function optBool(v) {
  if (v === undefined) return undefined;
  return !!v;
}

// Enforce the asset invariant: exactly one of url / mediaId. Returns the
// normalised { url, mediaId } pair or throws a coded error.
export function normalizeAssetSource({ url, mediaId }) {
  const hasUrl = typeof url === 'string' && url.trim() !== '';
  const hasMedia = typeof mediaId === 'string' && mediaId.trim() !== '';
  if (hasUrl && hasMedia) throw svcError('asset_source_conflict');
  if (!hasUrl && !hasMedia) throw svcError('asset_source_required');
  return hasUrl ? { url: url.trim(), mediaId: null } : { url: null, mediaId: mediaId.trim() };
}

// Given the desired id order and the actual rows for a scope, return the
// [{ id, sortOrder }] updates. Throws if the id set doesn't match exactly
// (prevents partial/cross-scope reorders silently corrupting order).
export function computeReorder(orderIds, existingIds) {
  if (!Array.isArray(orderIds)) throw svcError('invalid_order');
  const wanted = orderIds.map(String);
  const have = [...existingIds].map(String);
  if (wanted.length !== have.length) throw svcError('order_mismatch', { expected: have.length, got: wanted.length });
  const wantedSet = new Set(wanted);
  if (wantedSet.size !== wanted.length) throw svcError('order_duplicate');
  for (const id of have) if (!wantedSet.has(id)) throw svcError('order_mismatch');
  return wanted.map((id, i) => ({ id, sortOrder: i }));
}

function assertKind(kind) {
  if (kind !== undefined && !STATION_KINDS.has(kind)) throw svcError('invalid_kind', { allowed: [...STATION_KINDS] });
}
function assertAssetType(t) {
  if (!ASSET_TYPES.has(t)) throw svcError('invalid_asset_type', { allowed: [...ASSET_TYPES] });
}
function assertLanguage(l) {
  if (l !== undefined && l !== null && !LANGUAGES.has(l)) throw svcError('invalid_language', { allowed: [...LANGUAGES] });
}

// max(sortOrder)+1 for a scoped list; 0 when empty.
async function nextSortOrder(delegate, where) {
  const top = await delegate.findFirst({ where, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  return top ? top.sortOrder + 1 : 0;
}

// ── Tours ───────────────────────────────────────────────────────────────────

export async function listTours(prisma, { active } = {}) {
  return prisma.tour.findMany({
    where: active === undefined ? {} : { active },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createTour(prisma, body) {
  const titleHe = reqStr(body?.titleHe, 'title_required');
  return prisma.tour.create({
    data: {
      titleHe,
      descriptionHe: optStr(body?.descriptionHe) ?? null,
      active: optBool(body?.active) ?? true,
      sortOrder: await nextSortOrder(prisma.tour, {}),
    },
  });
}

export async function getTour(prisma, id) {
  return prisma.tour.findUnique({
    where: { id },
    include: { stations: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function updateTour(prisma, id, body) {
  const data = {};
  if (body?.titleHe !== undefined) data.titleHe = reqStr(body.titleHe, 'title_required');
  if (body?.descriptionHe !== undefined) data.descriptionHe = optStr(body.descriptionHe);
  if (body?.active !== undefined) data.active = optBool(body.active);
  return prisma.tour.update({ where: { id }, data });
}

export async function deleteTour(prisma, id) {
  // Cascade removes stations → steps/notes. Blocks are Restrict-protected but
  // steps (the FK holder) are deletable, so a tour delete never trips Restrict.
  await prisma.tour.delete({ where: { id } });
}

export async function reorderTours(prisma, orderIds) {
  const rows = await prisma.tour.findMany({ select: { id: true } });
  const updates = computeReorder(orderIds, rows.map((r) => r.id));
  await prisma.$transaction(updates.map((u) => prisma.tour.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
  return listTours(prisma, {});
}

// ── Stations ──────────────────────────────────────────────────────────────────

async function assertTour(prisma, tourId) {
  const t = await prisma.tour.findUnique({ where: { id: tourId }, select: { id: true } });
  if (!t) throw svcError('tour_not_found');
}

export async function listStations(prisma, tourId) {
  await assertTour(prisma, tourId);
  return prisma.tourStation.findMany({ where: { tourId }, orderBy: { sortOrder: 'asc' } });
}

export async function createStation(prisma, tourId, body) {
  await assertTour(prisma, tourId);
  const titleHe = reqStr(body?.titleHe, 'title_required');
  assertKind(body?.kind);
  return prisma.tourStation.create({
    data: {
      tourId,
      titleHe,
      descriptionHe: optStr(body?.descriptionHe) ?? null,
      kind: body?.kind ?? 'location',
      heroImageId: optStr(body?.heroImageId) ?? null,
      heroImageTitle: optStr(body?.heroImageTitle) ?? null,
      locationId: optStr(body?.locationId) ?? null,
      active: optBool(body?.active) ?? true,
      sortOrder: await nextSortOrder(prisma.tourStation, { tourId }),
    },
  });
}

export async function getStation(prisma, id) {
  return prisma.tourStation.findUnique({
    where: { id },
    include: {
      tour: { select: { id: true, titleHe: true } },
      heroImage: true,
      steps: {
        orderBy: { sortOrder: 'asc' },
        include: {
          contentBlock: {
            include: {
              // media carries the R2 URL — the read surfaces (editor media
              // section, preview, portal) render image assets from it.
              assets: {
                orderBy: { sortOrder: 'asc' },
                include: { media: { select: { url: true } } },
              },
            },
          },
        },
      },
      notes: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

export async function updateStation(prisma, id, body) {
  const data = {};
  if (body?.titleHe !== undefined) data.titleHe = reqStr(body.titleHe, 'title_required');
  if (body?.descriptionHe !== undefined) data.descriptionHe = optStr(body.descriptionHe);
  if (body?.kind !== undefined) { assertKind(body.kind); data.kind = body.kind; }
  if (body?.heroImageId !== undefined) data.heroImageId = optStr(body.heroImageId);
  if (body?.heroImageTitle !== undefined) data.heroImageTitle = optStr(body.heroImageTitle);
  if (body?.locationId !== undefined) data.locationId = optStr(body.locationId);
  if (body?.active !== undefined) data.active = optBool(body.active);
  return prisma.tourStation.update({ where: { id }, data });
}

export async function deleteStation(prisma, id) {
  await prisma.tourStation.delete({ where: { id } });
}

export async function reorderStations(prisma, tourId, orderIds) {
  await assertTour(prisma, tourId);
  const rows = await prisma.tourStation.findMany({ where: { tourId }, select: { id: true } });
  const updates = computeReorder(orderIds, rows.map((r) => r.id));
  await prisma.$transaction(updates.map((u) => prisma.tourStation.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
  return listStations(prisma, tourId);
}

// ── Content blocks (reusable library) ───────────────────────────────────────────

export async function listBlocks(prisma, { shared, active, q } = {}) {
  const where = {};
  if (shared !== undefined) where.shared = shared;
  if (active !== undefined) where.active = active;
  if (q) where.OR = [{ titleHe: { contains: q, mode: 'insensitive' } }, { bodyHe: { contains: q, mode: 'insensitive' } }];
  return prisma.tourContentBlock.findMany({ where, orderBy: { updatedAt: 'desc' } });
}

export async function createBlock(prisma, body) {
  return prisma.tourContentBlock.create({
    data: {
      titleHe: optStr(body?.titleHe) ?? null,
      bodyHe: typeof body?.bodyHe === 'string' ? body.bodyHe : '',
      internalNote: optStr(body?.internalNote) ?? null,
      shared: optBool(body?.shared) ?? false,
      active: optBool(body?.active) ?? true,
    },
  });
}

export async function getBlock(prisma, id) {
  return prisma.tourContentBlock.findUnique({
    where: { id },
    include: { assets: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function updateBlock(prisma, id, body) {
  const data = {};
  if (body?.titleHe !== undefined) data.titleHe = optStr(body.titleHe);
  if (body?.bodyHe !== undefined) data.bodyHe = typeof body.bodyHe === 'string' ? body.bodyHe : '';
  if (body?.internalNote !== undefined) data.internalNote = optStr(body.internalNote);
  if (body?.shared !== undefined) data.shared = optBool(body.shared);
  if (body?.active !== undefined) data.active = optBool(body.active);
  return prisma.tourContentBlock.update({ where: { id }, data });
}

export async function deleteBlock(prisma, id) {
  // A block still placed in any station must not be deleted (would orphan a step).
  const placements = await prisma.tourStep.count({ where: { contentBlockId: id } });
  if (placements > 0) throw svcError('has_placements', { count: placements });
  await prisma.tourContentBlock.delete({ where: { id } });
}

export async function whereUsed(prisma, id) {
  const steps = await prisma.tourStep.findMany({
    where: { contentBlockId: id },
    include: { station: { select: { id: true, titleHe: true, tourId: true } } },
  });
  return steps.map((s) => ({
    stepId: s.id,
    stationId: s.station.id,
    stationTitleHe: s.station.titleHe,
    tourId: s.station.tourId,
  }));
}

// ── Steps (ordered placement of a block into a station) ─────────────────────────

async function assertStation(prisma, stationId) {
  const s = await prisma.tourStation.findUnique({ where: { id: stationId }, select: { id: true } });
  if (!s) throw svcError('station_not_found');
}

export async function listSteps(prisma, stationId) {
  await assertStation(prisma, stationId);
  return prisma.tourStep.findMany({
    where: { stationId },
    orderBy: { sortOrder: 'asc' },
    include: { contentBlock: true },
  });
}

// Create a step by EITHER linking an existing block (contentBlockId) OR creating
// a one-off inline block (block: {...}, stored shared=false) and placing it.
export async function createStep(prisma, stationId, body) {
  await assertStation(prisma, stationId);
  let contentBlockId = optStr(body?.contentBlockId);

  if (!contentBlockId && body?.block && typeof body.block === 'object') {
    const created = await createBlock(prisma, { ...body.block, shared: body.block.shared ?? false });
    contentBlockId = created.id;
  }
  if (!contentBlockId) throw svcError('block_ref_required');

  const block = await prisma.tourContentBlock.findUnique({ where: { id: contentBlockId }, select: { id: true } });
  if (!block) throw svcError('block_not_found');

  return prisma.tourStep.create({
    data: {
      stationId,
      contentBlockId,
      isVisible: optBool(body?.isVisible) ?? true,
      roleHint: optStr(body?.roleHint) ?? null,
      sortOrder: await nextSortOrder(prisma.tourStep, { stationId }),
    },
    include: { contentBlock: true },
  });
}

export async function updateStep(prisma, id, body) {
  const data = {};
  if (body?.isVisible !== undefined) data.isVisible = optBool(body.isVisible);
  if (body?.roleHint !== undefined) data.roleHint = optStr(body.roleHint);
  return prisma.tourStep.update({ where: { id }, data, include: { contentBlock: true } });
}

export async function deleteStep(prisma, id) {
  await prisma.tourStep.delete({ where: { id } });
}

export async function reorderSteps(prisma, stationId, orderIds) {
  await assertStation(prisma, stationId);
  const rows = await prisma.tourStep.findMany({ where: { stationId }, select: { id: true } });
  const updates = computeReorder(orderIds, rows.map((r) => r.id));
  await prisma.$transaction(updates.map((u) => prisma.tourStep.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
  return listSteps(prisma, stationId);
}

// ── Block assets ────────────────────────────────────────────────────────────────

async function assertBlock(prisma, blockId) {
  const b = await prisma.tourContentBlock.findUnique({ where: { id: blockId }, select: { id: true } });
  if (!b) throw svcError('block_not_found');
}
async function assertMediaExists(prisma, mediaId) {
  if (!mediaId) return;
  const m = await prisma.mediaFile.findUnique({ where: { id: mediaId }, select: { id: true } });
  if (!m) throw svcError('media_not_found');
}

export async function listAssets(prisma, blockId) {
  await assertBlock(prisma, blockId);
  return prisma.tourBlockAsset.findMany({ where: { contentBlockId: blockId }, orderBy: { sortOrder: 'asc' } });
}

export async function createAsset(prisma, blockId, body) {
  await assertBlock(prisma, blockId);
  const titleHe = reqStr(body?.titleHe, 'title_required');
  const assetType = reqStr(body?.assetType, 'invalid_asset_type');
  assertAssetType(assetType);
  const language = body?.language === undefined ? undefined : optStr(body.language);
  assertLanguage(language);
  const { url, mediaId } = normalizeAssetSource({ url: body?.url, mediaId: body?.mediaId });
  await assertMediaExists(prisma, mediaId);
  return prisma.tourBlockAsset.create({
    data: {
      contentBlockId: blockId,
      titleHe,
      assetType,
      language: language ?? null,
      url,
      mediaId,
      active: optBool(body?.active) ?? true,
      sortOrder: await nextSortOrder(prisma.tourBlockAsset, { contentBlockId: blockId }),
    },
  });
}

export async function updateAsset(prisma, id, body) {
  const current = await prisma.tourBlockAsset.findUnique({ where: { id } });
  if (!current) throw svcError('asset_not_found');
  const data = {};
  if (body?.titleHe !== undefined) data.titleHe = reqStr(body.titleHe, 'title_required');
  if (body?.assetType !== undefined) { assertAssetType(body.assetType); data.assetType = body.assetType; }
  if (body?.language !== undefined) { const l = optStr(body.language); assertLanguage(l); data.language = l; }
  if (body?.active !== undefined) data.active = optBool(body.active);
  // Re-validate the url/mediaId invariant against the resulting state.
  if (body?.url !== undefined || body?.mediaId !== undefined) {
    const nextUrl = body?.url !== undefined ? body.url : current.url;
    const nextMedia = body?.mediaId !== undefined ? body.mediaId : current.mediaId;
    const norm = normalizeAssetSource({ url: nextUrl, mediaId: nextMedia });
    await assertMediaExists(prisma, norm.mediaId);
    data.url = norm.url;
    data.mediaId = norm.mediaId;
  }
  return prisma.tourBlockAsset.update({ where: { id }, data });
}

export async function deleteAsset(prisma, id) {
  await prisma.tourBlockAsset.delete({ where: { id } });
}

export async function reorderAssets(prisma, blockId, orderIds) {
  await assertBlock(prisma, blockId);
  const rows = await prisma.tourBlockAsset.findMany({ where: { contentBlockId: blockId }, select: { id: true } });
  const updates = computeReorder(orderIds, rows.map((r) => r.id));
  await prisma.$transaction(updates.map((u) => prisma.tourBlockAsset.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
  return listAssets(prisma, blockId);
}

// ── Station notes (admin-only) ──────────────────────────────────────────────────

export async function listNotes(prisma, stationId) {
  await assertStation(prisma, stationId);
  return prisma.tourStationNote.findMany({ where: { stationId }, orderBy: { sortOrder: 'asc' } });
}

export async function createNote(prisma, stationId, body) {
  await assertStation(prisma, stationId);
  return prisma.tourStationNote.create({
    data: {
      stationId,
      contentHe: typeof body?.contentHe === 'string' ? body.contentHe : '',
      sortOrder: await nextSortOrder(prisma.tourStationNote, { stationId }),
    },
  });
}

export async function updateNote(prisma, id, body) {
  const data = {};
  if (body?.contentHe !== undefined) data.contentHe = typeof body.contentHe === 'string' ? body.contentHe : '';
  return prisma.tourStationNote.update({ where: { id }, data });
}

export async function deleteNote(prisma, id) {
  await prisma.tourStationNote.delete({ where: { id } });
}

export async function reorderNotes(prisma, stationId, orderIds) {
  await assertStation(prisma, stationId);
  const rows = await prisma.tourStationNote.findMany({ where: { stationId }, select: { id: true } });
  const updates = computeReorder(orderIds, rows.map((r) => r.id));
  await prisma.$transaction(updates.map((u) => prisma.tourStationNote.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
  return listNotes(prisma, stationId);
}
