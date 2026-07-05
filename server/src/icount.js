// Outbound iCount PayPage client — personal payment links only.
//   POST ${ICOUNT_API_BASE}/paypage/generate_sale
//
// Ported 1:1 from the PROVEN Challenge System integration (confirmed against
// production 2026-05-29): cid/user/pass sent in the JSON body, NO Bearer
// header — this exact shape is what makes iCount prefill the visible customer
// form fields, and prices are sent VAT-INCLUSIVE (unitprice_incl; sending
// `unitprice` would make iCount add VAT again). Do not "modernize" this call.
//
// Credentials come ONLY from env (never hardcoded, never logged). When creds
// are missing the route returns a clean 'icount_not_configured' error, so
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

export async function generateSale(p) {
  const legacy = legacyAuthBody();
  const base = process.env.ICOUNT_API_BASE || API_BASE_DEFAULT;
  const payload = salePayload(p);
  console.log(`[icount] generate_sale body: ${JSON.stringify({ cid: legacy.cid, user: legacy.user, pass: '***', ...payload })}`);

  const res = await fetch(`${base}/paypage/generate_sale`, {
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
