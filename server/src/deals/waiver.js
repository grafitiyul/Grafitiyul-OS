// Canonical NO-PAYMENT WAIVER model.
//
// A waiver is an INDEPENDENT commercial decision layered on top of the
// fully-commercial builder. The QuoteLines ALWAYS keep their real prices (the
// builder is the single commercial truth); the waiver separately records which
// ticket QUANTITIES were waived, per (card, ticket type). The Deal's payable
// total — Deal.valueMinor, the ONE total collection / balance / accounting read —
// is `commercial gross − waived value at current prices`. Nothing here ever
// overwrites a line price.
//
// Stored on Deal.noPaymentWaiver (JSON | null):
//   { reason, waivedAt, lines: [{ cardGroupId, ticketTypeId, quantityWaived }] }
//
// This module is the ONE place waiver math + change-classification live. All
// helpers except loadGroupTicketLines are pure (no DB).

// A "priced group line": { cardGroupId, cardTitle, ticketTypeId, ticketLabel,
// quantity, unitPriceMinor (agorot, number) }.

function lineKey(cardGroupId, ticketTypeId) {
  return `${cardGroupId || ''}::${ticketTypeId || ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The deal's CURRENT group-ticket lines WITH price + labels — the canonical input
// for every waiver computation. Reads the working quote version (same version
// resolveDealGroupOffering reads). Returns [] when there are no group lines.
export async function loadGroupTicketLines(client, dealId) {
  if (!dealId || !client?.quoteVersion?.findFirst) return [];
  const version = await client.quoteVersion.findFirst({ where: { dealId, isWorking: true }, select: { id: true } });
  if (!version) return [];
  const lines = await client.quoteLine.findMany({
    where: { quoteVersionId: version.id, sourceKind: 'group_ticket', active: true },
    select: {
      sourceCardGroupId: true,
      ticketTypeId: true,
      quantity: true,
      unitPriceMinor: true,
      ticketType: { select: { nameHe: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });
  const cardIds = [...new Set(lines.map((l) => l.sourceCardGroupId).filter(Boolean))];
  const rules = cardIds.length
    ? await client.priceRule.findMany({ where: { cardGroupId: { in: cardIds } }, select: { cardGroupId: true, product: { select: { nameHe: true } } } })
    : [];
  const titleByCard = new Map();
  for (const r of rules) if (r.cardGroupId && !titleByCard.has(r.cardGroupId)) titleByCard.set(r.cardGroupId, r.product?.nameHe || 'כרטיס');
  return lines.map((l) => ({
    cardGroupId: l.sourceCardGroupId || null,
    cardTitle: titleByCard.get(l.sourceCardGroupId) || 'כרטיס',
    ticketTypeId: l.ticketTypeId || null,
    ticketLabel: l.ticketType?.nameHe || 'כרטיס',
    quantity: l.quantity || 0,
    unitPriceMinor: Number(l.unitPriceMinor) || 0,
  }));
}

// Snapshot ALL current quantities as waived — the initial register-without-payment.
export function snapshotWaiverFromLines(lines, { reason, at }) {
  return {
    reason: String(reason || '').trim(),
    waivedAt: at instanceof Date ? at.toISOString() : at || null,
    lines: (lines || [])
      .filter((l) => (l.quantity || 0) > 0)
      .map((l) => ({ cardGroupId: l.cardGroupId || null, ticketTypeId: l.ticketTypeId || null, quantityWaived: l.quantity || 0 })),
  };
}

// Waived qty for a line, CLAMPED to what currently exists (handles decreases:
// a stored waiver of 2 with a current quantity of 1 waives 1).
function waivedQtyFor(waiver, line) {
  const w = (waiver?.lines || []).find(
    (x) => (x.cardGroupId || null) === (line.cardGroupId || null) && (x.ticketTypeId || null) === (line.ticketTypeId || null),
  );
  return Math.min(w?.quantityWaived || 0, line.quantity || 0);
}

// The waived commercial value (agorot) at CURRENT line prices.
export function computeWaivedMinor(waiver, lines) {
  if (!waiver) return 0;
  let sum = 0;
  for (const l of lines || []) sum += waivedQtyFor(waiver, l) * (Number(l.unitPriceMinor) || 0);
  return sum;
}

// The Deal's payable total = commercial gross − waived value, clamped ≥ 0.
export function computePayableMinor(grossMinor, waiver, lines) {
  return Math.max(0, Number(grossMinor || 0) - computeWaivedMinor(waiver, lines));
}

// Classify a builder edit vs the PREVIOUS lines. An INCREASE (a line's quantity
// grew, or a new card/ticket appeared) requires an explicit business decision
// when a waiver exists; a pure decrease/removal never does. Returns
// { hasIncrease, added: [{ cardGroupId, cardTitle, ticketTypeId, ticketLabel, addedQty }] }.
export function classifyBuilderChange(oldLines, newLines) {
  const oldByKey = new Map((oldLines || []).map((l) => [lineKey(l.cardGroupId, l.ticketTypeId), l.quantity || 0]));
  const added = [];
  for (const nl of newLines || []) {
    const q = nl.quantity || 0;
    if (q <= 0) continue;
    const oldQ = oldByKey.get(lineKey(nl.cardGroupId, nl.ticketTypeId)) || 0;
    if (q > oldQ) {
      added.push({
        cardGroupId: nl.cardGroupId || null,
        cardTitle: nl.cardTitle || null,
        ticketTypeId: nl.ticketTypeId || null,
        ticketLabel: nl.ticketLabel || null,
        addedQty: q - oldQ,
      });
    }
  }
  return { hasIncrease: added.length > 0, added };
}

// Apply the operator's decision (or a plain decrease/no-change):
//   'expand'       → waive everything now present (added tickets become free).
//   'charge_added' → keep the stored waiver (min() leaves added tickets payable).
//   'cancel'       → no waiver (deal returns to full commercial pricing).
//   undefined      → decrease / no dialog → keep the stored waiver (min() clamps).
// In every non-cancel case the snapshot is PRUNED to lines that still exist.
export function applyWaiverDecision(waiver, newLines, decision) {
  if (!waiver) return null;
  if (decision === 'cancel') return null;
  if (decision === 'expand') {
    return {
      ...waiver,
      lines: (newLines || [])
        .filter((l) => (l.quantity || 0) > 0)
        .map((l) => ({ cardGroupId: l.cardGroupId || null, ticketTypeId: l.ticketTypeId || null, quantityWaived: l.quantity || 0 })),
    };
  }
  const present = new Set((newLines || []).map((l) => lineKey(l.cardGroupId, l.ticketTypeId)));
  return { ...waiver, lines: (waiver.lines || []).filter((w) => present.has(lineKey(w.cardGroupId, w.ticketTypeId))) };
}

// Per-line waived/payable breakdown at current prices → for the note + client.
export function waiverBreakdown(waiver, lines) {
  return (lines || [])
    .filter((l) => (l.quantity || 0) > 0)
    .map((l) => {
      const waived = waivedQtyFor(waiver, l);
      return {
        cardGroupId: l.cardGroupId || null,
        cardTitle: l.cardTitle || null,
        ticketTypeId: l.ticketTypeId || null,
        ticketLabel: l.ticketLabel || null,
        quantity: l.quantity || 0,
        waived,
        payable: (l.quantity || 0) - waived,
      };
    });
}

// The pinned-note body reflecting CURRENT commercial reality (rich HTML), so the
// note evolves as the builder is edited.
export function describeWaiver(waiver, lines) {
  if (!waiver) return null;
  const rows = waiverBreakdown(waiver, lines);
  const totalWaived = rows.reduce((n, r) => n + r.waived, 0);
  const totalPayable = rows.reduce((n, r) => n + r.payable, 0);
  const reason = waiver.reason ? escapeHtml(waiver.reason) : '';
  if (totalPayable <= 0) {
    return `<p><strong>רישום ללא תשלום:</strong> ${reason}</p><p>כל המשתתפים ללא תשלום (${totalWaived} כרטיסים).</p>`;
  }
  return (
    `<p><strong>רישום ללא תשלום (חלקי):</strong> ${reason}</p>` +
    `<p>${totalWaived} כרטיסים נותרו ללא תשלום · ${totalPayable} כרטיסים לחיוב.</p>`
  );
}

// The note body after a waiver is CANCELLED — the deal is commercial again.
export function describeWaiverCancelled(reason) {
  const r = reason ? escapeHtml(reason) : '';
  return `<p><strong>הפטור מתשלום בוטל</strong> — הדיל חזר לתמחור מסחרי מלא.${r ? ` (הרישום המקורי: ${r})` : ''}</p>`;
}
