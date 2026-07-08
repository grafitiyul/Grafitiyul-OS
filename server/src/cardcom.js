// Outbound Cardcom API client (v11 LowProfile) — the clearing provider for
// tourist-card / 3D-Secure payments.
//   POST ${CARDCOM_API_BASE}/LowProfile/Create      — create a hosted payment page
//   POST ${CARDCOM_API_BASE}/LowProfile/GetLpResult — verify a deal result
//
// Cardcom ONLY clears here. It creates NO accounting document (we deliberately
// omit the `Document` object), so the hosted page requires no Israeli ת.ז / ח.פ.
// iCount stays the accounting provider (see touristPayment.js). 3D Secure is
// enforced by the terminal itself — GOS sends no 3DS parameters.
//
// Auth is body-based: TerminalNumber + ApiName (+ optional ApiPassword only for
// endpoints that require it). Credentials come ONLY from env, never hardcoded,
// never logged. Missing creds → a clean coded 'cardcom_not_configured' error.

const API_BASE_DEFAULT = 'https://secure.cardcom.solutions/api/v11';

export function isCardcomConfigured() {
  return !!(process.env.CARDCOM_TERMINAL_NUMBER && process.env.CARDCOM_API_NAME);
}

function cardcomAuth() {
  const terminal = process.env.CARDCOM_TERMINAL_NUMBER;
  const apiName = process.env.CARDCOM_API_NAME;
  if (!terminal || !apiName) {
    // Name exactly which vars are missing (names only, never values) so the
    // operator can fix the deployment from the log alone.
    const missing = [!terminal && 'CARDCOM_TERMINAL_NUMBER', !apiName && 'CARDCOM_API_NAME'].filter(Boolean);
    console.error(`[cardcom] not configured — missing env: ${missing.join(', ')}`);
    const err = new Error('cardcom_not_configured');
    err.code = 'cardcom_not_configured';
    err.reason = `missing env: ${missing.join(', ')}`;
    throw err;
  }
  const auth = { TerminalNumber: Number(terminal), ApiName: apiName };
  // Only endpoints that require it (some accounts gate GetLpResult) get a password.
  if (process.env.CARDCOM_API_PASSWORD) auth.ApiPassword = process.env.CARDCOM_API_PASSWORD;
  return auth;
}

// Currency → Cardcom ISOCoinId. Defaults follow the commonly-documented mapping
// but are OVERRIDABLE per terminal via env — the exact codes MUST be confirmed
// against the live terminal before real charges (a wrong code clears the wrong
// currency). See the plan's blocking pre-code check.
const ISO_COIN_DEFAULT = { ILS: 1, USD: 2, EUR: 978 };

export function isoCoinId(currency) {
  const cur = String(currency || 'ILS').toUpperCase();
  const envKey = `CARDCOM_ISOCOIN_${cur}`;
  const override = Number(process.env[envKey]);
  if (Number.isFinite(override) && override > 0) return override;
  const code = ISO_COIN_DEFAULT[cur];
  if (!code) {
    const err = new Error(`cardcom_currency_unsupported: ${cur}`);
    err.code = 'cardcom_currency_unsupported';
    err.reason = cur;
    throw err;
  }
  return code;
}

export const SUPPORTED_CURRENCIES = Object.keys(ISO_COIN_DEFAULT);

function cardcomTimeoutMs() {
  const v = Number(process.env.CARDCOM_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}

// Bounded: a hung provider must surface as a structured GOS error, never as an
// upstream gateway timeout (Cloudflare replaces origin 502/504 with its HTML).
async function boundedFetch(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(cardcomTimeoutMs()) });
  } catch (e) {
    const err = new Error('cardcom_timeout');
    err.code = 'cardcom_timeout';
    err.reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
    throw err;
  }
}

// One POST with body auth; parses JSON; throws a coded error on transport or a
// non-zero ResponseCode. Secrets are never logged (auth stripped from the log).
async function cardcomRequest(path, payload) {
  const auth = cardcomAuth();
  const base = String(process.env.CARDCOM_API_BASE || API_BASE_DEFAULT).replace(/\/+$/, '');
  console.log(`[cardcom] ${path} body: ${JSON.stringify({ TerminalNumber: auth.TerminalNumber, ApiName: '***', ...payload })}`);

  const res = await boundedFetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, ...payload }),
  });
  // Read as text first so a non-JSON body (HTML error page, proxy response) is
  // still captured verbatim in the log instead of vanishing into a null parse.
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON body — logged below */
  }

  if (!res.ok || !data) {
    const reason = `HTTP ${res.status}`;
    console.error(`[cardcom] ${path} transport failed: ${reason} body=${text.slice(0, 800) || '(empty)'}`);
    const err = new Error(`cardcom_request_failed: ${reason}`);
    err.code = 'cardcom_request_failed';
    err.reason = reason;
    throw err;
  }
  // v11: success is ResponseCode === 0. Anything else carries a Description —
  // log the COMPLETE payload so the exact rejection class (auth / currency /
  // missing parameter / terminal config / validation) is visible in the log.
  if (Number(data.ResponseCode) !== 0) {
    const reason = data.Description || `ResponseCode ${data.ResponseCode}`;
    console.error(
      `[cardcom] ${path} rejected: ResponseCode=${data.ResponseCode} description="${data.Description || ''}" fullResponse=${JSON.stringify(data).slice(0, 1500)}`,
    );
    const err = new Error(`cardcom_request_failed: ${reason}`);
    err.code = 'cardcom_request_failed';
    err.reason = String(reason);
    err.responseCode = Number(data.ResponseCode);
    throw err;
  }
  return data;
}

// Create a hosted LowProfile payment page (English, no document, tourist-safe).
// `amountMajor` is major units (e.g. 100.00). `returnValue` is our own id echoed
// back on the webhook / result. Returns { lowProfileId, url, raw }.
export async function createLowProfile({
  amountMajor,
  currency,
  productName,
  returnValue,
  webHookUrl,
  successUrl,
  failedUrl,
  language = 'en',
}) {
  const coinId = isoCoinId(currency);
  // The mapping actually used + webhook presence, on one greppable line.
  console.log(
    `[cardcom] LowProfile/Create: currency=${currency} → ISOCoinId=${coinId}, amount=${Number(amountMajor)}, webhook=${webHookUrl ? 'set' : 'MISSING'}`,
  );
  const payload = {
    Operation: 'ChargeOnly', // plain charge; 3DS handled by the terminal config
    Amount: Number(amountMajor),
    ISOCoinId: coinId,
    Language: language,
    ProductName: String(productName || '').slice(0, 250),
    ReturnValue: String(returnValue || ''),
    ...(webHookUrl ? { WebHookUrl: webHookUrl } : {}),
    ...(successUrl ? { SuccessRedirectUrl: successUrl } : {}),
    ...(failedUrl ? { FailedRedirectUrl: failedUrl } : {}),
    // NOTE: intentionally NO `Document` object — Cardcom must not issue an
    // accounting document, and omitting it removes the mandatory Israeli-ID
    // field from the hosted page (iCount is our accounting provider).
  };

  const data = await cardcomRequest('LowProfile/Create', payload);
  const lowProfileId = data.LowProfileId || data.LowProfileCode || null;
  const url = data.Url || data.url || null;
  if (!lowProfileId || !url) {
    const err = new Error('cardcom_request_failed: missing LowProfileId/Url');
    err.code = 'cardcom_request_failed';
    err.reason = 'missing_lowprofile_or_url';
    err.raw = data;
    throw err;
  }
  return { lowProfileId: String(lowProfileId), url: String(url), raw: data };
}

// Server-side verification of a completed deal (called from the webhook — never
// trust the webhook body alone). Returns the normalized result.
export async function getLpResult(lowProfileId) {
  const data = await cardcomRequest('LowProfile/GetLpResult', { LowProfileId: String(lowProfileId) });
  const tx = data.TranzactionInfo || data.TransactionInfo || {};
  return {
    responseCode: Number(data.ResponseCode),
    lowProfileId: String(data.LowProfileId || lowProfileId),
    returnValue: data.ReturnValue != null ? String(data.ReturnValue) : null,
    transactionId: tx.TranzactionId != null ? String(tx.TranzactionId) : data.TranzactionId != null ? String(data.TranzactionId) : null,
    amount: Number(tx.Amount ?? data.Amount ?? 0) || null,
    cardLast4: tx.Last4CardDigits != null ? String(tx.Last4CardDigits) : tx.CardNumber != null ? String(tx.CardNumber).slice(-4) : null,
    approved: Number(tx.ResponseCode ?? 0) === 0,
    raw: data,
  };
}
