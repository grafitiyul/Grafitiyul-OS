// Ingress adapter — Meta Lead Ads.
//
// Thin by construction: authenticate, fetch the lead's field values, translate
// into the canonical contract. No contact matching, no dedupe, no deal shape —
// all of that belongs to the shared pipeline.
//
// Delivery model: Meta POSTs a leadgen notification carrying only ids; the
// actual answers must be fetched from the Graph API with a Page access token.
// That is why META_PAGE_ACCESS_TOKEN is required and not merely nice to have.
//
// One webhook delivery may carry MANY leads (several entries, several changes),
// so the adapter returns a LIST of deliveries and the route ingests each with
// its own idempotency key (the leadgen id) — one lead can never mask another.

import { buildEvent } from '../contract.js';
import { metaConfig } from '../config.js';
import { verifyMetaSignature } from '../signature.js';
import { ingressError, STAGES } from '../errors.js';

export const SOURCE = 'meta_lead_ads';

// Meta field names vary per form (and the live Hebrew form uses Hebrew labels).
// Matching is by normalized name against known aliases — one table, extended
// here rather than branched in code.
const FIELD_ALIASES = Object.freeze({
  email: ['email', 'אימייל', 'מייל', 'דואר אלקטרוני', 'e-mail'],
  phone: ['phone_number', 'phone', 'טלפון', 'מספר טלפון', 'נייד', 'טלפון נייד'],
  fullName: ['full_name', 'name', 'שם', 'שם מלא'],
  firstName: ['first_name', 'שם פרטי'],
  lastName: ['last_name', 'שם משפחה'],
  city: ['city', 'עיר'],
  participants: ['participants', 'כמות משתתפים', 'מספר משתתפים', 'כמה משתתפים'],
  message: ['message', 'הודעה', 'הערות'],
});

const norm = (s) => String(s || '').trim().toLowerCase();

export function pickField(fieldData, key) {
  const aliases = FIELD_ALIASES[key] || [];
  for (const f of fieldData || []) {
    const name = norm(f.name);
    if (aliases.some((a) => norm(a) === name)) {
      const v = Array.isArray(f.values) ? f.values[0] : f.values;
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return null;
}

// Meta's three standard identity fields arrive with English keys and no label,
// even on a Hebrew form. Translated for DISPLAY ONLY — the raw key and the raw
// value are untouched, and nothing matches on these strings.
const STANDARD_LABELS = Object.freeze({
  full_name: 'שם מלא',
  phone_number: 'טלפון',
  email: 'אימייל',
});

/**
 * Meta auto-derives a question's field key from its label — Hebrew wording with
 * spaces turned into underscores and the question mark kept, e.g.
 * `?כמה_אנשים_תהיו`. Printing that verbatim in an operator's note is unreadable,
 * so keys are prettified FOR DISPLAY ONLY. The raw key is always kept on the
 * answer object, and the answer VALUE is never touched.
 *
 * Display-only by design: nothing downstream matches on the prettified form, so
 * a question rename can change presentation but can never break processing.
 */
export function prettifyKey(key) {
  return String(key ?? '')
    .replace(/_/g, ' ')
    // Leading/trailing punctuation Meta carries over from the label.
    .replace(/^[\s?:*\-–—.,]+/, '')
    .replace(/[\s?:*\-–—.,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The COMPLETE submission, in Meta's original field order.
 *
 * Aliased extraction (`pickField`) feeds the structured GOS columns and is
 * lossy by design — it only looks for fields it knows. This function is the
 * lossless counterpart: every question the form asked, mapped or not, in the
 * order the customer saw it.
 *
 * Empty vs missing: Meta includes a question in `field_data` even when the
 * answer is blank, so a present-but-empty answer becomes
 * `{ value: null, answered: false }` while a question that was never asked
 * simply does not appear. Both states are meaningful to an operator.
 */
export function buildFormAnswers(fieldData) {
  return (fieldData || []).map((f) => {
    const values = Array.isArray(f.values) ? f.values : f.values === undefined || f.values === null ? [] : [f.values];
    const joined = values
      .map((v) => String(v ?? '').trim())
      .filter((v) => v !== '')
      .join(', ');
    const key = String(f.name ?? '').trim();
    return {
      key: key || null,
      // Display label, in precedence order: the canonical Hebrew term for a
      // standard identity field (deterministic regardless of what Meta sends),
      // then a real Meta label, then the raw key made readable. The live
      // Grafitiyul form sends no labels at all.
      label: STANDARD_LABELS[key] || String(f.label ?? '').trim() || prettifyKey(key) || key || null,
      value: joined === '' ? null : joined,
      answered: joined !== '',
    };
  });
}

// GET handshake Meta performs once when the webhook is registered.
export function verifySubscription(query) {
  const cfg = metaConfig();
  if (!cfg.verifyToken) throw ingressError('signature_secret_missing', { stage: STAGES.VALIDATE });
  const mode = query?.['hub.mode'];
  const token = query?.['hub.verify_token'];
  const challenge = query?.['hub.challenge'];
  if (mode === 'subscribe' && token && String(token) === String(cfg.verifyToken)) {
    return { ok: true, challenge: String(challenge ?? '') };
  }
  return { ok: false };
}

export function verify({ rawBody, headers }) {
  const cfg = metaConfig();
  verifyMetaSignature({
    rawBody,
    header: headers?.['x-hub-signature-256'] || headers?.['X-Hub-Signature-256'],
    appSecret: cfg.appSecret,
  });
  return true;
}

// Flatten the webhook envelope into individual leadgen notifications.
export function extractLeads(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field && change.field !== 'leadgen') continue;
      const v = change?.value || {};
      if (!v.leadgen_id) continue;
      out.push({
        leadgenId: String(v.leadgen_id),
        pageId: v.page_id ? String(v.page_id) : entry?.id ? String(entry.id) : null,
        formId: v.form_id ? String(v.form_id) : null,
        adId: v.ad_id ? String(v.ad_id) : null,
        adgroupId: v.adgroup_id ? String(v.adgroup_id) : null,
        campaignId: v.campaign_id ? String(v.campaign_id) : null,
        createdTime: v.created_time ? new Date(Number(v.created_time) * 1000) : null,
      });
    }
  }
  return out;
}

// Page/form gating. Restricting to a Page is strongly recommended; the
// block-list reproduces the legacy automation's deliberate exclusion of one
// form without hardcoding that id in code.
export function isAllowed(lead) {
  const cfg = metaConfig();
  if (cfg.pageId && lead.pageId && String(lead.pageId) !== String(cfg.pageId)) {
    return { ok: false, code: 'page_not_allowed' };
  }
  if (lead.formId) {
    if (cfg.blockedFormIds.includes(lead.formId)) return { ok: false, code: 'form_not_allowed' };
    if (cfg.allowedFormIds.length && !cfg.allowedFormIds.includes(lead.formId)) {
      return { ok: false, code: 'form_not_allowed' };
    }
  }
  return { ok: true };
}

// Graph fetch, injectable for tests. Never logs the access token.
export async function fetchLeadDetails(leadgenId, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = metaConfig();
  if (!cfg.pageAccessToken) throw ingressError('signature_secret_missing', { stage: STAGES.VALIDATE });
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${cfg.pageAccessToken}` } });
  } catch (err) {
    // Network-level failure is transient — must retry, not drop the lead.
    throw ingressError('provider_unreachable', { stage: STAGES.NORMALIZE, cause: err });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 4xx (bad/expired token, deleted lead) will not fix itself on retry; 5xx
    // and 429 will. Classifying here keeps the retry budget meaningful.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw ingressError(permanent ? 'provider_rejected' : 'provider_unavailable', {
      stage: STAGES.NORMALIZE,
      retryable: !permanent,
      detail: `HTTP ${res.status} ${String(body).slice(0, 200)}`,
    });
  }
  return res.json();
}

// details + notification → canonical event.
export function toCanonicalEvent(details, lead) {
  const fd = details?.field_data || [];
  return buildEvent({
    kind: 'lead',
    source: SOURCE,
    sourceKey: lead.formId || lead.pageId || null,
    externalId: lead.leadgenId,
    occurredAt: details?.created_time ? new Date(details.created_time) : lead.createdTime,
    person: {
      fullName: pickField(fd, 'fullName'),
      firstName: pickField(fd, 'firstName'),
      lastName: pickField(fd, 'lastName'),
      email: pickField(fd, 'email'),
      phone: pickField(fd, 'phone'),
    },
    context: {
      message: pickField(fd, 'message'),
      participants: pickField(fd, 'participants'),
      formName: lead.formId ? `Meta form ${lead.formId}` : null,
      // The lossless record of what the customer actually filled in.
      formAnswers: buildFormAnswers(fd),
    },
    attributionInput: {
      // Meta leads have no landing URL; attribution comes from campaign ids and
      // is normalized to the Meta channel by the shared resolver.
      utm: { utm_source: 'facebook', utm_medium: 'paid_social' },
      adId: details?.ad_id || lead.adId,
      adsetId: details?.adset_id || lead.adgroupId,
      campaignId: details?.campaign_id || lead.campaignId,
    },
    extra: {
      platform: details?.platform || null,
      city: pickField(fd, 'city'),
      formId: lead.formId,
      pageId: lead.pageId,
    },
  });
}

export const metaAdapter = Object.freeze({
  key: SOURCE,
  label: 'Meta Lead Ads',
  verify,
  verifySubscription,
  buildFormAnswers,
  prettifyKey,
  extractLeads,
  isAllowed,
  fetchLeadDetails,
  toCanonicalEvent,
});
