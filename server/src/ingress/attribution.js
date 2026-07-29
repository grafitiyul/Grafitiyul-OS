// Ingress Platform — THE attribution resolver (UTM + campaign).
//
// One implementation for every source. Adapters may hand over a URL, an
// explicit UTM object, or provider campaign ids (Meta gives ad/adset/campaign
// directly); this module reconciles all three into one attribution record.
//
// Precedence, highest first:
//   1. explicit UTM values supplied by the adapter
//   2. UTM parameters parsed out of the landing-page URL
//   3. provider campaign fields (Meta ad/adset/campaign names)
// The first non-empty value per field wins — so a Meta lead that also carries a
// tagged URL keeps the URL's campaign, matching how the legacy pipeline read
// utm_* off `url` before falling back to the payload's `source`.
//
// `sourceLabel` is the human-facing attribution shown on the Deal. It is
// deliberately derived here (not in adapters) so two sources can never disagree
// about how a channel is named.

const UTM_FIELDS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);

// Tolerant URL parse: query string only, no host requirement, never throws.
// Elementor and Meta both hand over half-formed URLs in the wild.
export function parseQueryParams(rawUrl) {
  const out = {};
  const s = String(rawUrl || '');
  if (!s) return out;
  const qIndex = s.indexOf('?');
  const query = qIndex === -1 ? (s.includes('=') ? s : '') : s.slice(qIndex + 1);
  if (!query) return out;
  for (const part of query.split(/[&;]/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? '' : part.slice(eq + 1);
    if (!k) continue;
    try {
      out[decodeURIComponent(k.replace(/\+/g, ' ')).trim()] = decodeURIComponent(v.replace(/\+/g, ' ')).trim();
    } catch {
      out[k.trim()] = v.trim(); // malformed percent-encoding — keep raw
    }
  }
  return out;
}

export function extractUtm(rawUrl) {
  const params = parseQueryParams(rawUrl);
  const utm = {};
  for (const f of UTM_FIELDS) {
    const v = params[f];
    if (v) utm[f] = v;
  }
  return utm;
}

const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
};

// Legacy lead-source labels, as they are actually spelled in Pipedrive's
// 33-option closed list. Mapping them here — rather than in the importer — is
// what stops an imported deal ("פייסבוק") and an ingress deal ("facebook") from
// reporting two different channels for the same acquisition.
const LEGACY_SOURCE_CHANNEL = Object.freeze({
  'פייסבוק': 'Meta',
  'אינסטגרם': 'Meta',
  'פייסבוק/אינסטגרם ממומן': 'Meta',
  'meta': 'Meta',
  'fb': 'Meta',
  'ig': 'Meta',
  'facebook': 'Meta',
  'גוגל': 'Google',
  'google': 'Google',
  'google ads': 'Google',
  'וואטספ': 'WhatsApp',
  'וואטסאפ': 'WhatsApp',
  'whatsapp': 'WhatsApp',
  'דיוור וואטספ': 'WhatsApp',
  'אתר גרפיטיול': 'אתר',
  'דף נחיתה': 'אתר',
  'טופס לקוחות עסקיים': 'אתר',
  'טופס סוכנים/מפיקים': 'אתר',
  'הרשמה עצמאית לסיורי חשיפה': 'אתר',
  'המלצה': 'המלצה',
  'לקוח/ה חוזר/ת': 'לקוח חוזר',
  'טלפון': 'טלפון',
  'מייל': 'מייל',
  'דיוור אימייל': 'מייל',
  'פנייה קרה': 'פנייה קרה',
});

// The canonical channel label. Kept small and stable — it is written onto the
// Deal and read by humans, so it must not churn with every campaign rename.
//
// `legacyLabel` is the Pipedrive closed-list value for imported deals. It is
// consulted BEFORE the generic fallbacks but AFTER real UTM tags, because a
// tagged URL is stronger evidence than a hand-picked dropdown.
// The legacy free-text source field frequently carries the label with its
// closed-list option id appended — "וואטספ - 113", "פייסבוק - 106". Left alone
// that suffix reaches the channel verbatim, which both fragments the analytics
// ("וואטספ - 113" and "וואטספ" counted separately) and shows an operator an
// internal id. Stripped here, in the shared resolver, so every consumer is
// protected rather than each one remembering to clean its own input.
// Bounded to 2-3 digits deliberately: every real option id in the closed list
// is three digits (106–472). Allowing four would eat the year off a date-like
// free-text value — "27-07-1970" really occurs and became "27-07" before this
// bound was measured against production.
const stripOptionId = (s) => String(s || '').trim().replace(/\s*[-–—]\s*\d{2,3}$/, '').trim();

export function channelLabel({ utmSource, utmMedium, source, legacyLabel = null }) {
  const s = (utmSource || '').toLowerCase();
  if (s.includes('facebook') || s.includes('instagram') || s === 'fb' || s === 'ig') return 'Meta';
  if (s.includes('google')) return 'Google';
  if (s) return utmSource;

  const cleaned = stripOptionId(legacyLabel);
  const legacy = cleaned.toLowerCase();
  if (legacy && LEGACY_SOURCE_CHANNEL[legacy]) return LEGACY_SOURCE_CHANNEL[legacy];

  if (source === 'meta_lead_ads') return 'Meta';
  if (source === 'woocommerce') return 'אתר';
  if (source === 'website_form') return 'אתר';
  if ((utmMedium || '').toLowerCase() === 'organic') return 'אורגני';
  // An unmapped legacy label is better than "unknown" — it is real information —
  // but only the cleaned form ever escapes, never one carrying an option id.
  if (cleaned) return cleaned;
  return 'לא ידוע';
}

export function resolveAttribution(event) {
  const fromUrl = extractUtm(event?.attributionInput?.url);
  const explicit = event?.attributionInput?.utm || {};

  const utmSource = firstNonEmpty(explicit.utm_source, fromUrl.utm_source);
  const utmMedium = firstNonEmpty(explicit.utm_medium, fromUrl.utm_medium);
  const utmCampaign = firstNonEmpty(
    explicit.utm_campaign,
    fromUrl.utm_campaign,
    event?.attributionInput?.campaignName,
  );
  const utmContent = firstNonEmpty(explicit.utm_content, fromUrl.utm_content);
  const utmTerm = firstNonEmpty(explicit.utm_term, fromUrl.utm_term);

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    // Provider campaign identifiers — retained verbatim for ad-spend reconciliation.
    adId: firstNonEmpty(event?.attributionInput?.adId),
    adsetId: firstNonEmpty(event?.attributionInput?.adsetId),
    campaignId: firstNonEmpty(event?.attributionInput?.campaignId),
    landingUrl: firstNonEmpty(event?.attributionInput?.url, event?.context?.pageUrl),
    referrer: firstNonEmpty(event?.context?.referrer),
    channel: channelLabel({ utmSource, utmMedium, source: event?.source }),
  };
}
