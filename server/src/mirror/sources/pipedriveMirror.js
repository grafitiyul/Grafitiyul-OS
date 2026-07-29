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
export function dealAdapter({ stageKeyForPipedriveStage, stageIdForKey }) {
  return {
    sourceType: 'deal',

    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;

      const stageKey = stageKeyForPipedriveStage ? stageKeyForPipedriveStage(c.stage_id) : null;
      const fields = {
        title: str(c.title),
        status: str(c.status),
        valueMinor: toMinor(c.value),
        currency: str(c.currency),
        wonAt: pdDate(c.won_time),
        lostAt: pdDate(c.lost_time),
        lostReason: str(c.lost_reason),
        expectedCloseDate: pdDate(c.expected_close_date),
      };
      // Only offer the stage when it translates; an unmapped stage must not
      // become null and silently move the deal to the first column.
      if (stageKey && stageIdForKey) {
        const id = stageIdForKey(stageKey);
        if (id) fields.dealStageId = id;
      }

      // Fields the mirror is allowed to touch but that are absent from a given
      // payload must not be offered at all — `undefined` means "the source said
      // nothing", which is different from "the source says empty".
      for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

      return {
        fields,
        legacySourceLabel: str(c[PD_FIELD_KEYS.leadSourceText]) || null,
      };
    },

    async loadGos(db, id) {
      return db.deal.findUnique({
        where: { id },
        select: {
          id: true, orderNo: true, title: true, status: true, valueMinor: true, currency: true,
          wonAt: true, lostAt: true, lostReason: true, expectedCloseDate: true, dealStageId: true,
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

/** The Organization adapter. */
export function organizationAdapter() {
  return {
    sourceType: 'organization',
    async normalize(payload) {
      if (isDeleteEvent(payload)) return { sourceDeleted: true, fields: {} };
      const c = payload?.current ?? payload?.data ?? payload;
      return { fields: { name: str(c.name), address: str(c.address) } };
    },
    async loadGos(db, id) {
      return db.organization.findUnique({ where: { id }, select: { id: true, orgNo: true, name: true, address: true, taxId: true } });
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
      return { fields };
    },
    async loadGos(db, id) {
      return db.contact.findUnique({
        where: { id },
        select: { id: true, contactNo: true, firstNameHe: true, lastNameHe: true, taxId: true },
      });
    },
    async applyGos(db, id, set) { await db.contact.update({ where: { id }, data: set }); },
    describe: (gos) => ({ label: `${gos.firstNameHe || ''} ${gos.lastNameHe || ''}`.trim(), orderNo: gos.contactNo }),
  };
}

/** Entity key ← Pipedrive webhook object name. */
export const PD_OBJECT_TO_ENTITY = Object.freeze({
  deal: 'deal',
  person: 'contact',
  organization: 'organization',
});

export function entityForPipedriveObject(object) {
  return PD_OBJECT_TO_ENTITY[String(object || '').toLowerCase()] || null;
}

/** LegacyRecord.sourceType ← entity key (they are NOT the same vocabulary). */
export const ENTITY_TO_SOURCE_TYPE = Object.freeze({
  deal: 'deal',
  contact: 'person',
  organization: 'organization',
});

export function adapterFor(entity, deps = {}) {
  if (entity === 'deal') return dealAdapter(deps);
  if (entity === 'organization') return organizationAdapter();
  if (entity === 'contact') return contactAdapter();
  return null;
}
