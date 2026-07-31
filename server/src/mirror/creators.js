// Live creation for the mirror — createGos implementations per entity.
//
// THE RULE: no new business logic. Every creator here calls the SAME canonical
// planner the batch importers use, with a ONE-record population, and writes with
// the SAME row shapes their executors write. A deal created live and a deal
// created by the cutover import are indistinguishable in the database because
// they went through the same code.
//
// THE CREATION INVARIANT (owner-mandated):
//   * entity + LegacyRecord crosswalk commit ATOMICALLY (one transaction);
//   * duplicate delivery / worker retry / concurrent workers never create a
//     second entity — the crosswalk's unique key is the arbiter: the loser of a
//     race gets P2002, re-reads, and returns the winner's entity;
//   * missing prerequisites DEFER (return { reason }) — the pipeline keeps the
//     event pending; nothing is marked processed when nothing was written.

import crypto from 'node:crypto';
import * as r2 from '../migration/r2.js';
import { buildStageMap, planDealImport, resolveFieldKeys } from '../migration/import/dealImport.js';
import { planActivityImport, planNoteImport } from '../migration/import/enrichmentImport.js';
import { defaultFields, validateContactNames } from '../migration/review/nameCleanup.js';
import { tourStatusOf } from '../migration/import/tourImport.js';
import { normalizeCoordRow } from '../migration/import/tourNormalize.js';
import { CHILD_TABLES } from './sources/airtableTourChildren.js';

const t = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const pid = (v) => (v && typeof v === 'object' ? v.value ?? v.id : v) ?? null;

// ── the atomic core ──────────────────────────────────────────────────────────

/**
 * Create an entity and its crosswalk as one transaction, idempotently.
 *
 * `writes(tx)` performs the entity writes and returns { entityType, entityId }.
 * The LegacyRecord insert rides in the same transaction; its unique
 * (sourceSystem, sourceType, sourceId) key is what makes retries and concurrent
 * workers safe: the second writer aborts on P2002, the transaction rolls back
 * (so its half-created entity vanishes), and the existing entity is returned.
 */
export async function atomicCreate(db, { sourceSystem = 'pipedrive', sourceType, sourceId, writes }) {
  const key = { sourceSystem, sourceType, sourceId: String(sourceId) };
  const existing = await db.legacyRecord.findUnique({
    where: { sourceSystem_sourceType_sourceId: key },
    select: { entityType: true, entityId: true },
  });
  if (existing?.entityId) return { entityType: existing.entityType, entityId: existing.entityId, alreadyExisted: true };

  try {
    return await db.$transaction(async (tx) => {
      const made = await writes(tx);
      await tx.legacyRecord.create({
        data: { ...key, entityType: made.entityType, entityId: made.entityId, importBatchId: `mirror-live` },
      });
      return made;
    });
  } catch (e) {
    if (e?.code === 'P2002') {
      // A concurrent worker won. Its transaction committed the entity + crosswalk;
      // ours rolled back completely. Return the winner's entity.
      const won = await db.legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: key },
        select: { entityType: true, entityId: true },
      });
      if (won?.entityId) return { entityType: won.entityType, entityId: won.entityId, alreadyExisted: true };
    }
    throw e;
  }
}

// ── shared reference data (frozen Pipedrive metadata) ────────────────────────
// The deal planner needs field keys, stage maps and user names — the same inputs
// run-cutover-import.mjs loads. They come from the latest snapshot's frozen
// reference entity, cached per process; reference data changes only when an admin
// edits Pipedrive settings, and a restart picks that up via a fresh snapshot.

let _ref = null;
export async function referenceBundle(db) {
  if (_ref) return _ref;
  // The CANONICAL reference location — the same path run-enrichment-import.mjs
  // reads: snapshots/<id>/pipedrive/reference/reference.json. The first version
  // of this loader guessed at manifest-shaped paths, silently got nothing, and
  // the resulting EMPTY stage map made every live deal "unmappable" — 36 real
  // deals deferred as deal_not_plannable during the first replay.
  const keys = await r2.listKeys('snapshots/');
  const ids = [...new Set(keys.map((k) => String(k.Key || k.key || k).split('/')[1]).filter(Boolean))].sort();
  let reference = null;
  for (const id of ids.reverse()) {
    try {
      reference = JSON.parse(await r2.getObjectText(`snapshots/${id}/pipedrive/reference/reference.json`));
      break;
    } catch { /* older snapshot may predate the layout — keep looking */ }
  }
  if (!reference) throw Object.assign(new Error('no pipedrive/reference in any snapshot'), { code: 'NO_REFERENCE' });
  if (!Array.isArray(reference.stages) || !Array.isArray(reference.pipelines)) {
    throw Object.assign(new Error('reference.json missing stages/pipelines — refusing an empty stage map'), { code: 'BAD_REFERENCE' });
  }

  const [stageConfigRows, gosStages] = await Promise.all([
    db.migrationDecision.findMany({ where: { queue: 'stage_config' } }),
    db.dealStage.findMany({ select: { id: true, key: true } }),
  ]);
  const stageMap = buildStageMap({ stageConfigRows, pipelines: reference.pipelines, stages: reference.stages });
  _ref = {
    fieldKeys: resolveFieldKeys(reference.dealFields),
    stageMap,
    gosStageIdByKey: new Map(gosStages.map((s) => [s.key, s.id])),
    users: reference.users || [],
    userName: new Map((reference.users || []).map((u) => [u.id, t(u.name)])),
    typeLabel: new Map((reference.activityTypes || []).map((x) => [x.key_string ?? x.key, x.name])),
  };
  return _ref;
}
export function _resetReferenceCache() { _ref = null; }

let _taskOwner = null;
async function taskOwnerId(db) {
  if (_taskOwner) return _taskOwner;
  const admin = await db.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  _taskOwner = admin?.id || null;
  return _taskOwner;
}

// Targeted crosswalk lookups (never table scans — one record's parents only).
async function xwalkOne(db, sourceType, sourceId) {
  if (sourceId == null) return null;
  const r = await db.legacyRecord.findUnique({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'pipedrive', sourceType, sourceId: String(sourceId) } },
    select: { entityType: true, entityId: true },
  });
  return r?.entityId ? r : null;
}

// ── contact ──────────────────────────────────────────────────────────────────

export async function createContact(db, normalized, row) {
  const c = row.rawPayload?.current ?? row.rawPayload?.data ?? {};
  const full = t(c.name) || '';
  const parts = full.split(/\s+/).filter(Boolean);
  const fields = defaultFields(parts[0] || '', parts.slice(1).join(' '));
  if (!validateContactNames(fields).valid) {
    return { reason: 'invalid_name', detail: `person ${row.externalId} has no usable first name ("${full}") — deferred, not silently dropped` };
  }
  const phones = [...new Set((c.phone || []).map((p) => t(p?.value ?? p)).filter(Boolean))];
  const emails = [...new Set((c.email || []).map((e) => t(e?.value ?? e)).filter(Boolean))];
  const orgLink = await xwalkOne(db, 'organization', pid(c.org_id));

  return atomicCreate(db, {
    sourceType: 'person',
    sourceId: row.externalId,
    writes: async (tx) => {
      const id = crypto.randomUUID();
      await tx.contact.create({
        data: {
          id,
          // EMPTY STRING, not null — Contact.firstNameHe is NOT NULL and the
          // identity importer stores '' for the script the name doesn't use
          // (its own t() returns ''). Nulling here crashed the insert for every
          // Latin-named person ("Liat Kaufman") during the first replay.
          firstNameHe: String(fields.firstNameHe ?? '').trim(),
          lastNameHe: String(fields.lastNameHe ?? '').trim(),
          firstNameEn: String(fields.firstNameEn ?? '').trim(),
          lastNameEn: String(fields.lastNameEn ?? '').trim(),
        },
      });
      for (let i = 0; i < phones.length; i += 1) {
        await tx.contactPhone.create({ data: { contactId: id, value: phones[i], isPrimary: i === 0, sortOrder: i } });
      }
      for (let i = 0; i < emails.length; i += 1) {
        await tx.contactEmail.create({ data: { contactId: id, value: emails[i], isPrimary: i === 0, sortOrder: i } });
      }
      if (orgLink) {
        await tx.contactOrganization.create({ data: { contactId: id, organizationId: orgLink.entityId, isPrimary: true } });
      }
      return { entityType: 'Contact', entityId: id };
    },
  });
}

// ── organization ─────────────────────────────────────────────────────────────

export async function createOrganization(db, normalized, row) {
  const c = row.rawPayload?.current ?? row.rawPayload?.data ?? {};
  const name = t(c.name);
  if (!name) return { reason: 'org_without_name', detail: `organization ${row.externalId} has no name` };
  return atomicCreate(db, {
    sourceType: 'organization',
    sourceId: row.externalId,
    writes: async (tx) => {
      const id = crypto.randomUUID();
      await tx.organization.create({
        data: { id, name, ...(normalized.fields?.organizationTypeId ? { organizationTypeId: normalized.fields.organizationTypeId } : {}) },
      });
      return { entityType: 'Organization', entityId: id };
    },
  });
}

// ── deal ─────────────────────────────────────────────────────────────────────
// The full canonical deal shape via planDealImport with a ONE-deal population —
// same order-number rule, same stage mapping, same legacy-card construction.

export async function createDeal(db, normalized, row) {
  const c = row.rawPayload?.current ?? row.rawPayload?.data ?? {};
  const ref = await referenceBundle(db);

  // The planner resolves people through the crosswalk maps; supply exactly the
  // parents this one deal references.
  const personXwalk = new Map();
  const orgXwalk = new Map();
  const personId = pid(c.person_id);
  const orgId = pid(c.org_id);
  if (personId != null) {
    const p = await xwalkOne(db, 'person', personId);
    if (p) personXwalk.set(String(personId), { entityType: p.entityType, entityId: p.entityId });
  }
  const o = orgId != null ? await xwalkOne(db, 'organization', orgId) : null;
  if (o) orgXwalk.set(String(orgId), o.entityId);

  const { payloads, stats } = planDealImport({
    deals: [c],
    stageMap: ref.stageMap,
    fieldKeys: ref.fieldKeys,
    personXwalk,
    orgXwalk,
    gosStageIdByKey: ref.gosStageIdByKey,
    users: ref.users,
    existingDealXwalk: new Map(),
  });
  const p = payloads.find((x) => x.kind === 'create');
  if (!p) {
    return { reason: 'deal_not_plannable', detail: `planDealImport produced no create payload for deal ${row.externalId} (${JSON.stringify(stats).slice(0, 120)})` };
  }

  return atomicCreate(db, {
    sourceType: 'deal',
    sourceId: row.externalId,
    writes: async (tx) => {
      const id = crypto.randomUUID();
      await tx.deal.create({
        data: {
          id,
          orderNo: p.orderNo,
          title: p.title,
          status: p.status,
          dealStageId: p.dealStageId ?? null,
          valueMinor: p.valueMinor != null ? BigInt(p.valueMinor) : null,
          currency: p.currency,
          wonAt: p.wonAt ? new Date(p.wonAt) : null,
          lostAt: p.lostAt ? new Date(p.lostAt) : null,
          lostReason: p.lostReason,
          expectedCloseDate: p.expectedCloseDate ? new Date(p.expectedCloseDate) : null,
          activityType: p.activityType,
          tourDate: p.tourDate,
          tourTime: p.tourTime,
          participants: p.participants,
          communicationLanguage: p.communicationLanguage,
          tourLanguage: p.tourLanguage,
          customerInfo: p.customerInfo,
          organizationId: p.organizationId ?? null,
        },
      });
      // A person crosswalk can point at a contact later MERGED AWAY in GOS —
      // linking it raises P2003 and deferred the whole deal forever. Link only
      // contacts that still exist; a dead reference costs the link, not the deal.
      const wanted = [...new Set([p.primaryContactId, ...(p.participantContactIds || [])].filter(Boolean))];
      const alive = new Set(
        (await tx.contact.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((x) => x.id),
      );
      if (p.primaryContactId && alive.has(p.primaryContactId)) {
        await tx.dealContact.create({ data: { dealId: id, contactId: p.primaryContactId, isPrimary: true } });
      }
      for (const cid of p.participantContactIds || []) {
        if (cid !== p.primaryContactId && alive.has(cid)) {
          await tx.dealContact.create({ data: { dealId: id, contactId: cid, isPrimary: false } });
        }
      }
      return { entityType: 'Deal', entityId: id, fieldsWritten: { orderNo: p.orderNo, stage: p.dealStageKey ?? null } };
    },
  });
}

// ── note → immutable TimelineEntry ───────────────────────────────────────────

export async function createNote(db, normalized, row) {
  const c = row.rawPayload?.current ?? row.rawPayload?.data ?? {};
  const ref = await referenceBundle(db);
  const maps = await subjectMaps(db, c);
  const { payloads, stats } = planNoteImport({
    notes: [c],
    ...maps,
    existingNoteXwalk: new Map(),
    userName: ref.userName,
  });
  const np = payloads[0];
  if (!np) {
    if (stats.noSubject && await subjectIsExcludedPerson(db, c)) {
      return { terminal: true, reason: 'excluded_person_subject', detail: `note ${row.externalId}: person subject is intentionally excluded (spam/shell)` };
    }
    const why = stats.noSubject ? 'note_subject_not_in_gos' : 'note_empty';
    return { reason: why, detail: `note ${row.externalId}: ${JSON.stringify(stats)}` };
  }
  const p = np;
  return atomicCreate(db, {
    sourceType: 'note',
    sourceId: row.externalId,
    writes: async (tx) => {
      const id = crypto.randomUUID();
      await tx.timelineEntry.create({
        data: {
          id, subjectType: p.subjectType, subjectId: p.subjectId,
          kind: 'note', isSystem: false, body: p.body,
          actorType: 'import', actorLabel: p.actorLabel,
          createdAt: new Date(p.createdAt),
        },
      });
      return { entityType: 'TimelineEntry', entityId: id };
    },
  });
}

// ── activity → Task (open, on a live deal) or immutable timeline history ─────

export async function createActivity(db, normalized, row) {
  const c = row.rawPayload?.current ?? row.rawPayload?.data ?? {};
  const ref = await referenceBundle(db);
  const owner = await taskOwnerId(db);
  if (!owner) return { reason: 'no_task_owner', detail: 'no active AdminUser to own imported tasks' };
  const maps = await subjectMaps(db, c);

  // Rule D7a needs to know whether the deal is OPEN in GOS.
  const openDealGosIds = new Set();
  const dealId = pid(c.deal_id);
  if (dealId != null && maps.dealXwalk.has(String(dealId))) {
    const gosId = maps.dealXwalk.get(String(dealId));
    const deal = await db.deal.findUnique({ where: { id: gosId }, select: { status: true } });
    if (deal?.status === 'open') openDealGosIds.add(gosId);
  }

  const { timeline, tasks, stats } = planActivityImport({
    activities: [c],
    ...maps,
    openDealGosIds,
    existingActivityXwalk: new Map(),
    userName: ref.userName,
    typeLabel: ref.typeLabel,
    taskOwnerUserId: owner,
  });

  if (tasks.length) {
    const x = tasks[0];
    return atomicCreate(db, {
      sourceType: 'activity',
      sourceId: row.externalId,
      writes: async (tx) => {
        const id = crypto.randomUUID();
        await tx.task.create({
          data: {
            id, dealId: x.dealId, title: (x.title || '').slice(0, 200) || 'משימה מיובאת',
            dueDate: new Date(x.dueDate), dueTime: x.dueTime,
            notes: x.notes, ownerUserId: x.ownerUserId,
            status: 'open', channel: 'none',
            ...(x.createdAt ? { createdAt: new Date(x.createdAt) } : {}),
          },
        });
        return { entityType: 'Task', entityId: id };
      },
    });
  }
  if (timeline.length) {
    const p = timeline[0];
    return atomicCreate(db, {
      sourceType: 'activity',
      sourceId: row.externalId,
      writes: async (tx) => {
        const id = crypto.randomUUID();
        await tx.timelineEntry.create({
          data: {
            id, subjectType: p.subjectType, subjectId: p.subjectId,
            kind: p.kind, isSystem: p.isSystem, body: p.body,
            actorType: 'import', actorLabel: p.actorLabel,
            createdAt: new Date(p.createdAt),
          },
        });
        return { entityType: 'TimelineEntry', entityId: id };
      },
    });
  }
  // The planner's own exclusions (bare person-level rows, no subject) — same
  // rules as Wave 1, reported with the planner's own accounting.
  if (stats.noSubject) {
    // No subject AT ALL (no person, no deal, no org — a team-internal reminder):
    // GOS deliberately has nowhere to put it, exactly Wave 1's noSubject rule.
    // Terminal with its own name, not an endless retry.
    if (pid(c.person_id) == null && pid(c.deal_id) == null && pid(c.org_id) == null) {
      return {
        terminal: true,
        reason: 'activity_without_subject',
        detail: `activity ${row.externalId} is attached to no person, deal or organization — Wave-1 noSubject rule, intentionally excluded`,
      };
    }
    const excluded = await subjectIsExcludedPerson(db, c);
    if (excluded) {
      return {
        terminal: true,
        reason: 'excluded_person_subject',
        detail: `activity ${row.externalId}: its person subject ${pid(c.person_id)} is in the intentionally-excluded spam/shell population — not imported by owner ruling (2026-07-31)`,
      };
    }
    return { reason: 'activity_subject_not_in_gos', detail: `activity ${row.externalId}: ${JSON.stringify(stats)}` };
  }
  const why = stats.personNoNote ? 'activity_bare_person_row_excluded' : 'activity_not_plannable';
  return { reason: why, detail: `activity ${row.externalId}: ${JSON.stringify(stats)}` };
}

/**
 * Is this record's person subject part of the deliberately-excluded population?
 *
 * The signal is structural, not a ledger lookup: a person with NO crosswalk who
 * ALSO has no mirror event was never imported AND predates capture — i.e. the
 * identity import saw them and skipped them (spam / empty shell). A genuinely
 * new person always produces a person.added event before (or with) their first
 * activity, so they never match this test.
 */
async function subjectIsExcludedPerson(db, c) {
  const personId = pid(c.person_id);
  if (personId == null) return false;
  if (pid(c.deal_id) != null || pid(c.org_id) != null) return false; // other subjects may still resolve
  const crosswalked = await xwalkOne(db, 'person', personId);
  if (crosswalked) return false;
  const anyEvent = await db.mirrorEvent.findFirst({
    where: { system: 'pipedrive', entity: 'contact', externalId: String(personId) },
    select: { id: true },
  });
  return !anyEvent;
}

async function subjectMaps(db, c) {
  const dealXwalk = new Map(); const personXwalk = new Map(); const orgXwalk = new Map();
  const dealId = pid(c.deal_id); const personId = pid(c.person_id); const orgId = pid(c.org_id);
  if (dealId != null) { const d = await xwalkOne(db, 'deal', dealId); if (d) dealXwalk.set(String(dealId), d.entityId); }
  if (personId != null) { const p = await xwalkOne(db, 'person', personId); if (p) personXwalk.set(String(personId), { entityType: p.entityType, entityId: p.entityId }); }
  if (orgId != null) { const o = await xwalkOne(db, 'organization', orgId); if (o) orgXwalk.set(String(orgId), o.entityId); }
  return { dealXwalk, personXwalk, orgXwalk };
}

// ── future tour (Airtable master row) ────────────────────────────────────────
// Kind uses the SAME rule as planFutureTours: >1 linked deal → group_slot, one
// business deal → business, else private. Coordination rows come live through the
// injected child fetcher; the deals' activity types through their crosswalk.

export function makeTourCreator({ fetcher, parentLinkField }) {
  return async function createTour(db, normalized, row) {
    const f = row.rawPayload?.fields || {};
    const date = normalized.fields?.date ?? null;
    if (!date) {
      return { reason: 'tour_without_usable_date', detail: `tour ${row.externalId} DATE is unusable — same gate as the import` };
    }
    const status = tourStatusOf({ status: t(f['סטטוס']) || '', date, today: new Date().toISOString().slice(0, 10) });
    if (status === 'cancelled') {
      return { reason: 'cancelled_tour_not_created', detail: 'Law 2 — cancelled tours are never imported, so one is never live-created either' };
    }

    let kind = 'private';
    try {
      const coordRaw = await fetcher.fetchTable(CHILD_TABLES.coordination, parentLinkField, row.externalId);
      const coords = coordRaw.map((r) => normalizeCoordRow(r));
      const dealIds = [...new Set(coords.map((x) => x.legacyDealId).filter((x) => x != null))];
      if (dealIds.length > 1) kind = 'group_slot';
      else if (dealIds.length === 1) {
        const d = await xwalkOne(db, 'deal', dealIds[0]);
        const gos = d ? await db.deal.findUnique({ where: { id: d.entityId }, select: { activityType: true } }) : null;
        kind = gos?.activityType === 'business' ? 'business' : 'private';
      } else if (t(f['סיור חשיפה מלא']) === 'open') {
        kind = 'group_slot'; // unsold open slot — the 5-empty-slots pattern
      }
    } catch (e) {
      return { reason: 'tour_children_unreachable', detail: `cannot derive kind for ${row.externalId}: ${String(e?.message || e).slice(0, 120)}` };
    }

    return atomicCreate(db, {
      sourceSystem: 'airtable',
      sourceType: 'tour',
      sourceId: row.externalId,
      writes: async (tx) => {
        const id = crypto.randomUUID();
        await tx.tourEvent.create({
          data: {
            id, kind,
            status: status === 'postponed' ? 'postponed' : 'scheduled',
            date,
            startTime: normalized.fields?.startTime ?? null,
            notes: t(f['שם']) || null,
            capacity: normalized.fields?.capacity ?? null,
            // gcalSyncStatus stays null — the sweep adopts it exactly like an
            // imported tour, so live-created and imported tours behave identically.
          },
        });
        return { entityType: 'TourEvent', entityId: id };
      },
    });
  };
}
