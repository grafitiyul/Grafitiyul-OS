// Pipedrive → GOS mirror adapters.
//
// An adapter TRANSLATES and nothing else. It never merges, never decides
// ownership, never writes outside the field set the ownership map declares.
// Everything interesting happens in the shared pipeline.
//
// Pipedrive webhooks deliver `{ meta: {...}, current: {...}, previous: {...} }`.
// We use `current` as the source state and ignore `previous` entirely: the
// baseline, not the provider's idea of the previous value, is what the merge
// compares against. Trusting `previous` would silently reintroduce a 2-way
// merge and with it the ability to clobber a human edit.

import { PD_FIELD_KEYS } from '../../migration/import/marketingImport.js';
import { reconcileAppendOnly } from '../merge.js';
import { normalizePhoneIntl } from '../../whatsapp/phone.js';
import { ACTIVITY_TYPE_MAP, DEAL_FIELDS, ORG_FIELDS, ORG_TYPE_LABELS, PERSON_FIELDS, stageKeyForPipedriveStage } from './pipedriveFields.js';

const str = (v) => {
  if (v === null || v === undefined) return null;
  const x = typeof v === 'object' ? (v.value ?? v.name ?? null) : v;
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
};

const num = (v) => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Pipedrive emits 'YYYY-MM-DD HH:mm:ss' in UTC, which Date cannot parse
// consistently across engines.
export function pdDate(v) {
  const s = str(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Money: Pipedrive `value` is major units; GOS stores minor. Rounded, never
// truncated — 19.99 must not become 1998.
export function toMinor(v) {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

// Pipedrive date-only custom fields arrive as 'YYYY-MM-DD'; GOS stores the same
// text. Anything else is refused rather than coerced into a wrong date.
export function dateOnly(v) {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Time custom fields arrive as 'HH:MM' or 'HH:MM:SS'.
export function hhmm(v) {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
}

export function isDeleteEvent(payload) {
  const action = String(payload?.meta?.action || payload?.meta?.type || '').toLowerCase();
  return action === 'deleted' || action === 'delete' || payload?.current === null;
}

/**
 * The Deal adapter.
 *
 * `dealStageKey` rather than `dealStageId`: the ownership map declares the stage
 * compares by KEY, because the numeric Pipedrive stage id means nothing in GOS
 * and the frozen stage map is the only correct translation.
 */
export function dealAdapter({ stageIdForKey, ownerLabelFor } = {}) {
  return {
    sourceType: 'deal',

    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;

      const fields = {
        title: str(c.title),
        status: str(c.status),
        valueMinor: toMinor(c.value),
        currency: str(c.currency),
        wonAt: pdDate(c.won_time),
        lostAt: pdDate(c.lost_time),
        lostReason: str(c.lost_reason),
        expectedCloseDate: pdDate(c.expected_close_date),
        // Operational custom fields — the ones the sales workspace actually uses.
        tourDate: dateOnly(c[DEAL_FIELDS.tourDate]),
        tourTime: hhmm(c[DEAL_FIELDS.tourTime]),
        participants: num(c[DEAL_FIELDS.participants]),
      };

      // Owner: Pipedrive sends a user id; GOS stores a loose label. Resolved
      // through the injected index so the mirror never shows a bare numeric id.
      const ownerId = c.user_id?.id ?? c.user_id;
      if (ownerId != null && ownerLabelFor) {
        const label = ownerLabelFor(ownerId);
        if (label) fields.ownerUserId = label;
      }

      // Stage: translated by the FROZEN map. An unmapped stage is omitted, never
      // nulled — nulling would silently move the deal to the first column.
      const stageKey = stageKeyForPipedriveStage(c.stage_id);
      if (stageKey && stageIdForKey) {
        const id = stageIdForKey(stageKey);
        if (id) fields.dealStageId = id;
      }

      // `undefined` means "the source said nothing", which is different from
      // "the source says empty" — only the latter may overwrite.
      for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

      return {
        fields,
        legacySourceLabel: str(c[PD_FIELD_KEYS.leadSourceText]) || null,
        // Marketing travels beside the field set: it lands in DealMarketing
        // through its own canonical write path, not through the deal merge.
        marketing: {
          leadSourceKey: str(c[DEAL_FIELDS.leadSourceList]),
          leadSourceText: str(c[DEAL_FIELDS.leadSourceText]),
          campaign: str(c[DEAL_FIELDS.campaign]),
        },
      };
    },

    async loadGos(db, id) {
      return db.deal.findUnique({
        where: { id },
        select: {
          id: true, orderNo: true, title: true, status: true, valueMinor: true, currency: true,
          wonAt: true, lostAt: true, lostReason: true, expectedCloseDate: true, dealStageId: true,
          tourDate: true, tourTime: true, participants: true, ownerUserId: true,
          wonQuoteRef: true,
        },
      });
    },

    async applyGos(db, id, set) {
      const data = { ...set };
      if (data.valueMinor !== undefined && data.valueMinor !== null) data.valueMinor = BigInt(data.valueMinor);
      await db.deal.update({ where: { id }, data });
    },

    async guards(db, gos) {
      // Once GOS produced the commercial document, GOS owns the money. A stale
      // Pipedrive value must never overwrite a signed quote.
      let hasPrimaryQuote = false;
      try {
        hasPrimaryQuote = (await db.quoteVersion.count({
          where: { dealId: gos.id, isSelected: true },
        })) > 0;
      } catch { hasPrimaryQuote = false; }
      return { gosOwnsCommercials: !!gos.wonQuoteRef || hasPrimaryQuote };
    },

    describe: (gos) => ({ label: gos.title, orderNo: gos.orderNo }),
  };
}

/**
 * The Organization adapter.
 *
 * `orgTypeIdForLabel` is injected and resolved against the LIVE catalogue, so a
 * rename in CRM settings cannot break the mirror and no enum id is ever written
 * into a GOS foreign key.
 */
export function organizationAdapter({ orgTypeIdForLabel } = {}) {
  return {
    sourceType: 'organization',
    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;
      const fields = {
        name: str(c.name),
        address: str(c.address),
        taxId: str(c[ORG_FIELDS.taxId]),
      };
      const optionId = str(c[ORG_FIELDS.orgType]);
      if (optionId && orgTypeIdForLabel) {
        const label = ORG_TYPE_LABELS[Number(optionId)];
        // An unresolved option is omitted, never written as a raw id.
        const id = label ? orgTypeIdForLabel(label) : null;
        if (id) fields.organizationTypeId = id;
      }
      for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
      return { fields };
    },
    async loadGos(db, id) {
      return db.organization.findUnique({
        where: { id },
        select: { id: true, orgNo: true, name: true, address: true, taxId: true, organizationTypeId: true },
      });
    },
    async applyGos(db, id, set) { await db.organization.update({ where: { id }, data: set }); },
    describe: (gos) => ({ label: gos.name, orderNo: gos.orgNo }),
  };
}

/**
 * The Contact adapter.
 *
 * Names only. Phones and emails are APPEND-ONLY and reconciled separately, so
 * they are deliberately NOT offered to the field merge — the ownership map
 * marks them append_only and the merge engine skips them, but not offering them
 * at all makes the intent obvious at the call site too.
 */
export function contactAdapter() {
  return {
    sourceType: 'person',
    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;
      const full = str(c.name) || '';
      const parts = full.split(/\s+/).filter(Boolean);
      const fields = {};
      if (parts.length) {
        fields.firstNameHe = parts[0];
        fields.lastNameHe = parts.slice(1).join(' ') || null;
      }
      const taxId = str(c[PERSON_FIELDS.taxId]);
      if (taxId) fields.taxId = taxId;

      // Channels travel BESIDE the field set. They are append-only and are
      // reconciled by their own routine — offering them to the field merge
      // would invite a future change to overwrite a number the office uses.
      const channels = {
        phones: (c.phone || []).map((p) => str(p?.value ?? p)).filter(Boolean),
        emails: (c.email || []).map((e) => str(e?.value ?? e)).filter(Boolean),
      };
      return { fields, channels };
    },
    async loadGos(db, id) {
      return db.contact.findUnique({
        where: { id },
        select: { id: true, contactNo: true, firstNameHe: true, lastNameHe: true, taxId: true },
      });
    },
    async applyGos(db, id, set) { await db.contact.update({ where: { id }, data: set }); },

    /**
     * Append-only channel reconciliation.
     *
     * `reconcileAppendOnly` existed in merge.js and was never called from
     * anywhere in the runtime — the ownership map declared phones and emails
     * append-only, the merge engine implemented it, and no code path connected
     * the two. A number added in Pipedrive simply never reached GOS.
     *
     * APPEND ONLY, and that word is doing real work: nothing here edits,
     * re-primaries, re-labels, reorders or deletes. The office may have corrected
     * a number by hand, and a sync must never undo that. Only genuinely absent
     * values are added, at the end.
     *
     * Phones compare by their INTERNATIONAL normal form, so 050-123-4567,
     * 0501234567 and +972501234567 are recognised as the same number rather than
     * accumulating as three. Emails compare case-insensitively for the same reason.
     */
    async applyChannels(db, id, channels = {}) {
      const added = { phones: 0, emails: 0 };

      const existingPhones = await db.contactPhone.findMany({ where: { contactId: id }, select: { value: true, sortOrder: true } });
      const phonePlan = reconcileAppendOnly({
        current: existingPhones.map((p) => p.value),
        incoming: channels.phones || [],
        isSame: (a, b) => (normalizePhoneIntl(a) || a) === (normalizePhoneIntl(b) || b),
      });
      let phoneOrder = existingPhones.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
      for (const value of phonePlan.add) {
        await db.contactPhone.create({
          // isPrimary stays false: the primary is a GOS decision, and a mirrored
          // addition must never demote the number the office actually calls.
          data: { contactId: id, value, label: 'Pipedrive', isPrimary: false, sortOrder: ++phoneOrder },
        });
        added.phones += 1;
      }

      const existingEmails = await db.contactEmail.findMany({ where: { contactId: id }, select: { value: true, sortOrder: true } });
      const emailPlan = reconcileAppendOnly({
        current: existingEmails.map((e) => e.value),
        incoming: channels.emails || [],
        isSame: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
      });
      let emailOrder = existingEmails.reduce((m, e) => Math.max(m, e.sortOrder ?? 0), 0);
      for (const value of emailPlan.add) {
        await db.contactEmail.create({
          data: { contactId: id, value, label: 'Pipedrive', isPrimary: false, sortOrder: ++emailOrder },
        });
        added.emails += 1;
      }

      return added;
    },

    describe: (gos) => ({ label: `${gos.firstNameHe || ''} ${gos.lastNameHe || ''}`.trim(), orderNo: gos.contactNo }),
  };
}

/**
 * The Activity → Task adapter.
 *
 * Pipedrive activities are GOS Tasks. Only activities that already have a
 * crosswalk are mirrored: a NEW activity has no GOS task, and the mirror does
 * not create records — creation belongs to the import, so a new activity simply
 * resolves to `not_crosswalked` and is visible as such.
 */
export function taskAdapter({ taskTypeIdForKey } = {}) {
  return {
    sourceType: 'activity',
    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;
      const fields = {
        title: str(c.subject),
        // Pipedrive splits due date and time; GOS stores one instant.
        dueAt: c.due_date ? pdDate(`${str(c.due_date)} ${str(c.due_time) || '00:00'}:00`) : null,
        status: c.done === true || c.done === 1 ? 'completed' : 'open',
      };
      const typeKey = ACTIVITY_TYPE_MAP[str(c.type)];
      if (typeKey && taskTypeIdForKey) {
        const id = taskTypeIdForKey(typeKey);
        if (id) fields.taskTypeId = id;
      }
      for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === null) delete fields[k];
      return { fields };
    },
    async loadGos(db, id) {
      // GOS stores dueDate (DateTime) + dueTime ("HH:MM"); the ownership map's
      // field is the single instant `dueAt`. Selecting a literal `dueAt` column
      // was schema drift — the Task model never had one — and it threw on the
      // first real task update the mirror ever processed. Compose the instant
      // here so the merge compares like with like.
      const t = await db.task.findUnique({
        where: { id },
        select: { id: true, title: true, dueDate: true, dueTime: true, status: true, taskTypeId: true, completedAt: true },
      });
      if (!t) return null;
      const date = t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : null;
      return {
        id: t.id,
        title: t.title,
        dueAt: date ? new Date(`${date}T${t.dueTime || '00:00'}:00Z`) : null,
        status: t.status,
        taskTypeId: t.taskTypeId,
        completedAt: t.completedAt,
      };
    },
    async applyGos(db, id, set) {
      const data = { ...set };
      if ('dueAt' in data) {
        const d = data.dueAt ? new Date(data.dueAt) : null;
        delete data.dueAt;
        if (d) {
          data.dueDate = new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
          const hhmm = d.toISOString().slice(11, 16);
          if (hhmm !== '00:00') data.dueTime = hhmm;
        }
      }
      // Completing a task stamps completedAt once; un-completing never erases it
      // silently (the merge already gated the status change itself).
      if (data.status === 'completed') {
        const cur = await db.task.findUnique({ where: { id }, select: { completedAt: true } });
        if (cur && !cur.completedAt) data.completedAt = new Date();
      }
      await db.task.update({ where: { id }, data });
    },
    describe: (gos) => ({ label: gos.title }),
  };
}

/**
 * The Note → TimelineEntry adapter.
 *
 * Imported history is IMMUTABLE (ownership map §4.4): a note edited in Pipedrive
 * appends a revision rather than mutating the original. That makes conflict
 * impossible for the highest-volume entity in the system — 213,729 rows — which
 * is exactly where a merge bug would be most expensive.
 *
 * The adapter therefore offers NO mergeable fields. It exists so a note webhook
 * is captured, attributed and auditable rather than dropped.
 */
export function noteAdapter() {
  return {
    sourceType: 'note',
    immutableAppendOnly: true,
    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;
      return {
        fields: {},
        note: { body: str(c.content), addedAt: pdDate(c.add_time), updatedAt: pdDate(c.update_time) },
      };
    },
    async loadGos() { return { id: 'immutable' }; },
    async applyGos() { /* EDITS never write: imported history is immutable */ },

    /**
     * DELETION is different from an edit (owner ruling 2026-07-31): a note the
     * team deleted in Pipedrive must stop being shown in GOS. Hard delete of the
     * ONE crosswalked TimelineEntry, and only if it still looks like an imported
     * note — kind/actorType are re-checked so that even a corrupted crosswalk
     * could never take out a native GOS timeline record. Idempotent by both the
     * pipeline's sourceDeletedAt guard and deleteMany's natural zero-match.
     */
    async applySourceDeleted(db, entityId) {
      if (!entityId) return null;
      const res = await db.timelineEntry.deleteMany({
        where: { id: entityId, kind: 'note', actorType: 'import' },
      });
      return { deletedTimelineEntries: res.count };
    },

    describe: () => ({ label: 'note' }),
  };
}

/** Entity key ← Pipedrive webhook object name. */
export const PD_OBJECT_TO_ENTITY = Object.freeze({
  deal: 'deal',
  person: 'contact',
  organization: 'organization',
  activity: 'task',
  note: 'note',
});

export function entityForPipedriveObject(object) {
  return PD_OBJECT_TO_ENTITY[String(object || '').toLowerCase()] || null;
}

/** LegacyRecord.sourceType ← entity key (they are NOT the same vocabulary). */
export const ENTITY_TO_SOURCE_TYPE = Object.freeze({
  deal: 'deal',
  contact: 'person',
  organization: 'organization',
  task: 'activity',
  note: 'note',
});

export function adapterFor(entity, deps = {}) {
  if (entity === 'task') return taskAdapter(deps);
  if (entity === 'note') return noteAdapter();
  if (entity === 'deal') return dealAdapter(deps);
  if (entity === 'organization') return organizationAdapter(deps);
  if (entity === 'contact') return contactAdapter();
  return null;
}
