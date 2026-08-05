// Woo → GOS operational bridge — the ONE seam that turns a WooCommerce order
// event (already a Deal via the ingress pipeline) into the full operational
// state an operator would have produced manually:
//
//   resolve order lines → WooVariationLink → (tourEvent, card, ticketType)
//   compose the canonical Group Ticket Builder quote (same engine, same shapes)
//   record the Woo payment as collection evidence
//   settle through settleDealWon (WON → booking → registration → capacity)
//
// Nothing here prices, registers or WONs on its own — every step delegates to
// the exact service the operator UI uses. Woo is the source event; GOS is the
// only business authority.
//
// Runs POST-COMMIT of the ingress persist transaction and is retried by the
// ingress worker on failure, so every step must (and does) converge on replay:
// compose is a guarded replace-sync, evidence is deduped by reference, WON is
// atomic, booking/registration reuse existing rows.

import { prisma } from '../db.js';
import { deriveTicketRows } from '../pricing/groupTicketCards.js';
import { composeBuilderLines } from '../pricing/builderCompose.js';
import { buildNoteVars, renderNoteTemplate, selectNoteTemplate } from '../pricing/noteTemplates.js';
import { resolveBuilderVatMode } from '../../../shared/vatMode.mjs';
import { lineToData } from '../quote/quoteLineMapping.js';
import { ensureWorkingVersion } from '../quote/quoteDocument.js';
import { resyncDealGroupTours } from '../tours/tourFromDeal.js';
import { settleDealWon } from './paymentWon.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { recordDealChanges, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { createReviewItem } from '../reviewItems/service.js';
import { WOO_ORDER_ATTENTION_KIND } from '../reviewItems/kinds/wooOrderAttention.js';
import { issueWooOrderInvrec, supersedeWooEvidence, wooInvrecKey } from './wooOrderDocument.js';

// Provenance stamp for the money-reconciliation line (coupon / price drift).
// Deliberately NOT 'group_ticket': the offering/registration derivation must
// never read it as a purchased ticket. It IS part of the composer's own output,
// so the rewrite guard treats it as own provenance.
export const WOO_ADJUSTMENT_SOURCE = 'woo_adjustment';

// QuoteLine sourceKinds this composer owns. Any other line on the working
// version means a human (or another system) built the quote — never clobber.
const OWN_SOURCE_KINDS = new Set(['group_ticket', WOO_ADJUSTMENT_SOURCE]);

// Same tolerance the collection SSOT uses — a few agorot of per-line VAT
// rounding must not mint an adjustment line.
const ROUNDING_TOLERANCE_MINOR = 10;

const toMinor = (total) => BigInt(Math.round(Number(total || 0) * 100));

// ── 1. RESOLVE ──────────────────────────────────────────────────────────────
// Order lines → the GOS identity of what was bought. The ONLY mapping consulted
// is WooVariationLink — the same rows the outbound sync maintains; no second
// mapping layer. A line is resolved only when its variation maps to a link that
// carries a ticket type (adult/child …); anything else is reported, not guessed.
export async function resolveWooOrderTour(client, normalized) {
  const items = (normalized?.order?.items || []).filter((it) => (Number(it.quantity) || 0) > 0);
  const variationIds = [...new Set(items.map((it) => Number(it.externalId)).filter((n) => Number.isFinite(n) && n > 0))];
  const links = variationIds.length
    ? await client.wooVariationLink.findMany({ where: { wooVariationId: { in: variationIds } } })
    : [];
  const byVariation = new Map(links.map((l) => [Number(l.wooVariationId), l]));

  const lines = [];
  const unresolved = [];
  for (const it of items) {
    const link = byVariation.get(Number(it.externalId));
    if (!link || !link.cardGroupId || !link.ticketTypeId) {
      unresolved.push({ externalId: it.externalId || null, name: it.name || null, quantity: Number(it.quantity) || 0 });
      continue;
    }
    // The same variation may appear on several order lines — quantities merge.
    const existing = lines.find(
      (l) => l.tourEventId === link.tourEventId && l.cardGroupId === link.cardGroupId && l.ticketTypeId === link.ticketTypeId,
    );
    if (existing) existing.quantity += Number(it.quantity) || 0;
    else {
      lines.push({
        tourEventId: link.tourEventId,
        cardGroupId: link.cardGroupId,
        ticketTypeId: link.ticketTypeId,
        quantity: Number(it.quantity) || 0,
      });
    }
  }
  const tourEventIds = [...new Set(lines.map((l) => l.tourEventId))];
  return {
    lines,
    unresolved,
    tourEventIds,
    tourEventId: tourEventIds.length === 1 ? tourEventIds[0] : null,
    resolvedAll: lines.length > 0 && unresolved.length === 0,
  };
}

// ── 2. COMPOSE ──────────────────────────────────────────────────────────────
// Pure mapper: resolved lines + canonical Pricing Card reps → the EXACT client
// builder-line shapes the Group Ticket Builder saves (kind 'manual', label
// "card — ticket", card VAT, canonical ticket prices, structured identity).
// Separated from the DB write so operator-parity is unit-testable.
export function wooBuilderClientLines({ resolution, reps }) {
  const repByCard = new Map();
  for (const rep of reps) {
    if (rep.cardGroupId && !repByCard.has(rep.cardGroupId)) repByCard.set(rep.cardGroupId, rep);
  }
  // Card order = the Builder's own order (cardSortOrder, then creation).
  const cardIds = [...new Set(resolution.lines.map((l) => l.cardGroupId))].sort((a, b) => {
    const ra = repByCard.get(a);
    const rb = repByCard.get(b);
    return (ra?.cardSortOrder ?? 0) - (rb?.cardSortOrder ?? 0)
      || String(ra?.createdAt || '').localeCompare(String(rb?.createdAt || ''));
  });

  const lines = [];
  const unsellable = [];
  for (const cardGroupId of cardIds) {
    const rep = repByCard.get(cardGroupId);
    const rows = rep ? deriveTicketRows(rep) : null;
    if (!rows) {
      unsellable.push(cardGroupId);
      continue;
    }
    const title = rep.product?.nameHe || 'כרטיס תמחור';
    for (const row of rows) {
      const bought = resolution.lines.find((l) => l.cardGroupId === cardGroupId && l.ticketTypeId === row.ticketTypeId);
      if (!bought || bought.quantity <= 0) continue;
      lines.push({
        kind: 'manual',
        label: `${title} — ${row.label}`,
        refId: null,
        quantity: bought.quantity,
        unitPriceMinor: row.unitPriceMinor,
        vatMode: rep.vatMode || 'inherit',
        vatRate: rep.vatRate ?? null,
        active: true,
        overridden: false,
        sourceKind: 'group_ticket',
        sourceCardGroupId: cardGroupId,
        ticketTypeId: row.ticketTypeId,
        productVariantId: rep.productVariantId || null,
      });
    }
    // A purchased ticket type the card no longer prices — refuse to guess.
    const rowIds = new Set(rows.map((r) => r.ticketTypeId));
    for (const bought of resolution.lines) {
      if (bought.cardGroupId === cardGroupId && !rowIds.has(bought.ticketTypeId)) unsellable.push(cardGroupId);
    }
  }
  return { lines, unsellable: [...new Set(unsellable)], firstCard: repByCard.get(cardIds[0]) || null };
}

// Persisted-row ↔ target-row equality on every field the composer controls —
// what makes a replayed webhook a genuine no-op.
function sameLine(existing, target) {
  return (
    existing.kind === target.kind &&
    (existing.label || '') === (target.label || '') &&
    (existing.productVariantId || null) === (target.productVariantId || null) &&
    Number(existing.quantity) === Number(target.quantity) &&
    BigInt(existing.unitPriceMinor) === BigInt(target.unitPriceMinor) &&
    (existing.vatMode || 'inherit') === (target.vatMode || 'inherit') &&
    (existing.vatRate ?? null) === (target.vatRate ?? null) &&
    !!existing.overridden === !!target.overridden &&
    (existing.sourceKind || null) === (target.sourceKind || null) &&
    (existing.sourceCardGroupId || null) === (target.sourceCardGroupId || null) &&
    (existing.ticketTypeId || null) === (target.ticketTypeId || null) &&
    (existing.note || '') === (target.note || '') &&
    Number(existing.sortOrder) === Number(target.sortOrder)
  );
}

/**
 * Idempotently write the order's canonical Ticket Builder quote onto the deal's
 * working version + headline fields (valueMinor / participants / product) —
 * the same replace-sync + deal patch the PUT /price-lines route performs.
 *
 * Guards (each returns { changed:false, skipped }):
 *   'already_won'   — WON quotes are frozen; the order can no longer edit them.
 *   'waiver'        — a no-payment waiver's math is an operator decision.
 *   'human_edited'  — foreign-provenance lines on the working version.
 *   'card_unsellable' — a purchased card/ticket has no canonical pricing.
 */
export async function composeWooQuote(tx, { dealId, resolution, normalized, origin }) {
  const deal = await tx.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { changed: false, skipped: 'deal_missing' };
  if (deal.status === 'won') return { changed: false, skipped: 'already_won' };
  if (deal.noPaymentWaiver) return { changed: false, skipped: 'waiver' };

  const cardIds = [...new Set(resolution.lines.map((l) => l.cardGroupId))];
  const reps = await tx.priceRule.findMany({
    where: { cardGroupId: { in: cardIds }, availableForGroupTickets: true, active: true, priceModel: 'ticket_types' },
    orderBy: { createdAt: 'asc' },
    include: {
      ticketPrices: { include: { ticketType: { select: { nameHe: true, sortOrder: true } } } },
      product: { select: { nameHe: true } },
    },
  });
  const mapped = wooBuilderClientLines({ resolution, reps });
  if (mapped.unsellable.length || !mapped.lines.length) {
    return { changed: false, skipped: 'card_unsellable', unsellable: mapped.unsellable };
  }

  // THE order-level VAT default — resolved exactly as /api/pricing/builder does
  // (live price list; the group builder never sets a version-level override).
  const priceList = await tx.priceList.findFirst({ where: { isDefault: true } });
  const vatDefault = {
    mode: resolveBuilderVatMode(null, priceList?.defaultVatMode),
    rate: priceList?.defaultVatRate != null ? priceList.defaultVatRate : 18,
  };

  // Canonical card first-line notes — the generic-template branch (group cards
  // have no engine result), same as the route's applyCardNotes path.
  const participants = mapped.lines.reduce((n, l) => n + l.quantity, 0);
  const genericVars = buildNoteVars({
    engineResult: null,
    groupCount: 1,
    participantCount: participants,
    variantName: null,
    cityName: null,
  });
  const noteByCard = new Map();
  for (const rep of reps) {
    if (rep.cardGroupId && !noteByCard.has(rep.cardGroupId)) {
      noteByCard.set(rep.cardGroupId, renderNoteTemplate(selectNoteTemplate(rep, 1), genericVars));
    }
  }

  const composeOnce = (inputLines) =>
    composeBuilderLines({
      inputLines,
      productResolution: { ok: false },
      vatDefault,
      applyCardNotes: true,
      noteByCard,
    });

  // Money truth: the customer paid the Woo total. When the canonical card
  // prices compose to a different gross (coupon, fee, price drift), an explicit
  // adjustment line reconciles the quote to the paid amount — exactly what an
  // operator would enter, and what lets collection settle to zero.
  let clientLines = mapped.lines;
  let { lines: composed, totals } = composeOnce(clientLines);
  const orderTotalMinor = Number(toMinor(normalized.order?.total));
  const diff = orderTotalMinor - totals.grossMinor;
  let adjusted = false;
  if (Math.abs(diff) > ROUNDING_TOLERANCE_MINOR) {
    const coupons = normalized.extra?.couponLines || [];
    const label = diff < 0
      ? coupons.length
        ? `הנחת קופון מהאתר (${coupons.join(', ')})`
        : 'התאמת מחיר להזמנה מהאתר'
      : 'תוספת מהזמנת האתר';
    clientLines = [
      ...mapped.lines,
      {
        kind: diff < 0 ? 'discount' : 'manual',
        label,
        refId: null,
        quantity: 1,
        // discount lines carry a positive amount; the composer applies the sign.
        unitPriceMinor: Math.abs(diff),
        // gross-mode so the adjustment moves the TOTAL by exactly the gap.
        vatMode: 'included',
        vatRate: vatDefault.rate,
        active: true,
        overridden: true,
        sourceKind: WOO_ADJUSTMENT_SOURCE,
        sourceCardGroupId: null,
        ticketTypeId: null,
        productVariantId: null,
      },
    ];
    ({ lines: composed, totals } = composeOnce(clientLines));
    adjusted = true;
  }

  const version = await ensureWorkingVersion(tx, dealId);
  const existing = await tx.quoteLine.findMany({
    where: { quoteVersionId: version.id },
    orderBy: { sortOrder: 'asc' },
  });
  const foreign = existing.find((l) => !OWN_SOURCE_KINDS.has(l.sourceKind || ''));
  if (foreign) return { changed: false, skipped: 'human_edited' };

  // The persisted shape: composed lines (they carry the canonical notes) with
  // the client line's own vat fields — precisely what lineToData stores.
  const targets = clientLines.map((ln, i) => {
    const c = composed[i];
    return { ...lineToData({ ...ln, note: c?.note || '' }, i), quoteVersionId: version.id };
  });

  const targetValue = BigInt(totals.grossMinor);
  const firstCard = mapped.firstCard;
  const dealPatch = {
    valueMinor: targetValue,
    participants,
    productId: firstCard?.productId || null,
    productVariantId: firstCard?.productVariantId || null,
  };
  const dealUnchanged =
    (deal.valueMinor == null ? null : BigInt(deal.valueMinor)) === targetValue &&
    Number(deal.participants) === participants &&
    (deal.productId || null) === dealPatch.productId &&
    (deal.productVariantId || null) === dealPatch.productVariantId;
  const linesUnchanged = existing.length === targets.length && existing.every((e, i) => sameLine(e, targets[i]));
  if (linesUnchanged && dealUnchanged) {
    return { changed: false, priced: true, lineCount: targets.length, valueMinor: Number(targetValue), participants };
  }

  const rewrite = existing.length > 0;
  await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id } });
  await tx.quoteLine.createMany({ data: targets });
  await tx.deal.update({ where: { id: dealId }, data: dealPatch });
  // Converge any existing registrations (held reservation / none yet) onto the
  // new cards — the same post-builder-save hook the operator route runs.
  await resyncDealGroupTours(tx, dealId, { origin });

  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'quote',
    body: rewrite
      ? '🧾 הצעת המחיר עודכנה אוטומטית מהזמנת האתר'
      : '🧾 הצעת המחיר נבנתה אוטומטית מהזמנת האתר',
    data: {
      event: 'woo_builder_composed',
      orderId: normalized.externalId || null,
      orderNumber: normalized.extra?.orderNumber || null,
      lineCount: targets.length,
      valueMinor: Number(targetValue),
      participants,
      adjusted,
    },
    origin,
  });

  return { changed: true, priced: true, lineCount: targets.length, valueMinor: Number(targetValue), participants };
}

// ── 3. MONEY ────────────────────────────────────────────────────────────────
// The Woo payment as canonical collection evidence — real money for the
// balance, honestly labeled as website payment, never dressed up as an
// accounting document. Deduped by reference so replays converge.
export async function recordWooPaymentEvidence(client, { dealId, normalized, storeKey }) {
  const amountMinor = toMinor(normalized.order?.total);
  if (amountMinor <= 0n) return { created: false, skipped: 'no_amount' };

  const reference = `woo:${storeKey || 'primary'}:${normalized.externalId}`;
  const existing = await client.dealCollectionEvidence.findFirst({
    where: { dealId, kind: 'woo_payment', reference, status: 'active' },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const paidAtRaw = normalized.extra?.datePaid || null;
  const paidAt = paidAtRaw ? new Date(paidAtRaw) : normalized.occurredAt instanceof Date ? normalized.occurredAt : new Date();
  const methodTitle = normalized.extra?.paymentMethod || null;

  const row = await client.dealCollectionEvidence.create({
    data: {
      dealId,
      kind: 'woo_payment',
      direction: 'in',
      amountMinor,
      currency: String(normalized.order?.currency || 'ILS').toUpperCase(),
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
      method: null,
      reference,
      note: methodTitle ? `שולם באתר (${methodTitle})` : 'שולם באתר',
      origin: 'woo',
      createdBy: null,
      createdByName: 'WooCommerce',
    },
  });

  await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'accounting',
    data: {
      event: 'collection_evidence_recorded',
      evidenceKind: 'woo_payment',
      evidenceLabel: 'תשלום באתר',
      direction: 'in',
      amountIls: Number(amountMinor) / 100,
      currency: String(normalized.order?.currency || 'ILS').toUpperCase(),
      paidAt: row.paidAt instanceof Date ? row.paidAt.toISOString() : String(row.paidAt),
      method: null,
      reference,
      note: row.note,
      hasAttachment: false,
      manual: false,
      provider: 'woocommerce',
    },
    origin: systemOrigin(),
  });

  return { created: true, id: row.id };
}

// Tour-join failures that must NOT park the order in the retry queue: the slot
// is gone/invalid, retrying cannot fix it, and the money is real. The deal WONs
// without a tour (the existing loud path) + a review card asks the office.
const JOIN_FAILURE_CODES = new Set(['tour_slot_invalid', 'tour_slot_not_scheduled', 'tour_full']);

// ── 4. ORCHESTRATE ──────────────────────────────────────────────────────────
// Post-commit step of the ingress pipeline for every Woo ORDER event.
// Throwing here marks the ingress event pending → the worker retries with
// backoff; every sub-step converges, so a replay can never duplicate anything.
export async function runWooOrderOperational({ dealId, normalized, storeKey }, { db = prisma, issue } = {}) {
  if (!dealId || normalized?.kind !== 'order') return { skipped: 'not_order' };
  const origin = systemOrigin();
  const reasons = [];

  const resolution = await resolveWooOrderTour(db, normalized);
  if (resolution.unresolved.length) reasons.push('lines_unresolved');
  if (resolution.tourEventIds.length > 1) reasons.push('multi_tour_order');
  if (!resolution.lines.length) reasons.push('no_resolvable_lines');

  const before = await db.deal.findUnique({ where: { id: dealId }, select: DEAL_DIFF_SELECT });

  // Quote composition — only when the WHOLE order resolved to one tour; a
  // partial quote would silently misstate what was bought.
  let compose = { changed: false, skipped: reasons.length ? 'unresolved' : undefined };
  if (resolution.resolvedAll && resolution.tourEventId) {
    compose = await db.$transaction((tx) => composeWooQuote(tx, { dealId, resolution, normalized, origin }));
    if (compose.skipped === 'card_unsellable') reasons.push('card_unsellable');
    if (compose.skipped === 'human_edited') reasons.push('builder_human_edited');
  }

  const paid = Boolean(normalized.order?.paid);
  let settle = null;
  let doc = null;
  if (paid) {
    // ── Accounting: exactly one חשבונית מס קבלה per paid order ─────────────
    // The invrec (canonical issueDocument, idempotent on woo:<store>:<order>:
    // invrec) IS the money proof when it exists. Only when issuance is refused
    // or fails does the woo_payment evidence stand in — loud review card, and
    // the next successful issuance supersedes (reverses) the evidence so the
    // money never counts twice.
    doc = await issueWooOrderInvrec({ dealId, normalized, storeKey }, { db, ...(issue ? { issue } : {}) });
    const paymentReference = `woo:${storeKey || 'primary'}:${normalized.externalId}`;
    if (doc.ok) {
      await supersedeWooEvidence(db, { dealId, reference: paymentReference, docnum: doc.doc?.docnum });
    } else {
      reasons.push(`doc_issue_failed:${doc.reason}`);
      await recordWooPaymentEvidence(db, { dealId, normalized, storeKey });
    }
    const paymentAmountMinor = Number(toMinor(normalized.order?.total)) || null;
    const settleOpts = {
      dealId,
      allowOverbook: true, // the customer already paid — capacity is the office's problem, not the webhook's
      origin,
      paymentStatus: 'paid',
      paymentAmountMinor,
      recordChangelog: true,
      cause: 'woo_order',
    };
    try {
      settle = await settleDealWon(db, { ...settleOpts, targetTourEventId: resolution.tourEventId || null });
    } catch (err) {
      if (!JOIN_FAILURE_CODES.has(err?.code)) throw err;
      reasons.push(`tour_join_failed:${err.code}`);
      settle = await settleDealWon(db, { ...settleOpts, targetTourEventId: null });
    }
    if (settle?.wonNow && !settle.tourCreated) reasons.push('won_without_tour');
  } else if (normalized.order?.status && String(normalized.order.status).toLowerCase().includes('refund')) {
    // A refund AFTER a paid order that already carries an invrec: the original
    // document is NEVER rewritten (accounting fact) — the credit-document flow
    // is a separate, explicitly manual process, so the office gets a card.
    const issued = await db.icountDocument.findUnique({
      where: { idempotencyKey: wooInvrecKey(storeKey, normalized.externalId) },
    });
    if (issued) reasons.push('refund_credit_document_needed');
  }

  // Compose-only changes (unpaid order created/edited) get their own changelog;
  // a settle that flipped WON already recorded the full diff itself.
  if (compose.changed && !settle?.wonNow) {
    const after = await db.deal.findUnique({ where: { id: dealId }, select: DEAL_DIFF_SELECT });
    if (before && after) await recordDealChanges(db, { dealId, before, after, origin });
  }

  // Loud, exactly-once attention card per (order, reason family). A replay with
  // the same problem converges on the same card; a NEW problem raises a new one.
  if (reasons.length) {
    const deal = await db.deal.findUnique({ where: { id: dealId }, select: { orderNo: true } });
    const orderNumber = normalized.extra?.orderNumber || normalized.externalId || '';
    await createReviewItem(
      {
        kind: WOO_ORDER_ATTENTION_KIND,
        dedupeKey: `woo_order_attention:${storeKey || 'primary'}:${normalized.externalId}:${reasons[0]}`,
        dealId,
        title: `הזמנת אתר #${orderNumber} דורשת השלמה ידנית`,
        summary: attentionSummaryHe(reasons, resolution),
        data: {
          orderId: normalized.externalId || null,
          orderNumber: orderNumber || null,
          storeKey: storeKey || 'primary',
          reasons,
          tourEventIds: resolution.tourEventIds,
          unresolved: resolution.unresolved,
          dealOrderNo: deal?.orderNo ?? null,
          paid,
        },
      },
      { db },
    );
  }

  return { resolution, compose, settle, doc, reasons };
}

// Business-language summary for the review card — no enum names, no IDs.
function attentionSummaryHe(reasons, resolution) {
  const parts = [];
  if (reasons.includes('lines_unresolved')) {
    const names = resolution.unresolved.map((u) => u.name).filter(Boolean).slice(0, 3);
    parts.push(`פריטים בהזמנה לא זוהו כסיור פתוח${names.length ? ` (${names.join(', ')})` : ''}`);
  }
  if (reasons.includes('multi_tour_order')) parts.push('ההזמנה מפוצלת בין כמה תאריכי סיור — נדרש שיבוץ ידני');
  if (reasons.includes('no_resolvable_lines')) parts.push('לא נמצאו כרטיסים ניתנים לזיהוי בהזמנה');
  if (reasons.includes('card_unsellable')) parts.push('כרטיס שנרכש אינו מתומחר עוד בכרטיסי התמחור');
  if (reasons.includes('builder_human_edited')) parts.push('הצעת המחיר נערכה ידנית — יש לוודא שהיא תואמת את ההזמנה');
  if (reasons.some((r) => r.startsWith('tour_join_failed'))) parts.push('לא ניתן היה לשבץ את העסקה לסיור (הסיור בוטל או אינו זמין)');
  if (reasons.includes('won_without_tour')) parts.push('העסקה נסגרה מהתשלום אך ללא שיבוץ לסיור');
  if (reasons.some((r) => r.startsWith('doc_issue_failed'))) {
    parts.push('חשבונית מס קבלה לא הונפקה אוטומטית — התשלום נרשם ידנית בגבייה ויש להפיק מסמך מהעסקה');
  }
  if (reasons.includes('refund_credit_document_needed')) {
    parts.push('ההזמנה זוכתה באתר אחרי שהונפקה חשבונית מס קבלה — נדרש טיפול ידני בחשבונית זיכוי');
  }
  return parts.join(' · ') || 'נדרשת בדיקה ידנית של ההזמנה';
}
