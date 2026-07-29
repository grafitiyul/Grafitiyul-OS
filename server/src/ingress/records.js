// Ingress Platform — THE record writer.
//
// The one place an inbound event becomes GOS business data. Adapters never
// write; the pipeline calls exactly these functions. Two outcomes exist:
//
//   createLeadDeal   — a new conversation: Contact (found or created) + Deal.
//   annotateExistingDeal — the same person inside the dedupe window: no second
//                    deal, a pinned note on the live one. This is the behaviour
//                    the legacy automation had ("לתשומת ליבך הליד פנה בעבר"),
//                    preserved deliberately.
//
// Stage and source are resolved from configuration/catalogue, never hardcoded
// to an id, so a CRM rename cannot silently break ingestion.

import { normalizeClassification } from '../deals/classification.js';
import { writeDealMarketing } from '../deals/marketing.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { createContactFrom, enrichContactChannels, resolveOrganization } from './resolve.js';

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Human-facing source labels. One label per source key, so the Deal's
// attribution text is consistent no matter which adapter produced it.
export const SOURCE_LABELS = Object.freeze({
  meta_lead_ads: 'Meta Lead Ads',
  woocommerce: 'רכישה מהאתר',
  website_form: 'טופס באתר',
});

export function sourceLabelFor(normalized) {
  return SOURCE_LABELS[normalized.source] || normalized.source || 'קליטה חיצונית';
}

// The lead entry stage. Configurable by key (INGRESS_LEAD_STAGE_KEY); otherwise
// the first active stage by sortOrder — the natural "new lead" column. Resolved
// per call so a settings change takes effect without a redeploy.
export async function resolveLeadStageId(db, stageKey = null) {
  if (stageKey) {
    const byKey = await db.dealStage.findUnique({ where: { key: stageKey }, select: { id: true } });
    if (byKey) return byKey.id;
  }
  const first = await db.dealStage.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  return first?.id || null;
}

// DealSource is a label-only catalogue (no stable key column), so find-or-create
// by the exact constant label — deterministic despite being label-based, and
// identical to how the reservations module resolves its own source.
export async function resolveDealSourceId(db, label) {
  const existing = await db.dealSource.findFirst({ where: { label }, select: { id: true } });
  if (existing) return existing.id;
  const created = await db.dealSource.create({ data: { label }, select: { id: true } });
  return created.id;
}

// Attribution rendered for humans. Kept compact: channel + campaign is what an
// operator actually reads; the full UTM set lives on the IngressEvent.
export function attributionSummary(attr) {
  if (!attr) return '';
  const bits = [];
  if (attr.channel) bits.push(attr.channel);
  if (attr.utmCampaign) bits.push(attr.utmCampaign);
  if (attr.utmMedium) bits.push(attr.utmMedium);
  return bits.join(' · ');
}

function dealTitleFor(normalized) {
  const who = normalized.person.displayName || 'ליד חדש';
  return normalized.kind === 'order' ? `הזמנה מהאתר — ${who}` : `ליד חדש — ${who}`;
}

// Money: Deal.valueMinor is BigInt minor units (agorot).
function toMinor(total) {
  if (total === null || total === undefined) return 0n;
  return BigInt(Math.round(Number(total) * 100));
}

/**
 * Create the Contact (if needed) and the Deal. Runs inside the caller's
 * transaction so a partial lead can never be persisted.
 */
export async function createLeadDeal(tx, { normalized, stageKey = null }) {
  let contactId = normalized.resolvedContactId || null;
  let contactCreated = false;

  if (contactId) {
    await enrichContactChannels(tx, contactId, normalized);
  } else {
    const c = await createContactFrom(tx, normalized);
    contactId = c.id;
    contactCreated = true;
  }

  const { organizationId } = await resolveOrganization(tx, normalized);
  const stageId = await resolveLeadStageId(tx, stageKey);
  if (!stageId) {
    const err = new Error('lead_stage_not_found');
    err.code = 'lead_stage_not_found';
    throw err;
  }

  const label = sourceLabelFor(normalized);
  const dealSourceId = await resolveDealSourceId(tx, label);

  // Canonical classification rule — a linked organization forces business and
  // clears the deal-level type copy. Same call shape as the deals route and the
  // reservations processor; never re-derived here.
  const classification = normalizeClassification({
    organizationId,
    activityType: organizationId ? 'business' : 'private',
    organizationTypeId: null,
    organizationSubtypeId: null,
    orgTypeId: null,
    subtypeTypeId: null,
  });

  const attrText = attributionSummary(normalized.attribution);
  const deal = await tx.deal.create({
    data: {
      title: dealTitleFor(normalized),
      dealStageId: stageId,
      status: 'open',
      ...classification,
      organizationId,
      dealSourceId,
      source: attrText ? `${label} — ${attrText}` : label,
      notes: normalized.context.message || null,
      participants: normalized.context.participants ?? null,
      tourDate: normalized.context.preferredDate
        ? normalized.context.preferredDate.toISOString().slice(0, 10)
        : null,
      communicationLanguage: normalized.person.language || null,
      valueMinor: toMinor(normalized.order?.total),
      contacts: { create: [{ contactId, isPrimary: true, roles: ['ongoingBooking'] }] },
    },
    select: { id: true, orderNo: true },
  });

  // THE canonical marketing record — written through the same function the
  // Pipedrive importer uses, into the same columns. This is what makes the Deal
  // panel identical before and after a source cuts over, and it is why
  // attribution must not also be stashed anywhere else on the deal.
  await writeDealMarketing(tx, deal.id, marketingFromIngress(normalized, label));

  return { dealId: deal.id, orderNo: deal.orderNo, contactId, contactCreated, organizationId };
}

/**
 * Map a normalized ingress event onto the canonical marketing shape.
 * Direct ingress is the source that CAN supply real UTM data, so unlike the
 * Pipedrive mapping this one fills the UTM columns.
 */
export function marketingFromIngress(normalized, label) {
  const a = normalized.attribution || {};
  const occurred = normalized.occurredAt instanceof Date ? normalized.occurredAt : null;
  return {
    leadSource: label,
    leadSourceKey: normalized.source || null,
    leadSourceText: normalized.context?.formName || null,
    channel: a.channel || null,
    campaign: a.utmCampaign || null,
    medium: a.utmMedium || null,
    content: a.utmContent || null,
    term: a.utmTerm || null,
    landingUrl: a.landingUrl || null,
    referrer: a.referrer || null,
    utmSource: a.utmSource || null,
    utmMedium: a.utmMedium || null,
    utmCampaign: a.utmCampaign || null,
    utmContent: a.utmContent || null,
    utmTerm: a.utmTerm || null,
    adId: a.adId || null,
    adsetId: a.adsetId || null,
    campaignId: a.campaignId || null,
    originalIngressSource: normalized.source || null,
    sourceCreatedAt: occurred,
    firstTouchAt: occurred,
    firstTouchSource: a.channel || label,
    firstTouchCampaign: a.utmCampaign || null,
    latestTouchAt: occurred,
    latestTouchSource: a.channel || label,
    attributionRaw: { ingress: a },
  };
}

// The intake note — what arrived, from where, with which attribution. Pinned so
// it is the first thing an operator sees on a fresh lead. isSystem:false keeps
// it editable, matching how the reservations module treats operational notes.
export async function writeIntakeNote(tx, { dealId, normalized, ambiguous = false }) {
  const lines = [];
  lines.push(`<b>${escapeHtml(sourceLabelFor(normalized))}</b>`);
  const attr = attributionSummary(normalized.attribution);
  if (attr) lines.push(escapeHtml(attr));
  if (normalized.context.formName) lines.push(`טופס: ${escapeHtml(normalized.context.formName)}`);
  if (normalized.context.interestedIn) lines.push(`מתעניין ב: ${escapeHtml(normalized.context.interestedIn)}`);
  if (normalized.context.message) lines.push(escapeHtml(normalized.context.message));
  if (normalized.context.pageUrl) lines.push(escapeHtml(normalized.context.pageUrl));
  if (normalized.order?.items?.length) {
    lines.push('פריטים:');
    for (const it of normalized.order.items) {
      lines.push(`• ${escapeHtml(it.name || it.sku || it.externalId)} ×${it.quantity}`);
    }
  }
  if (ambiguous) {
    lines.push('<b>⚠ מספר הטלפון משויך ליותר מאיש קשר אחד — יש לוודא שיוך נכון</b>');
  }

  await tx.timelineEntry.create({
    data: {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'note',
      body: `<p>${lines.join('<br>')}</p>`,
      isPinned: true,
      isSystem: false,
      actorType: 'system',
      actorLabel: sourceLabelFor(normalized),
      data: { event: 'ingress_intake', source: normalized.source, sourceKey: normalized.sourceKey },
    },
  });
}

// Repeat contact inside the dedupe window: annotate, never duplicate.
export async function annotateExistingDeal(tx, { dealId, normalized }) {
  const attr = attributionSummary(normalized.attribution);
  const parts = [
    `<b>פנייה נוספת — ${escapeHtml(sourceLabelFor(normalized))}</b>`,
    attr ? escapeHtml(attr) : null,
    normalized.context.message ? escapeHtml(normalized.context.message) : null,
    normalized.context.pageUrl ? escapeHtml(normalized.context.pageUrl) : null,
  ].filter(Boolean);

  await tx.timelineEntry.create({
    data: {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'note',
      body: `<p>${parts.join('<br>')}</p>`,
      isPinned: true,
      isSystem: false,
      actorType: 'system',
      actorLabel: sourceLabelFor(normalized),
      data: { event: 'ingress_repeat_contact', source: normalized.source },
    },
  });
  return { dealId };
}

// History entry on the deal — the immutable audit line (distinct from the
// editable operational note above).
export async function emitIngressHistory(tx, { dealId, normalized, outcome }) {
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'change',
    body: outcome === 'created_deal'
      ? `נוצר מקליטה חיצונית — ${sourceLabelFor(normalized)}`
      : `פנייה נוספת נקלטה — ${sourceLabelFor(normalized)}`,
    data: {
      event: 'ingress',
      outcome,
      source: normalized.source,
      sourceKey: normalized.sourceKey,
      externalId: normalized.externalId,
      attribution: normalized.attribution,
    },
    origin: { actorType: 'system', actorLabel: sourceLabelFor(normalized), createdBy: null, createdByName: null },
  });
}
