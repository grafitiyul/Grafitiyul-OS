// Seeding a WORKING Builder from frozen imported commercial evidence — THE ONE
// implementation. Extracted verbatim from
// scripts/migration/repair-deal-tour-context.mjs (GAP 2, shipped ff4c410),
// which seeded the future-tour population on 2026-08-01; the
// unlockUnpaidMigratedBuilders maintenance runner now applies the same
// mechanism balance-based, so both callers share this file instead of each
// carrying a copy.
//
// INVARIANTS (unchanged from the original):
//   * Deal.valueMinor is NEVER written — the Builder gross is made to equal the
//     already-agreed value, never the other way round.
//   * The frozen imported version is NEVER modified, never marked working.
//   * Amounts, labels, quantities, notes and order are copied verbatim; the
//     ONLY chosen thing is the VAT INTERPRETATION, and it is chosen by proof:
//     the interpretation whose composed gross reproduces Deal.valueMinor to the
//     agora. No interpretation matching → no seed (operator review).
//   * Idempotent + concurrency-safe: preconditions re-checked INSIDE the
//     transaction, so a re-run or a live operator edit can never be overwritten.
//   * No TourEvent / registration / timeline write. Plain quote rows only —
//     deliberately NOT touchDealActivity: seeding is not business activity.
import { splitVat } from '../pricing/engine.js';

const SIGN = (k) => (k === 'discount' || k === 'credit' ? -1 : 1);

// Compose exactly as pricing/builderCompose.js does for non-engine lines
// (every imported line is kind 'manual'/'discount', so the engine never prices
// them). `forceMode` tests one VAT interpretation of the same amounts.
export function grossOf(lines, vatDefault, forceMode) {
  let gross = 0;
  for (const ln of lines) {
    if (ln.active === false) continue;
    let qty = parseInt(ln.quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) qty = 1;
    const unit = Number(ln.unitPriceMinor) || 0;
    const mode = forceMode || (!ln.vatMode || ln.vatMode === 'inherit' ? vatDefault.mode : ln.vatMode);
    const rate = mode === 'exempt' ? 0 : ln.vatRate != null ? Number(ln.vatRate) : vatDefault.rate;
    gross += splitVat(SIGN(ln.kind) * unit * qty, mode, rate).grossMinor;
  }
  return gross;
}

// The ONE decision rule. Returns the interpretation that reproduces the agreed
// total, or null when none does (→ operator review).
export function chooseVatInterpretation(lines, valueMinor, vatDefault) {
  for (const [forceMode, why] of [
    [null, 'as-imported'],
    ['included', 'imported amounts are VAT-inclusive'],
    ['excluded', 'imported amounts are net of VAT'],
  ]) {
    const gross = grossOf(lines, vatDefault, forceMode);
    if (Math.abs(gross - Number(valueMinor)) < 100) return { forceMode, why, gross };
  }
  return null;
}

export async function loadVatDefault(client) {
  const priceList = await client.priceList.findFirst({
    where: { isDefault: true },
    select: { defaultVatMode: true, defaultVatRate: true },
  });
  return {
    mode: priceList?.defaultVatMode || 'included',
    rate: priceList?.defaultVatRate != null ? priceList.defaultVatRate : 18,
  };
}

// Seed the working version of `deal` ({ id, valueMinor }) from its frozen
// imported evidence. Returns a result descriptor; writes only when `execute`.
//
// `allowUnproven` (the EXPLICIT-OPERATOR mode, used by the start-editing
// endpoint): the automated boot runner refuses to guess — no proven VAT
// interpretation or no agreed amount means no silent seed. An operator who
// explicitly asked to edit is different: they are about to review every line,
// so the frozen evidence is copied AS IMPORTED (amounts + own vatMode
// verbatim, the frozen version's order-level vatMode carried over) even when
// the composed gross does not reproduce Deal.valueMinor, and even when the
// deal has no agreed amount at all. Nothing is invented either way.
export async function seedWorkingFromFrozen(
  client,
  deal,
  { vatDefault, execute = true, allowUnproven = false, auditContext = {} },
) {
  const value = deal.valueMinor == null ? 0 : Number(deal.valueMinor);
  if (value <= 0 && !allowUnproven) return { outcome: 'no_value' };

  const working = await client.quoteVersion.findFirst({
    where: { dealId: deal.id, isWorking: true },
    select: { id: true, _count: { select: { lines: true } } },
  });
  if (working && working._count.lines > 0) return { outcome: 'already_editable' };

  // Evidence: the frozen imported breakdown. pipedrive_import (real line
  // breakdown) preferred; historical_fallback (the one aggregated agreed-total
  // line built for breakdown-less migrated deals) accepted second. In
  // explicit-operator mode, ANY frozen version with active lines is acceptable
  // last — matched with the same orderBy the read route uses, so the operator
  // always starts from exactly what the read-only Builder was showing.
  const FROZEN_SELECT = { id: true, sourceKind: true, vatMode: true, lines: { orderBy: { sortOrder: 'asc' } } };
  const frozen =
    (await client.quoteVersion.findFirst({
      where: { dealId: deal.id, isWorking: false, sourceKind: 'pipedrive_import' },
      orderBy: { createdAt: 'asc' },
      select: FROZEN_SELECT,
    })) ||
    (await client.quoteVersion.findFirst({
      where: { dealId: deal.id, isWorking: false, sourceKind: 'historical_fallback' },
      orderBy: { createdAt: 'asc' },
      select: FROZEN_SELECT,
    })) ||
    (allowUnproven
      ? await client.quoteVersion.findFirst({
          where: { dealId: deal.id, isWorking: false, lines: { some: { active: true } } },
          orderBy: [{ sourceKind: 'asc' }, { createdAt: 'desc' }],
          select: FROZEN_SELECT,
        })
      : null);
  if (!frozen || !frozen.lines.length) return { outcome: 'no_evidence' };

  let choice = chooseVatInterpretation(frozen.lines, value, vatDefault);
  let unverified = false;
  if (!choice) {
    if (!allowUnproven) {
      return {
        outcome: 'ambiguous',
        candidates: {
          asImported: grossOf(frozen.lines, vatDefault, null),
          asGross: grossOf(frozen.lines, vatDefault, 'included'),
          asNet: grossOf(frozen.lines, vatDefault, 'excluded'),
        },
      };
    }
    unverified = true;
    choice = { forceMode: null, why: 'as-imported (unverified against deal value)', gross: grossOf(frozen.lines, vatDefault, null) };
  }
  if (!execute) return { outcome: 'would_seed', frozenVersionId: frozen.id, unverified, ...choice };

  let workingVersionId = null;
  await client.$transaction(async (tx) => {
    // Re-check inside the tx — never overwrite a builder someone just filled.
    let target = await tx.quoteVersion.findFirst({
      where: { dealId: deal.id, isWorking: true },
      select: { id: true, vatMode: true, _count: { select: { lines: true } } },
    });
    if (target && target._count.lines > 0) return;
    if (!target) {
      target = await tx.quoteVersion.create({
        data: {
          dealId: deal.id,
          isWorking: true,
          status: 'draft',
          // Unverified as-imported copies keep the frozen order-level VAT mode
          // so the lines mean exactly what the historical view showed. Proven
          // seeds keep the original behavior (forceMode lives on the lines).
          ...(unverified && frozen.vatMode ? { vatMode: frozen.vatMode } : {}),
        },
        select: { id: true, vatMode: true, _count: { select: { lines: true } } },
      });
    } else if (unverified && frozen.vatMode && !target.vatMode) {
      await tx.quoteVersion.update({ where: { id: target.id }, data: { vatMode: frozen.vatMode } });
    }
    workingVersionId = target.id;
    await tx.quoteLine.createMany({
      data: frozen.lines.map((l, i) => ({
        quoteVersionId: target.id,
        kind: l.kind,
        label: l.label,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        // The ONE reinterpreted field — see the header. Amounts are verbatim.
        vatMode: choice.forceMode || l.vatMode,
        vatRate: l.vatRate,
        active: l.active,
        note: l.note,
        // Frozen price: the engine must never reprice these from the cards.
        overridden: true,
        sourceKind: l.sourceKind || frozen.sourceKind,
        sortOrder: i,
      })),
    });
    await tx.legacyRecord.upsert({
      where: {
        sourceSystem_sourceType_sourceId: {
          sourceSystem: 'gos',
          sourceType: 'deal_builder_backfill',
          sourceId: deal.id,
        },
      },
      create: {
        sourceSystem: 'gos',
        sourceType: 'deal_builder_backfill',
        sourceId: deal.id,
        entityType: 'Deal',
        entityId: deal.id,
        cardData: buildAudit(frozen, target.id, choice, value, auditContext),
      },
      update: { cardData: buildAudit(frozen, target.id, choice, value, auditContext) },
    });
  });
  return workingVersionId
    ? { outcome: 'seeded', frozenVersionId: frozen.id, workingVersionId, unverified, ...choice }
    : { outcome: 'already_editable' };
}

function buildAudit(frozen, workingVersionId, choice, value, auditContext) {
  return {
    source: 'frozen_quote_version',
    frozenVersionId: frozen.id,
    frozenSourceKind: frozen.sourceKind,
    workingVersionId,
    interpretation: choice.why,
    vatMode: choice.forceMode,
    grossMinor: choice.gross,
    dealValueMinor: value,
    lines: frozen.lines.length,
    at: new Date().toISOString(),
    ...auditContext,
  };
}
