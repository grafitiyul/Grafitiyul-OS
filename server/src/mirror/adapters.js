// THE adapter factory.
//
// One resolver for (system, entity) → adapter, shared by the webhook route, the
// retry worker, the pollers and the admin replay endpoint. Having a single
// factory is what stops one of those paths from quietly using a differently
// configured adapter than the others.

import { prisma } from '../db.js';
import { adapterFor, ENTITY_TO_SOURCE_TYPE } from './sources/pipedriveMirror.js';
import { airtableTourSource, tourAdapter } from './sources/airtableMirror.js';
import { CHILD_TABLES, tourChildrenAdapter } from './sources/airtableTourChildren.js';
import { createChildDeps, createChildFetcher } from './sources/airtableTourChildDeps.js';

// Stage lookups are cached briefly: the mirror can process a burst of events,
// and re-reading the stage table per event would be wasteful — but a rename in
// CRM settings must still take effect without a redeploy.
let _stages = { at: 0, byKey: new Map() };
async function stageIndex() {
  if (Date.now() - _stages.at > 60_000) {
    const rows = await prisma.dealStage.findMany({ select: { id: true, key: true } });
    _stages = { at: Date.now(), byKey: new Map(rows.map((s) => [s.key, s.id])) };
  }
  return _stages.byKey;
}

export function mirrorAdapterFactory(system, entity) {
  if (system !== 'pipedrive') return null;
  const adapter = adapterFor(entity, {
    // Pipedrive stage id → GOS stage key is owner-approved mapping data that is
    // not yet exposed as configuration. Until it is, the mirror DECLINES to
    // guess and simply does not offer the stage field — which is why the
    // adapter omits it rather than nulling it.
    stageKeyForPipedriveStage: () => null,
    stageIdForKey: (key) => _stages.byKey.get(key) || null,
  });
  if (!adapter) return null;
  adapter.sourceType = ENTITY_TO_SOURCE_TYPE[entity] || adapter.sourceType;
  return adapter;
}

/** Warm the stage cache at boot so the first event does not pay for it. */
export async function warmMirrorAdapters() {
  try { await stageIndex(); } catch { /* the mirror is off or the DB is not up yet */ }
}

/**
 * Poll targets, built only for sources whose credentials are actually present.
 *
 * A poller configured without credentials would fail on every tick, inflate the
 * failure streak, and bury the one signal that matters — so an unconfigured
 * source produces NO target rather than a permanently red one.
 */
export function buildPollTargets({ ingest, airtableClient = null, prisma: db = prisma, budget = null } = {}) {
  const targets = [];
  if (!airtableClient) return targets;

  // Airtable is polled because its webhooks do not cover every change type and
  // give no trustworthy delete signal — polling IS the correctness mechanism.

  // 1) The tours table itself: 1:1 with TourEvent → entity_merge.
  targets.push({
    system: 'airtable',
    entity: 'tourEvent',
    source: airtableTourSource(airtableClient),
    adapter: tourAdapter(),
    ingest,
  });

  // 2–4) The child tables: NOT 1:1 with any GOS row → parent_recompute. One
  // fetcher is shared across all three so a tour whose coordination AND payroll
  // both changed pays for its children ONCE per run.
  const fetcher = createChildFetcher({ client: airtableClient, budget });
  const deps = createChildDeps({ fetcher, prisma: db });

  for (const [childKind, tableId] of Object.entries(CHILD_TABLES)) {
    targets.push({
      system: 'airtable',
      // The GOS entity a child change ultimately affects is the tour. Declaring
      // it here keeps the ownership map's scoping honest — a child event is
      // still, in ownership terms, a change to a crosswalked TourEvent.
      entity: 'tourEvent',
      cursorKey: `airtable:child:${childKind}`,
      source: airtableChildSource(airtableClient, tableId, CHILD_FIELDS[childKind]),
      adapter: tourChildrenAdapter({ childKind, deps }),
      ingest,
    });
  }
  return targets;
}

/**
 * A poll source for one child table. Same incremental contract as the tours
 * source — server-side modified-time filter, cursor from the source's own clock
 * — reusing the client's shared implementation rather than a second one.
 */
function airtableChildSource(client, tableId, fields) {
  return {
    async fetchChanges(cursor) {
      const { records, nextCursor, truncated, pages } =
        await client.listModifiedSinceIn(tableId, cursor, { fields });
      return {
        records: records.map((r) => ({
          externalId: r.id,
          version: r.lastModified || null,
          payload: { id: r.id, fields: r.fields, lastModified: r.lastModified || null },
        })),
        nextCursor,
        truncated,
        pages,
      };
    },
  };
}

/**
 * The fields each child table must project. Only what the derivation reads, so
 * payloads stay small and linked-record blobs are never dragged along.
 */
const CHILD_FIELDS = Object.freeze({
  coordination: ['שם סיור', 'פייפ דיל ID', 'משתתפים', 'מייל מדריך'],
  participants: ['שם סיור'],
  payroll: ['שם סיור', 'שם המדריך', 'מייל', 'סה"כ לפני מעמ', 'מאושר'],
});

