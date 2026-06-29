import { useEffect, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { minorToInput, toMinor } from '../../lib/money.js';

// Price Builder — the detailed, multi-line editor for a Deal's BASE pricing. It
// edits only the current deal (no quote versions yet). All money math runs in the
// engine via /api/pricing/builder; this component only collects lines and renders
// what the engine returns. The line shape is the future QuoteLine shape, so this
// becomes the Quote Builder later without a rewrite.

const VAT_MODES = [
  { key: 'inherit', label: 'ברירת מחדל' },
  { key: 'included', label: 'כולל מע״מ' },
  { key: 'excluded', label: 'לפני מע״מ' },
  { key: 'exempt', label: 'פטור' },
];
const KIND_LABELS = { product: 'מוצר', addon: 'תוסף', discount: 'הנחה', credit: 'זיכוי', manual: 'שורה' };
const PRICE_MODEL_LABELS = {
  per_head: 'לפי משתתף', tiered: 'מדורג', tiered_group: 'מדורג קבוצתי', fixed: 'מחיר קבוע', ticket_types: 'כרטיסים',
};
const PRICE_ERROR_LABELS = {
  no_product: 'בחרו מוצר ועיר בכרטיס "פרטי הסיור" כדי לחשב מחיר בסיס.',
  activity_type_required: 'בחרו סוג פעילות כדי לחשב מחיר.',
  no_price_list: 'לא הוגדר מחירון מתאים — אפשר להזין מחיר ידני.',
  no_price_rule: 'אין כלל תמחור מתאים למוצר/עיר/סוג פעילות — אפשר להזין מחיר ידני.',
  ambiguous_price_rule: 'נמצאו כללי תמחור סותרים (ראו פירוט למטה).',
  rule_incomplete: 'כלל התמחור חסר נתונים — אפשר להזין מחיר ידני.',
  activity_type_not_found: 'סוג הפעילות לא נמצא בקטלוג התמחור.',
};
const IN = 'h-9 rounded-md border border-gray-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';

function vatNote(mode, rate) {
  if (mode === 'exempt') return 'פטור ממע״מ';
  const r = rate ? ` ${rate}%` : '';
  return mode === 'excluded' ? `לפני מע״מ${r}` : `כולל מע״מ${r}`;
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
  return normalize({ kind: 'product', label: 'מחיר בסיס', refId: context?.productVariantId || null });
}

export default function PriceBuilderDialog({ open, deal, context, onClose, onSaved }) {
  const [lines, setLines] = useState([]);
  const [computed, setComputed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addons, setAddons] = useState([]);
  const calcTimer = useRef(null);

  // Load the working version's lines from the canonical store (QuoteVersion /
  // QuoteLine). The server ensures the working version exists.
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.deals
      .getPriceLines(deal.id)
      .then((r) => {
        if (!live) return;
        const saved = Array.isArray(r?.lines) ? r.lines.map(normalize) : [];
        if (saved.length) {
          setLines(saved.some((l) => l.kind === 'product') ? saved : [seedProductLine(context), ...saved]);
        } else {
          setLines([seedProductLine(context)]);
        }
      })
      .catch(() => {
        if (live) setLines([seedProductLine(context)]);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  useEffect(() => {
    if (open) api.addons.list().then(setAddons).catch(() => {});
  }, [open]);

  // Recompute via the engine whenever lines change (debounced). No client math.
  useEffect(() => {
    if (!open || !lines.length) {
      setComputed(null);
      return undefined;
    }
    if (calcTimer.current) clearTimeout(calcTimer.current);
    setLoading(true);
    calcTimer.current = setTimeout(() => {
      api.pricing
        .builder({ context, lines })
        .then((r) => setComputed(r))
        .catch((e) => setComputed({ ok: false, error: e.message }))
        .finally(() => setLoading(false));
    }, 300);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
  }, [open, lines, context]);

  function updateLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id) {
    setLines((ls) => ls.filter((l) => l.id !== id));
  }
  function addLine(kind) {
    setLines((ls) => [...ls, normalize({ kind, label: '' })]);
  }

  const computedById = new Map((computed?.lines || []).map((l) => [l.id, l]));
  const res = computed?.productResolution;
  const totals = computed?.totals;

  async function save() {
    setSaving(true);
    try {
      // Bake the engine's product unit price into the saved snapshot so reopening
      // shows the same number it was saved with (frozen until an explicit recompute).
      const toSave = lines.map((l) => {
        const c = computedById.get(l.id);
        if (l.kind === 'product' && !l.overridden && c) return { ...l, unitPriceMinor: c.unitPriceMinor };
        return l;
      });
      await api.deals.savePriceLines(deal.id, {
        lines: toSave,
        valueMinor: totals ? totals.grossMinor : 0,
        productId: context?.productId || null,
        productVariantId: context?.productVariantId || null,
      });
      await onSaved?.();
      onClose?.();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="בונה מחיר"
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            סגור
          </button>
          <button onClick={save} disabled={saving} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור תמחור'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Pricing explanation / conflict — the builder is where pricing is explained. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-[12px]">
          {loading && !res ? (
            <span className="text-gray-400">מחשב…</span>
          ) : res?.ok ? (
            <span className="text-blue-700">
              מחירון: <strong>{res.priceList?.nameHe || '—'}</strong> · מודל: {PRICE_MODEL_LABELS[res.priceModel] || res.priceModel} · {vatNote(res.vatMode, res.vatRate)}
            </span>
          ) : res ? (
            <div className="text-amber-700">
              <div>{PRICE_ERROR_LABELS[res.error] || 'לא נמצא מחיר אוטומטי — אפשר להזין מחיר ידני.'}</div>
              {res.conflictRules?.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
                  {res.conflictRules.map((r) => (
                    <li key={r.id}>
                      • {[r.scope.product, r.scope.location, r.scope.activityType, r.scope.organizationSubtype].filter(Boolean).join(' · ') || 'כלל כללי'}
                      {' '}— {PRICE_MODEL_LABELS[r.priceModel] || r.priceModel} (עדיפות {r.priority})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>

        {/* Lines */}
        <div className="space-y-2">
          {lines.map((l) => (
            <BuilderLine
              key={l.id}
              line={l}
              computed={computedById.get(l.id)}
              addons={addons}
              onChange={(patch) => updateLine(l.id, patch)}
              onRemove={() => removeLine(l.id)}
            />
          ))}
        </div>

        {/* Add line */}
        <div className="flex flex-wrap gap-2 pt-1">
          <AddBtn onClick={() => addLine('addon')}>+ תוסף</AddBtn>
          <AddBtn onClick={() => addLine('discount')}>+ הנחה</AddBtn>
          <AddBtn onClick={() => addLine('credit')}>+ זיכוי</AddBtn>
          <AddBtn onClick={() => addLine('manual')}>+ שורה חופשית</AddBtn>
        </div>

        {/* Totals */}
        <div className="rounded-lg border border-gray-200 p-3 space-y-1 text-sm">
          <TotalRow label="סכום ביניים (לפני מע״מ)" minor={totals?.netMinor} />
          <TotalRow label="מע״מ" minor={totals?.vatMinor} />
          <div className="border-t border-gray-100 pt-1">
            <TotalRow label="סה״כ כולל מע״מ" minor={totals?.grossMinor} strong />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function BuilderLine({ line, computed, addons, onChange, onRemove }) {
  const isProduct = line.kind === 'product';
  const gross = computed?.grossMinor;
  return (
    <div className={`rounded-lg border p-2.5 ${line.active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] rounded bg-gray-100 text-gray-500 px-1.5 py-0.5 shrink-0">{KIND_LABELS[line.kind]}</span>

        {/* Label / item selector */}
        {line.kind === 'addon' ? (
          <select
            value={line.refId || ''}
            onChange={(e) => {
              const a = addons.find((x) => x.id === e.target.value);
              onChange({ refId: e.target.value || null, label: a?.nameHe || '', unitPriceMinor: a ? Number(a.defaultPriceMinor) : line.unitPriceMinor, vatMode: a?.vatMode || 'inherit' });
            }}
            className={`${IN} flex-1 min-w-[8rem]`}
          >
            <option value="">— בחר תוסף —</option>
            {addons.map((a) => (<option key={a.id} value={a.id}>{a.nameHe}</option>))}
          </select>
        ) : isProduct ? (
          <span className="flex-1 min-w-[8rem] text-sm font-medium text-gray-800">{line.label || 'מחיר בסיס'}</span>
        ) : (
          <input
            value={line.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={line.kind === 'discount' ? 'תיאור ההנחה' : line.kind === 'credit' ? 'תיאור הזיכוי' : 'תיאור'}
            className={`${IN} flex-1 min-w-[8rem]`}
          />
        )}

        {/* Quantity (not for product) */}
        {!isProduct && (
          <input
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value.replace(/[^0-9]/g, '') })}
            inputMode="numeric"
            dir="ltr"
            title="כמות"
            className={`${IN} w-14 text-center`}
          />
        )}

        {/* Unit price */}
        {isProduct && !line.overridden ? (
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold tabular-nums" dir="ltr">₪{minorToInput(gross ?? line.unitPriceMinor)}</span>
            <button type="button" onClick={() => onChange({ overridden: true, unitPriceMinor: gross ?? line.unitPriceMinor })}
              className="text-[11px] text-gray-500 hover:text-gray-700 hover:underline">ערוך</button>
          </div>
        ) : (
          <input
            value={minorToInput(line.unitPriceMinor)}
            onChange={(e) => onChange({ unitPriceMinor: toMinor(e.target.value) ?? 0, ...(isProduct ? { overridden: true } : {}) })}
            inputMode="decimal"
            dir="ltr"
            title="מחיר ליחידה"
            className={`${IN} w-24 text-left`}
          />
        )}

        {/* VAT mode */}
        <select value={line.vatMode} onChange={(e) => onChange({ vatMode: e.target.value })} title="מע״מ" className={`${IN} w-28`}>
          {VAT_MODES.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
        </select>

        {/* Active toggle */}
        <label className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0" title="פעיל / מוחרג מהסכום">
          <input type="checkbox" checked={line.active} onChange={(e) => onChange({ active: e.target.checked })} />
          פעיל
        </label>

        {/* Line total */}
        <span className="ms-auto text-sm tabular-nums text-gray-700 min-w-[5rem] text-left" dir="ltr">
          {computed ? `₪${minorToInput(gross)}` : '—'}
        </span>

        {/* Remove (not product) */}
        {isProduct ? (
          line.overridden && (
            <button type="button" onClick={() => onChange({ overridden: false })} title="חזרה למחיר מהמחירון"
              className="text-[11px] text-gray-500 hover:text-gray-700 hover:underline">↺ מקור</button>
          )
        ) : (
          <button type="button" onClick={onRemove} className="text-red-500 hover:text-red-700 text-sm leading-none px-1" title="הסר שורה">✕</button>
        )}
      </div>

      {/* Optional note */}
      <input
        value={line.note}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder="הערה (אופציונלי)"
        className="mt-1.5 w-full h-7 rounded-md border border-gray-200 px-2 text-[12px] text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-200"
      />
    </div>
  );
}

function AddBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] text-blue-700 border border-blue-200 bg-blue-50 rounded-md px-2.5 py-1 hover:bg-blue-100">
      {children}
    </button>
  );
}

function TotalRow({ label, minor, strong }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[15px] font-bold text-gray-900' : 'text-gray-700'}`} dir="ltr">
        ₪{minor == null ? '—' : minorToInput(minor)}
      </span>
    </div>
  );
}
