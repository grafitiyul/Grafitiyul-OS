import { useEffect, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { api } from '../../lib/api.js';
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
    vatMode: l.vatMode || 'inherit',
    vatRate: l.vatRate ?? null,
    active: l.active !== false,
    note: l.note || '',
    overridden: !!l.overridden,
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
export default function PriceBuilderDialog({ open, deal, context, onClose, onSaved, title, headerExtra, skipDealTermsWrite = false }) {
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
  // Effective pricing context: starts from the Deal's context, then FOLLOWS the
  // product chosen on the first product line so the engine reprices live and the
  // saved Deal product matches it. One product value — the line drives the Deal.
  const [ctx, setCtx] = useState(context);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

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

  // Load working-version lines + payment fields on open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPaymentTermId(deal?.paymentTermId || '');
    setPaymentMethodId(deal?.paymentMethodId || '');
    setMethodOverridden(false);
    api.deals
      .getPriceLines(deal.id)
      .then(async (r) => {
        if (!live) return;
        const saved = Array.isArray(r?.lines) ? r.lines.map(normalize) : [];
        // Seed a default line ONLY for a brand-new working version. An existing
        // deal may legitimately have zero lines.
        let next = saved.length ? saved : r?.created ? [seedProductLine(context)] : [];

        // SSOT on open: the DEAL product is the source. The first product line must
        // reflect the CURRENT Deal product — it may have changed in the Tour Details
        // card since this version was last saved. We refresh that line's product
        // (label + variant) from the Deal; no duplicate product state is created and
        // the engine is untouched (it already prices via the effective context).
        if (context?.productId) {
          const dp = await api.products.get(context.productId).catch(() => null);
          if (live && dp) {
            const idx = next.findIndex((l) => l.kind === 'product');
            const name = dp.nameHe || '';
            if (idx === -1) {
              next = [normalize({ kind: 'product', label: name, refId: context.productVariantId || null }), ...next];
            } else {
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
  }, [open, deal?.id]);

  // Recompute totals + product price via the engine whenever lines change.
  useEffect(() => {
    if (!open || !lines.length) {
      setComputed(null);
      return undefined;
    }
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => {
      api.pricing
        .builder({ context: ctx, lines })
        .then((r) => setComputed(r))
        .catch((e) => setComputed({ ok: false, error: e.message }));
    }, 300);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
  }, [open, lines, ctx]);

  const computedById = new Map((computed?.lines || []).map((l) => [l.id, l]));
  const totals = computed?.totals;
  const vatDefault = computed?.vatDefault;
  const orderVatMode = lines.find((l) => l.vatMode && l.vatMode !== 'inherit')?.vatMode || vatDefault?.mode;

  function updateLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
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
  function setOrderVat(mode) {
    setLines((ls) => ls.map((l) => ({ ...l, vatMode: mode })));
  }
  function setFree(id, on) {
    setFreeRows((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
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
    setSaving(true);
    setSaveError(null);
    try {
      const toSave = lines.map((l) => {
        const c = computedById.get(l.id);
        if (l.kind === 'product' && !l.overridden && c) return { ...l, unitPriceMinor: c.unitPriceMinor };
        return l;
      });

      // SSOT: the effective context already followed the first product line's
      // product (incl. its variant + city). Persist that as the Deal product and the
      // builder TOTAL as the Deal value — one product value, one price. locationId is
      // sent only when a product change set it, so an unchanged product never churns
      // the Deal's city.
      await api.deals.savePriceLines(deal.id, {
        lines: toSave,
        valueMinor: totals ? totals.grossMinor : 0,
        productId: ctx?.productId || null,
        productVariantId: ctx?.productVariantId || null,
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || 'עריכת מחיר'}
      size="2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
            ביטול
          </button>
          <button onClick={save} disabled={saving} className="bg-emerald-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור וסגור'}
          </button>
        </>
      }
    >
      {headerExtra}
      <div className="space-y-7 px-2 py-2 min-h-[60vh] flex flex-col">
        {/* In-app save error (no native alert). */}
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            שמירה נכשלה: {saveError}
          </div>
        )}
        {/* Toolbar — VAT button then "⋯", pushed to the left in RTL. */}
        <div className="flex">
          <div className="flex items-center gap-2 ms-auto">
            <VatButton mode={orderVatMode} rate={vatDefault?.rate} onPick={setOrderVat} />
            <button
              type="button"
              title="הגדרות בונה המחיר — בקרוב"
              className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 text-lg leading-none"
            >
              ⋯
            </button>
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
                  products={products}
                  addons={addons}
                  defaultProductId={ctx?.productId || null}
                  noteOpen={openNotes.has(line.id)}
                  free={freeRows.has(line.id)}
                  handle={handle}
                  onChange={(patch) => updateLine(line.id, patch)}
                  onToggleNote={() => toggleNote(line.id)}
                  onRemove={() => removeLine(line.id)}
                  onSetFree={(on) => setFree(line.id, on)}
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

        {/* Bottom — payment (right) and totals (left). */}
        <div className="flex flex-wrap items-start justify-between gap-8 pt-4 border-t border-gray-100">
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

          <div className="min-w-[18rem] space-y-2 text-[15px] pt-2">
            <TotalRow label="סכום ביניים" minor={totals?.netMinor} />
            <TotalRow label={`מע״מ${vatDefault?.rate ? ` (${vatDefault.rate}%)` : ''}`} minor={totals?.vatMinor} />
            <div className="border-t border-gray-100 pt-2">
              <TotalRow label='סה"כ' minor={totals?.grossMinor} strong />
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const FIELD = 'w-full h-10 rounded-md border border-gray-300 px-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';

function LineRow({ line, computed, products, addons, defaultProductId, noteOpen, free, handle, onChange, onToggleNote, onRemove, onSetFree }) {
  const isProduct = line.kind === 'product';
  const isAddon = line.kind === 'addon';
  const disabled = !line.active;
  // Product price comes from the engine (per-unit base) until manually overridden.
  const unitMinor = isProduct && !line.overridden && computed ? computed.unitPriceMinor : line.unitPriceMinor;
  const qty = Number.isFinite(parseInt(line.quantity, 10)) ? parseInt(line.quantity, 10) : 1;
  const lineTotalMinor = (Number(unitMinor) || 0) * (qty || 0);
  const negative = lineTotalMinor < 0;

  // Item dropdown value: addon → a:<id>, product (by label or product-line default)
  // → p:<id>, free-text → __free__, else empty.
  const matchedProduct = products.find((p) => p.nameHe === line.label);
  const freeMode = free || (!isAddon && !matchedProduct && !!line.label && !(isProduct && !line.label));
  let selectValue = '';
  if (isAddon && line.refId) selectValue = `a:${line.refId}`;
  else if (freeMode) selectValue = '__free__';
  else if (matchedProduct) selectValue = `p:${matchedProduct.id}`;
  else if (isProduct && defaultProductId && products.some((p) => p.id === defaultProductId)) selectValue = `p:${defaultProductId}`;

  function onPickItem(v) {
    if (v === '') {
      onSetFree(false);
      onChange({ label: '', refId: null, kind: isProduct ? 'product' : 'manual' });
    } else if (v === '__free__') {
      onSetFree(true);
      if (isAddon) onChange({ kind: 'manual', refId: null });
    } else if (v.startsWith('p:')) {
      onSetFree(false);
      const p = products.find((x) => x.id === v.slice(2));
      onChange({ label: p?.nameHe || '', kind: isProduct ? 'product' : 'manual', refId: isProduct ? line.refId : null });
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

        {/* Center: item (product/addon dropdown), price, quantity */}
        <div className="flex-1 min-w-[12rem] flex items-center gap-2">
          <select
            value={selectValue}
            disabled={disabled}
            onChange={(e) => onPickItem(e.target.value)}
            className={`${CELL} ${freeMode ? 'w-44' : 'flex-1'}`}
          >
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
        <div className={`w-44 shrink-0 text-[13px] ${negative ? 'text-red-600' : 'text-gray-600'}`} dir="ltr">
          <span className="text-gray-400">{minorToInput(unitMinor) || 0} × {qty || 0} = </span>
          <span className="font-semibold">{formatMinor(lineTotalMinor)}</span>
        </div>

        {/* Left: note toggle + delete (every row is deletable) */}
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

function VatButton({ mode, rate, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        {vatLabel(mode)}{rate && mode !== 'exempt' ? <span className="text-gray-400">({rate}%)</span> : null}
        <span className="text-[9px] text-gray-400">▼</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
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
        </div>
      )}
    </div>
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
