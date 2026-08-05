// One-time import of the recovered "המלצות למסעדות שוות" page into the "דפי אתר"
// module, as its FIRST record.
//
// This is an IMPORT, not an implementation: after it runs, the page lives in the
// database and every word of it is editable from GOS. Nothing here is a runtime
// dependency of the page — deleting this script would not change what renders.
//
// Idempotent. Re-running it:
//   • re-uses R2 objects that already exist (keys are content-stable),
//   • updates the DRAFT of the existing page rather than creating a second one,
//   • never republishes on its own unless --publish is passed.
//
// Usage:
//   node server/scripts/importSitePageRestaurants.mjs [--publish] [--dry]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { newId } from '../../shared/sitePage.mjs';

// Running this against production from a workstation means reaching Postgres over
// its PUBLIC host, while `railway run` injects the INTERNAL one. Set DATABASE_URL
// before db.js is evaluated, then load everything that touches it dynamically —
// so the script and the service share ONE Prisma client rather than opening a
// second connection with different settings.
if (process.env.GOS_DB_URL) process.env.DATABASE_URL = process.env.GOS_DB_URL;

const r2 = await import('../src/r2.js');
const { prisma } = await import('../src/db.js');
const { sanitizeDocument } = await import('../src/sitePages/sanitize.js');
const { publishPage } = await import('../src/sitePages/service.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECOVERED = JSON.parse(readFileSync(path.join(HERE, 'data/restaurant-recommendations.recovered.json'), 'utf8'));

const SLUG = 'restaurant-recommendations';
const CANONICAL = 'https://grafitiyul.co.il/restaurant-recommendations/';
const APPLY_PUBLISH = process.argv.includes('--publish');
const DRY = process.argv.includes('--dry');

// The legacy uploads folder died with the legacy site, so every original image
// 404s today. They are recovered from the Internet Archive and re-hosted on OUR
// R2 bucket, which is what makes the published URLs stable (brief part 6).
const WAYBACK = (url) => `https://web.archive.org/web/2026id_/${encodeURI(url)}`;

// Verified 404 on a reachable server on 2026-08-05. Every other link is kept
// exactly as recovered; unreachable-from-CI hosts are reported, never deleted.
const DEAD_LINKS = new Set(['https://www.burger-il.com/business/vitrina/']);

const imageCache = new Map();

async function migrateImage(originalUrl) {
  if (!originalUrl) return '';
  if (imageCache.has(originalUrl)) return imageCache.get(originalUrl);

  const ext = (originalUrl.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase();
  // Content-stable key: the same source URL always maps to the same object, so
  // re-running the import overwrites in place instead of littering the bucket.
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

  // The Internet Archive rate-limits and occasionally refuses a connection. A
  // transient failure must not abort a 32-image import that is otherwise fine,
  // and must not silently drop the picture either — so retry with a backoff and
  // only give up (visibly) after several attempts.
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

async function buildDocument() {
  const sections = [];

  sections.push({
    id: newId('sec'),
    type: 'hero',
    hidden: false,
    titleHe: RECOVERED.titleHe,
    titleEn: '',
    subtitleHe: '',
    subtitleEn: '',
    image: '',
  });

  for (const sec of RECOVERED.sections) {
    if (sec.type === 'cards') {
      console.log(`  section: ${sec.heading} (${sec.cards.length} cards)`);
      const cards = [];
      for (const c of sec.cards) {
        const image = await migrateImage(c.image);
        const website = c.website && !DEAD_LINKS.has(c.website) ? c.website : '';
        if (c.website && !website) console.log(`    ! dropped dead link on "${c.name}": ${c.website}`);
        cards.push({
          id: newId('card'),
          hidden: false,
          name: c.name || '',
          descriptionHe: '',
          descriptionEn: '',
          category: '',
          address: c.address || '',
          phone: c.phone || '',
          hours: c.hours || '',
          kosher: c.kosher || '',
          notes: c.notes || '',
          website,
          mapUrl: '',
          image,
        });
      }
      sections.push({
        id: newId('sec'),
        type: 'cards',
        hidden: false,
        headingHe: sec.heading,
        headingEn: '',
        noteHe: sec.note || '',
        noteEn: '',
        cards,
      });
    } else if (sec.type === 'richText') {
      console.log(`  section: ${sec.heading} (rich text)`);
      sections.push({
        id: newId('sec'),
        type: 'richText',
        hidden: false,
        headingHe: sec.heading,
        headingEn: '',
        htmlHe: sec.html,
        htmlEn: '',
      });
    } else if (sec.type === 'faq') {
      console.log(`  section: ${sec.heading} (${sec.items.length} Q&A)`);
      sections.push({
        id: newId('sec'),
        type: 'faq',
        hidden: false,
        headingHe: sec.heading,
        headingEn: '',
        items: sec.items.map((i) => ({
          id: newId('faq'),
          hidden: false,
          questionHe: i.q,
          questionEn: '',
          answerHe: `<p>${i.a}</p>`,
          answerEn: '',
        })),
      });
    }
  }

  return sanitizeDocument({
    titleHe: RECOVERED.titleHe,
    titleEn: '',
    sections,
    seo: {
      // Exactly the <title> the archived page served.
      titleHe: 'המלצות למסעדות שוות - גרפיטיול',
      titleEn: '',
      // The original had NO <meta name="description"> (Yoast fell back to an
      // auto-excerpt ending in "[…]"). This one is written from the page's own
      // content — flagged as RECONSTRUCTED in the content report, not recovered.
      descriptionHe:
        'המלצות של גרפיטיול למסעדות, בתי קפה, ברים ופיצריות באזור נקודת המפגש בפלורנטין ודרום תל אביב — כולל כתובות, שעות פעילות, כשרות, חניונים ומקומות לפיקניק.',
      descriptionEn: '',
      canonicalUrl: CANONICAL,
      noindex: false,
      ogTitleHe: 'המלצות למסעדות שוות - גרפיטיול',
      ogTitleEn: '',
      ogDescriptionHe: '',
      ogDescriptionEn: '',
      // The original og:image, re-hosted below.
      ogImage: await migrateImage('https://grafitiyul.co.il/wp-content/uploads/2022/01/Screenshot_5-1024x601.jpg'),
    },
  });
}

async function main() {
  console.log(`R2 configured: ${r2.isConfigured()}${DRY ? '  [DRY RUN]' : ''}`);
  if (!r2.isConfigured() && !DRY) throw new Error('R2 is not configured — images cannot be re-hosted');

  console.log('\nBuilding document from recovered content…');
  const draft = await buildDocument();

  const cards = draft.sections.filter((s) => s.cards).flatMap((s) => s.cards);
  console.log(`\nDocument: ${draft.sections.length} sections, ${cards.length} cards`);
  console.log(`  cards with an image  : ${cards.filter((c) => c.image).length}`);
  console.log(`  cards with a website : ${cards.filter((c) => c.website).length}`);

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
        internalName: 'המלצות למסעדות',
        pageType: 'recommendations',
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
      note: 'ייבוא ראשוני מהאתר הקודם (שוחזר מארכיון האינטרנט)',
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
