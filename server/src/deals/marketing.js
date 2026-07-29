// Deal Marketing — THE one write path for the canonical marketing/attribution
// record on a Deal.
//
// Both producers go through here:
//   * the Pipedrive importer/mirror (today)
//   * the ingress platform (after each source cuts over)
//
// They write the SAME fields through the SAME function, which is what makes the
// Deal panel survive cutover without a UI change and stops marketing data from
// existing in two shapes.
//
// Two merge rules, deliberately opposite (see the ownership map §6.5):
//   firstTouch*  — IMMUTABLE once set. A later payload claiming a different
//                  first touch is a conflict, never an overwrite. Overwriting it
//                  is the classic attribution bug: every re-touch rewrites
//                  history until every lead looks like it came from the last ad.
//   latestTouch* — overwritten freely. That is what "latest" means.
//
// Everything else is "fill, do not clobber": a null incoming value never erases
// a value that is already known.

import { channelLabel } from '../ingress/attribution.js';

// The canonical field set. Listed once, used by the writer, the differ and the
// API serializer, so the three can never drift apart.
export const MARKETING_FIELDS = Object.freeze([
  'leadSource', 'leadSourceKey', 'leadSourceText', 'channel',
  'campaign', 'medium', 'content', 'term',
  'landingUrl', 'referrer',
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  'adId', 'adsetId', 'campaignId',
  'originalIngressSource', 'sourceCreatedAt',
]);

export const FIRST_TOUCH_FIELDS = Object.freeze(['firstTouchAt', 'firstTouchSource', 'firstTouchCampaign']);
export const LATEST_TOUCH_FIELDS = Object.freeze(['latestTouchAt', 'latestTouchSource']);

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Resolve the derived acquisition channel through the ONE shared resolver.
 * Never computed inline anywhere else.
 */
export function resolveChannel(input) {
  return channelLabel({
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    source: input.ingressSource || null,
    legacyLabel: input.leadSource || input.leadSourceText || null,
  });
}

/**
 * Compute what a write WOULD do, without touching the database.
 * Returns { set, firstTouchConflict } so callers can plan, test and surface a
 * conflict rather than discovering it after the fact.
 */
export function planMarketingWrite(existing, incoming) {
  const set = {};
  const cur = existing || {};

  for (const f of MARKETING_FIELDS) {
    const v = incoming[f];
    if (blank(v)) continue;                      // never erase what we know
    if (f === 'originalIngressSource' && !blank(cur[f])) continue; // write-once
    if (String(cur[f] ?? '') === String(v ?? '')) continue;
    set[f] = v;
  }

  // First touch: settable once, then immutable.
  let firstTouchConflict = null;
  const incomingFirst = FIRST_TOUCH_FIELDS.some((f) => !blank(incoming[f]));
  if (incomingFirst) {
    if (blank(cur.firstTouchAt) && blank(cur.firstTouchSource)) {
      for (const f of FIRST_TOUCH_FIELDS) if (!blank(incoming[f])) set[f] = incoming[f];
    } else {
      const differs = FIRST_TOUCH_FIELDS.some(
        (f) => !blank(incoming[f]) && String(cur[f] ?? '') !== String(incoming[f] ?? ''),
      );
      if (differs) {
        firstTouchConflict = {
          field: 'firstTouch',
          existing: Object.fromEntries(FIRST_TOUCH_FIELDS.map((f) => [f, cur[f] ?? null])),
          incoming: Object.fromEntries(FIRST_TOUCH_FIELDS.map((f) => [f, incoming[f] ?? null])),
        };
      }
    }
  }

  // Latest touch: always overwritten when supplied.
  for (const f of LATEST_TOUCH_FIELDS) {
    if (blank(incoming[f])) continue;
    if (String(cur[f] ?? '') === String(incoming[f] ?? '')) continue;
    set[f] = incoming[f];
  }

  // The raw bag is replaced wholesale when supplied — it is a snapshot, not a merge.
  if (incoming.attributionRaw !== undefined && incoming.attributionRaw !== null) {
    set.attributionRaw = incoming.attributionRaw;
  }

  return { set, firstTouchConflict };
}

/**
 * Upsert the marketing record for a deal. Returns
 * { created, changed, set, firstTouchConflict }.
 *
 * The first-touch conflict is RETURNED, not thrown: the write of every other
 * field still proceeds (the operator should not lose a campaign update because
 * an attribution question is open), and the caller raises the conflict.
 */
export async function writeDealMarketing(db, dealId, incoming) {
  const payload = { ...incoming };
  if (blank(payload.channel)) payload.channel = resolveChannel(payload);

  const existing = await db.dealMarketing.findUnique({ where: { dealId } });
  const { set, firstTouchConflict } = planMarketingWrite(existing, payload);

  if (!existing) {
    await db.dealMarketing.create({ data: { dealId, ...set } });
    return { created: true, changed: Object.keys(set).length, set, firstTouchConflict };
  }
  if (Object.keys(set).length) {
    await db.dealMarketing.update({ where: { dealId }, data: set });
  }
  return { created: false, changed: Object.keys(set).length, set, firstTouchConflict };
}

/**
 * The Deal-panel DTO. Business language only — no ids, no enum keys, no JSON.
 * `hasAny` lets the panel render an honest empty state instead of a grid of
 * dashes, and `groups` is ordered the way the panel reads it so the server owns
 * presentation order rather than duplicating it in the client.
 */
// Provenance in business language. The operator must never be shown
// "pipedrive:ManuallyCreated" — that is an internal token, not information.
const INGRESS_LABELS = Object.freeze({
  'pipedrive:ManuallyCreated': 'הוזן ידנית במערכת הקודמת',
  'pipedrive:API': 'נקלט אוטומטית למערכת הקודמת',
  'pipedrive:Automation': 'נוצר באוטומציה במערכת הקודמת',
  pipedrive: 'המערכת הקודמת',
  meta_lead_ads: 'Meta — טופס לידים',
  woocommerce: 'רכישה מהאתר',
  website_form: 'טופס באתר',
  agent_reservation: 'הזמנת סוכן',
});

export function ingressLabel(v) {
  if (blank(v)) return null;
  const s = String(v);
  return INGRESS_LABELS[s] || (s.startsWith('pipedrive') ? INGRESS_LABELS.pipedrive : s);
}

// Israeli date form. ISO is a storage format, not something to read.
export function heDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
}

export function marketingDto(m) {
  if (!m) return { hasAny: false, syncedFromLegacy: false, groups: [] };

  const row = (label, value) => (blank(value) ? null : { label, value: String(value) });
  const date = heDate;

  const groups = [
    {
      key: 'source',
      title: 'מקור הליד',
      rows: [
        row('מקור', m.leadSource || m.leadSourceText),
        row('פירוט', m.leadSource && m.leadSourceText && m.leadSource !== m.leadSourceText ? m.leadSourceText : null),
        // The channel is DERIVED from the source. When it lands on the same
        // value it says nothing, and a row that repeats the row above it is
        // noise — so it only appears when it adds information.
        row('ערוץ', m.channel && m.channel !== (m.leadSource || m.leadSourceText) ? m.channel : null),
        row('קמפיין', m.campaign),
      ].filter(Boolean),
    },
    {
      key: 'utm',
      title: 'פרמטרי UTM',
      rows: [
        row('utm_source', m.utmSource),
        row('utm_medium', m.utmMedium || m.medium),
        row('utm_campaign', m.utmCampaign),
        row('utm_content', m.utmContent || m.content),
        row('utm_term', m.utmTerm || m.term),
      ].filter(Boolean),
    },
    {
      key: 'landing',
      title: 'הגעה לאתר',
      rows: [
        row('דף נחיתה', m.landingUrl),
        row('מפנה', m.referrer),
      ].filter(Boolean),
    },
    {
      key: 'touch',
      title: 'נקודות מגע',
      rows: [
        row('מגע ראשון', [date(m.firstTouchAt), m.firstTouchSource, m.firstTouchCampaign].filter(Boolean).join(' · ')),
        row('מגע אחרון', [date(m.latestTouchAt), m.latestTouchSource].filter(Boolean).join(' · ')),
      ].filter(Boolean),
    },
    {
      key: 'origin',
      title: 'מקור הרשומה',
      rows: [
        row('נוצר דרך', ingressLabel(m.originalIngressSource)),
        row('נוצר בתאריך', date(m.sourceCreatedAt)),
      ].filter(Boolean),
    },
  ].filter((g) => g.rows.length);

  // Ownership signal for the badge. Derived from provenance on the SERVER —
  // the client must not infer "came from legacy" from an id range or a date.
  const syncedFromLegacy = String(m.originalIngressSource || '').startsWith('pipedrive');

  return { hasAny: groups.length > 0, syncedFromLegacy, groups };
}
