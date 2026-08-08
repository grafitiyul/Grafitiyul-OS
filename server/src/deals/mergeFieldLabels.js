// ── What each conflicting value ACTUALLY IS, in business language ───────────
//
// The merge wizard asks "which value should survive?". That question is only
// answerable if the operator can SEE both values. A deal stores most of its
// context as foreign keys, so the honest answer for "מקור הליד" is not the cuid
// and it is certainly not "ערך אחר" — it is "אתר" and "המלצה".
//
// So the labels are resolved HERE, on the server, where the catalogs are:
//   • the client can then never render an id, because it never receives one;
//   • the resolution is the SAME one the rest of GOS uses (the catalog's own
//     display column, the shared language vocabulary, the shared activity
//     labels) rather than a second opinion invented for this screen;
//   • it costs a bounded number of queries — one per catalog, for both deals
//     together, never one per field.
//
// A null/empty value resolves to null here and is rendered as "לא הוגדר" by the
// wizard. That distinction matters: "the operator chose nothing" is a real
// answer to a merge question, and must not look like a missing label.

import { ACTIVITY_TYPE_LABELS_HE } from '../../../shared/dealActivity.mjs';
import { tourLanguageLabel, commLanguageLabel } from '../../../shared/language.mjs';

// How each merged field turns into something a person can read.
//   ref     — the catalog to load and the column to show
//   format  — a pure formatter over the raw value
//   long    — free text: the client truncates and offers the full value
const FIELD_DISPLAY = Object.freeze({
  organizationId: { ref: 'organization' },
  organizationUnitId: { ref: 'organizationUnit' },
  organizationSubtypeId: { ref: 'organizationSubtype' },
  organizationTypeId: { ref: 'organizationType' },
  productId: { ref: 'product' },
  productVariantId: { ref: 'productVariant' },
  locationId: { ref: 'location' },
  dealSourceId: { ref: 'dealSource' },
  paymentTermId: { ref: 'paymentTerm' },
  paymentMethodId: { ref: 'paymentMethod' },
  ownerUserId: { ref: 'adminUser' },
  activityType: { format: (v) => ACTIVITY_TYPE_LABELS_HE[v] || v },
  tourLanguage: { format: (v) => tourLanguageLabel(v) },
  communicationLanguage: { format: (v) => commLanguageLabel(v) },
  tourDate: { format: fmtIsoDate },
  expectedCloseDate: { format: fmtDate },
  tourTime: { format: (v) => String(v) },
  groups: { format: (v) => `${v} קבוצות` },
  durationHours: { format: (v) => `${v} שעות` },
  currency: { format: (v) => String(v) },
  source: { long: true },
  groupName: { long: true },
});

function fmtIsoDate(v) {
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function fmtDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return fmtIsoDate(d.toISOString().slice(0, 10));
}

const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// Which catalog rows each ref needs, and how one row becomes a label. Every
// entry uses the catalog's OWN display column — the same one the Deal page and
// global search read — so a rename in settings changes this screen too.
const REFS = {
  organization: {
    load: (db, ids) => db.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, orgNo: true } }),
    label: (r) => r.name,
    hint: (r) => (r.orgNo ? `ארגון #${r.orgNo}` : null),
  },
  organizationUnit: {
    load: (db, ids) => db.organizationUnit.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    label: (r) => r.name,
  },
  organizationSubtype: {
    load: (db, ids) => db.organizationSubtype.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }),
    label: (r) => r.label,
  },
  organizationType: {
    load: (db, ids) => db.organizationType.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }),
    label: (r) => r.label,
  },
  product: {
    load: (db, ids) => db.product.findMany({ where: { id: { in: ids } }, select: { id: true, nameHe: true, nameEn: true } }),
    label: (r) => r.nameHe || r.nameEn,
  },
  productVariant: {
    // A variant has no name of its own — it IS a Product × Location pair, and
    // its identity to an operator is exactly how search renders it.
    load: (db, ids) => db.productVariant.findMany({
      where: { id: { in: ids } },
      select: { id: true, product: { select: { nameHe: true, nameEn: true } }, location: { select: { nameHe: true } } },
    }),
    label: (r) => [r.product?.nameHe || r.product?.nameEn, r.location?.nameHe].filter(Boolean).join(' — '),
  },
  location: {
    load: (db, ids) => db.location.findMany({ where: { id: { in: ids } }, select: { id: true, nameHe: true, nameEn: true } }),
    label: (r) => r.nameHe || r.nameEn,
  },
  dealSource: {
    load: (db, ids) => db.dealSource.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }),
    label: (r) => r.label,
  },
  paymentTerm: {
    load: (db, ids) => db.paymentTerm.findMany({ where: { id: { in: ids } }, select: { id: true, nameHe: true, nameEn: true } }),
    label: (r) => r.nameHe || r.nameEn,
  },
  paymentMethod: {
    load: (db, ids) => db.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, nameHe: true, nameEn: true } }),
    label: (r) => r.nameHe || r.nameEn,
  },
  adminUser: {
    load: (db, ids) => db.adminUser.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }),
    label: (r) => r.username,
  },
};

/**
 * Resolve display labels for every merged field on BOTH deals.
 *
 * @returns Map<fieldKey, { survivor: {value,label,hint,long}, other: {...} }>
 *          where `label` is null ONLY when the stored value is genuinely empty.
 */
export async function resolveFieldLabels(db, fields, survivorDeal, otherDeal) {
  // 1. Collect the ids each catalog needs, for both deals at once.
  const wanted = new Map(); // refName → Set(id)
  for (const f of fields) {
    const spec = FIELD_DISPLAY[f.key];
    if (!spec?.ref) continue;
    for (const deal of [survivorDeal, otherDeal]) {
      const v = deal?.[f.key];
      if (isEmpty(v)) continue;
      if (!wanted.has(spec.ref)) wanted.set(spec.ref, new Set());
      wanted.get(spec.ref).add(v);
    }
  }

  // 2. One query per catalog that is actually referenced — never per field.
  const loaded = new Map(); // refName → Map(id → row)
  await Promise.all([...wanted.entries()].map(async ([ref, ids]) => {
    const rows = await REFS[ref].load(db, [...ids]);
    loaded.set(ref, new Map(rows.map((r) => [r.id, r])));
  }));

  // 3. Turn each side's raw value into { value, label, hint, long }.
  const describe = (key, raw) => {
    if (isEmpty(raw)) return { value: null, label: null, hint: null, long: false };
    const spec = FIELD_DISPLAY[key];
    if (!spec) return { value: String(raw), label: String(raw), hint: null, long: false };
    if (spec.ref) {
      const row = loaded.get(spec.ref)?.get(raw);
      // A dangling reference is stated as such rather than shown as an id: the
      // operator can still choose it, and is told the catalog entry is gone.
      if (!row) return { value: null, label: 'ערך שנמחק מהקטלוג', hint: null, long: false, missing: true };
      const def = REFS[spec.ref];
      return { value: def.label(row), label: def.label(row), hint: def.hint?.(row) || null, long: false };
    }
    const label = spec.format ? spec.format(raw) : String(raw);
    return { value: String(raw), label, hint: null, long: !!spec.long };
  };

  const out = new Map();
  for (const f of fields) {
    out.set(f.key, {
      survivor: describe(f.key, survivorDeal?.[f.key]),
      other: describe(f.key, otherDeal?.[f.key]),
    });
  }
  return out;
}

/** Exported for the shape test: every merged field must have a display rule. */
export const DISPLAYABLE_FIELD_KEYS = Object.freeze(Object.keys(FIELD_DISPLAY));
