import { createDoc, docInfo, searchDocs, findClient, upsertClient, isIcountConfigured } from './icount.js';
import { emitTimelineEvent, userOrigin, systemOrigin } from './timeline/events.js';

// iCount document production — the domain logic behind "הפק מסמך".
//
// GOS is the operational source of truth; iCount is the accounting provider.
// This module builds the modal's prefill from the Deal (never the UI), issues
// documents through doc/create, links/closes base documents the way iCount
// expects (based_on for closing, origin_doc_id for credits), enforces the
// Israel Tax Authority allocation-number precondition, and records every
// issued document as an IcountDocument row + a PINNED 'accounting' timeline
// event — atomically, and idempotently (unique idempotencyKey).
//
// Money: GOS stores agorot (minor). iCount receives major units, VAT-INCLUSIVE
// (unitprice_incl) — the same proven shape as the payment-link integration.

// The five producible types. `paymentsAllowed` = the modal offers payment
// blocks (docs that RECORD money received). `baseTypes` = which previous
// documents this type may be based on / close; `baseRequired` marks the credit
// flow where issuing without an original invoice would be dangerous guessing.
export const DOC_TYPES = [
  { key: 'deal', label: 'חשבון עסקה', paymentsAllowed: false, baseTypes: [], baseRequired: false },
  { key: 'invoice', label: 'חשבונית מס', paymentsAllowed: false, baseTypes: ['deal'], baseRequired: false },
  { key: 'invrec', label: 'חשבונית מס קבלה', paymentsAllowed: true, baseTypes: ['deal'], baseRequired: false },
  { key: 'receipt', label: 'קבלה', paymentsAllowed: true, baseTypes: ['invoice'], baseRequired: false },
  { key: 'refund', label: 'חשבונית זיכוי', paymentsAllowed: false, baseTypes: ['invoice', 'invrec'], baseRequired: true },
];

export const DOC_TYPE_LABELS = Object.fromEntries(DOC_TYPES.map((t) => [t.key, t.label]));

// Doc types that are tax invoices for ITA allocation-number purposes.
const ALLOCATION_DOCTYPES = new Set(['invoice', 'invrec', 'refund']);

export function vatRatePercent() {
  const v = Number(process.env.ICOUNT_VAT_RATE);
  return Number.isFinite(v) && v > 0 ? v : 18;
}

export function allocationThresholdIls() {
  const v = Number(process.env.ICOUNT_ALLOCATION_THRESHOLD_ILS);
  return Number.isFinite(v) && v > 0 ? v : 5000;
}

// Everything the defaults/issue flows need on the deal row.
export const ICOUNT_DEAL_INCLUDE = {
  product: { select: { nameHe: true } },
  organization: { select: { name: true, taxId: true, address: true, financeEmail: true } },
  organizationUnit: { select: { name: true, taxId: true, address: true, financeEmail: true } },
  paymentMethodRef: { select: { nameHe: true } },
  paymentTerm: { select: { nameHe: true } },
  contacts: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: {
      contact: {
        select: {
          id: true,
          firstNameHe: true,
          lastNameHe: true,
          firstNameEn: true,
          lastNameEn: true,
          taxId: true,
          phones: { where: { isPrimary: true }, take: 1 },
          emails: { where: { isPrimary: true }, take: 1 },
        },
      },
    },
  },
  quoteVersions: {
    where: { isWorking: true },
    take: 1,
    include: { lines: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
  },
};

function contactFullName(c) {
  if (!c) return '';
  return (
    `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() ||
    `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim()
  );
}

// A quote line's price normalized to VAT-INCLUSIVE major units. Lines priced
// "excluded" get VAT added at the line's own rate (fallback: current default);
// "included"/"inherit" pass through (deal totals are gross by convention);
// "exempt" passes through unchanged and is flagged for the UI.
function lineUnitPriceInclIls(line) {
  const major = Number(line.unitPriceMinor) / 100;
  if (line.vatMode === 'excluded') {
    const rate = Number.isFinite(line.vatRate) && line.vatRate != null ? Number(line.vatRate) : vatRatePercent();
    return Math.round(major * (1 + rate / 100) * 100) / 100;
  }
  return major;
}

// GET-defaults payload: everything the modal prefills, straight from the Deal.
// `deal` must be loaded with ICOUNT_DEAL_INCLUDE.
export function buildDocumentDefaults(deal) {
  const contact = deal.contacts?.[0]?.contact || null;
  const org = deal.organizationUnit || deal.organization || null;
  const orgName = deal.organization?.name || null;
  const unitName = deal.organizationUnit?.name || null;
  const organizationName = orgName && unitName ? `${orgName} — ${unitName}` : orgName || unitName;

  const quoteLines = deal.quoteVersions?.[0]?.lines || [];
  const rows = quoteLines.length
    ? quoteLines.map((l) => ({
        description: l.label || deal.product?.nameHe || deal.title,
        quantity: l.quantity || 1,
        unitPriceIls: lineUnitPriceInclIls(l),
        vatExempt: l.vatMode === 'exempt',
      }))
    : [
        {
          description: deal.product?.nameHe || deal.title,
          quantity: 1,
          unitPriceIls: Number(deal.valueMinor || 0n) / 100,
          vatExempt: false,
        },
      ];

  return {
    docTypes: DOC_TYPES,
    vatRate: vatRatePercent(),
    allocationThresholdIls: allocationThresholdIls(),
    icountConfigured: isIcountConfigured(),
    customer: {
      organizationName,
      contactName: contactFullName(contact) || null,
      // Org linked → invoice the organization by default (same rule as the
      // payment link's customerName).
      defaultMode: organizationName ? 'organization' : 'contact',
      // Per-mode tax ids: the org's ח.פ vs the contact's ת.ז — the modal swaps
      // them with the name toggle. `vatId` stays the default-mode value.
      vatIdOrganization: org?.taxId || null,
      vatIdContact: contact?.taxId || null,
      vatId: (organizationName ? org?.taxId : contact?.taxId) || org?.taxId || contact?.taxId || null,
      email: org?.financeEmail || contact?.emails?.[0]?.value || null,
      phone: contact?.phones?.[0]?.value || null,
      address: org?.address || null,
    },
    rows,
    currency: deal.currency || 'ILS',
    paymentMethodName: deal.paymentMethodRef?.nameHe || null,
    paymentTermName: deal.paymentTerm?.nameHe || null,
    notes: '',
  };
}

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

const round2 = (n) => Math.round(n * 100) / 100;

// ── Base-document inheritance ────────────────────────────────────────────────
// A follow-up document (closing / crediting) carries the BASE document's item
// rows EXACTLY as iCount stores them — same descriptions, quantities, prices
// and row details; multiple rows preserved; nothing consolidated, nothing
// synthesized. doc_info items (verified live 2026-07-08) carry a NET
// high-precision `unitprice` + per-item `tax_rate`/`tax_exempt`, so each row
// converts to the modal's VAT-inclusive price with ITS OWN rate — exactly the
// numbers iCount itself shows on the document.
export function normalizeBaseDocItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((it) => {
      const quantity = Number(it.quantity ?? it.qty ?? 1) || 0;
      let unitPriceIls;
      if (it.unitprice_incl != null) {
        unitPriceIls = round2(Number(it.unitprice_incl) || 0);
      } else {
        const net = Number(it.unitprice ?? it.unit_price ?? 0) || 0;
        const exempt = it.tax_exempt === '1' || it.tax_exempt === 1 || it.tax_exempt === true;
        const rate = Number(it.tax_rate);
        unitPriceIls = round2(exempt || !Number.isFinite(rate) ? net : net * (1 + rate / 100));
      }
      return {
        description: String(it.description ?? it.desc ?? '').trim(),
        details: String(it.long_description ?? '').trim() || null,
        quantity,
        unitPriceIls,
      };
    })
    .filter((r) => r.description && r.quantity > 0);
}

// The document's VAT-inclusive total from a doc/info payload — field names are
// read defensively (totalwithvat is the classic iCount name; totalsum+totalvat
// is the before-VAT pair).
export function grossFromDocInfo(info) {
  for (const k of ['totalwithvat', 'total_with_vat', 'totalWithVat', 'total_inc_vat']) {
    const v = Number(info?.[k]);
    if (Number.isFinite(v) && v > 0) return round2(v);
  }
  const sum = Number(info?.totalsum);
  const vat = Number(info?.totalvat);
  if (Number.isFinite(sum) && sum > 0) return round2(sum + (Number.isFinite(vat) && vat > 0 ? vat : 0));
  return null;
}

// Live prefill for a selected base document: its real lines + total (+ client
// name), copied from doc/info. A GOS-recorded row of the same document
// supplies the gross as a fallback when doc/info's totals are unreadable.
export async function fetchBaseDocumentPrefill(prisma, deal, doctype, docnum) {
  if (!DOC_TYPE_LABELS[doctype]) throw codedError('invalid_doctype');
  const local = await prisma.icountDocument.findFirst({
    where: { dealId: deal.id, doctype, docnum: String(docnum) },
    orderBy: { createdAt: 'desc' },
  });
  const info = await docInfo(doctype, docnum);
  const localGross = local ? Number(local.amountMinor) / 100 : null;
  const gross = grossFromDocInfo(info) ?? localGross;
  const rows = normalizeBaseDocItems(info?.items);
  const amountIls = gross ?? round2(rows.reduce((s, r) => s + r.quantity * r.unitPriceIls, 0));
  console.log(
    `[icount] base prefill ${doctype}/${docnum}: items=${Array.isArray(info?.items) ? info.items.length : 'none'} gross=${gross ?? '?'} → rows=${rows.length} total=${amountIls}`,
  );
  return {
    doctype,
    docnum: String(docnum),
    doctypeLabel: DOC_TYPE_LABELS[doctype],
    rows,
    amountIls,
    clientName: info?.client_name || local?.clientName || null,
  };
}

// ── iCount customer identity (email-first) ───────────────────────────────────
// EMAIL is the accounting identity key. When the modal's customer carries an
// email, we look it up in iCount first: an existing customer is REUSED (and
// updated with the edited fields) via client_id — doc/create never mints a
// duplicate for a known email. No email / not found → the document's client_*
// fields let iCount create the customer as before. Update failures degrade to
// "reuse without update" (identity beats freshness); lookup failures degrade
// to the legacy path — both logged, neither blocks issuing.
export async function resolveClientIdentity(client) {
  const email = String(client.email || '').trim();
  if (!email) return { clientId: null, updated: false };
  const clientId = await findClient({ email });
  if (!clientId) return { clientId: null, updated: false };
  try {
    await upsertClient({
      clientId,
      name: client.name,
      vatId: client.vatId ? String(client.vatId).trim() : null,
      email,
      phone: client.phone ? String(client.phone).trim() : null,
      address: client.address ? String(client.address).trim() : null,
    });
    return { clientId, updated: true };
  } catch (err) {
    console.error(`[icount] client update failed for ${clientId} — reusing without update: ${err?.reason || err?.message}`);
    return { clientId, updated: false };
  }
}

// ── GOS write-back: ח.פ / ת.ז persistence ────────────────────────────────────
// Where an issued document's tax id should live in GOS so the NEXT document is
// prefilled: org mode → the deal's OrganizationUnit (most specific) else its
// Organization; contact mode → the deal's primary Contact. Pure — testable.
export function vatIdWriteTarget(deal, clientMode) {
  if (clientMode === 'contact') {
    const contactId = deal.contacts?.[0]?.contact?.id || null;
    return contactId ? { model: 'contact', id: contactId } : null;
  }
  if (deal.organizationUnitId) return { model: 'organizationUnit', id: deal.organizationUnitId };
  if (deal.organizationId) return { model: 'organization', id: deal.organizationId };
  // Org mode without an org can't happen from the modal; fall back to contact.
  const contactId = deal.contacts?.[0]?.contact?.id || null;
  return contactId ? { model: 'contact', id: contactId } : null;
}

// Best-effort (never fails the issue): persist the tax id typed in the modal
// back onto the GOS entity it belongs to.
async function persistClientVatId(prisma, deal, clientMode, vatId) {
  try {
    const value = String(vatId || '').trim();
    if (!value) return;
    const target = vatIdWriteTarget(deal, clientMode || 'organization');
    if (!target) return;
    const current = {
      contact: deal.contacts?.[0]?.contact?.taxId,
      organizationUnit: deal.organizationUnit?.taxId,
      organization: deal.organization?.taxId,
    }[target.model];
    if ((current || '') === value) return; // unchanged — nothing to write
    await prisma[target.model].update({ where: { id: target.id }, data: { taxId: value } });
    console.log(`[icount] persisted vat id onto ${target.model} ${target.id}`);
  } catch (err) {
    console.error(`[icount] vat id write-back failed (non-fatal): ${err?.message || err}`);
  }
}

// Totals for a set of edited rows (major units, VAT-inclusive).
export function totalsForRows(rows, vatRate) {
  const grossIls = round2(rows.reduce((s, r) => s + Number(r.quantity) * Number(r.unitPriceIls), 0));
  const beforeVatIls = round2(grossIls / (1 + vatRate / 100));
  return { grossIls, beforeVatIls };
}

// ITA allocation-number precondition: a tax-invoice document at/above the
// threshold (before VAT) must carry the customer's tax id — iCount would
// reject the allocation request without it, so GOS blocks the issue upfront.
// Returns null when OK, else { required: true, missing: [...] }.
export function allocationRequirement({ doctype, rows, vatId }) {
  if (!ALLOCATION_DOCTYPES.has(doctype)) return null;
  const { beforeVatIls } = totalsForRows(rows, vatRatePercent());
  if (beforeVatIls < allocationThresholdIls()) return null;
  const missing = [];
  if (!/^\d{8,9}$/.test(String(vatId || '').trim())) missing.push('vatId');
  return { required: true, beforeVatIls, missing };
}

// Map the modal's payment rows onto iCount's payment blocks. Only the four
// blocks verified against the iCount v3 doc/create contract are produced —
// cash / cc (manual card record) / cheques / banktransfer. Amounts are major
// units. At most one block per type (cheques accumulate) — enforced here.
export function buildPaymentBlocks(payments) {
  const body = {};
  for (const p of payments || []) {
    const amount = round2(Number(p.amount) || 0);
    if (amount <= 0) throw codedError('payment_amount_invalid');
    const date = String(p.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (p.method === 'cash') {
      if (body.cash) throw codedError('payment_method_duplicate');
      body.cash = { sum: String(amount) };
    } else if (p.method === 'cc') {
      if (body.cc) throw codedError('payment_method_duplicate');
      body.cc = {
        sum: String(amount),
        date,
        num_of_payments: Math.max(1, Number(p.installments) || 1),
        first_payment: String(amount),
        card_type: p.cardType || 'VISA',
        card_number: String(p.cardLast4 || '0000'),
        exp_year: new Date().getFullYear() + 1,
        exp_month: 12,
        holder_id: String(p.holderId || '000000000'),
        holder_name: p.holderName || 'Card Holder',
        confirmation_code: String(p.reference || '000000'),
      };
    } else if (p.method === 'banktransfer') {
      if (body.banktransfer) throw codedError('payment_method_duplicate');
      body.banktransfer = { sum: String(amount), date, account: String(p.reference || '1') };
    } else if (p.method === 'cheque') {
      if (!body.cheques) body.cheques = [];
      body.cheques.push({
        sum: String(amount),
        date,
        bank: Number(p.bank) || 0,
        branch: Number(p.branch) || 0,
        account: String(p.account || ''),
        number: String(p.reference || ''),
      });
    } else {
      throw codedError('payment_method_invalid');
    }
  }
  return body;
}

// The pinned accounting event — ONE shape for every path that produces an
// iCount document (modal issue now; webhook capture reuses it). Pinned so it
// lands in the Deal FOCUS area.
export async function emitAccountingEvent(client, { dealId, doc, origin, sourceLabel }) {
  // Append to the end of the FOCUS order (same rule as the manual pin API).
  const last = await client.timelineEntry.findFirst({
    where: { subjectType: 'deal', subjectId: dealId, isPinned: true, deletedAt: null },
    orderBy: { pinSortOrder: 'desc' },
    select: { pinSortOrder: true },
  });
  const entry = await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'accounting',
    data: {
      event: 'icount_document',
      doctype: doc.doctype,
      doctypeLabel: DOC_TYPE_LABELS[doc.doctype] || doc.doctype,
      docnum: doc.docnum,
      amountIls: Number(doc.amountMinor) / 100,
      currency: doc.currency,
      clientName: doc.clientName,
      docUrl: doc.docUrl || null,
      issuedAt: (doc.createdAt || new Date()).toISOString(),
      source: sourceLabel, // 'user' | 'webhook' | 'custom_link'
      basedOnDoctype: doc.basedOnDoctype || null,
      basedOnDocnum: doc.basedOnDocnum || null,
    },
    origin,
  });
  // emitTimelineEvent doesn't know about pinning — pin in place.
  return client.timelineEntry.update({
    where: { id: entry.id },
    data: { isPinned: true, pinSortOrder: (last?.pinSortOrder ?? -1) + 1 },
  });
}

// Issue a document through iCount and record it. Validates BEFORE calling
// iCount (allocation, credit base, payments), is idempotent on
// `idempotencyKey`, and never records a document unless iCount confirmed one.
export async function issueDocument(prisma, deal, input, userId) {
  const doctype = String(input.doctype || '');
  const typeDef = DOC_TYPES.find((t) => t.key === doctype);
  if (!typeDef) throw codedError('invalid_doctype');

  // Idempotency: same key → return the already-issued document, no second call.
  const idempotencyKey = String(input.idempotencyKey || '').trim() || null;
  if (idempotencyKey) {
    const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey } });
    if (existing) return { doc: existing, reused: true };
  }

  const client = input.client || {};
  const clientName = String(client.name || '').trim();
  if (!clientName) throw codedError('client_name_required');

  const rows = (input.rows || [])
    .map((r) => ({
      description: String(r.description || '').trim(),
      details: String(r.details || '').trim() || null,
      quantity: Number(r.quantity) || 0,
      unitPriceIls: round2(Number(r.unitPriceIls) || 0),
    }))
    .filter((r) => r.description && r.quantity > 0);
  if (!rows.length) throw codedError('rows_required');

  const basedOn = input.basedOn && input.basedOn.doctype && input.basedOn.docnum
    ? { doctype: String(input.basedOn.doctype), docnum: String(input.basedOn.docnum) }
    : null;
  if (typeDef.baseRequired && !basedOn) throw codedError('base_document_required');
  if (basedOn && !typeDef.baseTypes.includes(basedOn.doctype)) throw codedError('base_document_type_invalid');

  // Allocation-number precondition (ITA) — hard block before any iCount call.
  const alloc = allocationRequirement({ doctype, rows, vatId: client.vatId });
  if (alloc && alloc.missing.length) {
    const err = codedError('allocation_fields_missing');
    err.details = alloc;
    throw err;
  }

  const payments = typeDef.paymentsAllowed ? buildPaymentBlocks(input.payments) : {};

  // EMAIL-first customer identity: reuse+update an existing iCount customer
  // with this email (client_id) instead of letting doc/create mint a
  // duplicate. Falls back to the client_* fields when no email / no match.
  const identity = await resolveClientIdentity({ ...client, name: clientName });

  // Build the iCount body. Items are VAT-inclusive major units (same proven
  // shape as generate_sale).
  const body = {
    doctype,
    lang: 'he',
    currency_code: deal.currency || 'ILS',
    ...(identity.clientId ? { client_id: identity.clientId } : {}),
    client_name: clientName,
    ...(client.vatId ? { vat_id: String(client.vatId).trim() } : {}),
    ...(client.email ? { email: String(client.email).trim() } : {}),
    ...(client.phone ? { client_phone: String(client.phone).trim() } : {}),
    ...(client.address ? { client_address: String(client.address).trim() } : {}),
    items: rows.map((r) => ({
      description: r.description,
      quantity: r.quantity,
      unitprice_incl: r.unitPriceIls,
      // Row details from an inherited base document (doc_info item schema).
      ...(r.details ? { long_description: r.details } : {}),
    })),
    ...(String(input.notes || '').trim() ? { hwc: String(input.notes).trim() } : {}),
    ...(input.sendEmail && client.email ? { send_email: 1 } : {}),
    ...payments,
  };

  if (basedOn) {
    // Closing AND crediting both link by based_on. (The live doc_info payload
    // carries no internal doc_id, so the origin_doc_id variant from Bearer-
    // auth integrations is not available under body auth — verified
    // 2026-07-08; based_on is the mechanism doc/create supports here.)
    body.based_on = [{ doctype: basedOn.doctype, docnum: Number(basedOn.docnum) }];
  }

  const { docId, docnum, docUrl, raw } = await createDoc(body);

  const { grossIls } = totalsForRows(rows, vatRatePercent());
  const amountMinor = BigInt(Math.round(grossIls * 100));

  const origin = await userOrigin(userId);
  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.icountDocument.create({
      data: {
        dealId: deal.id,
        source: 'user',
        doctype,
        docnum,
        providerDocId: docId,
        amountMinor,
        currency: deal.currency || 'ILS',
        clientName,
        clientVatId: client.vatId ? String(client.vatId).trim() : null,
        docUrl,
        basedOnDoctype: basedOn?.doctype || null,
        basedOnDocnum: basedOn?.docnum || null,
        idempotencyKey,
        issuedBy: userId || null,
        raw: raw ?? undefined,
      },
    });
    await emitAccountingEvent(tx, { dealId: deal.id, doc: created, origin, sourceLabel: 'user' });
    return created;
  });

  // After success: the typed ח.פ/ת.ז becomes the GOS prefill for next time.
  await persistClientVatId(prisma, deal, input.clientMode, client.vatId);

  return { doc, reused: false };
}

// ── External document linking ("שייך מסמך אחר מאייקאונט") ────────────────────

// Search iCount documents for the link picker. One free-text query routed by
// shape onto doc/search's verified filters (email / docnum / vat_id /
// client_name — phone is NOT a doc/search filter), plus an optional doctype.
export async function searchExternalDocuments({ query, doctype }) {
  const q = String(query || '').trim();
  // A phone-shaped query (05X…/+972…) has no doc/search filter — reject it
  // explicitly so the UI explains instead of showing a false "no results".
  if (/^(\+?972|0)5\d{8}$/.test(q.replace(/[-\s]/g, ''))) {
    throw codedError('phone_search_unsupported');
  }
  const filters = [];
  if (q.includes('@')) filters.push({ email: q });
  else if (/^\d{8,9}$/.test(q)) filters.push({ vat_id: q }, { docnum: Number(q) });
  else if (/^\d+$/.test(q)) filters.push({ docnum: Number(q) });
  else if (q) filters.push({ client_name: q });
  else filters.push({}); // type-only browse
  const seen = new Set();
  const out = [];
  for (const f of filters) {
    // searchDocs returns [] for iCount's "no results"; real failures bubble up
    // so the UI shows an ERROR, never a false empty state.
    const rows = await searchDocs({ ...f, ...(doctype ? { doctype } : {}), max_results: 30 });
    for (const r of rows) {
      const dt = r.doctype || r.doc_type;
      const dn = r.docnum != null ? String(r.docnum) : null;
      if (!dt || !dn || !DOC_TYPE_LABELS[dt]) continue;
      const key = `${dt}:${dn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        doctype: dt,
        doctypeLabel: DOC_TYPE_LABELS[dt],
        docnum: dn,
        clientName: r.client_name || null,
        email: r.email || r.client_email || null,
        phone: r.phone || r.client_phone || null,
        amountIls: grossFromDocInfo(r) ?? (r.total != null ? round2(Number(r.total)) : null),
        issuedAt: r.dateissued || r.date_issued || null,
        // 0 open / 1 closed / 2 partially closed (doc/search convention).
        status: r.status === 1 || r.status === '1' ? 'closed' : r.status === 2 || r.status === '2' ? 'partial' : 'open',
      });
    }
  }
  return out.slice(0, 30);
}

// Link an EXTERNAL iCount document (not issued through GOS) to a deal so it
// becomes a base-document candidate. Verified against doc/info before linking
// (never links a document iCount doesn't confirm), recorded in the SAME
// IcountDocument table (source 'linked'), idempotent via the derived key —
// re-linking returns the existing row and emits nothing.
export async function linkExternalDocument(prisma, deal, { doctype, docnum }, userId) {
  if (!DOC_TYPE_LABELS[doctype]) throw codedError('invalid_doctype');
  const num = String(docnum || '').trim();
  if (!num) throw codedError('docnum_required');

  const idempotencyKey = `linked:${deal.id}:${doctype}:${num}`;
  const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey } });
  if (existing) return { doc: existing, reused: true };
  // Also treat a GOS-issued/webhook-captured row of the same document as
  // already-linked — one document must never appear twice on a deal.
  const sameDoc = await prisma.icountDocument.findFirst({
    where: { dealId: deal.id, doctype, docnum: num },
  });
  if (sameDoc) return { doc: sameDoc, reused: true };

  const info = await docInfo(doctype, num);
  const gross = grossFromDocInfo(info) ?? 0;
  const clientName = info?.client_name || 'לקוח';

  const origin = await userOrigin(userId);
  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.icountDocument.create({
      data: {
        dealId: deal.id,
        source: 'linked',
        doctype,
        docnum: num,
        providerDocId: info?.doc_id != null ? String(info.doc_id) : null,
        amountMinor: BigInt(Math.round(gross * 100)),
        currency: deal.currency || 'ILS',
        clientName,
        clientVatId: info?.vat_id ? String(info.vat_id) : null,
        docUrl: info?.doc_url || null,
        idempotencyKey,
        issuedBy: userId || null,
        raw: info ?? undefined,
      },
    });
    // Visible (non-pinned) event — a manual association, not a new document.
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: deal.id,
      kind: 'accounting',
      data: {
        event: 'icount_document_linked',
        doctype,
        doctypeLabel: DOC_TYPE_LABELS[doctype],
        docnum: num,
        amountIls: gross,
        currency: deal.currency || 'ILS',
        clientName,
        source: 'user',
      },
      origin,
    });
    return created;
  });
  return { doc, reused: false };
}

// Previous documents for the modal's base/close/credit selector: GOS-recorded
// rows always; live iCount search (by customer identifiers) merged in when
// configured — deduped by doctype+docnum. Live failures degrade to local-only
// (flagged) instead of breaking the modal.
export async function listDealDocuments(prisma, deal) {
  const local = await prisma.icountDocument.findMany({
    where: { dealId: deal.id, status: 'issued' },
    orderBy: { createdAt: 'desc' },
  });
  const out = local.map((d) => ({
    doctype: d.doctype,
    doctypeLabel: DOC_TYPE_LABELS[d.doctype] || d.doctype,
    docnum: d.docnum,
    amountIls: Number(d.amountMinor) / 100,
    currency: d.currency,
    clientName: d.clientName,
    docUrl: d.docUrl,
    createdAt: d.createdAt,
    origin: d.source === 'linked' ? 'linked' : 'gos',
  }));

  let liveError = null;
  if (isIcountConfigured()) {
    const contact = deal.contacts?.[0]?.contact || null;
    const org = deal.organizationUnit || deal.organization || null;
    const identifiers = [];
    if (org?.taxId) identifiers.push({ vat_id: org.taxId });
    const email = org?.financeEmail || contact?.emails?.[0]?.value;
    if (email) identifiers.push({ email });
    try {
      const seen = new Set(out.map((d) => `${d.doctype}:${d.docnum}`));
      for (const filter of identifiers.slice(0, 2)) {
        const rows = await searchDocs(filter);
        for (const r of rows) {
          const doctype = r.doctype || r.doc_type;
          const docnum = r.docnum != null ? String(r.docnum) : null;
          if (!doctype || !docnum || !DOC_TYPE_LABELS[doctype]) continue;
          const key = `${doctype}:${docnum}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            doctype,
            doctypeLabel: DOC_TYPE_LABELS[doctype],
            docnum,
            amountIls: r.total != null ? Number(r.total) : r.totalsum != null ? Number(r.totalsum) : null,
            currency: r.currency_code || 'ILS',
            clientName: r.client_name || null,
            docUrl: null,
            createdAt: r.dateissued || null,
            origin: 'icount',
          });
        }
      }
    } catch (err) {
      liveError = err?.reason || err?.code || 'icount_search_failed';
      console.error(`[icount] doc search for deal ${deal.id} failed: ${liveError}`);
    }
  }

  return { documents: out, liveError };
}

export { systemOrigin };
