// Outbound iCount API client.
//   POST ${ICOUNT_API_BASE}/paypage/generate_sale   — personal payment links
//   POST ${ICOUNT_API_BASE}/doc/create              — accounting documents
//   POST ${ICOUNT_API_BASE}/doc/search              — previous documents
//   POST ${ICOUNT_API_BASE}/doc/info                — one document (credit base)
//   POST ${ICOUNT_API_BASE}/doc/email               — email a document to the customer
//   POST ${ICOUNT_API_BASE}/doc/get_doc_url         — document view URL
//
// generate_sale is ported 1:1 from the PROVEN Challenge System integration
// (confirmed against production 2026-05-29): cid/user/pass sent in the JSON
// body, NO Bearer header — this exact shape is what makes iCount prefill the
// visible customer form fields, and prices are sent VAT-INCLUSIVE
// (unitprice_incl; sending `unitprice` would make iCount add VAT again). Do
// not "modernize" this call. The doc/* endpoints reuse the same body auth and
// the same VAT-inclusive item shape.
//
// Credentials come ONLY from env (never hardcoded, never logged). When creds
// are missing the routes return a clean 'icount_not_configured' error, so
// deploying without Railway variables set is safe.

const API_BASE_DEFAULT = 'https://api.icount.co.il/api/v3.php';

export function isIcountConfigured() {
  return !!(process.env.ICOUNT_CID && process.env.ICOUNT_USER && process.env.ICOUNT_PASS);
}

function legacyAuthBody() {
  const cid = process.env.ICOUNT_CID;
  const user = process.env.ICOUNT_USER;
  const pass = process.env.ICOUNT_PASS;
  if (!cid || !user || !pass) {
    const err = new Error('icount_not_configured');
    err.code = 'icount_not_configured';
    throw err;
  }
  return { cid, user, pass };
}

// The exact generate_sale request payload (no auth/secrets).
function salePayload(p) {
  return {
    paypage_id: p.paypageId,
    items: p.items, // [{ quantity, description, unitprice_incl }]
    client_name: p.clientName,
    first_name: p.firstName ?? '',
    last_name: p.lastName ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    max_payments: String(p.maxPayments ?? 10),
    max_payments_advanced: String(p.maxPayments ?? 10),
    ...(p.ipnUrl ? { ipn_url: p.ipnUrl } : {}),
    ...(p.successUrl ? { success_url: p.successUrl } : {}),
  };
}

// Every iCount call is bounded: a hung provider must surface as a structured
// GOS error, never as an upstream gateway timeout (Cloudflare replaces origin
// 502/504 bodies with its own HTML page).
function icountTimeoutMs() {
  const v = Number(process.env.ICOUNT_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}

async function boundedFetch(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(icountTimeoutMs()) });
  } catch (e) {
    const err = new Error('icount_timeout');
    err.code = 'icount_timeout';
    err.reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
    throw err;
  }
}

export async function generateSale(p) {
  const legacy = legacyAuthBody();
  const base = process.env.ICOUNT_API_BASE || API_BASE_DEFAULT;
  const payload = salePayload(p);
  console.log(`[icount] generate_sale body: ${JSON.stringify({ cid: legacy.cid, user: legacy.user, pass: '***', ...payload })}`);

  const res = await boundedFetch(`${base}/paypage/generate_sale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // legacy body auth — no Bearer
    body: JSON.stringify({ ...legacy, ...payload }),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.status === false || !data.sale_url) {
    const reason = (data && data.reason) || `HTTP ${res.status}`;
    console.error(`[icount] generate_sale failed: ${reason}`);
    const err = new Error(`icount_generate_failed: ${reason}`);
    err.code = 'icount_generate_failed';
    err.reason = String(reason);
    throw err;
  }
  return { saleUrl: data.sale_url, raw: data };
}

// ── doc/* endpoints (accounting documents) ───────────────────────────────────

// Generic iCount call with the same legacy body auth as generate_sale.
// Returns the parsed JSON; throws a coded error when iCount reports failure
// (status:false / error_description / HTTP error). Secrets never logged.
async function icountRequest(path, payload) {
  const legacy = legacyAuthBody();
  const base = process.env.ICOUNT_API_BASE || API_BASE_DEFAULT;
  console.log(`[icount] ${path} body: ${JSON.stringify({ cid: legacy.cid, user: legacy.user, pass: '***', ...payload })}`);

  const res = await boundedFetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // legacy body auth — no Bearer
    body: JSON.stringify({ ...legacy, ...payload }),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.status === false) {
    // Surface everything iCount tells us: the reason code plus any
    // error_details (e.g. WHY a create_doc failed — date chronology, missing
    // fields) — the modal maps these to clean Hebrew.
    const details = Array.isArray(data?.error_details) && data.error_details.length
      ? ` (${data.error_details.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join('; ')})`
      : '';
    const reason =
      ((data && (data.reason || data.error_description || data.message || data.error)) || `HTTP ${res.status}`) + details;
    console.error(`[icount] ${path} failed: ${reason}`);
    const err = new Error(`icount_request_failed: ${reason}`);
    err.code = 'icount_request_failed';
    err.reason = String(reason);
    throw err;
  }
  return data;
}

// Create an accounting document (doc/create). `payload` is the full iCount
// body built by the service layer (doctype, client fields, items with
// unitprice_incl, payment blocks, based_on / origin_doc_id, hwc…).
// Returns { docId, docnum, docUrl, raw }.
export async function createDoc(payload) {
  const data = await icountRequest('doc/create', payload);
  const d = data.data || data;
  const docnum = d.doc_number ?? d.docnum ?? null;
  const docId = d.doc_id ?? null;
  const docUrl = d.pdf_link ?? d.doc_url ?? null;
  if (docnum == null && docId == null) {
    // status was true but no document identity came back — treat as failure so
    // we never record a phantom document.
    const err = new Error('icount_request_failed: no docnum in response');
    err.code = 'icount_request_failed';
    err.reason = 'no_docnum_in_response';
    err.raw = data;
    throw err;
  }
  return { docId: docId != null ? String(docId) : null, docnum: docnum != null ? String(docnum) : null, docUrl, raw: data };
}

// "Zero results" comes back from iCount as status:false with one of these
// reasons — that is an EMPTY result, never an error.
const NO_RESULTS_REASONS = /no_results_found|client_not_found|not_found/i;

// Search documents (doc/search) — used to list the customer's previous iCount
// documents for base/close/credit selection. Rows live under `results_list`
// (verified against the live API 2026-07-08). Returns [] for iCount's
// "no results" status; real API failures still throw.
export async function searchDocs(filters) {
  let data;
  try {
    data = await icountRequest('doc/search', { detail_level: 2, max_results: 50, ...filters });
  } catch (err) {
    if (NO_RESULTS_REASONS.test(String(err?.reason || ''))) return [];
    throw err;
  }
  const rows = data.results_list ?? data.data;
  return Array.isArray(rows) ? rows : [];
}

// One document's details (doc/info) — the payload nests everything under
// `doc_info` (items with NET unitprice + per-item tax_rate/tax_exempt,
// totals, doc_url, based_on/based_on_this; verified live 2026-07-08).
export async function docInfo(doctype, docnum) {
  const data = await icountRequest('doc/info', { doctype, docnum: Number(docnum) });
  return data.doc_info || data.data || data;
}

// ── client/* endpoints (customer identity) ───────────────────────────────────
// EMAIL is the accounting identity key: before a document creates a customer
// implicitly, we look the email up (client/find) and reuse+update the existing
// iCount customer (client/create_or_update) instead of letting doc/create
// mint a duplicate under a new display name.

// Find an existing iCount customer by email (or ח.פ). client/info resolves an
// email to its client (matching_query_id:'email'; client/find is bad_method
// under body auth — verified live 2026-07-08). Returns client_id or null;
// "not found" and genuine failures both resolve to null (the caller falls
// back to letting doc/create handle the customer) — failures are logged.
export async function findClient({ email, hp }) {
  try {
    const body = {};
    if (email) body.email = email;
    if (hp) body.hp = hp;
    const data = await icountRequest('client/info', body);
    const id = data?.client_id ?? data?.client_info?.client_id ?? null;
    return id != null ? String(id) : null;
  } catch (err) {
    if (!NO_RESULTS_REASONS.test(String(err?.reason || ''))) {
      console.error(`[icount] client/info lookup failed: ${err?.reason || err?.message || err}`);
    }
    return null;
  }
}

// Update (or create) an iCount customer. `fields` uses the modal's edited
// values; both spellings are sent where iCount accepts either (same shape as
// the verified v3 integration). Returns the client_id.
export async function upsertClient({ clientId, name, vatId, email, phone, address }) {
  const body = {
    ...(clientId ? { client_id: clientId } : {}),
    client_name: name,
    ...(vatId ? { vat_id: vatId, hp: vatId } : {}),
    ...(email ? { email, client_email: email } : {}),
    ...(phone ? { phone, client_phone: phone } : {}),
    ...(address ? { address, client_address: address } : {}),
  };
  const data = await icountRequest('client/create_or_update', body);
  const id = data?.data?.client_id ?? data?.client_id ?? clientId ?? null;
  return id != null ? String(id) : null;
}

// Email an already-issued document to a recipient. The live v3 method is
// doc/email — doc/send does NOT exist (bad_method; both verified live
// 2026-07-08). Params: doctype + docnum + email_to. HAZARD (also verified
// live): doc/email IGNORES unknown params, and without a usable recipient it
// silently falls back to the customer email on the iCount client card — so
// success is only reported after the response's per-recipient email_status
// confirms OUR address actually received the mail.
export async function sendDocByEmail({ doctype, docnum, email }) {
  const addr = String(email || '').trim();
  if (!addr) {
    const err = new Error('email_required');
    err.code = 'email_required';
    throw err;
  }
  const data = await icountRequest('doc/email', {
    doctype,
    docnum: Number(docnum),
    email_to: addr,
  });
  if (!emailRecipientConfirmed(data, addr)) {
    const err = new Error('icount_request_failed: doc/email did not confirm the recipient');
    err.code = 'icount_request_failed';
    err.reason = 'recipient_not_confirmed';
    throw err;
  }
  return { sent: true };
}

// Pure: did doc/email's response confirm delivery to `addr`? The response
// carries email_status keyed by address — { email, addr?, email_sent } per
// recipient (live shape 2026-07-08).
export function emailRecipientConfirmed(data, addr) {
  const want = String(addr || '').trim().toLowerCase();
  if (!want) return false;
  const statuses =
    data?.email_status && typeof data.email_status === 'object' ? Object.values(data.email_status) : [];
  return statuses.some((s) => {
    const got = String(s?.email || s?.addr || '').trim().toLowerCase();
    return got === want && s?.email_sent === true;
  });
}

// Viewer URL for an issued document (doc/get_doc_url).
export async function getDocUrl(doctype, docnum) {
  const data = await icountRequest('doc/get_doc_url', {
    doctype,
    docnum: Number(docnum),
    lang: 'he',
    orig: true,
    hidenis: false,
  });
  return data.url || null;
}
