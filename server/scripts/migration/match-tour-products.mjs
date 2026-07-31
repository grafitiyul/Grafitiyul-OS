// Resolve product / variant / location for legacy-imported tours — the canonical
// duration + title source (owner item 4).
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/match-tour-products.mjs [--execute]
//
// CONFIDENCE RULES (no guessing):
//   * product: the legacy tour name, after stripping its trailing same-date
//     token, must EXACTLY equal Product.nameHe (whitespace-normalised);
//   * variant: the product's single variant, OR the unique variant whose
//     Location.nameHe matches the master's `מיקום טקסט` (normalised containment,
//     unique hit required);
//   * anything less → NO write; a visible Control issue carries the context.
//
// Writes are FILL-NULL-ONLY on TourEvent (productId, productVariantId,
// locationId) and matched tours are re-pended so the calendar reconciler
// re-derives duration and title from the same canonical config as native tours.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { stripTrailingSameDate } from '../../src/tours/calendar/desiredState.js';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Master fields (מיקום טקסט lives only in the raw snapshot rows).
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: 'snap-20260730T081731Z-44cb' });
const man = await reader.entityManifest('airtable/main/tblTI7iaGm6qsQA4a');
const masterFields = new Map();
for (const s of man.shards || []) {
  for (const r of await reader.readShard(s.key)) masterFields.set(r.id, r.fields || {});
  reader._shardCache.clear();
}

const products = await prisma.product.findMany({
  select: { id: true, nameHe: true, variants: { select: { id: true, locationId: true, durationHours: true, location: { select: { id: true, nameHe: true } } } } },
});
const productByName = new Map(products.map((p) => [norm(p.nameHe), p]));

const tours = await prisma.$queryRawUnsafe(`
  SELECT t.id, t.notes, t.date, t."startTime", t."gcalSyncStatus", lr."sourceId"
  FROM "TourEvent" t
  JOIN "LegacyRecord" lr ON lr."entityId"=t.id AND lr."sourceSystem"='airtable' AND lr."sourceType"='tour'
  WHERE t.status='scheduled' AND t.date::date >= CURRENT_DATE AND t."productId" IS NULL`);
console.log(`candidate tours (future, imported, product-less): ${tours.length}`);

let matched = 0; let unmatched = 0; const issues = [];
for (const t of tours) {
  const rawName = String(t.notes || '').trim().split('\n')[0];
  const name = norm(stripTrailingSameDate(rawName, t.date));
  const product = productByName.get(name) || null;
  const f = masterFields.get(t.sourceId) || {};
  const locText = norm(Array.isArray(f['מיקום טקסט']) ? f['מיקום טקסט'][0] : f['מיקום טקסט']);

  let variant = null;
  let why = null;
  if (!product) {
    why = `שם הפעילות "${name}" אינו תואם אף מוצר`;
  } else if (product.variants.length === 1) {
    variant = product.variants[0];
  } else if (locText) {
    const hits = product.variants.filter((v) => norm(v.location?.nameHe).includes(locText) || locText.includes(norm(v.location?.nameHe)));
    if (hits.length === 1) variant = hits[0];
    else why = `מיקום "${locText}" תואם ${hits.length} וריאנטים של "${product.nameHe}"`;
  } else {
    why = `למוצר "${product.nameHe}" ${product.variants.length} וריאנטים ואין מיקום במקור`;
  }

  if (variant) {
    matched += 1;
    console.log(`  ✓ ${t.sourceId} "${name}" → ${product.nameHe} @ ${variant.location?.nameHe} (${variant.durationHours ?? '?'}h)${EXECUTE ? '' : '  [dry]'}`);
    if (EXECUTE) {
      await prisma.tourEvent.update({
        where: { id: t.id },
        data: {
          productId: product.id,
          productVariantId: variant.id,
          locationId: variant.locationId,
          // Re-derive duration + title through the reconciler.
          ...(t.gcalSyncStatus === 'synced' ? { gcalSyncStatus: 'pending', gcalAttempts: 0, gcalNextRetryAt: null } : {}),
        },
      });
    }
  } else {
    unmatched += 1;
    issues.push({ tourId: t.id, sourceId: t.sourceId, name, locText: locText || null, why });
  }
}

console.log(`\nmatched (confident): ${matched} · unmatched: ${unmatched}`);
if (EXECUTE && issues.length) {
  for (const i of issues) {
    const dedupeKey = `legacy_tour_product_unmatched:${i.tourId}`;
    const existing = await prisma.operationalIssue.findFirst({ where: { dedupeKey, status: { in: ['open', 'acknowledged'] } } });
    if (existing) continue;
    await prisma.operationalIssue.create({
      data: {
        type: 'legacy_tour_product_unmatched',
        severity: 'info',
        sourceModule: 'mirror',
        dedupeKey,
        title: `סיור מיובא ללא מוצר מזוהה — ${i.name || i.sourceId}`,
        explanation: `${i.why}. משך האירוע ביומן נשאר ברירת מחדל (שעתיים) עד שישויך מוצר. שיוך ידני של מוצר/וריאנט לסיור יתקן את המשך והכותרת אוטומטית.`,
        entityRefs: [{ type: 'tour_event', id: i.tourId }],
        data: { sourceRecId: i.sourceId, legacyName: i.name, legacyLocationText: i.locText },
        status: 'open',
      },
    });
  }
  console.log(`Control issues created for the unmatched: ${issues.length}`);
} else {
  for (const i of issues.slice(0, 12)) console.log(`  ✗ ${i.sourceId} "${i.name}" loc="${i.locText ?? '—'}" — ${i.why}`);
}
if (!EXECUTE) console.log('\n--dry: nothing written.');
await prisma.$disconnect();
