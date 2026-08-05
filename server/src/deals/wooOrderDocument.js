// Woo paid order → חשבונית מס קבלה (invrec) through THE canonical iCount
// issuer (icountDocs.issueDocument) — the exact service behind the operator's
// "הפק מסמך" modal and the Cardcom auto-issue. Nothing here talks to iCount
// directly and no second document implementation exists.
//
// Money-truth invariants owned here:
//   * exactly ONE invrec per paid Woo order — idempotencyKey
//     `woo:<store>:<orderId>:invrec` (unique on IcountDocument), so webhook
//     retries, processing→completed transitions, reconciliation replays and
//     worker restarts all converge on the same document;
//   * the document total must EQUAL the amount the customer actually paid —
//     when the Builder no longer matches the order (human-edited quote), we
//     refuse to issue rather than document money that did not move;
//   * a document failure is never silent and never blocks the WON chain — the
//     caller records fallback payment evidence + a loud review card instead;
//   * no auto-email: the customer receives nothing without an operator's
//     explicit send (project rule; Cardcom's pre-frozen checkbox has no Woo
//     equivalent yet).

import {
  issueDocument,
  buildDocumentDefaults,
  totalsForRows,
  ICOUNT_DEAL_INCLUDE,
} from '../icountDocs.js';
import { loadVatDefault } from '../quote/importedBuilderSeed.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

export const wooInvrecKey = (storeKey, orderId) => `woo:${storeKey || 'primary'}:${orderId}:invrec`;

// A document may differ from the paid total only by rounding noise (agorot).
const AMOUNT_TOLERANCE_ILS = 0.11;

// Woo's payment_method / payment_method_title → the verified iCount payment
// blocks (buildPaymentBlocks vocabulary). Unknown gateways are a card charge —
// the only method every Woo gateway ultimately is from the store's side.
export function wooPaymentMethod(raw) {
  const s = String(raw || '').toLowerCase();
  if (/\bbit\b|ביט/.test(s)) return 'bit';
  if (/paybox|פייבוקס/.test(s)) return 'paybox';
  if (/bacs|bank|העברה/.test(s)) return 'banktransfer';
  if (/\bcod\b|cash|מזומן/.test(s)) return 'cash';
  return 'cc';
}

/**
 * Issue the invrec for one PAID Woo order. Never throws — returns
 *   { ok:true, doc, reused }            document exists (new or replayed)
 *   { ok:false, reason, detail? }       refused / failed, caller goes loud
 *
 * `issue` is injectable for tests; production always uses the canonical
 * issueDocument.
 */
export async function issueWooOrderInvrec({ dealId, normalized, storeKey }, { db, issue = issueDocument } = {}) {
  const orderId = normalized?.externalId;
  const idempotencyKey = wooInvrecKey(storeKey, orderId);
  try {
    // Fast idempotency path (also what makes the refund check cheap).
    const existing = await db.icountDocument.findUnique({ where: { idempotencyKey } });
    if (existing) return { ok: true, doc: existing, reused: true };

    const deal = await db.deal.findUnique({ where: { id: dealId }, include: ICOUNT_DEAL_INCLUDE });
    if (!deal) return { ok: false, reason: 'deal_missing' };

    // The canonical document derivation — the SAME defaults the operator modal
    // opens with: working Builder lines, Builder VAT mode, customer/org
    // resolution, document language. The Woo-composed quote IS the working
    // version, so the document lines are exactly the purchased tickets.
    const vatDefault = await loadVatDefault(db);
    const defaults = buildDocumentDefaults(deal, { vatDefault });

    const paidIls = Math.round(Number(normalized.order?.total || 0) * 100) / 100;
    if (!(paidIls > 0)) return { ok: false, reason: 'no_amount' };
    const { grossIls } = totalsForRows(defaults.rows, vatDefault.rate, defaults.vatMode);
    if (Math.abs(grossIls - paidIls) > AMOUNT_TOLERANCE_ILS) {
      // The Builder does not describe the money that moved (operator edit /
      // compose skipped) — documenting it would state a false accounting fact.
      return { ok: false, reason: 'doc_amount_mismatch', detail: { grossIls, paidIls } };
    }

    const orderNumber = normalized.extra?.orderNumber || orderId;
    const clientName =
      defaults.customer.organizationName ||
      defaults.customer.contactName ||
      normalized.person?.displayName ||
      null;
    if (!clientName) return { ok: false, reason: 'client_name_missing' };

    const paidAtRaw = normalized.extra?.datePaid || null;
    const paidDate = (paidAtRaw ? new Date(paidAtRaw) : new Date());
    const { doc, reused } = await issue(
      db,
      deal,
      {
        doctype: 'invrec',
        idempotencyKey,
        vatMode: defaults.vatMode,
        lang: defaults.language,
        currency: defaults.currency,
        client: {
          name: clientName,
          vatId: defaults.customer.vatId,
          email: defaults.customer.email,
          phone: defaults.customer.phone,
          address: defaults.customer.address,
        },
        rows: defaults.rows,
        payments: [
          {
            method: wooPaymentMethod(normalized.extra?.paymentMethod),
            amount: paidIls,
            date: Number.isNaN(paidDate.getTime()) ? undefined : paidDate.toISOString().slice(0, 10),
            reference: normalized.extra?.transactionId || String(orderNumber),
            holderName: normalized.person?.displayName || clientName,
          },
        ],
        notes: `הזמנה מהאתר #${orderNumber}`,
        sendEmail: false,
        origin: systemOrigin(),
        source: 'webhook',
        sourceLabel: 'woo',
      },
      null,
    );
    return { ok: true, doc, reused };
  } catch (err) {
    console.error(`[woo-doc] invrec issue failed for deal ${dealId} order ${orderId}: ${err?.code || err?.message}`);
    return { ok: false, reason: err?.code || 'doc_issue_failed' };
  }
}

/**
 * The issued invrec supersedes any fallback woo_payment evidence for the same
 * order — the money must count exactly once. The evidence row is REVERSED
 * (audited, stays visible as history), never deleted.
 */
export async function supersedeWooEvidence(db, { dealId, reference, docnum }) {
  const rows = await db.dealCollectionEvidence.findMany
    ? await db.dealCollectionEvidence.findMany({ where: { dealId, kind: 'woo_payment', reference, status: 'active' } })
    : [];
  for (const row of rows) {
    await db.dealCollectionEvidence.update({
      where: { id: row.id },
      data: {
        status: 'reversed',
        reversedAt: new Date(),
        reversedBy: null,
        reversedByName: 'מערכת',
        reversalReason: `הונפקה חשבונית מס קבלה${docnum ? ` מס׳ ${docnum}` : ''} — הרישום הזמני הוחלף במסמך`,
      },
    });
    await emitTimelineEvent(db, {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'accounting',
      data: {
        event: 'collection_evidence_reversed',
        evidenceKind: 'woo_payment',
        evidenceLabel: 'תשלום באתר',
        amountIls: Number(row.amountMinor) / 100,
        currency: row.currency,
        reason: 'הוחלף בחשבונית מס קבלה',
        manual: false,
      },
      origin: systemOrigin(),
    });
  }
  return { reversed: rows.length };
}
