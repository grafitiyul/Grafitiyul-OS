// WooCommerce REST v3 client — hand-rolled over global fetch, the same lean
// pattern as the Google clients. WooCommerce is a sync TARGET only (this slice);
// order ingestion (Woo→GOS) is a later slice. Auth is Basic (consumer key/secret
// over HTTPS). Everything is gated behind wooConfigured(): with no credentials
// the sync worker is a silent no-op, exactly like the calendar worker without a
// connected Google account.

// Credentials. The live Railway project already stores these under the
// WOOCOMMERCE_* names (the project convention, alongside CARDCOM_*, ICOUNT_*),
// so those are PRIMARY; the older WOO_* names remain a backward-compatible
// fallback. Reading the wrong names is exactly what kept sync a silent no-op.
const STORE_URL = () =>
  (process.env.WOOCOMMERCE_BASE_URL || process.env.WOO_STORE_URL || '').replace(/\/+$/, '');
const CK = () => process.env.WOOCOMMERCE_CONSUMER_KEY || process.env.WOO_CONSUMER_KEY || '';
const CS = () => process.env.WOOCOMMERCE_CONSUMER_SECRET || process.env.WOO_CONSUMER_SECRET || '';

// Legacy LOCAL-attribute name, kept only for the local-taxonomy fallback path.
// The live store uses GLOBAL taxonomy attributes (pa_תאריך / pa_שעה) captured
// per-product in WooProductMapping.config, so this default is no longer the
// primary date model.
export const WOO_DATE_ATTRIBUTE = () => process.env.WOO_DATE_ATTRIBUTE || 'Date';

// Credentials present? (Store URL + key + secret.) With none, the worker is a
// silent no-op — the same contract as the calendar worker without Google.
export function wooConfigured() {
  return Boolean(STORE_URL() && CK() && CS());
}

// EXPLICIT activation gate. Separate from wooConfigured() ON PURPOSE: deploying
// the compatibility code (or configuring credentials) must NEVER be enough to
// start mutating the live store. A human sets WOO_SYNC_ENABLED=true only once the
// corrected model has been reviewed and a controlled occurrence approved. Until
// then every write path is inert even when credentials are valid.
export function wooSyncEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.WOO_SYNC_ENABLED || '').trim());
}

// The single guard the worker consults before it will touch WooCommerce.
export function wooSyncActive() {
  return wooConfigured() && wooSyncEnabled();
}

async function wooFetch(path, { method = 'GET', query, body } = {}) {
  const url = new URL(`${STORE_URL()}/wp-json/wc/v3${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const auth = Buffer.from(`${CK()}:${CS()}`).toString('base64');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`woo ${method} ${path} → ${res.status}: ${payload?.message || ''}`.trim());
    err.status = res.status;
    err.code = payload?.code || null;
    throw err;
  }
  return payload;
}

// The real client. Injectable everywhere (the worker takes a `woo` dep) so tests
// pass a fake with the same surface.
export const woo = {
  getProduct: (productId) => wooFetch(`/products/${productId}`),
  updateProduct: (productId, data) => wooFetch(`/products/${productId}`, { method: 'PUT', body: data }),
  // WooCommerce caps per_page at 100; a Variable Product can hold many date
  // variations, so page through until a short page.
  async listVariations(productId) {
    const out = [];
    for (let page = 1; ; page += 1) {
      const batch = await wooFetch(`/products/${productId}/variations`, {
        query: { per_page: 100, page },
      });
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  },
  createVariation: (productId, data) =>
    wooFetch(`/products/${productId}/variations`, { method: 'POST', body: data }),
  updateVariation: (productId, variationId, data) =>
    wooFetch(`/products/${productId}/variations/${variationId}`, { method: 'PUT', body: data }),

  // ── Global attribute terms ────────────────────────────────────────────────
  // A GLOBAL taxonomy attribute (pa_תאריך, pa_שעה) can only carry a term that
  // already exists in the taxonomy. GOS owns the occurrence dates, so for a new
  // date it must first ensure the term exists (create) before a variation can
  // reference it. Time terms already cover the working hours; date terms grow.
  async listAttributeTerms(attributeId) {
    const out = [];
    for (let page = 1; ; page += 1) {
      const batch = await wooFetch(`/products/attributes/${attributeId}/terms`, {
        query: { per_page: 100, page },
      });
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  },
  createAttributeTerm: (attributeId, data) =>
    wooFetch(`/products/attributes/${attributeId}/terms`, { method: 'POST', body: data }),
};
