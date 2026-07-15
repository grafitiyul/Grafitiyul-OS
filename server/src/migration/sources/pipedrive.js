// Read-only Pipedrive source for snapshot extraction. GET-only; never writes.
// Thin client the run executor drives page-by-page so pagination cursors can be
// persisted for resumability.
//
// SAFETY (post-incident): a RequestBudget is MANDATORY. Every single request —
// including retries — calls budget.take() first, which throws before exceeding
// the approved run ceiling. There is no code path to a Pipedrive request that
// bypasses the guard.
//
// COST: deal products use the v2 BULK endpoint (100 deal_ids per call, limit 500)
// instead of one call per deal — 15,639 calls → ~157. v2 also costs ~half the
// tokens of v1. The old per-deal path is deliberately GONE.
import { setTimeout as sleep } from 'node:timers/promises';

// Cap how long we'll ever wait on a Retry-After. Beyond this (e.g. Pipedrive's
// "daily request budget exceeded" returns retry-after ≈ 8+ hours) we FAIL FAST
// with a resumable RATE_BUDGET_EXCEEDED error instead of sleeping for hours.
const MAX_RETRY_AFTER_SLEEP_S = 120;
const REQUEST_TIMEOUT_MS = 60000;

export const DEAL_IDS_PER_BULK_CALL = 100; // Pipedrive hard max for deal_ids
export const BULK_PAGE_LIMIT = 500;        // Pipedrive hard max for `limit`

export function pipedriveClient({ throttleMs = 90, fetchImpl = fetch, budget } = {}) {
  if (!budget || typeof budget.take !== 'function') {
    throw new Error('pipedrive_client_requires_budget'); // no unguarded requests, ever
  }
  const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
  const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim()
    .replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
  if (!token || !domain) throw new Error('pipedrive_not_configured');
  const host = `https://${domain}.pipedrive.com`;

  function url(version, path, params = {}) {
    const u = new URL(`${host}/api/${version}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
    u.searchParams.set('api_token', token);
    return u.toString();
  }
  async function fetchWithTimeout(u) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try { return await fetchImpl(u, { method: 'GET', signal: ac.signal }); }
    finally { clearTimeout(t); }
  }

  async function request(version, path, params = {}, attempt = 0) {
    await budget.take(); // ← checked BEFORE every request (incl. retries). Throws if exhausted.
    let res;
    try {
      res = await fetchWithTimeout(url(version, path, params));
    } catch (e) {
      if (attempt < 4) { await sleep(1000 * (attempt + 1)); return request(version, path, params, attempt + 1); }
      const err = new Error(`pipedrive ${path} network: ${e?.name || e?.message || e}`); err.code = 'NETWORK'; throw err;
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 2);
      const body = await res.text().catch(() => '');
      const dailyBudget = /daily request budget/i.test(body);
      // Daily-budget lockout → pause IMMEDIATELY. No hidden retry, no long sleep.
      if (dailyBudget || retry > MAX_RETRY_AFTER_SLEEP_S) {
        const err = new Error(`pipedrive_rate_budget_exceeded: retry-after ${retry}s${dailyBudget ? ' (daily budget)' : ''}`);
        err.code = 'RATE_BUDGET_EXCEEDED'; err.retryAfter = retry; err.status = 429;
        throw err;
      }
      await sleep((retry + 0.5) * 1000);
      if (attempt < 6) return request(version, path, params, attempt + 1);
      const err = new Error(`pipedrive ${path} HTTP 429 after retries`); err.status = 429; err.code = 'RATE_LIMITED'; throw err;
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

  const get = (path, params) => request('v1', path, params);

  return {
    domain,
    get,
    // One page of a v1 collection (start/limit). Returns {records, nextStart, hasMore}.
    async page(path, params, start, limit = 500) {
      const json = await request('v1', path, { ...params, start, limit });
      const records = json?.data || [];
      const pag = json?.additional_data?.pagination;
      return { records, nextStart: pag?.next_start ?? null, hasMore: !!pag?.more_items_in_collection };
    },
    // One page of a v2 collection (cursor/limit). Returns {records, nextCursor}.
    async pageV2(path, params, cursor = null, limit = BULK_PAGE_LIMIT) {
      const json = await request('v2', path, { ...params, cursor, limit });
      return { records: json?.data || [], nextCursor: json?.additional_data?.next_cursor ?? null };
    },
    // BULK deal products: up to 100 deal_ids per call, cursor-paged at 500 rows.
    // Sorted by deal_id then order_nr so product-line ORDER is preserved.
    async dealProductsBulk(dealIds, cursor = null) {
      if (dealIds.length > DEAL_IDS_PER_BULK_CALL) throw new Error(`too many deal_ids: ${dealIds.length} > ${DEAL_IDS_PER_BULK_CALL}`);
      const json = await request('v2', '/deals/products', {
        deal_ids: dealIds.join(','),
        limit: BULK_PAGE_LIMIT,
        cursor,
        sort_by: 'id',
        sort_direction: 'asc',
      });
      return { records: json?.data || [], nextCursor: json?.additional_data?.next_cursor ?? null };
    },
    // Config/reference objects (small; fetched whole).
    async reference() {
      const grab = async (p, params) => { try { return (await get(p, params))?.data ?? null; } catch (e) { if (e?.code) throw e; return { _error: e.message }; } };
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
  };
}
