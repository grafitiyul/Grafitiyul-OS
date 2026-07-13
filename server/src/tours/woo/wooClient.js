// WooCommerce REST v3 client — hand-rolled over global fetch, the same lean
// pattern as the Google clients. WooCommerce is a sync TARGET only (this slice);
// order ingestion (Woo→GOS) is a later slice. Auth is Basic (consumer key/secret
// over HTTPS). Everything is gated behind wooConfigured(): with no credentials
// the sync worker is a silent no-op, exactly like the calendar worker without a
// connected Google account.

const STORE_URL = () => (process.env.WOO_STORE_URL || '').replace(/\/+$/, '');
const CK = () => process.env.WOO_CONSUMER_KEY || '';
const CS = () => process.env.WOO_CONSUMER_SECRET || '';

// The product attribute (name/option) used to represent a concrete occurrence on
// a Variable Product. Configurable so we stay compatible with the EXISTING site
// structure (variations already keyed by date/time). Default "Date".
export const WOO_DATE_ATTRIBUTE = () => process.env.WOO_DATE_ATTRIBUTE || 'Date';

export function wooConfigured() {
  return Boolean(STORE_URL() && CK() && CS());
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
};
