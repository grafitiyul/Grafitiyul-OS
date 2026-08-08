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

import { ISRAEL_TZ, israelDateOf } from '../lib/israelDate.js';
import { normalizeClassification } from '../deals/classification.js';
import { writeDealMarketing } from '../deals/marketing.js';
import { emitTimelineEvent, touchDealActivity } from '../timeline/events.js';
import { createContactFrom, enrichContactChannels, resolveOrganization } from './resolve.js';
import { resolveIngressLanguage } from './language.js';

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

/**
 * THE activity-type rule for external intake — one function, every adapter.
 *
 * A LEAD carries NO activity type. Until 2026-08 every ingress event without an
 * organization was stamped 'פרטי', which is a guess dressed as data: a website
 * or Meta lead says nothing about whether the enquiry is private, group or
 * business, and an operator reading "פרטי" on a fresh lead had no way to tell a
 * real classification from the default. Unclassified is the honest state — the
 * office classifies when it knows.
 *
 * An ORDER is 'group', paid or not. A store order is a tour order, and that is
 * known from WHAT it is, not from whether the money arrived: an abandoned
 * checkout for a tour is still a tour enquiry, not a generic lead. Payment
 * status drives the deal's business status (WON), never its classification.
 *
 * A linked organization still wins over all of this — normalizeClassification
 * forces 'business', which is the project's classification SSOT and the only
 * place 'business' may come from.
 */
export function activityTypeForIngress(normalized) {
  return normalized?.kind === 'order' ? 'group' : null;
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
  //
  const classification = normalizeClassification({
    organizationId,
    activityType: activityTypeForIngress(normalized),
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
        ? israelDateOf(normalized.context.preferredDate)
        : null,
      // Which language GOS speaks to this customer. Resolved by the canonical
      // conservative rule (ingress/language.js) — English only on positive
      // evidence, never merely because the name is not Hebrew. null keeps the
      // system-wide Hebrew default, exactly as before.
      communicationLanguage: resolveIngressLanguage(normalized),
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

// Blank answers are rendered explicitly rather than skipped: "asked and left
// empty" is information an operator acts on, and silently omitting it would be
// indistinguishable from "never asked".
const UNANSWERED = '— ללא מענה';

// Submission time as the customer experienced it. The provider's own timestamp,
// not processing time — a delayed delivery or a replay must still read as "when
// they filled the form". Israel time via the shared constant, never a second
// notion of the project's timezone.
function submittedAtText(occurredAt) {
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) return null;
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: ISRAEL_TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(occurredAt);
}

/**
 * THE intake note body. A pure function of the normalized event — no database,
 * no side effects — so the dry-run preview and the real write render byte-identical
 * text. If these ever diverge, shadow-mode comparison stops being trustworthy.
 *
 * Contains ONLY customer-submitted content plus non-sensitive source context.
 * Access tokens, signatures, app secrets and raw headers are never referenced
 * here — they live on the IngressEvent, which is not customer-facing.
 */
export function buildIntakeNoteBody(normalized, { ambiguous = false } = {}) {
  const lines = [];
  lines.push(`<b>${escapeHtml(sourceLabelFor(normalized))}</b>`);
  const attr = attributionSummary(normalized.attribution);
  if (attr) lines.push(escapeHtml(attr));

  // ── What the customer actually submitted ──────────────────────────────────
  const answers = normalized.context?.formAnswers || [];
  if (answers.length) {
    lines.push('');
    lines.push('<b>תוכן הטופס</b>');
    for (const a of answers) {
      const label = escapeHtml(a.label || a.key || '—');
      lines.push(a.answered && a.value ? `${label}: ${escapeHtml(a.value)}` : `${label}: ${UNANSWERED}`);
    }
  } else {
    // Sources with no per-question payload (Woo orders, simple forms) keep the
    // original compact rendering.
    if (normalized.context.formName) lines.push(`טופס: ${escapeHtml(normalized.context.formName)}`);
    if (normalized.context.interestedIn) lines.push(`מתעניין ב: ${escapeHtml(normalized.context.interestedIn)}`);
    if (normalized.context.message) lines.push(escapeHtml(normalized.context.message));
    if (normalized.context.pageUrl) lines.push(escapeHtml(normalized.context.pageUrl));
  }

  if (normalized.order?.items?.length) {
    lines.push('');
    lines.push('<b>פריטים</b>');
    for (const it of normalized.order.items) {
      lines.push(`• ${escapeHtml(it.name || it.sku || it.externalId)} ×${it.quantity}`);
    }
  }

  // ── Where it came from ────────────────────────────────────────────────────
  const a = normalized.attribution || {};
  const extra = normalized.extra || {};
  const src = [
    ['טופס', normalized.context?.formName],
    ['מזהה טופס', extra.formId],
    ['נשלח בתאריך', submittedAtText(normalized.occurredAt)],
    ['מזהה ליד', normalized.externalId],
    ['קמפיין', a.utmCampaign || a.campaignId],
    ['ערכת מודעות', a.adsetId],
    ['מודעה', a.adId],
    ['פלטפורמה', extra.platform],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (src.length) {
    // Two blank lines: the note reads as three distinct blocks — header, what
    // the customer wrote, where it came from.
    lines.push('');
    lines.push('');
    lines.push('<b>פרטי מקור</b>');
    for (const [k, v] of src) lines.push(`${k}: ${escapeHtml(v)}`);
  }

  if (ambiguous) {
    lines.push('');
    lines.push('<b>⚠ מספר הטלפון משויך ליותר מאיש קשר אחד — יש לוודא שיוך נכון</b>');
  }

  return `<p>${lines.join('<br>')}</p>`;
}

// The intake note — what arrived, from where, with which attribution.
//
// Deliberately NOT pinned: the explicit `createdAt` below already makes it the
// first entry on the deal, so pinning would only spend the operator's manual
// FOCUS slot on something chronology already guarantees. isSystem:false keeps
// it editable, matching how the reservations module treats operational notes.
//
// `createdAt` is passed explicitly by the pipeline. The column default is
// CURRENT_TIMESTAMP, which in PostgreSQL returns the TRANSACTION start time —
// identical for every row written in the same transaction. Relying on it would
// make "the first note" a tie broken arbitrarily, so the caller stamps an
// explicit instant and the history entry that follows takes a later one.
export async function writeIntakeNote(tx, { dealId, normalized, ambiguous = false, createdAt = null }) {
  await tx.timelineEntry.create({
    data: {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'note',
      body: buildIntakeNoteBody(normalized, { ambiguous }),
      isPinned: false,
      isSystem: false,
      actorType: 'system',
      actorLabel: sourceLabelFor(normalized),
      data: { event: 'ingress_intake', source: normalized.source, sourceKey: normalized.sourceKey },
      ...(createdAt ? { createdAt } : {}),
    },
  });
  await touchDealActivity(tx, dealId, createdAt || new Date());
}

// ── External order lifecycle ────────────────────────────────────────────────
//
// A Woo order reaches GOS at every stage of its life, not only when it is paid.
// Each delivery becomes a PINNED internal note on the one deal that order owns,
// so an operator opening it sees immediately what actually happened — an
// abandoned checkout, a failed payment, a cancellation, a refund.
//
// Two rules the note text obeys absolutely:
//   1. Only what Woo actually sent. A field the payload does not carry is shown
//      as "—", never guessed and never back-filled from elsewhere.
//   2. It is stamped as an automatic internal note that is NEVER sent to the
//      customer, because it is pinned and highly visible and an operator must
//      not have to wonder whether the customer saw it.

const MONEY = (v, currency) =>
  v === null || v === undefined || v === '' ? null : `${v}${currency ? ` ${currency}` : ''}`;

const dt = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('he-IL', { timeZone: ISRAEL_TZ, dateStyle: 'short', timeStyle: 'short' }).format(d);
};

/**
 * THE pinned order-status note. Pure — no database, no side effects — so the
 * dry-run preview and the real write render byte-identical text.
 *
 * `meaning` comes from the adapter's ONE status catalogue; this function never
 * decides what a status means.
 */
export function buildOrderStatusNoteBody(normalized, meaning, { previousStatus = null } = {}) {
  const e = normalized.extra || {};
  const o = normalized.order || {};
  const p = normalized.person || {};
  const a = normalized.attribution || {};
  const cur = o.currency || null;
  const lines = [];

  lines.push(`<b>${escapeHtml(meaning.icon)} ${escapeHtml(meaning.title)}</b>`);
  if (meaning.detail) lines.push(escapeHtml(meaning.detail));
  if (previousStatus && previousStatus !== meaning.status) {
    lines.push(`שינוי סטטוס: <b>${escapeHtml(previousStatus)}</b> ← <b>${escapeHtml(meaning.status)}</b>`);
  }

  // ── The order ─────────────────────────────────────────────────────────────
  const order = [
    ['מספר הזמנה', e.orderNumber || normalized.externalId],
    ['סטטוס בוו', meaning.status],
    ['סכום', MONEY(o.total, cur)],
    ['הנחה', MONEY(e.discountTotal, cur)],
    ['משלוח', MONEY(e.shippingTotal, cur)],
    ['מע״מ', MONEY(e.totalTax, cur)],
    ['אמצעי תשלום', e.paymentMethod],
    ['מזהה עסקה', e.transactionId],
    ['קופון', (e.couponLines || []).join(', ') || null],
    ['תאריך סיור', normalized.context?.preferredDate
      ? israelDateOf(normalized.context.preferredDate) : null],
    ['משתתפים', normalized.context?.participants],
    ['חנות', e.storeKey],
    ['נוצר דרך', e.createdVia],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (order.length) {
    lines.push('');
    lines.push('<b>פרטי ההזמנה</b>');
    for (const [k, v] of order) lines.push(`${k}: ${escapeHtml(v)}`);
  }

  // ── What was ordered ──────────────────────────────────────────────────────
  const items = e.lineItems || o.items || [];
  if (items.length) {
    lines.push('');
    lines.push('<b>פריטים</b>');
    for (const it of items) {
      const bits = [`• ${escapeHtml(it.name || it.sku || it.externalId || '—')} ×${escapeHtml(it.quantity ?? 1)}`];
      if (it.total !== null && it.total !== undefined && it.total !== '') bits.push(`— ${escapeHtml(MONEY(it.total, cur))}`);
      lines.push(bits.join(' '));
      for (const m of it.meta || []) {
        if (m?.key && m?.value !== null && m?.value !== undefined && String(m.value).trim() !== '') {
          lines.push(`&nbsp;&nbsp;&nbsp;${escapeHtml(m.key)}: ${escapeHtml(m.value)}`);
        }
      }
    }
  }
  for (const f of e.feeLines || []) {
    if (f?.name) lines.push(`• ${escapeHtml(f.name)} — ${escapeHtml(MONEY(f.total, cur))}`);
  }

  // ── Who ordered ───────────────────────────────────────────────────────────
  const who = [
    ['שם', p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || null],
    ['טלפון', p.phoneIntl || p.phone],
    ['אימייל', p.email],
    ['חברה', normalized.organization?.name],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (who.length) {
    lines.push('');
    lines.push('<b>פרטי הלקוח</b>');
    for (const [k, v] of who) lines.push(`${k}: ${escapeHtml(v)}`);
  }
  if (normalized.context?.message) {
    lines.push('');
    lines.push('<b>הערת הלקוח</b>');
    lines.push(escapeHtml(normalized.context.message));
  }

  // ── Provenance ────────────────────────────────────────────────────────────
  const meta = [
    ['נוצר בווקומרס', dt(e.dateCreated)],
    ['עודכן בווקומרס', dt(e.dateModified)],
    ['שולם', dt(e.datePaid)],
    ['הושלם', dt(e.dateCompleted)],
    ['מקור', a.channel],
    ['קמפיין', a.utmCampaign],
    ['מדיום', a.utmMedium],
    ['דף נחיתה', a.landingUrl],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (meta.length) {
    lines.push('');
    lines.push('<b>מקור וזמנים</b>');
    for (const [k, v] of meta) lines.push(`${k}: ${escapeHtml(v)}`);
  }

  // Unmissable, and last: an operator must never wonder whether this reached
  // the customer.
  lines.push('');
  lines.push('<i>הערה אוטומטית של המערכת — נוצרה מעדכון של ווקומרס. לא נשלחת ללקוח.</i>');

  return `<p>${lines.join('<br>')}</p>`;
}

/**
 * Write the pinned order-status note. Pinned deliberately (unlike the lead
 * intake note): an abandoned checkout or a refund is exactly the thing that
 * must be the first thing an operator sees on the deal.
 */
export async function writeOrderStatusNote(tx, { dealId, normalized, meaning, previousStatus = null, createdAt = null }) {
  await tx.timelineEntry.create({
    data: {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'note',
      body: buildOrderStatusNoteBody(normalized, meaning, { previousStatus }),
      isPinned: true,
      isSystem: true,
      actorType: 'system',
      actorLabel: sourceLabelFor(normalized),
      data: {
        event: 'ingress_order_status',
        source: normalized.source,
        sourceKey: normalized.sourceKey,
        externalId: normalized.externalId,
        wooStatus: meaning.status,
        previousStatus,
        paid: !!normalized.order?.paid,
      },
      ...(createdAt ? { createdAt } : {}),
    },
  });
  await touchDealActivity(tx, dealId, createdAt || new Date());
}

/**
 * The SAME external order arriving again — a status transition or an edit.
 *
 * Updates the one deal that order owns; never creates a second one. Mutable
 * business fields are refreshed from the order (it is the source of truth for
 * its own contents), and the change is recorded as a pinned note plus history.
 *
 * Deliberately does NOT touch: the deal's stage, owner, status (the WON
 * transition is the pipeline's job through the canonical service), or any field
 * an operator may have edited by hand that Woo has no opinion about.
 */
export async function updateOrderDeal(tx, { dealId, normalized, meaning, previousStatus = null, createdAt = null }) {
  const data = {
    valueMinor: toMinor(normalized.order?.total),
    activityType: 'group',
  };
  if (normalized.context?.preferredDate) {
    data.tourDate = israelDateOf(normalized.context.preferredDate);
  }
  if (normalized.context?.participants !== null && normalized.context?.participants !== undefined) {
    data.participants = normalized.context.participants;
  }
  // A paid Woo order is a group booking — but never overwrite a classification
  // a human already made on this deal. An org-linked deal, and equally a deal
  // an operator deliberately classified (including through the activity-type
  // conversion flow), keeps what it has; only an unclassified deal is stamped.
  const deal = await tx.deal.findUnique({
    where: { id: dealId },
    select: { organizationId: true, activityType: true },
  });
  if (deal?.organizationId || deal?.activityType) delete data.activityType;

  await tx.deal.update({ where: { id: dealId }, data });
  await writeOrderStatusNote(tx, { dealId, normalized, meaning, previousStatus, createdAt });
  return { dealId };
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
  // A repeat inbound inquiry IS meaningful — the customer just reached out.
  await touchDealActivity(tx, dealId);
  return { dealId };
}

// History entry on the deal — the immutable audit line (distinct from the
// editable operational note above).
export async function emitIngressHistory(tx, { dealId, normalized, outcome, createdAt = null }) {
  await emitTimelineEvent(tx, {
    createdAt,
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
