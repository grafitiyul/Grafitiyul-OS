// ETL: import recruitment tour content → GOS (Tour Content domain).
//
// SAFETY / CONTRACT:
//   • Recruitment is READ-ONLY (session set to read only; only SELECTs).
//   • GOS writes are ADDITIVE + IDEMPOTENT (keyed by sourceRef / r2Key), so a
//     re-run creates nothing new and never duplicates.
//   • Hero images (BYTEA) upload to R2 with DETERMINISTIC keys
//     (tour-content/hero/station-<id>.jpg) → MediaFile. No DB blobs.
//   • Recruitment data is never modified or deleted.
//
// MAPPING (see docs/architecture/phase1-tour-content-domain.md):
//   tours                 → Tour                     sourceRef tour:<id>
//   stations              → TourStation (+hero→R2)   sourceRef station:<id>
//   station_part_variants → TourContentBlock + Step  sourceRef variant:<id>
//     titleHe = variant.title || part.display_name; roleHint = part.internal_key
//     step order = (part.order_index, variant.order_index)
//   station_assets (all station-level) → a per-station media block placed as the
//     final step; assets kept as external url (none are recruitment-hosted).
//     sourceRef asset:<id>; media block sourceRef station-media:<station_id>
//   station_notes         → TourStationNote (idempotent by stationId+sortOrder)
//   station_part_definitions, station_flow_items → NOT migrated as tables
//     (roles become roleHint; flow_items are all default-visible → no effect).
//
// CONFIG (env): RECRUITMENT_DATABASE_URL, GOS_DATABASE_URL (fallback DATABASE_URL),
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   R2_PUBLIC_BASE_URL. Flags: --dry-run (no writes/uploads), --report <path>.

import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// `pg` is not a GOS dependency (GOS uses Prisma); this ETL reads the recruitment
// Postgres, which does use pg. Load it from a configurable path (default: the
// sibling recruitment repo) without adding a GOS dependency.
const require = createRequire(import.meta.url);
const PG_PATH = process.env.RECRUITMENT_PG_PATH
  || 'C:/Projects/grafitiyul-recruitment/server/node_modules/pg';
let pg;
try { pg = require('pg'); } catch { pg = require(PG_PATH); }

const DRY = process.argv.includes('--dry-run');
const reportPath = (() => {
  const i = process.argv.indexOf('--report');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const RECRUIT_URL = process.env.RECRUITMENT_DATABASE_URL;
const GOS_URL = process.env.GOS_DATABASE_URL || process.env.DATABASE_URL;
if (!RECRUIT_URL) { console.error('Missing RECRUITMENT_DATABASE_URL'); process.exit(1); }
if (!GOS_URL) { console.error('Missing GOS_DATABASE_URL'); process.exit(1); }

const R2 = {
  account: process.env.R2_ACCOUNT_ID,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  base: process.env.R2_PUBLIC_BASE_URL,
};
const r2Configured = !!(R2.account && R2.key && R2.secret && R2.bucket && R2.base);
const r2 = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2.account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2.key, secretAccessKey: R2.secret },
    })
  : null;
const r2PublicUrl = (k) => `${String(R2.base).replace(/\/+$/, '')}/${k}`;

const report = {
  dryRun: DRY,
  counts: {
    tours: { created: 0, updated: 0 },
    stations: { created: 0, updated: 0 },
    blocks: { created: 0, updated: 0 },
    steps: { created: 0, updated: 0 },
    mediaBlocks: { created: 0, updated: 0 },
    assets: { created: 0, updated: 0 },
    notes: { created: 0, updated: 0 },
  },
  hero: { total: 0, uploaded: 0, reused: 0, failed: 0 },
  flagged: [], // suspicious/broken media, surfaced not dropped
};
const bump = (k, kind) => { report.counts[k][kind]++; };

async function main() {
  let rc;
  try {
    rc = new pg.Client({ connectionString: RECRUIT_URL, ssl: { rejectUnauthorized: false } });
    await rc.connect();
  } catch {
    rc = new pg.Client({ connectionString: RECRUIT_URL, ssl: false });
    await rc.connect();
  }
  await rc.query('SET default_transaction_read_only = on');

  const prisma = new PrismaClient({ datasources: { db: { url: GOS_URL } } });

  console.log(`[etl] mode=${DRY ? 'DRY-RUN (no writes)' : 'LIVE'}  r2=${r2Configured ? 'configured' : 'MISSING'}`);
  if (!DRY && !r2Configured) throw new Error('R2 not configured — refusing to import hero images in LIVE mode');

  const rows = async (sql, params) => (await rc.query(sql, params)).rows;

  // Part definitions → order + role lookup.
  const parts = await rows('SELECT id, internal_key, order_index FROM station_part_definitions');
  const partById = new Map(parts.map((p) => [p.id, p]));

  // ── Tours ─────────────────────────────────────────────────────────────────
  const tours = await rows('SELECT id, name, description, is_active, COALESCE(order_index,0) order_index FROM tours ORDER BY order_index, id');
  const gosTourIdByRef = new Map();
  for (const t of tours) {
    const sourceRef = `tour:${t.id}`;
    const data = { titleHe: t.name, descriptionHe: t.description ?? null, active: !!t.is_active, sortOrder: t.order_index };
    if (DRY) { gosTourIdByRef.set(sourceRef, `dry:${sourceRef}`); bump('tours', 'created'); continue; }
    const existing = await prisma.tour.findUnique({ where: { sourceRef } });
    const row = await prisma.tour.upsert({ where: { sourceRef }, create: { sourceRef, ...data }, update: data });
    gosTourIdByRef.set(sourceRef, row.id);
    bump('tours', existing ? 'updated' : 'created');
  }

  // ── Stations (+ hero) ────────────────────────────────────────────────────
  const stations = await rows(
    `SELECT id, tour_id, name, description, COALESCE(order_index,0) order_index, is_active,
            hero_image_title, hero_image_mime, (hero_image_data IS NOT NULL) has_hero
     FROM stations ORDER BY tour_id, order_index, id`);
  const gosStationIdByRef = new Map();
  for (const s of stations) {
    const sourceRef = `station:${s.id}`;
    const tourId = gosTourIdByRef.get(`tour:${s.tour_id}`);
    if (!tourId) { report.flagged.push({ kind: 'orphan_station', stationId: s.id, note: 'no parent tour' }); continue; }

    let heroImageId = null;
    if (s.has_hero) {
      report.hero.total++;
      heroImageId = await ensureHero(prisma, rc, s);
    }

    const data = {
      titleHe: s.name, descriptionHe: s.description ?? null, kind: 'location',
      active: !!s.is_active, sortOrder: s.order_index,
      heroImageTitle: s.hero_image_title ?? null,
      ...(heroImageId ? { heroImageId } : {}),
    };
    if (DRY) { gosStationIdByRef.set(sourceRef, `dry:${sourceRef}`); bump('stations', 'created'); continue; }
    const existing = await prisma.tourStation.findUnique({ where: { sourceRef } });
    const row = await prisma.tourStation.upsert({
      where: { sourceRef }, create: { sourceRef, tourId, ...data }, update: data,
    });
    gosStationIdByRef.set(sourceRef, row.id);
    bump('stations', existing ? 'updated' : 'created');
  }

  // ── Variants → ContentBlock + Step ──────────────────────────────────────────
  const variants = await rows(
    `SELECT id, station_id, part_definition_id, title, body, notes,
            COALESCE(order_index,0) order_index, is_active
     FROM station_part_variants`);
  // Sort per station by (part order, variant order) → step sortOrder.
  const byStation = new Map();
  for (const v of variants) {
    if (!byStation.has(v.station_id)) byStation.set(v.station_id, []);
    byStation.get(v.station_id).push(v);
  }
  const gosBlockIdByRef = new Map();
  const stepCountByStationRef = new Map(); // for placing the media block last

  for (const [stationId, list] of byStation) {
    list.sort((a, b) => {
      const pa = partById.get(a.part_definition_id)?.order_index ?? 99;
      const pb = partById.get(b.part_definition_id)?.order_index ?? 99;
      return pa - pb || a.order_index - b.order_index || a.id - b.id;
    });
    const stationRef = `station:${stationId}`;
    const gosStationId = gosStationIdByRef.get(stationRef);
    let order = 0;
    for (const v of list) {
      const part = partById.get(v.part_definition_id);
      const blockRef = `variant:${v.id}`;
      const titleHe = (v.title && v.title.trim()) || part?.internal_key || null;
      // display fallback: prefer the human part label when the variant has no title
      const blockData = {
        titleHe: (v.title && v.title.trim()) ? v.title.trim() : (part ? partLabelFallback(part) : titleHe),
        bodyHe: v.body ?? '', internalNote: v.notes ?? null, shared: false, active: !!v.is_active,
      };
      let gosBlockId = `dry:${blockRef}`;
      if (!DRY) {
        const existing = await prisma.tourContentBlock.findUnique({ where: { sourceRef: blockRef } });
        const b = await prisma.tourContentBlock.upsert({ where: { sourceRef: blockRef }, create: { sourceRef: blockRef, ...blockData }, update: blockData });
        gosBlockId = b.id;
        bump('blocks', existing ? 'updated' : 'created');
      } else bump('blocks', 'created');
      gosBlockIdByRef.set(blockRef, gosBlockId);

      await upsertStep(prisma, gosStationId, gosBlockId, order, part?.internal_key ?? null);
      order++;
    }
    stepCountByStationRef.set(stationRef, order);
  }

  // ── Assets (all station-level) → per-station media block placed last ────────
  const assets = await rows(
    `SELECT id, station_id, asset_type, language, title, url, COALESCE(order_index,0) order_index, is_active
     FROM station_assets ORDER BY station_id, order_index, id`);
  const mediaBlockIdByStation = new Map();
  for (const a of assets) {
    const stationRef = `station:${a.station_id}`;
    const gosStationId = gosStationIdByRef.get(stationRef);
    if (!gosStationId) { report.flagged.push({ kind: 'orphan_asset', assetId: a.id, note: 'no parent station' }); continue; }

    // Flag suspicious URLs (surfaced, NOT dropped — still imported).
    const url = a.url ?? '';
    if (!/^https?:\/\//i.test(url)) {
      report.flagged.push({ kind: 'suspicious_asset_url', assetId: a.id, stationId: a.station_id, url });
    }

    // Ensure the station's media block exists (created lazily, placed as last step).
    let blockId = mediaBlockIdByStation.get(a.station_id);
    if (!blockId) {
      const mbRef = `station-media:${a.station_id}`;
      const mbData = { titleHe: 'סרטונים ומדיה', bodyHe: '', shared: false, active: true };
      if (DRY) { blockId = `dry:${mbRef}`; bump('mediaBlocks', 'created'); }
      else {
        const existing = await prisma.tourContentBlock.findUnique({ where: { sourceRef: mbRef } });
        const mb = await prisma.tourContentBlock.upsert({ where: { sourceRef: mbRef }, create: { sourceRef: mbRef, ...mbData }, update: mbData });
        blockId = mb.id;
        bump('mediaBlocks', existing ? 'updated' : 'created');
      }
      mediaBlockIdByStation.set(a.station_id, blockId);
      const lastOrder = stepCountByStationRef.get(stationRef) ?? 0;
      await upsertStep(prisma, gosStationId, blockId, lastOrder, 'media');
      stepCountByStationRef.set(stationRef, lastOrder + 1);
    }

    const assetRef = `asset:${a.id}`;
    const assetData = {
      assetType: a.asset_type, language: a.language ?? null, titleHe: a.title ?? '(ללא כותרת)',
      url: url || null, mediaId: null, sortOrder: a.order_index, active: !!a.is_active,
    };
    if (DRY) { bump('assets', 'created'); continue; }
    const existing = await prisma.tourBlockAsset.findUnique({ where: { sourceRef: assetRef } });
    await prisma.tourBlockAsset.upsert({
      where: { sourceRef: assetRef }, create: { sourceRef: assetRef, contentBlockId: blockId, ...assetData }, update: assetData,
    });
    bump('assets', existing ? 'updated' : 'created');
  }

  // ── Notes (idempotent by stationId + sortOrder) ─────────────────────────────
  const notes = await rows('SELECT id, station_id, content, COALESCE(order_index,0) order_index FROM station_notes ORDER BY station_id, order_index, id');
  for (const n of notes) {
    const gosStationId = gosStationIdByRef.get(`station:${n.station_id}`);
    if (!gosStationId) { report.flagged.push({ kind: 'orphan_note', noteId: n.id }); continue; }
    if (DRY) { bump('notes', 'created'); continue; }
    const existing = await prisma.tourStationNote.findFirst({ where: { stationId: gosStationId, sortOrder: n.order_index } });
    if (existing) { await prisma.tourStationNote.update({ where: { id: existing.id }, data: { contentHe: n.content ?? '' } }); bump('notes', 'updated'); }
    else { await prisma.tourStationNote.create({ data: { stationId: gosStationId, contentHe: n.content ?? '', sortOrder: n.order_index } }); bump('notes', 'created'); }
  }

  await rc.end();
  await prisma.$disconnect();

  console.log('\n===== ETL REPORT =====');
  console.log(JSON.stringify(report, null, 2));
  if (reportPath) { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log('report written:', reportPath); }
}

function partLabelFallback(part) {
  // Human label used when a variant has no title. The Hebrew display_name lives
  // in recruitment; we don't have it in this row, so use the stable key as a
  // last resort. (Most variants have real titles.)
  return part.internal_key;
}

// Idempotent step: one step per (station, block). Fixes order/roleHint on re-run.
async function upsertStep(prisma, stationId, blockId, sortOrder, roleHint) {
  if (String(blockId).startsWith('dry:') || !stationId || String(stationId).startsWith('dry:')) { bump('steps', 'created'); return; }
  const existing = await prisma.tourStep.findFirst({ where: { stationId, contentBlockId: blockId } });
  if (existing) { await prisma.tourStep.update({ where: { id: existing.id }, data: { sortOrder, roleHint } }); bump('steps', 'updated'); }
  else { await prisma.tourStep.create({ data: { stationId, contentBlockId: blockId, sortOrder, isVisible: true, roleHint } }); bump('steps', 'created'); }
}

// Deterministic hero → R2 → MediaFile (idempotent by r2Key). Returns MediaFile id.
async function ensureHero(prisma, rc, station) {
  const key = `tour-content/hero/station-${station.id}.jpg`;
  if (DRY) { report.hero.uploaded++; return null; }
  try {
    const existing = await prisma.mediaFile.findUnique({ where: { r2Key: key } });
    if (existing) { report.hero.reused++; return existing.id; }

    const { rows: [{ hero_image_data: buf }] } = await rc.query(
      'SELECT hero_image_data FROM stations WHERE id = $1', [station.id]);
    const mime = station.hero_image_mime || 'image/jpeg';

    // Upload only if the object isn't already present (deterministic key).
    let present = false;
    try { await r2.send(new HeadObjectCommand({ Bucket: R2.bucket, Key: key })); present = true; } catch { present = false; }
    if (!present) {
      await r2.send(new PutObjectCommand({ Bucket: R2.bucket, Key: key, Body: buf, ContentType: mime }));
    }
    const mf = await prisma.mediaFile.create({
      data: {
        r2Key: key, url: r2PublicUrl(key), bucket: R2.bucket,
        filename: `station-${station.id}-hero.jpg`, mimeType: mime,
        sizeBytes: buf?.length ?? 0, kind: 'image', uploadedById: 'etl:tour-content',
      },
    });
    report.hero.uploaded++;
    return mf.id;
  } catch (e) {
    report.hero.failed++;
    report.flagged.push({ kind: 'hero_failed', stationId: station.id, error: e.message });
    return null;
  }
}

main().catch((e) => { console.error('[etl] FATAL:', e); process.exit(1); });
