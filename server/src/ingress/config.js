// Ingress Platform — THE configuration surface.
//
// Every credential the platform will ever need is declared here, in one place,
// with the exact Railway variable name and what it unlocks. Nothing is
// hardcoded and nothing is read from process.env outside this module.
//
// Design rule (explicitly required): missing credentials must NEVER block boot.
// A source whose variables are absent is simply reported as `configured:false`
// and its endpoint answers a clear, non-crashing error. The rest of the
// platform — and the rest of GOS — keeps running. `ingressConfigReport()`
// renders exactly what is still missing, so the deployment checklist is
// generated from code rather than maintained by hand.
//
// Values are read through getters (never captured at import time) so tests and
// Railway restarts observe changes without module reloading.

const env = (name) => {
  const v = process.env[name];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
};

const bool = (name, fallback = false) => {
  const v = env(name);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

// ── Variable catalogue ───────────────────────────────────────────────────────
// `required` = the source cannot function at all without it.
// `optional`  = degrades a capability but the source still works.
export const VARIABLE_CATALOGUE = Object.freeze({
  platform: {
    label: 'פלטפורמת קליטה (כללי)',
    required: [],
    optional: [
      { name: 'INGRESS_DRY_RUN', purpose: 'Global shadow mode — normalize and dedupe but write no records' },
      { name: 'INGRESS_ADMIN_ENABLED', purpose: 'Expose the admin observability endpoints (default on)' },
    ],
  },
  meta_lead_ads: {
    label: 'Meta Lead Ads',
    required: [
      { name: 'META_APP_SECRET', purpose: 'Verify X-Hub-Signature-256 on every webhook delivery' },
      { name: 'META_VERIFY_TOKEN', purpose: 'Answer Meta’s GET subscription handshake' },
      { name: 'META_PAGE_ACCESS_TOKEN', purpose: 'Fetch full lead field values by leadgen id' },
    ],
    optional: [
      { name: 'META_PAGE_ID', purpose: 'Restrict acceptance to one Page id (recommended)' },
      { name: 'META_ALLOWED_FORM_IDS', purpose: 'Comma-separated allow-list of Lead Ads form ids' },
      { name: 'META_BLOCKED_FORM_IDS', purpose: 'Comma-separated block-list (mirrors the legacy exclusion)' },
      { name: 'META_GRAPH_VERSION', purpose: 'Graph API version (default v21.0)' },
    ],
  },
  woocommerce: {
    label: 'WooCommerce',
    required: [],
    optional: [
      { name: 'WOOCOMMERCE_BASE_URL', purpose: 'Primary store URL (shared with the Woo sync module)' },
      { name: 'WOOCOMMERCE_CONSUMER_KEY', purpose: 'Primary store REST consumer key' },
      { name: 'WOOCOMMERCE_CONSUMER_SECRET', purpose: 'Primary store REST consumer secret' },
      { name: 'WOO_PRIMARY_WEBHOOK_SECRET', purpose: 'Primary store webhook signature secret' },
      { name: 'WOO_NEW_BASE_URL', purpose: 'New store URL' },
      { name: 'WOO_NEW_CONSUMER_KEY', purpose: 'New store REST consumer key' },
      { name: 'WOO_NEW_CONSUMER_SECRET', purpose: 'New store REST consumer secret' },
      { name: 'WOO_NEW_WEBHOOK_SECRET', purpose: 'New store webhook signature secret' },
    ],
  },
  website_form: {
    label: 'Website / Elementor forms',
    required: [{ name: 'WEBSITE_FORM_SECRET', purpose: 'Shared secret for the website form endpoint' }],
    optional: [],
  },
});

// ── Platform ────────────────────────────────────────────────────────────────
export const platformConfig = () => ({
  // Global shadow mode. When on, EVERY source is forced dry-run regardless of
  // per-request intent — the safe direction for a mis-set variable.
  dryRun: bool('INGRESS_DRY_RUN', false),
  adminEnabled: bool('INGRESS_ADMIN_ENABLED', true),
});

// ── Meta ────────────────────────────────────────────────────────────────────
const csv = (name) => {
  const v = env(name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
};

export const metaConfig = () => ({
  appSecret: env('META_APP_SECRET'),
  verifyToken: env('META_VERIFY_TOKEN'),
  pageAccessToken: env('META_PAGE_ACCESS_TOKEN'),
  pageId: env('META_PAGE_ID'),
  allowedFormIds: csv('META_ALLOWED_FORM_IDS'),
  blockedFormIds: csv('META_BLOCKED_FORM_IDS'),
  graphVersion: env('META_GRAPH_VERSION') || 'v21.0',
});

export const metaConfigured = () => {
  const c = metaConfig();
  return Boolean(c.appSecret && c.verifyToken && c.pageAccessToken);
};

// ── WooCommerce (multi-store) ───────────────────────────────────────────────
// Two stores, one adapter. `primary` deliberately reuses the existing
// WOOCOMMERCE_* names: it is the SAME store the Woo sync module targets, so a
// second copy of the same credential would be duplicate state.
export const WOO_STORES = Object.freeze(['primary', 'secondary']);

export function wooStoreConfig(storeKey) {
  if (storeKey === 'primary') {
    return {
      key: 'primary',
      label: 'אתר קיים',
      baseUrl: (env('WOOCOMMERCE_BASE_URL') || env('WOO_STORE_URL') || '').replace(/\/+$/, '') || null,
      consumerKey: env('WOOCOMMERCE_CONSUMER_KEY') || env('WOO_CONSUMER_KEY'),
      consumerSecret: env('WOOCOMMERCE_CONSUMER_SECRET') || env('WOO_CONSUMER_SECRET'),
      webhookSecret: env('WOO_PRIMARY_WEBHOOK_SECRET'),
    };
  }
  if (storeKey === 'secondary') {
    return {
      key: 'secondary',
      label: 'אתר חדש',
      baseUrl: (env('WOO_NEW_BASE_URL') || '').replace(/\/+$/, '') || null,
      consumerKey: env('WOO_NEW_CONSUMER_KEY'),
      consumerSecret: env('WOO_NEW_CONSUMER_SECRET'),
      webhookSecret: env('WOO_NEW_WEBHOOK_SECRET'),
    };
  }
  return null;
}

// A store is usable once it can verify a delivery AND read the order back.
export const wooStoreConfigured = (storeKey) => {
  const c = wooStoreConfig(storeKey);
  return Boolean(c && c.baseUrl && c.consumerKey && c.consumerSecret && c.webhookSecret);
};

// ── Website forms ───────────────────────────────────────────────────────────
export const websiteFormConfig = () => ({ secret: env('WEBSITE_FORM_SECRET') });
export const websiteFormConfigured = () => Boolean(websiteFormConfig().secret);

// ── Startup validation / reporting ──────────────────────────────────────────
// Never throws. Returns a structured report the boot log and the admin endpoint
// both render, so "what is still missing" has exactly one answer.
export function ingressConfigReport() {
  const present = (n) => env(n) !== null;
  const section = (key) => {
    const spec = VARIABLE_CATALOGUE[key];
    const missingRequired = spec.required.filter((v) => !present(v.name)).map((v) => v.name);
    const missingOptional = spec.optional.filter((v) => !present(v.name)).map((v) => v.name);
    return { key, label: spec.label, missingRequired, missingOptional };
  };

  const sources = [
    { ...section('meta_lead_ads'), configured: metaConfigured() },
    {
      ...section('woocommerce'),
      configured: WOO_STORES.some(wooStoreConfigured),
      stores: WOO_STORES.map((k) => ({
        key: k,
        label: wooStoreConfig(k).label,
        configured: wooStoreConfigured(k),
      })),
    },
    { ...section('website_form'), configured: websiteFormConfigured() },
  ];

  return {
    platform: { ...section('platform'), ...platformConfig() },
    sources,
    readyCount: sources.filter((s) => s.configured).length,
    totalCount: sources.length,
  };
}

// Boot-time log. Deliberately informational: an unconfigured source is a
// pending deployment step, not a crash.
export function logIngressConfig(logger = console) {
  const r = ingressConfigReport();
  logger.log(`[ingress] ${r.readyCount}/${r.totalCount} sources configured${r.platform.dryRun ? ' (GLOBAL DRY-RUN ON)' : ''}`);
  for (const s of r.sources) {
    if (s.configured) {
      const extra = s.stores ? ` [${s.stores.filter((x) => x.configured).map((x) => x.key).join(', ') || 'none'}]` : '';
      logger.log(`[ingress]   ✓ ${s.key}${extra}`);
    } else {
      logger.log(`[ingress]   • ${s.key} — awaiting: ${s.missingRequired.concat(s.stores ? ['store credentials'] : []).join(', ') || 'configuration'}`);
    }
  }
  return r;
}
