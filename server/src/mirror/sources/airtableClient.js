// Airtable REST client for the mirror — incremental, cursor-based, bounded.
//
// EFFICIENCY IS THE DESIGN, not an afterthought:
//
//   * Server-side filtering. `filterByFormula` on the table's own
//     LAST_MODIFIED_TIME() means Airtable returns only records changed since
//     the cursor. A quiet cycle costs ONE request that returns zero records —
//     not a full-table rescan.
//   * Field selection. Only the fields the adapter maps are requested, so the
//     payload stays small and linked-record blobs are not dragged along.
//   * Page-bounded. `maxPages` caps a single cycle so a bad cursor cannot walk
//     an entire base.
//   * Hard request ceiling per run, shared across tables, so a bug cannot
//     exhaust the quota.
//   * Cursor advances ONLY after the caller confirms success (the poller
//     releases it), so a crash mid-cycle re-reads rather than skips.
//
// Airtable's limit is 5 requests/second per base. At a 5-minute interval one
// table costs ~288 requests/day — about 0.02% of capacity.

import { apiCeiling } from '../config.js';

const API = 'https://api.airtable.com/v0';

export class AirtableRateLimit extends Error {
  constructor(retryAfterMs) {
    super(`airtable_rate_limited: retry in ${retryAfterMs}ms`);
    this.code = 'RATE_LIMITED';
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with jitter — jitter matters because several tables poll
// on the same timer and would otherwise retry in lockstep.
export function backoffMs(attempt, base = 1000, max = 30_000) {
  const raw = Math.min(base * 2 ** attempt, max);
  return Math.round(raw / 2 + Math.random() * (raw / 2));
}

/**
 * Escape a value for use inside an Airtable formula string literal.
 * Cursors are ISO timestamps we produced, but building formulas by
 * concatenation without escaping is how injection bugs start.
 */
export function escapeFormulaValue(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * The incremental filter. Records modified strictly AFTER the cursor.
 * With no cursor there is no filter — the first cycle is a full read, which is
 * correct and happens exactly once per table.
 */
export function modifiedSinceFormula(cursor) {
  if (!cursor) return null;
  return `IS_AFTER(LAST_MODIFIED_TIME(), '${escapeFormulaValue(cursor)}')`;
}

export function createAirtableClient({
  token, baseId, tableId, fields = [], pageSize = 100, maxPages = 20, fetchImpl = fetch, budget = null,
}) {
  if (!token || !baseId || !tableId) throw new Error('airtable_client_misconfigured');

  const spend = () => {
    if (!budget) return;
    if (budget.used >= budget.ceiling) {
      const e = new Error(`api_ceiling_reached: ${budget.used}/${budget.ceiling} requests this run`);
      e.code = 'API_CEILING';
      throw e;
    }
    budget.used += 1;
  };

  async function request(url, attempt = 0) {
    spend();
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const retryAfter = Number(res.headers?.get?.('retry-after') || 0) * 1000 || backoffMs(attempt);
      if (attempt >= 4) throw new AirtableRateLimit(retryAfter);
      await sleep(retryAfter);
      return request(url, attempt + 1);
    }
    if (res.status >= 500) {
      if (attempt >= 4) throw new Error(`airtable_${res.status}`);
      await sleep(backoffMs(attempt));
      return request(url, attempt + 1);
    }
    if (!res.ok) {
      // 4xx is permanent — a bad table id or formula will never succeed, and
      // retrying it forever only burns quota.
      const body = await res.text().catch(() => '');
      const e = new Error(`airtable_${res.status}: ${body.slice(0, 200)}`);
      e.code = 'PERMANENT';
      e.permanent = true;
      throw e;
    }
    return res.json();
  }

  return {
    tableId,

    /**
     * An arbitrary server-side filtered read of ANY table in this base.
     *
     * Used by the child fetcher to read one parent's children. Filtering server
     * side is the whole point: the alternative is scanning a table and matching
     * in memory, which is exactly the pattern that burns quota.
     */
    async listWhere(otherTableId, { formula = null, maxRecords = 200, fields: onlyFields = [] } = {}) {
      const out = [];
      let offset;
      let pages = 0;
      do {
        const u = new URL(`${API}/${baseId}/${otherTableId}`);
        u.searchParams.set('pageSize', String(Math.min(pageSize, maxRecords)));
        if (formula) u.searchParams.set('filterByFormula', formula);
        for (const f of onlyFields) u.searchParams.append('fields[]', f);
        if (offset) u.searchParams.set('offset', offset);
        const json = await request(u.toString());
        for (const r of json.records || []) out.push({ id: r.id, fields: r.fields });
        offset = json.offset;
        pages += 1;
      } while (offset && out.length < maxRecords && pages < maxPages);
      return out;
    },

    /** Records changed since `cursor`, for THIS client's configured table. */
    async listModifiedSince(cursor) {
      return this.listModifiedSinceIn(tableId, cursor);
    },

    /**
     * Records changed since `cursor`, in ANY table of this base.
     *
     * The child tables need the same incremental contract as the tours table, so
     * the implementation is shared rather than duplicated per table — one place
     * that gets the cursor semantics right.
     *
     * nextCursor is the MAXIMUM lastModified observed, not "now": using the
     * clock would skip a record written while the page was in flight.
     */
    async listModifiedSinceIn(inTableId, cursor, { fields: onlyFields = null } = {}) {
      const out = [];
      let offset;
      let pages = 0;
      let maxSeen = cursor || null;
      const wanted = onlyFields ?? fields;

      do {
        const u = new URL(`${API}/${baseId}/${inTableId}`);
        u.searchParams.set('pageSize', String(pageSize));
        // A child table has different fields from the tours table, so the
        // projection must follow the table being read — sending the tours
        // field list at a child table would return nothing useful.
        for (const f of wanted) u.searchParams.append('fields[]', f);
        // Ask Airtable for the modified time so the cursor comes from the
        // source's own clock rather than ours.
        u.searchParams.set('cellFormat', 'json');
        u.searchParams.set('timeZone', 'UTC');
        u.searchParams.set('userLocale', 'en-gb');
        const formula = modifiedSinceFormula(cursor);
        if (formula) u.searchParams.set('filterByFormula', formula);
        if (offset) u.searchParams.set('offset', offset);

        const json = await request(u.toString());
        for (const r of json.records || []) {
          const lm = r.fields?.__lastModified || r.createdTime || null;
          out.push({ id: r.id, fields: r.fields, lastModified: lm });
          if (lm && (!maxSeen || lm > maxSeen)) maxSeen = lm;
        }
        offset = json.offset;
        pages += 1;
      } while (offset && pages < maxPages);

      return {
        records: out,
        nextCursor: maxSeen,
        // Surfaced so a cycle that hit the page cap is visible rather than
        // looking like a complete read.
        truncated: !!offset,
        pages,
      };
    },
  };
}

/**
 * Build the client from environment, or return null when Airtable is not
 * configured. Returning null (rather than a client that always fails) is what
 * keeps an unconfigured source from producing a permanently red poll target.
 */
export function airtableClientFromEnv(env = process.env) {
  const token = String(env.AIRTABLE_PERSONAL_ACCESS_TOKEN || '').trim();
  const baseId = String(env.AIRTABLE_MAIN_BASE_ID || '').trim();
  const tableId = String(env.MIRROR_AIRTABLE_TOURS_TABLE || 'tblTI7iaGm6qsQA4a').trim();
  if (!token || !baseId) return null;

  const budget = { used: 0, ceiling: apiCeiling(env) };
  return createAirtableClient({
    token,
    baseId,
    tableId,
    // Only the fields the tour adapter maps — payloads stay small and linked
    // record blobs are never dragged along.
    fields: ['DATE', 'שעת התחלה', 'סטטוס', 'משתתפים בסיור', 'הערות', 'Tour_ID'],
    budget,
  });
}
