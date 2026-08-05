// One-time import of the recovered agents price list ("מחירון סוכנים") into the
// "דפי אתר" module — the SECOND record on the same generic engine.
//
// Recovered from the legacy pages /pricingagent/ (HE) + /en/pricingagent-en/
// (EN) via the Internet Archive. This is an IMPORT, not an implementation: after
// it runs, the page lives in the database and every word of it is editable from
// GOS. Nothing here is a runtime dependency of the page.
//
// Pricing provenance (the part that matters commercially):
//   • Rows that reference a canonical Pricing Card (cardGroupId) get their
//     amounts resolved LIVE from the agents-segment card at import time —
//     current GOS is the commercial authority, never the stale archive copy.
//   • Rows with explicit `lines` are agent-only prices the archive carried and
//     GOS does not model yet; they are frozen editorial values, flagged in the
//     import log and in the delivery report.
//
// Idempotent: re-uses R2 objects (content-stable keys), updates the DRAFT of an
// existing page, never republishes unless --publish is passed.
//
// Usage:
//   node server/scripts/importSitePageAgentPricing.mjs [--publish] [--dry]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { newId } from '../../shared/sitePage.mjs';

// Public-host DB URL support — same pattern as importSitePageRestaurants.mjs:
// set DATABASE_URL before db.js is evaluated, then import dynamically so the
// script and the service share ONE Prisma client.
if (process.env.GOS_DB_URL) process.env.DATABASE_URL = process.env.GOS_DB_URL;

const r2 = await import('../src/r2.js');
const { prisma } = await import('../src/db.js');
const { sanitizeDocument } = await import('../src/sitePages/sanitize.js');
const { publishPage } = await import('../src/sitePages/service.js');
const { describeStructure } = await import('../src/pricing/pricingDisplay.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECOVERED = JSON.parse(readFileSync(path.join(HERE, 'data/agent-price-list.recovered.json'), 'utf8'));

const SLUG = 'agent-price-list';
const CANONICAL = 'https://grafitiyul.co.il/agent-price-list/';
const APPLY_PUBLISH = process.argv.includes('--publish');
const DRY = process.argv.includes('--dry');

const WAYBACK = (url) => `https://web.archive.org/web/2026id_/${encodeURI(url)}`;

const imageCache = new Map();

async function migrateImage(originalUrl) {
  if (!originalUrl) return '';
  if (imageCache.has(originalUrl)) return imageCache.get(originalUrl);

  const ext = (originalUrl.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase();
  const hash = createHash('sha1').update(originalUrl).digest('hex').slice(0, 16);
  const key = `site-pages/${SLUG}/${hash}.${ext}`;
  const url = r2.publicUrl(key);

  if (DRY) { imageCache.set(originalUrl, url); return url; }

  const existing = await r2.headObject(key).catch(() => null);
  if (existing) {
    console.log(`    = already on R2: ${key}`);
    imageCache.set(originalUrl, url);
    return url;
  }

  let res = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      res = await fetch(WAYBACK(originalUrl), { signal: AbortSignal.timeout(60000) });
      if (res.ok) break;
      lastErr = `HTTP ${res.status}`;
      res = null;
    } catch (e) {
      lastErr = String(e.cause?.code || e.message || e);
      res = null;
    }
    if (attempt < 4) {
      const wait = attempt * 4000;
      console.log(`    … archive retry ${attempt}/3 in ${wait / 1000}s (${lastErr})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!res) {
    console.log(`    ! archive unavailable after retries (${lastErr}) — ${originalUrl}`);
    imageCache.set(originalUrl, '');
    return '';
  }

  const body = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (body.length < 500) {
    console.log(`    ! suspiciously small (${body.length}B), skipping ${originalUrl}`);
    imageCache.set(originalUrl, '');
    return '';
  }
  await r2.putObject({ key, body, contentType: type });
  console.log(`    + uploaded ${key} (${(body.length / 1024).toFixed(0)} KB)`);
  imageCache.set(originalUrl, url);
  return url;
}

/** describeStructure rows → the page document's pricing-line shape. */
function structureToLines(structure) {
  const lines = [];
  for (const r of structure.rows) {
    if (r.type === 'tier_up_to') lines.push({ kind: 'tier', upto: r.threshold ?? null, amountMinor: r.unitAmountMinor });
    else if (r.type === 'extra_participant') lines.push({ kind: 'extra', upto: null, amountMinor: r.unitAmountMinor });
    else if (r.type === 'fixed_price') lines.push({ kind: 'fixed', upto: null, amountMinor: r.unitAmountMinor });
  }
  return lines;
}

/** Resolve a referenced row's lines from the LIVE canonical Pricing Card. */
async function resolveCardLines(row) {
  const rules = await prisma.priceRule.findMany({
    where: { cardGroupId: row.cardGroupId, active: true },
    include: { tiers: true, ticketPrices: true },
  });
  const rule = rules.find((r) => r.productVariantId === row.variantId) || rules[0] || null;
  if (!rule) {
    console.log(`    ! Pricing Card NOT FOUND for "${row.titleHe}" (${row.cardGroupId}) — using recovered fallback values`);
    return { lines: row.fallbackLines || [], live: false };
  }
  const lines = structureToLines(describeStructure(rule));
  if (!lines.length) {
    console.log(`    ! Pricing Card for "${row.titleHe}" produced no structural lines — using recovered fallback values`);
    return { lines: row.fallbackLines || [], live: false };
  }
  return { lines, live: true };
}

async function buildDocument() {
  const sections = [];
  const D = RECOVERED;

  sections.push({
    id: newId('sec'),
    type: 'hero',
    hidden: false,
    titleHe: D.hero.titleHe,
    titleEn: D.hero.titleEn,
    subtitleHe: D.hero.subtitleHe,
    subtitleEn: D.hero.subtitleEn,
    image: await migrateImage(D.hero.image),
  });

  for (const sec of D.pricingSections) {
    console.log(`  pricing section: ${sec.headingHe} (${sec.rows.length} rows)`);
    const rows = [];
    for (const row of sec.rows) {
      let lines;
      if (row.cardGroupId) {
        const resolved = await resolveCardLines(row);
        lines = resolved.lines;
        console.log(`    ${resolved.live ? '⇄ live card' : '□ fallback'}: ${row.titleHe}`);
      } else {
        lines = row.lines || [];
        console.log(`    □ editorial (no agents card): ${row.titleHe}`);
      }
      rows.push({
        id: newId('pr'),
        hidden: false,
        titleHe: row.titleHe,
        titleEn: row.titleEn,
        metaHe: row.metaHe || '',
        metaEn: row.metaEn || '',
        notesHe: row.notesHe || '',
        notesEn: row.notesEn || '',
        lines: lines.map((l) => ({ id: newId('pl'), kind: l.kind, upto: l.upto ?? null, amountMinor: l.amountMinor ?? null, labelHe: l.labelHe || '', labelEn: l.labelEn || '' })),
        variantId: row.variantId || '',
        cardGroupId: row.cardGroupId || '',
      });
    }
    sections.push({
      id: newId('sec'),
      type: 'pricing',
      hidden: false,
      headingHe: sec.headingHe,
      headingEn: sec.headingEn,
      noteHe: sec.noteHe || '',
      noteEn: sec.noteEn || '',
      rows,
    });
  }

  for (const key of ['kosherStory', 'generalNotes', 'groupSize']) {
    const t = D[key];
    sections.push({
      id: newId('sec'),
      type: 'richText',
      hidden: false,
      headingHe: t.headingHe,
      headingEn: t.headingEn,
      htmlHe: t.htmlHe,
      htmlEn: t.htmlEn,
    });
  }

  sections.push({
    id: newId('sec'),
    type: 'image',
    hidden: false,
    image: await migrateImage(D.galleryImage.image),
    altHe: D.galleryImage.altHe,
    altEn: D.galleryImage.altEn,
    captionHe: D.galleryImage.captionHe,
    captionEn: D.galleryImage.captionEn,
  });

  sections.push({
    id: newId('sec'),
    type: 'cta',
    hidden: false,
    headingHe: D.cta.headingHe,
    headingEn: D.cta.headingEn,
    bodyHe: D.cta.bodyHe,
    bodyEn: D.cta.bodyEn,
    buttonLabelHe: D.cta.buttonLabelHe,
    buttonLabelEn: D.cta.buttonLabelEn,
    buttonUrl: D.cta.buttonUrl,
  });

  const heroImage = imageCache.get(D.hero.image) || '';
  return sanitizeDocument({
    titleHe: D.titleHe,
    titleEn: D.titleEn,
    sections,
    seo: {
      titleHe: D.seo.titleHe,
      titleEn: D.seo.titleEn,
      descriptionHe: D.seo.descriptionHe,
      descriptionEn: D.seo.descriptionEn,
      canonicalUrl: CANONICAL,
      // The HE legacy page was deliberately noindex,nofollow + sitemap-excluded
      // — a sales asset shared as a direct link. That stays the access model.
      noindex: D.seo.noindex === true,
      ogTitleHe: D.seo.titleHe,
      ogTitleEn: D.seo.titleEn,
      ogDescriptionHe: D.seo.descriptionHe,
      ogDescriptionEn: D.seo.descriptionEn,
      ogImage: heroImage,
    },
  });
}

async function main() {
  console.log(`R2 configured: ${r2.isConfigured()}${DRY ? '  [DRY RUN]' : ''}`);
  if (!r2.isConfigured() && !DRY) throw new Error('R2 is not configured — images cannot be re-hosted');

  console.log('\nBuilding document (live card amounts + recovered content)…');
  const draft = await buildDocument();

  const rows = draft.sections.filter((s) => s.rows).flatMap((s) => s.rows);
  console.log(`\nDocument: ${draft.sections.length} sections, ${rows.length} pricing rows`);
  console.log(`  rows linked to a Pricing Card : ${rows.filter((r) => r.cardGroupId).length}`);
  console.log(`  editorial rows (no card yet)  : ${rows.filter((r) => !r.cardGroupId).length}`);

  if (DRY) { console.log('\n[DRY RUN] nothing written'); return; }

  const existing = await prisma.sitePage.findUnique({ where: { slug: SLUG } });
  let page;
  if (existing) {
    page = await prisma.sitePage.update({
      where: { id: existing.id },
      data: { draft, draftDirty: true, updatedByName: 'ייבוא מהאתר הישן' },
    });
    console.log(`\nUpdated the DRAFT of the existing page (${page.id}) — live version untouched.`);
  } else {
    page = await prisma.sitePage.create({
      data: {
        internalName: 'מחירון סוכנים',
        pageType: 'price_list',
        slug: SLUG,
        draft,
        status: 'draft',
        draftDirty: true,
        updatedByName: 'ייבוא מהאתר הישן',
      },
    });
    console.log(`\nCreated page ${page.id} (slug: ${page.slug})`);
  }

  if (APPLY_PUBLISH) {
    const result = await publishPage(page.id, {
      note: 'ייבוא ראשוני: תוכן מהעמוד הישן, מחירים מכרטיסי התמחור הקנוניים',
      actor: { id: null, name: 'ייבוא מהאתר הישן' },
    });
    console.log(`Published: version #${result.version.versionNo} (created=${result.created})`);
  } else {
    console.log('Not published (pass --publish to publish).');
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
