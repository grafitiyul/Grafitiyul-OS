import { searchDocsWindow, docInfo, isIcountConfigured } from './icount.js';

// The iCount account census — builds IcountLedgerDoc, a complete local mirror
// of every accounting document that exists in the provider.
//
// WHY A CENSUS AND NOT PER-DOCUMENT LOOKUPS
// The historical reconstruction has ~3,900 document references to resolve. One
// doc/info call each would be ~4,000 requests. doc/search cannot page, but it
// CAN answer "all documents of type X between two dates" and it reports the
// true match count even when it refuses to return rows. Splitting a date window
// whenever the count exceeds the provider's 100-row ceiling enumerates the whole
// account — 14,785 documents — in a few hundred requests, and every later
// lookup is a local index read costing nothing.
//
// It is a CACHE. It never participates in the collection math; only a document
// actually attached to a deal (IcountDocument) does. Truncating this table
// loses nothing but the need to re-run.
//
// PACING. One process, strictly sequential, with a deliberate pause between
// calls. iCount publishes no rate-limit headers and returned none under test,
// so the budget is self-imposed rather than negotiated: ~2.5 requests/second at
// the default delay, with exponential back-off and a hard stop after repeated
// failures. Nothing here writes to iCount — doc/search and doc/info are reads.

export const CENSUS_DOCTYPES = ['invrec', 'receipt', 'invoice', 'deal', 'refund'];

// The provider refuses a window holding more than this many documents.
const WINDOW_ROW_CEILING = 100;
const DEFAULT_DELAY_MS = 400;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_BACKOFF_MS = 60_000;
// Latency degradation guard: if the provider slows to a crawl we back off
// rather than keep hammering it.
const SLOW_RESPONSE_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toMinor = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 100));
};

const asDate = (s) => {
  if (!s) return null;
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const truthy = (v) => v === true || v === 1 || v === '1';

// One doc/search row → the IcountLedgerDoc shape. Amounts are kept EXACTLY as
// iCount reports them, credit notes included (negative). Normalising the sign
// is the attach step's job, so this table stays byte-comparable with the
// provider.
export function ledgerRowFromSearch(r) {
  const doctype = r.doctype || r.doc_type;
  const docnum = r.docnum != null ? String(r.docnum) : null;
  if (!doctype || !docnum) return null;
  const issuedAt = asDate(r.dateissued || r.date_issued);
  if (!issuedAt) return null;

  // `totalwithvat` is the VAT-inclusive gross; receipts have no VAT breakdown
  // and report the money under `total`.
  const gross = r.totalwithvat != null && r.totalwithvat !== '' ? r.totalwithvat : r.total;
  // `totalpaid` is what the document RECORDS as received — present only on the
  // types that record money (receipt / invrec). An empty string is "not
  // applicable", not zero.
  const paidRaw = r.totalpaid != null && r.totalpaid !== '' ? r.totalpaid : r.paid;

  return {
    doctype,
    docnum,
    issuedAt,
    clientId: r.client_id != null ? String(r.client_id) : null,
    clientName: r.client_name || null,
    clientVatId: r.client_idno ? String(r.client_idno) : null,
    currency: r.currency_code || 'ILS',
    fxRate: r.rate != null ? String(r.rate) : null,
    totalMinor: toMinor(gross) ?? 0n,
    paidMinor: paidRaw != null && paidRaw !== '' ? toMinor(paidRaw) : null,
    vatMinor: r.totalvat != null && r.totalvat !== '' ? toMinor(r.totalvat) : null,
    vatPercent: r.vat_percent != null ? String(r.vat_percent) : null,
    isCancelled: truthy(r.is_cancelled),
    isCancellation: truthy(r.is_cancellation),
    providerStatus: r.status != null && r.status !== '' ? Number(r.status) : null,
    raw: r,
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00.000Z`) - new Date(`${a}T00:00:00.000Z`)) / 86_400_000);
const midpoint = (a, b) => addDays(a, Math.floor(daysBetween(a, b) / 2));

// A paced, self-throttling caller. Every provider read in the census goes
// through this so back-off and the failure ceiling apply uniformly.
export function createPacer({ delayMs = DEFAULT_DELAY_MS, log = console } = {}) {
  const state = { requests: 0, failures: 0, consecutiveFailures: 0, backoffMs: 0, stopped: false, reason: null };

  async function call(fn, label) {
    if (state.stopped) throw Object.assign(new Error('census_stopped'), { code: 'census_stopped' });
    if (state.backoffMs) {
      log.warn?.(`[census] backing off ${state.backoffMs}ms before ${label}`);
      await sleep(state.backoffMs);
    } else {
      await sleep(delayMs);
    }
    const t0 = Date.now();
    try {
      const out = await fn();
      const ms = Date.now() - t0;
      state.requests += 1;
      state.consecutiveFailures = 0;
      // Latency degradation → widen the gap; a healthy response shrinks it back.
      if (ms > SLOW_RESPONSE_MS) {
        state.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(2_000, state.backoffMs * 2 || 2_000));
        log.warn?.(`[census] ${label} took ${ms}ms — slowing down`);
      } else {
        state.backoffMs = 0;
      }
      return out;
    } catch (err) {
      state.requests += 1;
      state.failures += 1;
      state.consecutiveFailures += 1;
      const reason = String(err?.reason || err?.code || err?.message || '');
      // A rate-limit / throttle signal is respected explicitly.
      if (/rate|throttle|too_many_requests|429/i.test(reason)) {
        state.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(5_000, (state.backoffMs || 2_500) * 2));
        log.warn?.(`[census] rate signal on ${label} (${reason}) — backing off ${state.backoffMs}ms`);
      } else if (err?.code === 'icount_timeout') {
        state.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(3_000, (state.backoffMs || 1_500) * 2));
      }
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.stopped = true;
        state.reason = `${MAX_CONSECUTIVE_FAILURES} consecutive failures — last: ${reason}`;
        log.error?.(`[census] STOPPING: ${state.reason}`);
      }
      throw err;
    }
  }

  return { call, state };
}

// Persist a window's ledger rows. Idempotent by (doctype, docnum): re-running
// the census refreshes the numbers and never duplicates.
//
// Sent as ONE batched transaction rather than a row-at-a-time loop. The census
// writes ~15,000 rows and the database is reached over a proxy — at a round
// trip each, the writes, not the provider, become the bottleneck.
async function upsertLedgerRows(prisma, rows) {
  if (!rows.length) return 0;
  const now = new Date();
  await prisma.$transaction(
    rows.map((row) => {
      const { doctype, docnum, ...rest } = row;
      return prisma.icountLedgerDoc.upsert({
        where: { doctype_docnum: { doctype, docnum } },
        // The census must never clobber the lazily-fetched doc/info enrichment
        // (docUrl / basedOn) that a later step wrote — those fields are absent
        // here, so they are simply not part of the update.
        update: { ...rest, syncedAt: now },
        create: { doctype, docnum, ...rest },
      });
    }),
  );
  return rows.length;
}

/**
 * Enumerate one doctype across [startDate, endDate] by adaptively splitting the
 * window whenever the provider says it holds more documents than it will
 * return. Windows are walked in chronological order so a resumable cursor is
 * meaningful.
 *
 * `onWindowDone(endDate)` is called after each fully-persisted window — the
 * caller uses it to advance a durable cursor.
 */
export async function censusDoctype(prisma, doctype, { startDate, endDate, pacer, log = console, onWindowDone } = {}) {
  const stats = { doctype, requests: 0, documents: 0, windows: 0, splits: 0, gaps: [] };

  // Explicit stack instead of recursion: the walk can be thousands of windows
  // deep on a busy doctype and must stay in chronological order.
  const stack = [[startDate, endDate]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let result;
    try {
      result = await pacer.call(
        () => searchDocsWindow({ doctype, startDate: from, endDate: to }),
        `search ${doctype} ${from}..${to}`,
      );
    } catch (err) {
      if (err?.code === 'census_stopped') throw err;
      // A single failed window is recorded as a GAP, never silently skipped —
      // an unresolved reference inside it falls back to a direct doc/info read.
      stats.gaps.push({ from, to, reason: String(err?.reason || err?.message || err) });
      log.error?.(`[census] ${doctype} ${from}..${to} failed: ${err?.reason || err?.message}`);
      continue;
    }
    stats.requests += 1;

    if (result.tooMany) {
      const span = daysBetween(from, to);
      if (span <= 0) {
        // A single day holding more than the ceiling cannot be split further.
        // Recorded as a gap so the report says so out loud; references landing
        // in it are resolved individually by doc/info later.
        stats.gaps.push({ from, to, reason: `single_day_over_ceiling (${result.count ?? '?'} docs)` });
        log.warn?.(`[census] ${doctype} ${from}: ${result.count ?? '?'} documents in one day — over the ${WINDOW_ROW_CEILING}-row ceiling`);
        continue;
      }
      const mid = midpoint(from, to);
      stats.splits += 1;
      // Pushed so the EARLIER half is processed first (stack → reverse order).
      stack.push([addDays(mid, 1), to]);
      stack.push([from, mid]);
      continue;
    }

    const rows = result.rows.map(ledgerRowFromSearch).filter(Boolean);
    if (rows.length) stats.documents += await upsertLedgerRows(prisma, rows);
    stats.windows += 1;
    onWindowDone?.(to, stats);
  }
  return stats;
}

/**
 * Full census across every doctype. Resumable: `cursors` maps doctype → the
 * last completed date, and the walk restarts from the day after.
 */
export async function runCensus(
  prisma,
  { startDate = '2015-01-01', endDate, doctypes = CENSUS_DOCTYPES, cursors = {}, delayMs, log = console, onProgress } = {},
) {
  if (!isIcountConfigured()) {
    throw Object.assign(new Error('icount_not_configured'), { code: 'icount_not_configured' });
  }
  const end = endDate || iso(new Date(Date.now() + 86_400_000)); // include today
  const pacer = createPacer({ delayMs, log });
  const perType = [];
  for (const doctype of doctypes) {
    const from = cursors[doctype] ? addDays(cursors[doctype], 1) : startDate;
    if (daysBetween(from, end) < 0) {
      log.log?.(`[census] ${doctype}: already complete through ${cursors[doctype]}`);
      continue;
    }
    log.log?.(`[census] ${doctype}: ${from} … ${end}`);
    const stats = await censusDoctype(prisma, doctype, {
      startDate: from,
      endDate: end,
      pacer,
      log,
      onWindowDone: (doneTo, s) => onProgress?.({ doctype, cursor: doneTo, ...s }),
    });
    perType.push(stats);
    log.log?.(`[census] ${doctype}: ${stats.documents} documents, ${stats.requests} requests, ${stats.splits} splits, ${stats.gaps.length} gaps`);
  }
  return {
    perType,
    totalRequests: pacer.state.requests,
    totalDocuments: perType.reduce((s, t) => s + t.documents, 0),
    failures: pacer.state.failures,
    stopped: pacer.state.stopped,
    stopReason: pacer.state.reason,
  };
}

/**
 * Resolve ONE document straight from the provider and fold it into the ledger.
 * Used for a reference the census never saw (a gap window, or a document type
 * outside the census range), and to enrich a document with the fields
 * doc/search cannot return: doc_url and the based_on relation graph.
 *
 * Returns the ledger row, or null when iCount does not recognise the pair.
 */
export async function fetchLedgerDoc(prisma, doctype, docnum, { pacer, log = console } = {}) {
  const num = String(docnum);
  // A wrong doctype guess comes back as doc_not_found. That is an EMPTY ANSWER,
  // not a failure — resolving a bare number means probing several types on
  // purpose, so it must be absorbed INSIDE the paced call. Letting it reach the
  // pacer would trip the consecutive-failure ceiling after five type probes and
  // abandon the run (observed on the first production pass).
  const read = async () => {
    try {
      return await docInfo(doctype, num);
    } catch (err) {
      if (/doc_not_found|not_found/i.test(String(err?.reason || ''))) return null;
      throw err;
    }
  };

  let info;
  try {
    info = pacer ? await pacer.call(read, `info ${doctype}/${num}`) : await read();
  } catch (err) {
    if (err?.code === 'census_stopped') throw err;
    log.error?.(`[census] doc/info ${doctype}/${num} failed: ${err?.reason || err?.message}`);
    return null;
  }
  if (!info || !info.docnum) return null;

  const base = ledgerRowFromSearch({ ...info, doctype, docnum: num });
  if (!base) return null;
  const data = {
    ...base,
    docUrl: info.doc_url || null,
    basedOn: Array.isArray(info.based_on) ? info.based_on : undefined,
    basedOnThis: Array.isArray(info.based_on_this) ? info.based_on_this : undefined,
  };
  const { doctype: dt, docnum: dn, ...rest } = data;
  return prisma.icountLedgerDoc.upsert({
    where: { doctype_docnum: { doctype: dt, docnum: dn } },
    update: { ...rest, syncedAt: new Date() },
    create: { doctype: dt, docnum: dn, ...rest },
  });
}
