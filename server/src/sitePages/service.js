import { prisma as realPrisma } from '../db.js';
import { sanitizeDocument } from './sanitize.js';
import { normalizeSlug, documentSummary, emptyDocument } from '../../../shared/sitePage.mjs';

// Test seam. The draft/published invariants below are the whole point of this
// module, and they are decidable without a database — so the tests swap in a
// small in-memory double. Production never calls __useTestDb; nothing outside
// service.test.js imports it.
let prisma = realPrisma;
export function __useTestDb(fake) {
  prisma = fake || realPrisma;
}

// THE write path for "דפי אתר". Every mutation goes through here so the three
// invariants hold everywhere:
//
//   1. A draft edit NEVER changes what the public sees. The public reads
//      publishedVersion.content; saveDraft only ever touches SitePage.draft.
//   2. A published version is IMMUTABLE. Publishing inserts a new row; it never
//      updates an old one. Rollback re-points publishedVersionId at an existing
//      row — it does not copy content backwards.
//   3. Everything stored has been sanitized. sanitizeDocument runs on save AND
//      on publish, so a row written before a rule was tightened cannot leak.

const LOCALES = ['he', 'en'];
const cleanLocale = (v, fallback = 'he') => (LOCALES.includes(v) ? v : fallback);

const listSelect = {
  id: true,
  internalName: true,
  pageType: true,
  slug: true,
  defaultLanguage: true,
  status: true,
  publishedAt: true,
  draftDirty: true,
  updatedAt: true,
  updatedByName: true,
  publishedVersionId: true,
};

export async function listPages() {
  const rows = await prisma.sitePage.findMany({
    select: { ...listSelect, draft: true, _count: { select: { versions: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(({ draft, _count, ...r }) => ({
    ...r,
    versionCount: _count.versions,
    summary: documentSummary(draft),
  }));
}

export async function getPage(id) {
  const page = await prisma.sitePage.findUnique({
    where: { id },
    include: {
      versions: {
        select: { id: true, versionNo: true, publishedAt: true, publishedByName: true, note: true },
        orderBy: { versionNo: 'desc' },
      },
    },
  });
  if (!page) return null;
  return page;
}

export async function createPage({ internalName, pageType, slug, defaultLanguage, actor }) {
  const name = String(internalName || '').trim();
  if (!name) throw badRequest('internalName_required');
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) throw badRequest('slug_required');
  const clash = await prisma.sitePage.findUnique({ where: { slug: cleanSlug } });
  if (clash) throw badRequest('slug_taken');

  const draft = sanitizeDocument({ ...emptyDocument(), titleHe: name });
  return prisma.sitePage.create({
    data: {
      internalName: name,
      pageType: String(pageType || 'info'),
      slug: cleanSlug,
      defaultLanguage: cleanLocale(defaultLanguage),
      draft,
      status: 'draft',
      draftDirty: true,
      updatedById: actor?.id || null,
      updatedByName: actor?.name || null,
    },
  });
}

/**
 * Save the working copy. Deliberately does NOT touch publishedVersionId, so the
 * live page is byte-identical before and after — that is regression test #3.
 */
export async function saveDraft(id, { document, internalName, pageType, slug, defaultLanguage, actor }) {
  const page = await prisma.sitePage.findUnique({ where: { id } });
  if (!page) return null;

  const data = {
    draft: sanitizeDocument(document),
    draftDirty: true,
    updatedById: actor?.id || null,
    updatedByName: actor?.name || null,
  };
  if (internalName !== undefined) {
    const n = String(internalName).trim();
    if (!n) throw badRequest('internalName_required');
    data.internalName = n;
  }
  if (pageType !== undefined) data.pageType = String(pageType);
  if (defaultLanguage !== undefined) data.defaultLanguage = cleanLocale(defaultLanguage, page.defaultLanguage || 'he');
  if (slug !== undefined) {
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) throw badRequest('slug_required');
    if (cleanSlug !== page.slug) {
      const clash = await prisma.sitePage.findUnique({ where: { slug: cleanSlug } });
      if (clash) throw badRequest('slug_taken');
      data.slug = cleanSlug;
    }
  }
  return prisma.sitePage.update({ where: { id }, data });
}

/**
 * Freeze the current draft as a new immutable version and point the page at it.
 *
 * Idempotent by content: publishing twice with no edit in between returns the
 * SAME version instead of minting a duplicate. That matters because "publish"
 * is a button a nervous operator will press twice, and because a duplicate
 * version would invalidate the WordPress cache for no reason.
 */
export async function publishPage(id, { note, actor } = {}) {
  const page = await prisma.sitePage.findUnique({
    where: { id },
    include: { publishedVersion: true },
  });
  if (!page) return null;

  const content = sanitizeDocument(page.draft);

  if (page.publishedVersion && stableEqual(page.publishedVersion.content, content)) {
    // Nothing actually changed — clear the dirty flag and return what is live.
    if (page.draftDirty) {
      await prisma.sitePage.update({ where: { id }, data: { draftDirty: false } });
    }
    return { page: await getPage(id), version: page.publishedVersion, created: false };
  }

  const last = await prisma.sitePageVersion.findFirst({
    where: { pageId: id },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });
  const versionNo = (last?.versionNo || 0) + 1;

  const version = await prisma.sitePageVersion.create({
    data: {
      pageId: id,
      versionNo,
      content,
      note: note ? String(note).slice(0, 500) : null,
      publishedById: actor?.id || null,
      publishedByName: actor?.name || null,
    },
  });

  await prisma.sitePage.update({
    where: { id },
    data: {
      publishedVersionId: version.id,
      publishedAt: version.publishedAt,
      status: 'published',
      draftDirty: false,
    },
  });

  return { page: await getPage(id), version, created: true };
}

/**
 * Roll the live page back to an earlier version. The old version is re-pointed
 * at, never rewritten, and the draft is left alone so an operator does not lose
 * work in progress by rolling back.
 */
export async function rollbackPage(id, versionId, { actor } = {}) {
  const version = await prisma.sitePageVersion.findUnique({ where: { id: versionId } });
  if (!version || version.pageId !== id) throw badRequest('version_not_found');

  await prisma.sitePage.update({
    where: { id },
    data: {
      publishedVersionId: version.id,
      publishedAt: new Date(),
      status: 'published',
      updatedById: actor?.id || null,
      updatedByName: actor?.name || null,
    },
  });
  return getPage(id);
}

/** Take the page off the public website without deleting anything. */
export async function unpublishPage(id) {
  const page = await prisma.sitePage.findUnique({ where: { id } });
  if (!page) return null;
  return prisma.sitePage.update({
    where: { id },
    data: { status: 'draft', publishedVersionId: null, publishedAt: null, draftDirty: true },
  });
}

export async function deletePage(id) {
  // publishedVersionId FK is ON DELETE SET NULL, so clear the pointer first,
  // then the cascade removes the version rows with the page.
  await prisma.sitePage.update({ where: { id }, data: { publishedVersionId: null } });
  await prisma.sitePage.delete({ where: { id } });
}

/**
 * THE public read. Returns the frozen published content for a slug, or null.
 * A draft-only page is indistinguishable from a missing one here — that is
 * regression test #1, and the reason the public router has no other entry point.
 */
export async function getPublishedBySlug(slug) {
  const page = await prisma.sitePage.findUnique({
    where: { slug: normalizeSlug(slug) },
    include: { publishedVersion: true },
  });
  if (!page || page.status !== 'published' || !page.publishedVersion) return null;
  return {
    slug: page.slug,
    pageType: page.pageType,
    defaultLanguage: cleanLocale(page.defaultLanguage),
    versionId: page.publishedVersion.id,
    versionNo: page.publishedVersion.versionNo,
    publishedAt: page.publishedVersion.publishedAt,
    content: page.publishedVersion.content,
  };
}

export async function getVersion(id, versionId) {
  const v = await prisma.sitePageVersion.findUnique({ where: { id: versionId } });
  return v && v.pageId === id ? v : null;
}

// Order-insensitive deep compare, so key ordering from JSON round-trips never
// makes an unchanged document look changed.
function stableEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(',')}}`;
}

function badRequest(code) {
  const err = new Error(code);
  err.status = 400;
  err.code = code;
  return err;
}
