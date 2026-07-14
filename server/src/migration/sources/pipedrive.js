// Read-only Pipedrive source for snapshot extraction. GET-only; never writes.
// Thin client the run executor drives page-by-page so pagination cursors can be
// persisted for resumability. API v1 (returns custom fields inline).
import { setTimeout as sleep } from 'node:timers/promises';

export function pipedriveClient({ throttleMs = 90 } = {}) {
  const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
  const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim()
    .replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
  if (!token || !domain) throw new Error('pipedrive_not_configured');
  const base = `https://${domain}.pipedrive.com/api/v1`;

  function url(path, params = {}) {
    const u = new URL(base + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('api_token', token);
    return u.toString();
  }
  async function get(path, params = {}, attempt = 0) {
    const res = await fetch(url(path, params), { method: 'GET' });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 2);
      await sleep((retry + 0.5) * 1000);
      if (attempt < 6) return get(path, params, attempt + 1);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const e = new Error(`pipedrive ${path} HTTP ${res.status}`);
      e.status = res.status; e.body = String(text || '').slice(0, 200);
      throw e;
    }
    await sleep(throttleMs);
    return json;
  }

  // One page of a v1 collection. Returns {records, nextStart, hasMore}.
  async function page(path, params, start, limit = 500) {
    const json = await get(path, { ...params, start, limit });
    const records = json?.data || [];
    const pag = json?.additional_data?.pagination;
    return { records, nextStart: pag?.next_start ?? null, hasMore: !!pag?.more_items_in_collection };
  }

  return {
    domain,
    get,
    page,
    // Config/reference objects (small; fetched whole).
    async reference() {
      const grab = async (p, params) => { try { return (await get(p, params))?.data ?? null; } catch (e) { return { _error: e.message }; } };
      return {
        pipelines: await grab('/pipelines'),
        stages: await grab('/stages'),
        dealFields: await grab('/dealFields'),
        personFields: await grab('/personFields'),
        organizationFields: await grab('/organizationFields'),
        productFields: await grab('/productFields'),
        activityTypes: await grab('/activityTypes'),
        users: await grab('/users'),
        currencies: await grab('/currencies'),
        filters: await grab('/filters'),
        note_fields: await grab('/noteFields'),
      };
    },
    async dealProducts(dealId) {
      const json = await get(`/deals/${dealId}/products`, { start: 0, limit: 500 });
      return json?.data || [];
    },
  };
}
