// One-time provisioning of the VAT-EXEMPT iCount paypage that exempt deals'
// payment links are generated on — see dealPayment.js salePaypageId().
//
// ── Why a separate page (verified live 2026-08-03) ───────────────────────────
// VAT presentation is a PAYPAGE property; generate_sale cannot override it.
// Sending tax_exempt / add_vat / vat_rate on the sale (or tax_exempt on the
// item) leaves the regular page presenting the amount as VAT-inclusive:
// ₪1,000 renders as ₪847.46 + ₪152.54 מע"מ. Only the page's own settings
// change it, and the ONE that matters is `tax_exempt`:
//   tax_exempt=true  → is_tax_exempt on the page, vat=0, the amount passes
//                      verbatim and the summary drops the VAT rows entirely
//                      ("סה\"כ לתשלום ₪1,000.00").
//   add_vat=false alone is NOT exemption — it means "the prices I send are
//                      NET", so ₪1,000 would be charged as ₪1,180. Never use
//                      it as the exempt signal.
//
// Idempotent:
//   • ICOUNT_EXEMPT_PAYPAGE_ID already set → verifies the page really is
//     tax-exempt, prints the verdict, changes nothing.
//   • Not set → creates + configures the page, verifies it, and prints the id
//     to set as the ICOUNT_EXEMPT_PAYPAGE_ID Railway variable.
//
// Run with the iCount env vars exported (same set the server uses):
//   railway run node server/scripts/provisionExemptPaypage.mjs
// Additive only — never touches the regular ICOUNT_DEFAULT_PAYPAGE_ID page.

const base = process.env.ICOUNT_API_BASE || 'https://api.icount.co.il/api/v3.php';
const auth = { cid: process.env.ICOUNT_CID, user: process.env.ICOUNT_USER, pass: process.env.ICOUNT_PASS };
if (!auth.cid || !auth.user || !auth.pass) {
  console.error('ICOUNT_CID / ICOUNT_USER / ICOUNT_PASS must be set.');
  process.exit(1);
}

async function call(path, payload = {}) {
  const res = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, ...payload }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status === false) {
    throw new Error(`${path} failed: ${data?.reason || data?.error_description || `HTTP ${res.status}`}`);
  }
  return data;
}

// The page name is CUSTOMER-VISIBLE (rendered as the page header), so it
// doubles as the required "this sale is VAT-exempt" label.
const PAGE_NAME = 'דינמי - פטור ממע"מ';

const SETTINGS = {
  tax_exempt: 1, // THE exemption switch — see the note above
  auto_vat_detection: 0, // never let iCount re-decide VAT per customer
  add_vat: 1, // amounts are sent as final (unitprice_incl), never net+VAT
  currency_id: 5, // ILS, same as the regular page
  doctype: 'invrec', // חשבונית מס קבלה — same auto-issued receipt type
  is_active: 1,
};

async function verify(pageId) {
  const info = (await call('paypage/info', { paypage_id: pageId })).paypage_info;
  const exempt = info?.tax_exempt === true || info?.tax_exempt === 1 || info?.tax_exempt === '1';
  console.log(
    `paypage ${pageId}: "${info?.page_name}" tax_exempt=${JSON.stringify(info?.tax_exempt)} ` +
      `add_vat=${info?.add_vat} currency_id=${info?.currency_id} doctype=${info?.doctype} active=${info?.is_active}`,
  );
  if (!exempt) {
    console.error('✗ this page is NOT tax-exempt — it must not be used for exempt deals.');
    process.exit(1);
  }
  console.log('✓ page is tax-exempt: amounts pass verbatim, VAT = ₪0.');
  return info;
}

const existing = process.env.ICOUNT_EXEMPT_PAYPAGE_ID;
if (existing) {
  await verify(existing);
  process.exit(0);
}

const created = await call('paypage/create', { page_name: PAGE_NAME, custom_sum: 0, max_payments: '1', ...SETTINGS });
const pageId = created?.paypage_id ?? created?.data?.paypage_id ?? created?.page_id;
if (!pageId) {
  console.error('paypage/create returned no id:', JSON.stringify(created).slice(0, 400));
  process.exit(1);
}
// paypage/create ignores some of the VAT settings; paypage/update is what
// actually applies them (verified live — a created page came back
// tax_exempt:"auto" until updated).
await call('paypage/update', { paypage_id: String(pageId), page_name: PAGE_NAME, ...SETTINGS });
console.log(`created exempt paypage id=${pageId}`);
await verify(pageId);
console.log(`\nSet on Railway:  ICOUNT_EXEMPT_PAYPAGE_ID=${pageId}`);
