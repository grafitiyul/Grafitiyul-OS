// Pipedrive → canonical DealMarketing mapping.
//
// The field keys below are Pipedrive custom-field hashes, verified against
// snapshot snap-20260728T171134Z-65d8 (24,640 deals). Measured fill rates:
//
//   Deal created        (add_time)  100%
//   Source origin       (origin)    100%   API | ManuallyCreated | Automation
//   מקור                 80.2%   free text  — דף נחיתה, המלצה, פייסבוק…
//   מקור-רשימה סגורה     69.9%   33-option closed list
//   קמפיין               15.6%   free text  — FB-COLD-Grafiti-AD2-short, וואטספ…
//   Source origin ID    (origin_id) 0.1%
//
// Pipedrive holds NO UTM data, no landing page, no referrer and no gclid/fbclid.
// That is a measured finding, not an assumption — the audit script
// (scripts/migration/marketing-audit.mjs) reproduces it from the snapshot with
// zero API calls. The UTM columns therefore stay empty until direct ingress
// fills them, which is exactly the designed hand-over.

export const PD_FIELD_KEYS = Object.freeze({
  leadSourceList: 'b5fbb89a2499268c9bdc95b4bb34dda000a8f172', // מקור-רשימה סגורה (enum)
  leadSourceText: '35a2565c8f374bbb994cd97accedaff2db273aba', // מקור (varchar)
  campaign: '412d86415428dc30693364760314252259faa86a',       // קמפיין (varchar)
  origin: 'origin',
  originId: 'origin_id',
  addTime: 'add_time',
});

const val = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw.value ?? raw.name ?? raw.label ?? null;
  return raw;
};

const str = (v) => {
  const x = val(v);
  if (x === null) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
};

const date = (v) => {
  const s = str(v);
  if (!s) return null;
  // Pipedrive emits 'YYYY-MM-DD HH:mm:ss' (UTC). Date can't parse that reliably
  // across engines, so normalise to ISO before handing it over.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Build an option-id → label index from the snapshot's dealFields definition.
 * Labels are resolved from the source of truth rather than hardcoded, because
 * the closed list has been edited repeatedly (33 options, ids 106–472) and a
 * frozen copy would silently rot.
 */
export function buildLeadSourceOptions(dealFields = []) {
  const field = dealFields.find((f) => f.key === PD_FIELD_KEYS.leadSourceList);
  const map = new Map();
  for (const o of field?.options || []) map.set(String(o.id), String(o.label));
  return map;
}

/**
 * Map ONE Pipedrive deal record to the canonical marketing shape.
 * `optionLabels` comes from buildLeadSourceOptions.
 */
export function mapPipedriveMarketing(deal, optionLabels = new Map()) {
  const listId = str(deal?.[PD_FIELD_KEYS.leadSourceList]);
  const leadSource = listId ? optionLabels.get(String(listId)) || null : null;
  const leadSourceText = str(deal?.[PD_FIELD_KEYS.leadSourceText]);
  const campaign = str(deal?.[PD_FIELD_KEYS.campaign]);
  const origin = str(deal?.[PD_FIELD_KEYS.origin]);
  const originId = str(deal?.[PD_FIELD_KEYS.originId]);
  const createdAt = date(deal?.[PD_FIELD_KEYS.addTime]);

  // An unresolved option id must never be written as if it were a label — that
  // is how "112" ends up displayed to an operator as their lead source.
  const unresolvedOption = listId && !leadSource ? String(listId) : null;

  return {
    leadSource,
    leadSourceKey: listId || null,
    leadSourceText,
    campaign,
    // Channel is left null: the canonical resolver derives it in the write path
    // so imported and ingress deals cannot disagree.
    channel: null,
    // Provenance. 'pipedrive:API' | 'pipedrive:ManuallyCreated' | 'pipedrive:Automation'
    originalIngressSource: origin ? `pipedrive:${origin}` : 'pipedrive',
    sourceCreatedAt: createdAt,
    // First touch is what the source can honestly attest: when the deal was
    // created, and where it said it came from. Immutable from here on.
    firstTouchAt: createdAt,
    firstTouchSource: leadSource || leadSourceText || null,
    firstTouchCampaign: campaign,
    attributionRaw: {
      pipedrive: {
        origin,
        originId,
        leadSourceOptionId: listId,
        leadSourceLabel: leadSource,
        leadSourceFreeText: leadSourceText,
        campaign,
        ...(unresolvedOption ? { unresolvedLeadSourceOption: unresolvedOption } : {}),
      },
    },
  };
}

/**
 * Plan a marketing backfill over a set of Pipedrive deal records.
 * READ-ONLY: returns rows to write plus honest statistics, writes nothing.
 */
export function planMarketingImport({ deals, dealIdByPipedriveId, optionLabels }) {
  const rows = [];
  const stats = {
    dealsSeen: 0,
    mapped: 0,
    skippedNoCrosswalk: 0,
    skippedNothingToWrite: 0,
    withLeadSource: 0,
    withCampaign: 0,
    unresolvedOptions: 0,
  };

  for (const d of deals) {
    stats.dealsSeen += 1;
    const gosDealId = dealIdByPipedriveId.get(String(d.id));
    if (!gosDealId) { stats.skippedNoCrosswalk += 1; continue; }

    const m = mapPipedriveMarketing(d, optionLabels);
    // leadSourceKey counts as meaningful even when its label does not resolve:
    // the raw option id is exactly what lets the value be recovered once the
    // closed list is re-read. Dropping the row would throw that away silently.
    const meaningful = m.leadSource || m.leadSourceKey || m.leadSourceText || m.campaign || m.sourceCreatedAt;
    if (!meaningful) { stats.skippedNothingToWrite += 1; continue; }

    if (m.leadSource || m.leadSourceText) stats.withLeadSource += 1;
    if (m.campaign) stats.withCampaign += 1;
    if (m.attributionRaw?.pipedrive?.unresolvedLeadSourceOption) stats.unresolvedOptions += 1;

    rows.push({ dealId: gosDealId, pipedriveId: String(d.id), marketing: m });
    stats.mapped += 1;
  }

  return { rows, stats };
}
