// Seed mirror baselines from the cutover snapshot.
//
// Called at the END of the cutover import, once every record exists and is
// crosswalked. It translates the SOURCE-shaped snapshot values into baselines
// through the SAME adapters the mirror uses, so the baseline is byte-comparable
// with what a later webhook or poll will present.
//
// Using the adapters rather than a hand-written projection is the whole point:
// if the baseline were shaped differently from what the mirror normalises, every
// first real change would look like a difference and conflict spuriously.

import { seedBaselines } from './seedBaseline.js';
import { adapterFor } from './sources/pipedriveMirror.js';
import { tourAdapter } from './sources/airtableMirror.js';

/**
 * @param finalDeals  the Pipedrive deal records the cutover just imported/merged
 * @param masterTours the normalised Airtable master tours from the same snapshot
 */
export async function seedMirrorBaselinesFromSnapshot(prisma, { finalDeals = [], masterTours = [], log = () => {} }) {
  // ── deals ──────────────────────────────────────────────────────────────────
  // Normalised through the deal adapter, so the stored baseline is exactly the
  // shape the mirror will compare against. Stage is deliberately excluded: the
  // adapter omits it unless the frozen map resolves it, and seeding a value the
  // mirror would not itself produce would manufacture a false difference.
  const dealAdapter = adapterFor('deal', {});
  const dealRows = [];
  for (const d of finalDeals) {
    const raw = d?.raw ?? d?.source ?? d;
    const pdId = raw?.id ?? d?.pipedriveId ?? d?.legacyDealId;
    if (pdId == null) continue;
    let normalized;
    try {
      normalized = await dealAdapter.normalize({ meta: { action: 'seed' }, current: raw });
    } catch {
      continue;
    }
    if (normalized?.sourceDeleted) continue;
    dealRows.push({ sourceId: String(pdId), fields: normalized.fields || {} });
  }

  const deals = await seedBaselines(prisma, {
    system: 'pipedrive',
    sourceType: 'deal',
    entity: 'deal',
    rows: dealRows,
    // Never rewind a baseline the live mirror already advanced. A re-run of the
    // cutover import must not undo real synchronisation that happened since.
    overwrite: false,
  });
  log(`   (deals considered: ${deals.considered}, no crosswalk: ${deals.skippedNoCrosswalk})`);

  // ── tours ──────────────────────────────────────────────────────────────────
  const tAdapter = tourAdapter();
  const tourRows = [];
  for (const m of masterTours) {
    if (!m?.recId) continue;
    // The master tours are already normalised by tourNormalize, so they are
    // re-presented in Airtable's own field shape for the adapter to read — one
    // normalisation contract, not two.
    let normalized;
    try {
      normalized = await tAdapter.normalize({
        id: m.recId,
        fields: {
          DATE: m.date,
          'שעת התחלה': m.startTime,
          'סטטוס': m.status,

          'הערות': m.notes ?? null,
        },
      });
    } catch {
      continue;
    }
    tourRows.push({ sourceId: String(m.recId), fields: normalized.fields || {} });
  }

  const tours = await seedBaselines(prisma, {
    system: 'airtable',
    sourceType: 'tour',
    entity: 'tourEvent',
    rows: tourRows,
    overwrite: false,
  });
  log(`   (tours considered: ${tours.considered}, no crosswalk: ${tours.skippedNoCrosswalk})`);

  return { deals, tours };
}
