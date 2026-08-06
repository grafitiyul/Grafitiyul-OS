import { useEffect, useRef, useState } from 'react';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { api } from '../../lib/api.js';
import { duplicateLineVat } from '../../../../shared/vatMode.mjs';
import { lineSign } from '../../../../shared/lineMath.mjs';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';

// Price Builder — a roomy, document-style editor for a Deal's base pricing. Edits
// the working QuoteVersion's lines (canonical storage). UI/UX layer only: money
// math runs in the engine via /api/pricing/builder; load/save go through
// /api/deals/:id/price-lines. No schema/calculation/quote-workflow changes here.

const VAT_OPTIONS = [
  { mode: 'included', label: 'מחירים כולל מע״מ' },
  { mode: 'excluded', label: 'מחירים לפני מע״מ' },
  { mode: 'exempt', label: 'פטור ממע״מ' },
];
// Per-LINE VAT vocabulary (the row ⋮ menu). 'inherit' = follow the order's
// mode — the default every new line is born with (shared/vatMode.mjs).
const LINE_VAT_OPTIONS = [
  { mode: 'inherit', label: 'לפי ההזמנה' },
  { mode: 'included', label: 'כולל מע״מ' },
  { mode: 'excluded', label: 'לפני מע״מ' },
  { mode: 'exempt', label: 'פטור ממע״מ' },
];
const lineVatLabel = (mode) => LINE_VAT_OPTIONS.find((o) => o.mode === mode)?.label || mode;
function vatLabel(mode) {
  return VAT_OPTIONS.find((o) => o.mode === mode)?.label || 'מע״מ';
}
function nid() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `l${Math.random().toString(36).slice(2, 10)}`;
}
function normalize(l) {
  return {
    id: l.id || nid(),
    kind: l.kind || 'manual',
    label: l.label || '',
    refId: l.refId || null,
    quantity: l.quantity ?? 1,
    unitPriceMinor: l.unitPriceMinor ?? 0,
    // Per-line discount INTENT — the line's own price is never modified; the
    // resolved money is a synthetic line_discount row (server compose).
    discountPercent: l.discountPercent ?? null,
    discountFixedMinor: l.discountFixedMinor ?? null,
    // VAT via the ONE resolver's vocabulary: an existing line keeps its exact
    // meaning, a new line is born 'inherit' = follow the order's mode.
    ...duplicateLineVat(l),
    active: l.active !== false,
    note: l.note || '',
    overridden: !!l.overridden,
    // Structured provenance — which Pricing Card produced this line (engine
    // stamps the product line with the winning card). Round-trips to QuoteLine.
    sourceKind: l.sourceKind || null,
    sourceCardGroupId: l.sourceCardGroupId || null,
    ticketTypeId: l.ticketTypeId || null,
    // Manual Pricing Card selection (INPUT to resolution; null = automatic).
    pinnedCardGroupId: l.pinnedCardGroupId || null,
  };
}
function seedProductLine(context) {
  return normalize({ kind: 'product', label: '', refId: context?.productVariantId || null });
}
function isRichEmpty(html) {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}
const CELL = 'h-10 rounded-md border border-gray-200 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400';

// Additive embedding props (the parallel-offer dialog reuses this builder as-is):
//   title       — dialog title override (default "עריכת מחיר").
//   headerExtra — rendered ABOVE the builder body (the offer's context fields).
//   skipDealTermsWrite — when true, payment terms/method are NOT edited or
//     written (they are DEAL-level commercial terms; a parallel offer follows
//     the Deal's terms and must never mutate the Deal).
//   simulated — no Deal: nothing is loaded from or saved to the server. Lines are
//     seeded from the supplied context and live only in this component. The SAME
//     builder + the SAME /api/pricing/builder engine path as a real Deal — only
//     persistence is disabled. The footer becomes סגור + איפוס סימולטור
//     (onReset, provided by the simulator wrapper) instead of save.
export default function PriceBuilderDialog({ open, deal, context, onClose, onSaved, onReset, title, headerExtra, skipDealTermsWrite = false, simulated = false }) {
  const [lines, setLines] = useState([]);
  const [openNotes, setOpenNotes] = useState(() => new Set());
  const [freeRows, setFreeRows] = useState(() => new Set());
  const [computed, setComputed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [products, setProducts] = useState([]);
  const [addons, setAddons] = useState([]);
  const [terms, setTerms] = useState([]);
  const [methods, setMethods] = useState([]);
  const [paymentTermId, setPaymentTermId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [methodOverridden, setMethodOverridden] = useState(false);
  const calcTimer = useRef(null);
  // Effective pricing context: starts from the Deal's context, then follows the
  // context controls (product pick, groups, card pin, participants). Editing it
  // ONLY updates the context — no line is created or modified until חישוב
  // אוטומטי runs. One product value — the line drives the Deal.
  // THE order-level VAT mode ("מחירים כולל/לפני מע״מ · פטור") — canonical, stored
  // on QuoteVersion.vatMode, loaded with the lines and saved with them. It is
  // NOT derived from the lines: an order with no lines still holds the choice,
  // and a line added later inherits it instead of the price-list default (the
  // bug where a "לפני מע״מ" builder read the next typed amount as VAT-inclusive).
  // null = never chosen → the price list decides. Resolution: shared/vatMode.mjs.
  const [vatMode, setVatMode] = useState(null);
  // Deal-level discount INTENT — the permanent summary row above סכום ביניים:
  // mode ('percent' | 'fixed') + the raw input string. Persisted on
  // QuoteVersion (dealDiscountPercent / dealDiscountFixedMinor) and RESOLVED
  // server-side by composeBuilderLines into a synthetic 'deal_discount' line,
  // which save materializes as a stored QuoteLine — so quotes/iCount/payments
  // keep reading lines, and the operator experiences a Builder-level property.
  const [dealDiscount, setDealDiscount] = useState({ mode: 'percent', value: '' });
  const dealDiscountInputRef = useRef(null);
  // Set when the server answered with a FROZEN imported version (a migrated deal
  // with no working quote). Read-only: the Builder shows the historical record
  // and refuses to save over it.
  const [historicalMode, setHistoricalMode] = useState(null);
  // Bumped by the explicit "start editing" action to re-run the load effect.
  const [reloadKey, setReloadKey] = useState(0);
  const [startEditBusy, setStartEditBusy] = useState(false);
  const [ctx, setCtx] = useState(context);
  // The context the CURRENT lines were calculated against. Line edits recompute
  // totals against THIS snapshot; it advances only when חישוב אוטומטי runs, so
  // the calculation feels atomic (nothing shifts while values are being picked).
  const [appliedCtx, setAppliedCtx] = useState(context);
  // Card options for the manual override picker (metadata only — fetching them
  // never touches lines).
  const [cardOptions, setCardOptions] = useState([]);

  // Catalogs (product+addon item dropdown, payment terms/methods dropdowns).
  useEffect(() => {
    if (!open) return;
    api.products.list().then(setProducts).catch(() => {});
    api.addons.list().then(setAddons).catch(() => {});
    api.payment.listTerms().then(setTerms).catch(() => {});
    api.payment.listMethods().then(setMethods).catch(() => {});
  }, [open]);

  // Re-seed the effective context from the Deal each time the dialog opens.
  useEffect(() => {
    setCtx(context);
    setAppliedCtx(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  // Simulator: the context is LIVE (the popup's top block edits it) — follow it
  // into ctx ONLY (nothing recalculates until חישוב אוטומטי). The builder-owned
  // controls (קבוצות, card pin) are preserved across follows; reset remounts.
  useEffect(() => {
    if (simulated)
      setCtx((cur) => ({
        ...context,
        groupCount: cur?.groupCount ?? context?.groupCount ?? 1,
        pinnedCardGroupId: cur?.pinnedCardGroupId ?? null,
      }));
  }, [simulated, context]);

  // Participant count follows the context prop LIVE (the embedded parallel-offer
  // header edits it while the builder is open; the deal flow's context is stable
  // while open, so this is a no-op there). Product/variant stay line/remount
  // driven — unchanged.
  useEffect(() => {
    if (context?.participantCount === undefined) return;
    setCtx((c) => (c && c.participantCount !== context.participantCount
      ? { ...c, participantCount: context.participantCount }
      : c));
  }, [context?.participantCount]);

  // Follow the first product line's product → effective context (productId + its
  // first variant + city). The engine then reprices through the SAME /builder
  // endpoint; no pricing logic is duplicated here. Manual overrides are untouched
  // (the engine only reprices a product line that is NOT overridden).
  useEffect(() => {
    if (!open) return undefined;
    const picked = lines.map((l) => products.find((p) => p.nameHe === l.label)).find(Boolean);
    if (!picked || picked.id === ctx?.productId) return undefined;
    let live = true;
    api.products
      .get(picked.id)
      .then((full) => {
        if (!live) return;
        const v = (full?.variants || [])[0];
        setCtx((c) => ({
          ...(c || {}),
          productId: picked.id,
          productVariantId: v ? v.id : null,
          locationId: v ? v.location?.id || v.locationId || null : null,
        }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lines, products, ctx?.productId]);

  // (Simulator lines are NOT seeded while picking values — חישוב אוטומטי
  // creates the complete result atomically; the server ensures the product
  // line from the context on regeneration.)

  // Load working-version lines + payment fields on open.
  useEffect(() => {
    if (!open || simulated) return;
    let live = true;
    setPaymentTermId(deal?.paymentTermId || '');
    setPaymentMethodId(deal?.paymentMethodId || '');
    setMethodOverridden(false);
    api.deals
      .getPriceLines(deal.id)
      .then(async (r) => {
        if (!live) return;
        setVatMode(r?.vatMode || null);
        setDealDiscount(
          r?.dealDiscountPercent != null
            ? { mode: 'percent', value: String(r.dealDiscountPercent) }
            : r?.dealDiscountFixedMinor != null
              ? { mode: 'fixed', value: minorToInput(r.dealDiscountFixedMinor) }
              : { mode: 'percent', value: '' },
        );
        // The summary section shows only when the deal actually carries one.
        setShowDealDiscount(r?.dealDiscountPercent != null || r?.dealDiscountFixedMinor != null);
        // A migrated deal has no working version — the server answers with its
        // FROZEN imported version, read-only. The Builder shows the real
        // historical commercial record instead of a blank sheet, and cannot save
        // over it: the import stays evidence, not a live editable quote.
        setHistoricalMode(r?.readOnly ? { source: r.source, importedAt: r.importedAt, versionId: r.versionId } : null);
        // Stored deal_discount / line_discount rows are RESOLVED artifacts of
        // their intents (the summary row / the target line's fields) — they
        // re-enter through the intents (compose regenerates them), never as
        // editable list rows.
        const saved = Array.isArray(r?.lines)
          ? r.lines
              .map(normalize)
              .filter((l) => r?.readOnly || (l.sourceKind !== 'deal_discount' && l.sourceKind !== 'line_discount'))
          : [];
        // Seed a default line ONLY for a brand-new working version. An existing
        // deal may legitimately have zero lines.
        let next = saved.length ? saved : r?.created ? [seedProductLine(context)] : [];

        // SSOT on open: the DEAL product is the source. The first product line must
        // reflect the CURRENT Deal product — it may have changed in the Tour Details
        // card since this version was last saved. We refresh that line's product
        // (label + variant) from the Deal; no duplicate product state is created and
        // the engine is untouched (it already prices via the effective context).
        //
        // EXCEPTION — frozen reservation lines (sourceKind 'agent_reservation'):
        // their label is the FROZEN agent-facing display name and their overridden
        // price is the ACCEPTED reservation price. The label never equals the
        // product's internal name, so the "product changed" heuristic would fire
        // on every open, rename the line and clear `overridden` — silently
        // repricing the frozen accepted amount from live cards. These lines are
        // left exactly as saved; an explicit חישוב אוטומטי remains the one way to
        // deliberately reprice such a deal.
        if (context?.productId) {
          const dp = await api.products.get(context.productId).catch(() => null);
          if (live && dp) {
            const idx = next.findIndex((l) => l.kind === 'product');
            const name = dp.nameHe || '';
            // A builder seeded from FROZEN IMPORTED evidence carries the full
            // agreed amounts as manual lines and has no product line at all.
            // Prepending an engine-priced product line here would ADD the
            // current catalogue base price on top of the imported total —
            // double-counting money nobody agreed. The imported lines stay the
            // one commercial content; an explicit חישוב אוטומטי remains the way
            // to deliberately reprice such a deal from today's catalogue.
            const importedEvidence = next.some(
              (l) => l.sourceKind === 'pipedrive_import' || l.sourceKind === 'historical_fallback',
            );
            if (idx === -1 && !importedEvidence) {
              next = [normalize({ kind: 'product', label: name, refId: context.productVariantId || null }), ...next];
            } else if (idx !== -1 && next[idx].sourceKind !== 'agent_reservation') {
              next = next.map((l, i) => {
                if (i !== idx) return l;
                const productChanged = l.label !== name;
                return {
                  ...l,
                  label: name,
                  refId: context.productVariantId || null,
                  // If the product actually changed (e.g. via Tour Details), drop any
                  // stale manual price so the engine reprices the NEW product. An
                  // unchanged product keeps the user's override.
                  ...(productChanged ? { overridden: false } : {}),
                };
              });
            }
          }
        }

        if (!live) return;
        setLines(next);
        // A previously saved manual card selection re-enters the context so the
        // picker shows it and the next חישוב אוטומטי honors it.
        const savedPin = next.find((l) => l.kind === 'product')?.pinnedCardGroupId || null;
        if (savedPin) setCtx((c) => ({ ...(c || {}), pinnedCardGroupId: savedPin }));
        // Open only notes that actually have content. Never auto-open an empty
        // note (no large blank note area should pop open on load).
        const noteOpen = new Set(next.filter((l) => !isRichEmpty(l.note)).map((l) => l.id));
        setOpenNotes(noteOpen);
      })
      .catch(() => {
        if (live) {
          setLines([]);
          setOpenNotes(new Set());
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id, reloadKey]);

  // EXPLICIT unlock: seed a working version from the frozen evidence (the
  // server copies it verbatim; the frozen record stays untouched in history)
  // and reload — the same GET now answers editable. Never automatic: reading
  // stays side-effect free, editing is an operator decision.
  async function startEditing() {
    if (startEditBusy) return;
    setStartEditBusy(true);
    try {
      await api.deals.startPriceLinesEditing(deal.id);
      setReloadKey((k) => k + 1);
    } catch {
      /* the reload below simply shows the unchanged read-only state */
    } finally {
      setStartEditBusy(false);
    }
  }

  // Recompute totals whenever LINES change — against the context of the LAST
  // calculation (appliedCtx). Context edits (product, groups, card, participants,
  // date…) deliberately change nothing here: lines and totals stay exactly as
  // they are until חישוב אוטומטי rebuilds the result atomically. Line notes and
  // provenance are NEVER touched by this recompute (no applyCardNotes).
  // The summary row's intent as the request shape ({percent} | {fixedMinor} |
  // null). The SERVER resolves it — the client never computes discount money.
  const dealDiscountReq = (() => {
    if (dealDiscount.mode === 'percent') {
      const p = parseFloat(dealDiscount.value);
      return Number.isFinite(p) && p > 0 ? { percent: p } : null;
    }
    const m = toMinor(dealDiscount.value);
    return m && m > 0 ? { fixedMinor: m } : null;
  })();

  useEffect(() => {
    if (!open || !lines.length) {
      setComputed(null);
      return undefined;
    }
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => {
      api.pricing
        .builder({ context: { ...(appliedCtx || {}), vatMode, dealDiscount: dealDiscountReq }, lines })
        .then((r) => setComputed(r))
        .catch((e) => setComputed({ ok: false, error: e.message }));
    }, 300);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lines, appliedCtx, vatMode, dealDiscount.mode, dealDiscount.value]);

  // Card options for the picker follow the LIVE context (metadata-only request
  // with no lines — nothing on screen changes). The SIMULATOR lists
  // configuration-valid cards (inspectable as soon as a product is chosen,
  // before city/activity); the Deal builder stays strict (context-applicable
  // cards only — every visible option calculates).
  useEffect(() => {
    if (!open || !ctx?.productId) {
      setCardOptions([]);
      return undefined;
    }
    let live = true;
    api.pricing
      .builder({
        context: { ...ctx, pinnedCardGroupId: null },
        lines: [],
        optionsMode: simulated ? 'config' : 'applicable',
      })
      .then((r) => {
        if (live) setCardOptions(r?.cardOptions || []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, simulated, ctx?.productId, ctx?.productVariantId, ctx?.activityTypeId]);

  const computedById = new Map((computed?.lines || []).map((l) => [l.id, l]));
  const totals = computed?.totals;
  const vatDefault = computed?.vatDefault;
  // The picker reads the ORDER's own mode — never inferred from whichever line
  // happens to carry one (that inference is what let a new line disagree).
  const orderVatMode = vatMode || vatDefault?.mode;
  // Pin/unpin a Pricing Card (manual option override) — a CONTEXT edit only.
  // Nothing recalculates until חישוב אוטומטי applies it atomically.
  function pickCard(cardGroupId) {
    setCtx((c) => ({ ...(c || {}), pinnedCardGroupId: cardGroupId || null }));
  }
  function setGroups(raw) {
    const n = Math.max(1, parseInt(String(raw).replace(/[^0-9]/g, ''), 10) || 1);
    setCtx((c) => ({ ...(c || {}), groupCount: n }));
  }

  function updateLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  // ONE primary product per builder. Picking a product from the item dropdown
  // always targets THE primary product line: if one exists it is REPLACED
  // (same semantics as a product change from the Deal — label refreshed,
  // manual price dropped so the engine reprices the new product); if none
  // exists the picked row becomes it. A second product line is never created.
  // Frozen agent-reservation product lines are not primaries — they are
  // accepted snapshot rows and are never retargeted by a pick.
  function pickProduct(rowId, product) {
    if (!product) return;
    setLines((ls) => {
      const primaryIdx = ls.findIndex((l) => l.kind === 'product' && l.sourceKind !== 'agent_reservation');
      const targetIdx = primaryIdx !== -1 ? primaryIdx : ls.findIndex((l) => l.id === rowId);
      if (targetIdx === -1) return ls;
      return ls.map((l, i) => {
        if (i !== targetIdx) return l;
        const changed = l.label !== (product.nameHe || '');
        return {
          ...l,
          kind: 'product',
          label: product.nameHe || '',
          refId: null,
          ...(changed ? { overridden: false } : {}),
        };
      });
    });
  }
  function removeLine(id) {
    setLines((ls) => ls.filter((l) => l.id !== id));
    setOpenNotes((s) => { const n = new Set(s); n.delete(id); return n; });
    setFreeRows((s) => { const n = new Set(s); n.delete(id); return n; });
  }
  function addLine() {
    setLines((ls) => [...ls, normalize({ kind: 'manual', label: '' })]);
  }
  function toggleNote(id) {
    setOpenNotes((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function onReorder(ids) {
    setLines((ls) => ids.map((id) => ls.find((l) => l.id === id)).filter(Boolean));
  }
  // Choosing the order's VAT mode sets the ORDER's mode only. A deliberate
  // per-line override (the row ⋮ menu) SURVIVES the order-level change — the
  // row shows a visible badge, so nothing disagrees silently; every 'inherit'
  // line follows the new mode automatically.
  function setOrderVat(mode) {
    setVatMode(mode);
  }

  // ---- Line discounts -----------------------------------------------------
  // A LINE discount is INTENT ON ITS TARGET LINE (discountPercent /
  // discountFixedMinor — the line's own price is never modified, so removal
  // restores it exactly). The server compose resolves the intent into a
  // synthetic line_discount row directly under the target; save stores that
  // row with the others so documents/iCount inherit it. Same architecture as
  // the deal-level discount, one level down.
  const [discountFor, setDiscountFor] = useState(null); // <line id> | null

  // A line's builder-basis amount exactly as its row displays it: sign × unit
  // × qty, product lines following the engine price until overridden.
  function lineAmountMinor(l) {
    const c = computedById.get(l.id);
    const unit = l.kind === 'product' && !l.overridden && c ? c.unitPriceMinor : l.unitPriceMinor;
    let qty = parseInt(l.quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) qty = 1;
    return lineSign(l.kind) * (Number(unit) || 0) * qty;
  }

  function applyLineDiscount({ pct, fixedMinor }) {
    updateLine(discountFor, {
      discountPercent: pct || null,
      discountFixedMinor: pct ? null : fixedMinor || null,
    });
    setDiscountFor(null);
  }
  function removeLineDiscount(id) {
    updateLine(id, { discountPercent: null, discountFixedMinor: null });
  }

  const discountTarget = discountFor ? lines.find((l) => l.id === discountFor) : null;
  const discountBaseMinor = discountTarget ? lineAmountMinor(discountTarget) : 0;

  // ---- Commission (עמלה) --------------------------------------------------
  // A commission is an ADDED CHARGE to the customer — a positive line (kind
  // 'manual', sourceKind 'commission') that increases the total and appears on
  // documents as a normal charge row. It is deliberately NOT discount-signed.
  const [commissionOpen, setCommissionOpen] = useState(false);
  // % base: the current signed builder-basis total (discounts included) —
  // taken from the composed lines so engine-priced products count correctly.
  const commissionBaseMinor = (computed?.lines || [])
    .filter((l) => l.active !== false)
    .reduce((s, l) => s + lineSign(l.kind) * (Number(l.unitPriceMinor) || 0) * (l.quantity || 0), 0);
  function applyCommission({ pct, amountMinor }) {
    const row = normalize({
      kind: 'manual',
      sourceKind: 'commission',
      label: pct ? `עמלה ${pct}%` : 'עמלה',
      unitPriceMinor: amountMinor,
      quantity: 1,
    });
    setLines((ls) => [...ls, row]);
    setCommissionOpen(false);
  }

  // ---- Builder-level (⋯) actions ------------------------------------------
  // The deal-discount summary row is OPT-IN: hidden until the operator asks
  // for it (or the deal already carries an intent — set on load).
  const [showDealDiscount, setShowDealDiscount] = useState(false);
  function openDealDiscount() {
    setShowDealDiscount(true);
    setTimeout(() => {
      dealDiscountInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      dealDiscountInputRef.current?.focus();
    }, 100);
  }
  // ✕ on the summary row: clears the intent (the synthetic row disappears on
  // the next compose — totals restore) and hides the section. Idempotent with
  // reopening: the row regenerates only from a non-empty intent.
  function closeDealDiscount() {
    setDealDiscount({ mode: 'percent', value: '' });
    setShowDealDiscount(false);
  }
  // The explicit Builder-level "release the per-line VAT overrides" action —
  // deliberately an action here, never a silent side effect of the VAT switch.
  function resetLineVat() {
    setLines((ls) => ls.map((l) => ({ ...l, vatMode: 'inherit', vatRate: null })));
  }
  const hasLineVatOverrides = lines.some((l) => l.vatMode && l.vatMode !== 'inherit');
  // "שליטה על כל שורה בנפרד" — pure UI state (never commercial data): shows/
  // hides the per-row ⋮ menus. Turning it OFF hides controls only; existing
  // overrides keep their always-visible row chips.
  const [lineControls, setLineControls] = useState(false);
  function setFree(id, on) {
    setFreeRows((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  }

  // חישוב אוטומטי — explicit regeneration. Card-produced lines are rebuilt from
  // the CURRENT canonical Pricing Card data via the ONE engine path
  // (/api/pricing/builder with applyCardNotes): the product line returns to the
  // engine price (manual override cleared) and each card's first-line note is
  // restored from the card — replacing any manual edit on those lines. Manual
  // lines and their notes are untouched. Identical in a real Deal and in the
  // simulator (same component, same request).
  const [autoCalcBusy, setAutoCalcBusy] = useState(false);
  async function autoCalc() {
    setAutoCalcBusy(true);
    setSaveError(null);
    try {
      // ONE atomic regeneration from the CURRENT context: previously generated
      // lines (extras, add-ons) are dropped; the server rebuilds the complete
      // result — product breakdown, extra-participants line, auto add-ons,
      // rendered notes — and everything renders together.
      const reqLines = lines
        .filter((l) => l.sourceKind !== 'price_rule_addon' && l.sourceKind !== 'price_rule_extra')
        .map((l) =>
          l.kind === 'product'
            ? { ...l, overridden: false, pinnedCardGroupId: ctx?.pinnedCardGroupId ?? null }
            : l,
        );
      const r = await api.pricing.builder({ context: { ...(ctx || {}), vatMode, dealDiscount: dealDiscountReq }, lines: reqLines, applyCardNotes: true });
      setComputed(r);
      // A calculation that cannot run must say so explicitly — never a silent
      // no-op. Missing context (city/activity) names the missing input; a
      // selected card that doesn't apply says exactly that. The selected card
      // stays selected either way (ctx keeps the pin).
      const pr = r?.productResolution;
      if (pr && pr.ok === false) {
        const msgs = {
          no_product: 'חסרה עיר/מיקום — בחרו עיר כדי לחשב מחיר.',
          activity_type_required: 'חסר סוג פעילות — בחרו סוג פעילות כדי לחשב מחיר.',
          activity_type_not_found: 'חסר סוג פעילות — בחרו סוג פעילות כדי לחשב מחיר.',
          pinned_card_not_found: 'כרטיס התמחור שנבחר אינו קיים עוד — בחרו כרטיס אחר.',
          pinned_card_not_applicable:
            'כרטיס התמחור שנבחר אינו חל על ההקשר הנוכחי (עיר/מוצר). בחרו כרטיס אחר או שנו את ההקשר.',
          no_price_rule: 'אין כרטיס תמחור שמתאים אוטומטית להקשר הנוכחי — אפשר לבחור כרטיס ידנית.',
          ambiguous_price_rule: 'יותר מכרטיס תמחור אחד מתאים — בחרו כרטיס ידנית.',
          no_price_list: 'לא הוגדר מחירון פעיל.',
        };
        setSaveError(msgs[pr.error] || 'לא ניתן לחשב מחיר בהקשר הנוכחי.');
      }
      // The response IS the regenerated set: existing lines adopt canonical
      // note/provenance/quantity; server-generated lines (product ensure, extra
      // participants, auto add-ons) enter state; stale ones disappear.
      const stateById = new Map(reqLines.map((l) => [l.id, l]));
      // Synthetic discount rows are intent-derived, never list rows.
      const next = (r?.lines || []).filter((rl) => rl.sourceKind !== 'deal_discount' && rl.sourceKind !== 'line_discount').map((rl) => {
        const existing = stateById.get(rl.id);
        if (existing) {
          if (!rl.sourceCardGroupId) return existing;
          return {
            ...existing,
            note: rl.note || '',
            sourceKind: rl.sourceKind || null,
            sourceCardGroupId: rl.sourceCardGroupId,
            pinnedCardGroupId: rl.pinnedCardGroupId || null,
            // The breakdown owns the generated quantity (base × groups).
            ...(rl.sourceKind === 'price_rule_base' ? { quantity: rl.quantity } : {}),
          };
        }
        return normalize(rl);
      });
      if (next.length) setLines(next);
      // The applied context snapshot advances — subsequent line edits recompute
      // against exactly what this calculation used.
      setAppliedCtx({ ...(ctx || {}) });
      setOpenNotes((s) => new Set([...s, ...next.filter((l) => !isRichEmpty(l.note)).map((l) => l.id)]));
    } catch (e) {
      setSaveError(e.payload?.error || e.message || 'החישוב נכשל');
    } finally {
      setAutoCalcBusy(false);
    }
  }

  // Payment Term → auto-fill Payment Method via the catalog relationship BY ID,
  // unless the method was manually changed this session.
  function pickTerm(termId) {
    setPaymentTermId(termId);
    if (!methodOverridden) {
      const t = terms.find((x) => x.id === termId);
      const defId = t?.defaultPaymentMethod?.id;
      if (defId) setPaymentMethodId(defId);
    }
  }
  function pickMethod(methodId) {
    setMethodOverridden(true);
    setPaymentMethodId(methodId);
  }

  async function save() {
    // A frozen imported version is historical EVIDENCE, not a live quote. It is
    // never saved over — which is also what guarantees that opening a completed
    // deal's Builder cannot reprice it, touch its registrations or its tour.
    // Changing anything means deliberately starting a new working quote.
    if (historicalMode) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Materialize the RESOLVED discounts as stored lines alongside their
      // intents (the summary row / target-line fields round-trip): each line's
      // synthetic line_discount row is stored DIRECTLY UNDER it (document row
      // order), the deal_discount row last. Compose regenerates them all on
      // load, so stored rows and intents can never drift apart.
      const toSave = [];
      for (const l of lines) {
        const c = computedById.get(l.id);
        toSave.push(l.kind === 'product' && !l.overridden && c ? { ...l, unitPriceMinor: c.unitPriceMinor } : l);
        const ld = computedById.get(`${l.id}:discount`);
        if (ld) toSave.push(normalize(ld));
      }
      const ddLine = (computed?.lines || []).find((l) => l.sourceKind === 'deal_discount');
      if (ddLine) toSave.push(normalize(ddLine));

      // SSOT: the effective context already followed the first product line's
      // product (incl. its variant + city). Persist that as the Deal product and the
      // builder TOTAL as the Deal value — one product value, one price. locationId is
      // sent only when a product change set it, so an unchanged product never churns
      // the Deal's city.
      await api.deals.savePriceLines(deal.id, {
        lines: toSave,
        // Saved in the same transaction as the lines it interprets.
        vatMode,
        dealDiscountPercent: dealDiscountReq?.percent ?? null,
        dealDiscountFixedMinor: dealDiscountReq?.fixedMinor ?? null,
        valueMinor: totals ? totals.grossMinor : 0,
        productId: ctx?.productId || null,
        productVariantId: ctx?.productVariantId || null,
        // Operational groups persist to the Deal (canonical Deal.groups) so the
        // builder's context and the tour details never diverge.
        groups: ctx?.groupCount ?? 1,
        ...(ctx && 'locationId' in ctx ? { locationId: ctx.locationId } : {}),
      });
      // Payment terms are DEAL-level; embedded (parallel-offer) mode never
      // writes to the Deal.
      if (!skipDealTermsWrite) {
        await api.deals.update(deal.id, {
          paymentTermId: paymentTermId || null,
          paymentMethodId: paymentMethodId || null,
        });
      }
      await onSaved?.();
      onClose?.();
    } catch (e) {
      setSaveError(e.payload?.error || e.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // ONE builder body for both modes — the Deal dialog and the simulator popup
  // share the shell and layout; only the footer differs (save vs reset/close).
  const body = (
    <>
      {headerExtra}
      <div className="space-y-7 px-2 py-2 min-h-[60vh] flex flex-col">
        {/* A migrated deal's commercial record, shown as it was agreed. Read-only
            on purpose: this is the historical evidence of what the customer was
            charged, not a quote to re-price from today's catalogue. */}
        {historicalMode && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="text-[13px] font-semibold text-amber-900">
              🗄️ הזמנה היסטורית שיובאה מפייפדרייב — לצפייה בלבד
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800">
              זהו הפירוט המסחרי כפי שסוכם בפועל, כפי שיובא מהמערכת הקודמת. הוא נשמר כראיה היסטורית ולא ישתנה.
              לחיצה על "פתח לעריכה" תיצור גרסת עבודה חדשה שמתחילה מהפירוט הזה — הרשומה ההיסטורית נשארת
              בדיוק כפי שהיא, וכל שינוי מסחרי נעשה בגרסת העבודה בלבד.
            </p>
            <button
              type="button"
              onClick={startEditing}
              disabled={startEditBusy}
              className="mt-2 h-9 rounded-lg bg-amber-600 px-4 text-[13px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {startEditBusy ? 'פותח…' : 'פתח לעריכה'}
            </button>
          </div>
        )}
        {/* In-app error (no native alert). */}
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {saveError}
          </div>
        )}
        {/* Toolbar — the SHARED pricing context strip (auto-calc, groups, card
            option pick) on the right (RTL), VAT + "⋯" pushed to the left. One
            implementation for Deal and simulator alike. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={autoCalc}
            disabled={autoCalcBusy || (!lines.length && !ctx?.productId)}
            title="חישוב מלא מהנתונים הנוכחיים — פירוק מחיר, הערות ותוספות אוטומטיות נבנים יחד"
            className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {autoCalcBusy ? 'מחשב…' : 'חישוב אוטומטי'}
          </button>
          {/* Operational groups (Deal.groups) — group-aware base pricing. */}
          <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
            קבוצות
            <input
              value={ctx?.groupCount ?? 1}
              onChange={(e) => setGroups(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              title="מספר קבוצות (תפעולי) — הבסיס מוכפל בקבוצות והמשתתפים הכלולים נספרים לפי קבוצה"
              className="w-14 h-10 text-center rounded-lg border border-gray-200 px-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
          {/* Manual Pricing Card selection — automatic (org default) unless
              pinned. Same-tab duplicates carry a representative-price
              descriptor so genuine twins are distinguishable. */}
          {cardOptions.length >= 1 && (
            <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
              כרטיס תמחור
              <select
                value={ctx?.pinnedCardGroupId || ''}
                onChange={(e) => pickCard(e.target.value)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="">אוטומטי — לפי הארגון</option>
                {cardOptions.map((o) => (
                  <option key={o.cardGroupId} value={o.cardGroupId}>
                    {o.descriptor ? `${o.label} — ${o.descriptor}` : o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-2 ms-auto">
            <VatButton mode={orderVatMode} rate={vatDefault?.rate} onPick={setOrderVat} />
            <BuilderMenu
              disabled={!!historicalMode}
              hasLineVatOverrides={hasLineVatOverrides}
              lineControls={lineControls}
              onDealDiscount={openDealDiscount}
              onCommission={() => setCommissionOpen(true)}
              onToggleLineControls={() => setLineControls((v) => !v)}
              onResetLineVat={resetLineVat}
            />
          </div>
        </div>

        {/* Column labels */}
        <div>
          <div className="flex items-center gap-3 px-3 pb-2 text-[12px] font-medium text-gray-400">
            <span className="w-5 shrink-0" aria-hidden />
            <span className="w-10 shrink-0" aria-hidden />
            <span className="flex-1 min-w-[12rem]">מוצר</span>
            <span className="w-32 shrink-0 text-center">מחיר</span>
            <span className="w-20 shrink-0 text-center">כמות</span>
            <span className="w-44 shrink-0">סה״כ שורה</span>
            <span className="w-9 shrink-0" aria-hidden />
            <span className="w-9 shrink-0" aria-hidden />
            <span className="w-9 shrink-0" aria-hidden />
          </div>

          {/* Lines — generous working canvas. */}
          <div className="rounded-xl border border-gray-200 p-3 min-h-[200px]">
            <ReorderableList
              items={lines}
              onReorder={onReorder}
              emptyText="אין שורות. הוסיפו שורה כדי לבנות את המחיר."
              renderRow={(line, { handle }) => (
                <LineRow
                  line={line}
                  computed={computedById.get(line.id)}
                  computedDiscount={computedById.get(`${line.id}:discount`)}
                  products={products}
                  addons={addons}
                  defaultProductId={ctx?.productId || null}
                  noteOpen={openNotes.has(line.id)}
                  free={freeRows.has(line.id)}
                  handle={handle}
                  menuEnabled={lineControls && !historicalMode}
                  onChange={(patch) => updateLine(line.id, patch)}
                  onToggleNote={() => toggleNote(line.id)}
                  onRemove={() => removeLine(line.id)}
                  onSetFree={(on) => setFree(line.id, on)}
                  onPickProduct={(p) => pickProduct(line.id, p)}
                  onDiscount={() => setDiscountFor(line.id)}
                  onRemoveDiscount={() => removeLineDiscount(line.id)}
                />
              )}
            />
          </div>
        </div>

        {/* Add row — right side. */}
        <div className="flex">
          <button
            type="button"
            onClick={addLine}
            className="text-sm font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-4 py-2 hover:bg-blue-100"
          >
            + הוסף שורה
          </button>
        </div>

        <div className="flex-1" />

        {/* Bottom — payment (right) and totals (left). The simulator has no Deal,
            so payment terms are not shown there at all. */}
        <div className="flex flex-wrap items-start justify-between gap-8 pt-4 border-t border-gray-100">
          {simulated ? (
            <div />
          ) : (
          <div className="w-72 space-y-3 pt-2">
            {skipDealTermsWrite ? (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-500 ring-1 ring-gray-200">
                תנאי ואמצעי התשלום נקבעים ברמת העסקה (בבונה המחיר של ההצעה הראשית) וחלים על כל ההצעות.
              </p>
            ) : (
              <>
                <Field label="תנאי תשלום">
                  <select value={paymentTermId} onChange={(e) => pickTerm(e.target.value)} className={FIELD}>
                    <option value="">— ללא —</option>
                    {terms.map((t) => (<option key={t.id} value={t.id}>{t.nameHe}</option>))}
                  </select>
                </Field>
                <Field label="אמצעי תשלום">
                  <select value={paymentMethodId} onChange={(e) => pickMethod(e.target.value)} className={FIELD}>
                    <option value="">— ללא —</option>
                    {methods.map((m) => (<option key={m.id} value={m.id}>{m.nameHe}</option>))}
                  </select>
                </Field>
              </>
            )}
          </div>
          )}

          {/* Summary. The Deal Discount section is OPT-IN (⋯ → "הוסף הנחה
              לעסקה") — a clean Builder shows only סכום ביניים/מע״מ/סה"כ. When
              present: mode (% / ₪) + value, resolved server-side; ✕ clears the
              intent, restores the totals and hides the section. */}
          <div className="min-w-[21rem] space-y-2 text-[15px] pt-2">
            {(() => {
              const dd = (computed?.lines || []).find((l) => l.sourceKind === 'deal_discount') || null;
              return (
                <>
                  <TotalRow
                    label="סכום ביניים"
                    minor={totals != null ? totals.netMinor - (dd?.netMinor || 0) : undefined}
                  />
                  {showDealDiscount && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-gray-500">
                        <button
                          type="button"
                          onClick={closeDealDiscount}
                          disabled={!!historicalMode}
                          title="הסרת ההנחה מהעסקה"
                          className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                        >
                          ✕
                        </button>
                        הנחה לעסקה
                        <span className="flex rounded-md border border-gray-200 p-0.5 text-[11.5px] font-medium">
                          {[{ k: 'percent', l: '%' }, { k: 'fixed', l: '₪' }].map((o) => (
                            <button
                              key={o.k}
                              type="button"
                              disabled={!!historicalMode}
                              onClick={() => setDealDiscount((d) => (d.mode === o.k ? d : { mode: o.k, value: '' }))}
                              className={`w-7 rounded px-1 py-0.5 ${
                                dealDiscount.mode === o.k ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {o.l}
                            </button>
                          ))}
                        </span>
                        <input
                          ref={dealDiscountInputRef}
                          value={dealDiscount.value}
                          disabled={!!historicalMode}
                          onChange={(e) =>
                            setDealDiscount((d) => ({ ...d, value: e.target.value.replace(/[^0-9.]/g, '') }))
                          }
                          inputMode="decimal"
                          dir="ltr"
                          placeholder={dealDiscount.mode === 'percent' ? '0' : '0.00'}
                          aria-label="הנחה לעסקה"
                          className="h-8 w-20 rounded-md border border-gray-200 px-2 text-left text-[13.5px] focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50"
                        />
                      </span>
                      <span dir="ltr" className={`tabular-nums ${dd ? 'font-medium text-red-600' : 'text-gray-300'}`}>
                        {dd ? formatMinor(dd.netMinor) : '—'}
                      </span>
                    </div>
                  )}
                  <TotalRow label={`מע״מ${vatDefault?.rate ? ` (${vatDefault.rate}%)` : ''}`} minor={totals?.vatMinor} />
                  <div className="border-t border-gray-100 pt-2">
                    <TotalRow label='סה"כ' minor={totals?.grossMinor} strong />
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <DiscountDialog
        open={!!discountFor}
        targetLabel={discountTarget?.label || ''}
        baseMinor={discountBaseMinor}
        initialPercent={discountTarget?.discountPercent ?? null}
        initialFixedMinor={discountTarget?.discountFixedMinor ?? null}
        onApply={applyLineDiscount}
        onClose={() => setDiscountFor(null)}
      />
      <CommissionDialog
        open={commissionOpen}
        baseMinor={commissionBaseMinor}
        onApply={applyCommission}
        onClose={() => setCommissionOpen(false)}
      />
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || 'עריכת מחיר'}
      size="2xl"
      footer={
        simulated ? (
          <>
            <button type="button" onClick={onReset} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
              איפוס סימולטור
            </button>
            <button type="button" onClick={onClose} className="bg-blue-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-blue-700">
              סגור
            </button>
          </>
        ) : (
          historicalMode ? (
            // A frozen record cannot be saved over — but it is never a dead
            // end: the explicit action seeds a working copy and unlocks.
            <>
              <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
                סגור
              </button>
              <button
                type="button"
                onClick={startEditing}
                disabled={startEditBusy}
                className="bg-amber-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-amber-700 disabled:opacity-50"
              >
                {startEditBusy ? 'פותח…' : 'פתח לעריכה'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
                ביטול
              </button>
              <button onClick={save} disabled={saving} className="bg-emerald-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'שומר…' : 'שמור וסגור'}
              </button>
            </>
          )
        )
      }
    >
      {body}
    </Dialog>
  );
}

const FIELD = 'w-full h-10 rounded-md border border-gray-300 px-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';

function LineRow({ line, computed, computedDiscount, products, addons, defaultProductId, noteOpen, free, handle, menuEnabled, onChange, onToggleNote, onRemove, onSetFree, onPickProduct, onDiscount, onRemoveDiscount }) {
  const isProduct = line.kind === 'product';
  const isAddon = line.kind === 'addon';
  const disabled = !line.active;
  // Product price comes from the engine (per-unit base) until manually overridden.
  const unitMinor = isProduct && !line.overridden && computed ? computed.unitPriceMinor : line.unitPriceMinor;
  const qty = Number.isFinite(parseInt(line.quantity, 10)) ? parseInt(line.quantity, 10) : 1;
  // Same signed echo as every other surface (shared/lineMath.mjs) — a discount
  // row must display negative here exactly as the server totals it.
  const sign = lineSign(line.kind);
  const lineTotalMinor = sign * (Number(unitMinor) || 0) * (qty || 0);
  const negative = lineTotalMinor < 0;
  // Deliberate per-line VAT override (the ⋮ menu) — visibly badged so it can
  // never disagree silently with the order's toolbar mode.
  const vatOverride = line.vatMode && line.vatMode !== 'inherit' ? line.vatMode : null;
  // Per-line discount intent — ALWAYS badged on the row (even when the ⋮
  // controls are hidden), so differing pricing is never silently invisible.
  const hasDiscount = line.discountPercent != null || line.discountFixedMinor != null;
  const discountChip = hasDiscount
    ? line.discountPercent != null
      ? `הנחה ${line.discountPercent}%${computedDiscount ? ` (${formatMinor(computedDiscount.netMinor)})` : ''}`
      : `הנחה ${formatMinor(-(Number(line.discountFixedMinor) || 0))}`
    : null;

  // Engine-GENERATED computed lines (the "משתתפים נוספים" breakdown line, an
  // auto שבת/חג surcharge) are NOT catalog items and must NEVER become editable
  // free-text rows — they render as a standard pricing line with a read-only
  // label. Regeneration owns them; the item picker/free-text is only for real
  // manually-created rows. (The product line keeps its normal product picker.)
  const generated =
    line.sourceKind === 'price_rule_extra' || line.sourceKind === 'price_rule_addon';

  // CANONICAL LABELED rows — structured pricing lines whose identity is their
  // frozen label rather than a catalog ref (agent-reservation base/extra/
  // surcharge lines, group-ticket rows, …): any non-generated row carrying a
  // structured sourceKind + a label, unless it's an addon already matched to a
  // catalog item. The row's item dropdown DISPLAYS the canonical label as its
  // selected value ("▼ תוספת שפה", "▼ משתתף נוסף") and the user may re-pick a
  // catalog item / free text to re-type the row. A canonical row must NEVER
  // render as a "טקסט חופשי" row with an inner input, and never as an empty
  // "בחר פריט" picker that hides its label.
  const canonicalLabeled =
    !generated && !free && !!line.sourceKind && !!line.label && !(isAddon && line.refId);

  // Item dropdown value: addon → a:<id>, canonical labeled → __label__,
  // product (by label or product-line default) → p:<id>, free-text → __free__,
  // else empty.
  const matchedProduct = products.find((p) => p.nameHe === line.label);
  const freeMode =
    !generated &&
    !canonicalLabeled &&
    (free || (!isAddon && !matchedProduct && !!line.label && !(isProduct && !line.label)));
  let selectValue = '';
  if (isAddon && line.refId) selectValue = `a:${line.refId}`;
  else if (canonicalLabeled) selectValue = '__label__';
  else if (freeMode) selectValue = '__free__';
  else if (matchedProduct) selectValue = `p:${matchedProduct.id}`;
  else if (isProduct && defaultProductId && products.some((p) => p.id === defaultProductId)) selectValue = `p:${defaultProductId}`;

  function onPickItem(v) {
    if (v === '__label__') return; // the row's own canonical label — no-op
    if (v === '') {
      onSetFree(false);
      onChange({ label: '', refId: null, kind: isProduct ? 'product' : 'manual' });
    } else if (v === '__free__') {
      onSetFree(true);
      if (isAddon) onChange({ kind: 'manual', refId: null });
    } else if (v.startsWith('p:')) {
      onSetFree(false);
      const p = products.find((x) => x.id === v.slice(2));
      // Delegates to the dialog-level single-primary handler: replaces the
      // existing primary product line (or promotes this row when none exists) —
      // never adds a second product line.
      onPickProduct(p || null);
    } else if (v.startsWith('a:')) {
      onSetFree(false);
      const a = addons.find((x) => x.id === v.slice(2));
      onChange({ kind: 'addon', refId: a?.id || null, label: a?.nameHe || '', unitPriceMinor: a ? Number(a.defaultPriceMinor) || 0 : 0, overridden: false });
    }
  }

  const showRevert = isProduct && line.overridden;

  return (
    <div className={`px-3 py-2.5 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Right: drag handle + active toggle */}
        <span className="w-5 shrink-0 flex justify-center">{handle}</span>
        <Toggle checked={line.active} onChange={(v) => onChange({ active: v })} />

        {/* Center: item (product/addon dropdown), price, quantity. Generated
            computed lines show a read-only label in the SAME full-width cell —
            standard pricing-line layout, no item picker, no free-text control. */}
        <div className="flex-1 min-w-[12rem] flex items-center gap-2">
          {generated ? (
            <div className={`${CELL} flex-1 flex items-center bg-gray-50 text-gray-700`}>
              <span className="truncate">{line.label}</span>
            </div>
          ) : (
            <>
              <select
                value={selectValue}
                disabled={disabled}
                onChange={(e) => onPickItem(e.target.value)}
                className={`${CELL} ${freeMode ? 'w-44' : 'flex-1'}`}
              >
                {/* Canonical labeled row: its OWN frozen label is the selected
                    value — the row reads as its real pricing type, never as an
                    empty picker or a free-text row. Picking another option
                    re-types the row as usual. */}
                {canonicalLabeled && <option value="__label__">{line.label}</option>}
                <option value="">— בחר פריט —</option>
                <optgroup label="מוצרים">
                  {products.map((p) => (<option key={p.id} value={`p:${p.id}`}>{p.nameHe}</option>))}
                </optgroup>
                <optgroup label="תוספות">
                  {addons.map((a) => (<option key={a.id} value={`a:${a.id}`}>{a.nameHe}</option>))}
                </optgroup>
                <option value="__free__">— טקסט חופשי —</option>
              </select>
              {freeMode && (
                <input
                  value={line.label}
                  disabled={disabled}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="תיאור"
                  className={`${CELL} flex-1`}
                />
              )}
            </>
          )}
        </div>

        <div className="relative w-32 shrink-0">
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">₪</span>
          <input
            value={minorToInput(unitMinor)}
            disabled={disabled}
            onChange={(e) => onChange({ unitPriceMinor: toMinor(e.target.value) ?? 0, ...(isProduct ? { overridden: true } : {}) })}
            inputMode="decimal"
            dir="ltr"
            className={`w-full pr-6 text-left ${showRevert ? 'pl-6' : ''} ${CELL} ${(Number(unitMinor) || 0) < 0 ? 'text-red-600' : ''}`}
          />
          {showRevert && (
            <button
              type="button"
              onClick={() => onChange({ overridden: false })}
              title="חזרה למחיר מהמחירון"
              className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 hover:text-gray-700"
            >
              ↺
            </button>
          )}
        </div>
        <input
          value={line.quantity}
          disabled={disabled}
          onChange={(e) => onChange({ quantity: e.target.value.replace(/[^0-9]/g, '') })}
          inputMode="numeric"
          dir="ltr"
          title="כמות"
          className={`w-20 shrink-0 text-center ${CELL}`}
        />

        {/* Line total */}
        <div className={`w-44 shrink-0 text-[13px] ${negative ? 'text-red-600' : 'text-gray-600'}`}>
          <div dir="ltr">
            <span className="text-gray-400">{sign < 0 ? '−' : ''}{minorToInput(unitMinor) || 0} × {qty || 0} = </span>
            <span className="font-semibold">{formatMinor(lineTotalMinor)}</span>
          </div>
          {vatOverride && (
            <div className="text-[10.5px] font-medium text-blue-600">מע״מ: {lineVatLabel(vatOverride)}</div>
          )}
          {discountChip && (
            <div dir="rtl" className="text-[10.5px] font-medium text-red-600">{discountChip}</div>
          )}
        </div>

        {/* Left: row menu + note toggle + delete (every row is deletable) */}
        <LineKebab
          line={line}
          generated={generated}
          enabled={menuEnabled}
          onDiscount={onDiscount}
          onRemoveDiscount={onRemoveDiscount}
          onVat={(mode) => onChange(mode === 'inherit' ? { vatMode: 'inherit', vatRate: null } : { vatMode: mode })}
        />
        <NoteIcon open={noteOpen} onClick={onToggleNote} />
        <button type="button" onClick={onRemove} title="מחק שורה" className="w-9 shrink-0 flex justify-center text-gray-300 hover:text-red-600">
          <TrashIcon />
        </button>
      </div>

      {noteOpen && (
        <div className="mt-2.5 ps-11 pe-2">
          <RichEditor
            value={line.note}
            onChange={(html) => onChange({ note: html })}
            preset="note"
            toolbar="lite"
            collapsible
            maxHeight="200px"
            ariaLabel="הערה לשורה"
            placeholder="הערה לשורה…"
          />
        </div>
      )}
    </div>
  );
}

// The VAT-mode menu renders through the shared AnchoredMenu portal: the Builder
// is a Dialog whose content area scrolls (`overflow-y-auto`), so an in-flow
// `absolute` panel on a line near the bottom was cut off by it.
function VatButton({ mode, rate, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <div>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        {vatLabel(mode)}{rate && mode !== 'exempt' ? <span className="text-gray-400">({rate}%)</span> : null}
        <span className="text-[9px] text-gray-400">▼</span>
      </button>
      <AnchoredMenu
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        width={224}
        align="start"
      >
        {VAT_OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => { onPick(o.mode); setOpen(false); }}
            className={`w-full text-right px-3 py-2 text-sm hover:bg-gray-50 ${mode === o.mode ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
          >
            {o.label}
          </button>
        ))}
      </AnchoredMenu>
    </div>
  );
}

// The Builder's "⋯" toolbar menu — the Builder-level actions (portal-anchored,
// same pattern as the VAT menu beside it): reveal the opt-in Deal-Discount
// section, add a commission line, toggle the per-row control menus, release
// every per-line VAT override.
function BuilderMenu({ disabled, hasLineVatOverrides, lineControls, onDealDiscount, onCommission, onToggleLineControls, onResetLineVat }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const item = (label, onClick, itemDisabled = false) => (
    <button
      type="button"
      disabled={itemDisabled}
      onClick={() => { setOpen(false); onClick(); }}
      className="w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
  return (
    <div>
      <button
        ref={ref}
        type="button"
        title="פעולות בונה המחיר"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-lg leading-none disabled:opacity-40"
      >
        ⋯
      </button>
      <AnchoredMenu anchorRef={ref} open={open} onClose={() => setOpen(false)} width={256} align="start">
        {item('הוסף הנחה לעסקה', onDealDiscount)}
        {item('עמלה…', onCommission)}
        <div className="border-t border-gray-100" />
        {/* Pure UI toggle — showing/hiding the row ⋮ menus never touches data. */}
        {item(`${lineControls ? '✓ ' : ''}שליטה על כל שורה בנפרד`, onToggleLineControls)}
        {item('אפס עקיפות מע״מ בשורות', onResetLineVat, !hasLineVatOverrides)}
      </AnchoredMenu>
    </div>
  );
}

// Per-row "⋮" menu (shown only in "שליטה על כל שורה בנפרד" mode): line
// discount add/edit/remove + the line's own VAT mode. Generated (engine-
// rebuilt) rows hide the VAT override — regeneration would silently drop it;
// their VAT follows the order/card like the calculation that made them.
function LineKebab({ line, generated, enabled, onDiscount, onRemoveDiscount, onVat }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = line.vatMode || 'inherit';
  const hasDiscount = line.discountPercent != null || line.discountFixedMinor != null;
  if (!enabled) return <span className="w-9 shrink-0" aria-hidden />;
  const item = (label, onClick, cls = 'text-gray-700') => (
    <button
      type="button"
      onClick={() => { setOpen(false); onClick(); }}
      className={`w-full text-right px-3 py-2 text-sm hover:bg-gray-50 ${cls}`}
    >
      {label}
    </button>
  );
  return (
    <div className="w-9 shrink-0 flex justify-center">
      <button
        ref={ref}
        type="button"
        title="פעולות שורה"
        onClick={() => setOpen((v) => !v)}
        className={`p-1 rounded text-lg leading-none ${current !== 'inherit' || hasDiscount ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
      >
        ⋮
      </button>
      <AnchoredMenu anchorRef={ref} open={open} onClose={() => setOpen(false)} width={232} align="start">
        {line.kind !== 'discount' && line.kind !== 'credit' && (
          <>
            {item(hasDiscount ? 'עריכת ההנחה על השורה…' : 'הנחה על שורה זו…', onDiscount)}
            {hasDiscount && item('הסר הנחה מהשורה', onRemoveDiscount, 'text-red-600')}
          </>
        )}
        {!generated && (
          <>
            <div className="border-t border-gray-100 px-3 pt-2 pb-1 text-[11px] font-medium text-gray-400">
              מע״מ לשורה
            </div>
            {LINE_VAT_OPTIONS.map((o) => (
              <button
                key={o.mode}
                type="button"
                onClick={() => { onVat(o.mode); setOpen(false); }}
                className={`w-full text-right px-3 py-2 text-sm hover:bg-gray-50 ${current === o.mode ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
              >
                {current === o.mode ? '✓ ' : ''}{o.label}
              </button>
            ))}
          </>
        )}
      </AnchoredMenu>
    </div>
  );
}

// Shared % / ₪ entry body for the two adjustment dialogs.
function PercentAmountFields({ mode, setMode, value, setValue, baseMinor, previewLabel, previewMinor, negative }) {
  return (
    <div className="space-y-3">
      <div className="flex rounded-lg border border-gray-200 p-0.5 text-sm">
        {[{ k: 'percent', l: 'אחוז (%)' }, { k: 'fixed', l: 'סכום (₪)' }].map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => { setMode(o.k); setValue(''); }}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${mode === o.k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {o.l}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
        autoFocus
        inputMode="decimal"
        dir="ltr"
        placeholder={mode === 'percent' ? 'למשל 10' : 'למשל 500'}
        className="w-full h-10 rounded-lg border border-gray-300 px-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600 space-y-0.5">
        {mode === 'percent' && (
          <div className="flex justify-between">
            <span>בסיס החישוב</span>
            <span dir="ltr" className="tabular-nums">{formatMinor(baseMinor)}</span>
          </div>
        )}
        <div className="flex justify-between font-medium text-gray-800">
          <span>{previewLabel}</span>
          <span dir="ltr" className="tabular-nums">
            {previewMinor > 0 ? `${negative ? '−' : '+'}${formatMinor(previewMinor)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// LINE-discount intent editor (the row ⋮ menu): sets discountPercent /
// discountFixedMinor ON the target line. The line's own price is untouched —
// the server compose materializes the resolved discount row under it, and
// "הסר הנחה מהשורה" clears the intent to restore the original exactly.
function DiscountDialog({ open, targetLabel, baseMinor, initialPercent, initialFixedMinor, onApply, onClose }) {
  const [mode, setMode] = useState('percent'); // 'percent' | 'fixed'
  const [value, setValue] = useState('');
  useEffect(() => {
    if (!open) return;
    if (initialPercent != null) { setMode('percent'); setValue(String(initialPercent)); }
    else if (initialFixedMinor != null) { setMode('fixed'); setValue(minorToInput(initialFixedMinor)); }
    else { setMode('percent'); setValue(''); }
  }, [open, initialPercent, initialFixedMinor]);
  const pct = parseFloat(value);
  const amountMinor =
    mode === 'percent'
      ? Number.isFinite(pct) && pct > 0
        ? Math.round((baseMinor * pct) / 100)
        : 0
      : toMinor(value) ?? 0;
  const valid = amountMinor > 0 && (mode !== 'percent' || pct <= 100);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`הנחה על ${targetLabel || 'השורה'}`}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            ביטול
          </button>
          <button
            type="button"
            onClick={() => valid && onApply(mode === 'percent' ? { pct } : { fixedMinor: amountMinor })}
            disabled={!valid}
            className="bg-blue-600 text-white text-sm font-semibold rounded-md px-5 py-1.5 disabled:opacity-50"
          >
            החל הנחה
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <PercentAmountFields
          mode={mode}
          setMode={setMode}
          value={value}
          setValue={setValue}
          baseMinor={baseMinor}
          previewLabel="סכום ההנחה"
          previewMinor={amountMinor}
          negative
        />
        <p className="text-[11.5px] leading-relaxed text-gray-400">
          מחיר השורה המקורי אינו משתנה — ההנחה מסומנת על השורה וניתן להסירה בכל רגע (⋮ → הסר הנחה מהשורה).
        </p>
      </div>
    </Dialog>
  );
}

// Commission (עמלה) — an ADDED CHARGE to the customer: a positive line that
// INCREASES the total and appears on documents as a normal charge row (the
// opposite sign of a discount, on purpose). A percentage is computed here once
// over the current builder total and frozen into the row.
function CommissionDialog({ open, baseMinor, onApply, onClose }) {
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) { setMode('percent'); setValue(''); }
  }, [open]);
  const pct = parseFloat(value);
  const amountMinor =
    mode === 'percent'
      ? Number.isFinite(pct) && pct > 0
        ? Math.round((baseMinor * pct) / 100)
        : 0
      : toMinor(value) ?? 0;
  const valid = amountMinor > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="עמלה"
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            ביטול
          </button>
          <button
            type="button"
            onClick={() => valid && onApply(mode === 'percent' ? { pct, amountMinor } : { amountMinor })}
            disabled={!valid}
            className="bg-blue-600 text-white text-sm font-semibold rounded-md px-5 py-1.5 disabled:opacity-50"
          >
            הוסף עמלה
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <PercentAmountFields
          mode={mode}
          setMode={setMode}
          value={value}
          setValue={setValue}
          baseMinor={baseMinor}
          previewLabel="סכום העמלה"
          previewMinor={amountMinor}
        />
        <p className="text-[11.5px] leading-relaxed text-gray-400">
          העמלה נוספת כשורת חיוב רגילה — היא מגדילה את הסכום לתשלום ומופיעה במסמכים ללקוח.
        </p>
      </div>
    </Dialog>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      dir="ltr"
      onClick={() => onChange(!checked)}
      title={checked ? 'פעיל' : 'מוחרג מהסכום'}
      className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function NoteIcon({ open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? 'הסתר הערה' : 'הערה'}
      className={`shrink-0 w-9 flex justify-center p-1 rounded ${open ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'}`}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill={open ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </button>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function TotalRow({ label, minor, strong }) {
  return (
    <div className="flex items-center justify-between gap-8">
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[20px] font-bold text-blue-700' : 'text-gray-700'}`} dir="ltr">
        {minor == null ? '—' : formatMinor(minor)}
      </span>
    </div>
  );
}
