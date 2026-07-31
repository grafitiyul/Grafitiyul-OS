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
import { COORD_FIELDS, PAYROLL_FIELDS } from '../migration/import/tourNormalize.js';
import { createChildDeps, createChildFetcher } from './sources/airtableTourChildDeps.js';
import { cursorIdFor } from './worker.js';
import { airtableClientFromEnv } from './sources/airtableClient.js';
import { createContact, createDeal, createNote, createOrganization, createActivity, makeTourCreator } from './creators.js';
import { fileAdapter, pipedriveFilesConfigured, pipedriveFilesSource } from './sources/pipedriveFiles.js';
import { PARENT_LINK_FIELDS } from './sources/airtableTourChildren.js';

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

/**
 * Which child table a persisted Airtable event came from.
 *
 * All four Airtable poll targets declare entity 'tourEvent' (deliberately — in
 * ownership terms a child change IS a change to a tour), so `entity` alone cannot
 * tell the master table from a child one. Poll payloads now carry `childKind`
 * explicitly; the field-shape fallback exists so events captured BEFORE that was
 * added are still resolvable rather than stranded.
 *
 * Disambiguated by each table's own parent-link field, from the canonical contract:
 * coordination has `שם סיור`, payroll has `סיורים`, the master table has neither.
 */
export function airtableChildKindOf(payload) {
  const explicit = payload?.childKind;
  if (explicit && Object.prototype.hasOwnProperty.call(CHILD_TABLES, explicit)) return explicit;
  const f = payload?.fields || {};
  if (f[PAYROLL_FIELDS.parentLink] !== undefined) return 'payroll';
  if (f[COORD_FIELDS.parentLink] !== undefined) return 'coordination';
  return null; // the master tours table
}

// Airtable child adapters need live deps (a fetcher and a db handle). Built once,
// lazily, so the factory can serve the retry worker and the replay runner — which
// resolve adapters from a persisted row and have no poll target to borrow from.
let _airtableDeps = null;
function airtableChildDeps() {
  if (_airtableDeps) return _airtableDeps;
  const client = airtableClientFromEnv();
  if (!client) return null;
  _airtableDeps = createChildDeps({ fetcher: createChildFetcher({ client }), prisma });
  return _airtableDeps;
}

export function mirrorAdapterFactory(system, entity, row = null) {
  // AIRTABLE. Omitting this branch meant the retry worker resolved no adapter for
  // any Airtable event and marked it `skipped / no_adapter` — terminal. With apply
  // off, every polled Airtable change was left pending by the apply gate and then
  // destroyed by the worker 60s later, so the Phase A buffer silently lost every
  // Airtable change while looking perfectly healthy. Found on production, having
  // already discarded two real coordination-row changes.
  if (system === 'airtable') {
    if (entity !== 'tourEvent') return null;
    const childKind = airtableChildKindOf(row?.rawPayload);
    if (!childKind) {
      const a = tourAdapter();
      // A NEW Airtable tour (no crosswalk) is CREATED, not skipped — kind derived
      // by the same rule planFutureTours uses, via the live child fetcher.
      const client = airtableClientFromEnv();
      if (client) {
        a.createGos = makeTourCreator({
          fetcher: createChildFetcher({ client }),
          parentLinkField: PARENT_LINK_FIELDS.coordination,
        });
      }
      return a;
    }
    const deps = airtableChildDeps();
    if (!deps) return null;
    return tourChildrenAdapter({ childKind, deps });
  }

  if (system !== 'pipedrive') return null;
  if (entity === 'file') return fileAdapter();
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

  // Live creation — same canonical planners as the batch importers, one-record
  // populations, atomic entity+crosswalk. An entity absent from this map simply
  // has no createGos, and the pipeline defers its events with a named reason.
  const creator = {
    deal: createDeal,
    contact: createContact,
    organization: createOrganization,
    note: createNote,
    task: createActivity,
  }[entity];
  if (creator) adapter.createGos = creator;

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
  // Pipedrive FILES are polled (there is no file webhook object) — one
  // /recents request per tick, cursor = max observed update_time. Independent
  // of the Airtable client.
  if (pipedriveFilesConfigured()) {
    targets.push({
      system: 'pipedrive',
      entity: 'file',
      cursorKey: 'pipedrive:file',
      source: pipedriveFilesSource(),
      adapter: fileAdapter(),
      ingest,
    });
  }

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
      source: airtableChildSource(airtableClient, tableId, CHILD_FIELDS[childKind], childKind),
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
function airtableChildSource(client, tableId, fields, childKind) {
  return {
    async fetchChanges(cursor) {
      const { records, nextCursor, truncated, pages } =
        await client.listModifiedSinceIn(tableId, cursor, { fields });
      return {
        records: records.map((r) => ({
          externalId: r.id,
          version: r.lastModified || null,
          // childKind is stamped on the payload because the persisted event only
          // records entity='tourEvent', which all four targets share. Without it a
          // retry or replay cannot tell which adapter the event belongs to.
          payload: { id: r.id, fields: r.fields, lastModified: r.lastModified || null, childKind },
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
// The fields each poll asks Airtable for. Every name here must EXIST in its table:
// Airtable answers an unknown field with a 422 for the whole request, so one wrong
// name kills the entire poller rather than degrading it. Derived from the canonical
// field contract so it cannot drift from what the mappers then read.
const CHILD_FIELDS = Object.freeze({
  coordination: [
    COORD_FIELDS.parentLink, COORD_FIELDS.legacyDealId, COORD_FIELDS.seats,
    COORD_FIELDS.guideEmail, COORD_FIELDS.guideName, COORD_FIELDS.calendarId,
  ],
  payroll: [
    PAYROLL_FIELDS.parentLink, PAYROLL_FIELDS.guideNameEn, PAYROLL_FIELDS.role,
    PAYROLL_FIELDS.totalPreVat, PAYROLL_FIELDS.vat, PAYROLL_FIELDS.approved,
    PAYROLL_FIELDS.guideApproved, PAYROLL_FIELDS.note,
  ],
});


/**
 * The cursor identities of every Airtable poll target, derived from the target
 * list itself.
 *
 * Exists so the pre-capture cursor seeding cannot drift from what the worker
 * actually registers. A seeded cursor whose id is one character off is worse than
 * no seeding: the script reports success, the row is never read, and capture still
 * performs the unbounded first read this whole mechanism exists to avoid.
 *
 * A stub client is enough — buildPollTargets only needs it to decide that Airtable
 * is configured, and nothing here polls.
 */
export function airtableCursorTargets() {
  const targets = buildPollTargets({
    ingest: () => { throw new Error('airtableCursorTargets must not ingest'); },
    airtableClient: { __stub: true },
    prisma: null,
  });
  return targets
    .filter((t) => t.system === 'airtable')
    .map((t) => ({
      id: cursorIdFor({ system: t.system, entity: t.entity, cursorKey: t.cursorKey ?? null }),
      system: t.system,
      entity: t.entity,
      cursorKey: t.cursorKey ?? null,
    }));
}
