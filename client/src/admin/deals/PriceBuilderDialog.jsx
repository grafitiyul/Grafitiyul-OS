import { useEffect, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';
import { PAYMENT_METHODS } from './config.js';

// Price Builder — a clean, document-style editor for a Deal's base pricing. It
// edits the working QuoteVersion's lines (canonical storage). This file is the
// UI/UX layer only: all money math runs in the engine via /api/pricing/builder,
// load/save go through /api/deals/:id/price-lines, and nothing here changes the
// schema, calculations, or quote workflow.

function vatLabel(mode) {
  if (mode === 'exempt') return 'פטור ממע״מ';
  if (mode === 'excluded') return 'מחירים לפני מע״מ';
  if (mode === 'included') return 'מחירים כולל מע״מ';
  return 'מע״מ';
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
function isRichEmpty(html) {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}

export default function PriceBuilderDialog({ open, deal, context, onClose, onSaved }) {
  const [lines, setLines] = useState([]);
  const [openNotes, setOpenNotes] = useState(() => new Set());
  const [computed, setComputed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const calcTimer = useRef(null);

  // Load the working version's lines + the deal's payment fields on open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPaymentTerms(deal?.paymentTerms || '');
    setPaymentMethod(deal?.paymentMethod || '');
    api.deals
      .getPriceLines(deal.id)
      .then((r) => {
        if (!live) return;
        const saved = Array.isArray(r?.lines) ? r.lines.map(normalize) : [];
        const next = saved.length
          ? saved.some((l) => l.kind === 'product')
            ? saved
            : [seedProductLine(context), ...saved]
          : [seedProductLine(context)];
        setLines(next);
        // Notes that already have content start open so they're not hidden.
        setOpenNotes(new Set(next.filter((l) => !isRichEmpty(l.note)).map((l) => l.id)));
      })
      .catch(() => {
        if (live) {
          setLines([seedProductLine(context)]);
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
        .builder({ context, lines })
        .then((r) => setComputed(r))
        .catch((e) => setComputed({ ok: false, error: e.message }))
        .finally(() => {});
    }, 300);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
  }, [open, lines, context]);

  const computedById = new Map((computed?.lines || []).map((l) => [l.id, l]));
  const totals = computed?.totals;
  const vatDefault = computed?.vatDefault;
  const res = computed?.productResolution;

  function updateLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id) {
    setLines((ls) => ls.filter((l) => l.id !== id));
    setOpenNotes((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }
  function addLine() {
    setLines((ls) => [...ls, normalize({ kind: 'manual', label: '' })]);
  }
  function toggleNote(id) {
    setOpenNotes((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function onReorder(ids) {
    setLines((ls) => ids.map((id) => ls.find((l) => l.id === id)).filter(Boolean));
  }

  async function save() {
    setSaving(true);
    try {
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
      // Payment fields live on the Deal — persist via the existing update API.
      await api.deals.update(deal.id, {
        paymentTerms: paymentTerms || null,
        paymentMethod: paymentMethod || null,
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
      title="עריכת מחיר"
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            ביטול
          </button>
          <button onClick={save} disabled={saving} className="bg-emerald-600 text-white text-sm font-semibold rounded-md px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור וסגור'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Toolbar — pushed to the left in RTL. */}
        <div className="flex">
          <div className="flex items-center gap-2 ms-auto">
            <button
              type="button"
              title="הגדרות בונה המחיר — בקרוב"
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 text-lg leading-none"
            >
              ⋯
            </button>
            <VatButton mode={vatDefault?.mode} rate={vatDefault?.rate} />
          </div>
        </div>

        {/* Conflict surfacing — only when the engine can't resolve a single rule.
            Keeps the user from a dead end without cluttering the clean layout. */}
        {res && !res.ok && res.error === 'ambiguous_price_rule' && res.conflictRules?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <div className="font-medium">נמצאו כללי תמחור סותרים — אפשר להזין מחיר ידני בינתיים:</div>
            <ul className="mt-1 space-y-0.5">
              {res.conflictRules.map((r) => (
                <li key={r.id}>
                  • {[r.scope.product, r.scope.location, r.scope.activityType, r.scope.organizationSubtype].filter(Boolean).join(' · ') || 'כלל כללי'} (עדיפות {r.priority})
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Lines */}
        <div className="rounded-xl border border-gray-200 p-1.5">
          <ReorderableList
            items={lines}
            onReorder={onReorder}
            emptyText="אין שורות. הוסיפו שורה כדי לבנות את המחיר."
            renderRow={(line, { handle }) => (
              <LineRow
                line={line}
                computed={computedById.get(line.id)}
                noteOpen={openNotes.has(line.id)}
                handle={handle}
                onChange={(patch) => updateLine(line.id, patch)}
                onToggleNote={() => toggleNote(line.id)}
                onRemove={() => removeLine(line.id)}
              />
            )}
          />
        </div>

        {/* Add row — right side. */}
        <div className="flex">
          <button
            type="button"
            onClick={addLine}
            className="text-[13px] font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-3 py-1.5 hover:bg-blue-100"
          >
            + הוסף שורה
          </button>
        </div>

        {/* Bottom — totals (right) and commercial fields (left), not stretched. */}
        <div className="flex flex-wrap items-start justify-between gap-6 pt-2">
          <div className="min-w-[16rem] space-y-1.5 text-sm">
            <TotalRow label="סכום ביניים" minor={totals?.netMinor} />
            <TotalRow label={`מע״מ${vatDefault?.rate ? ` (${vatDefault.rate}%)` : ''}`} minor={totals?.vatMinor} />
            <div className="border-t border-gray-100 pt-1.5">
              <TotalRow label='סה"כ' minor={totals?.grossMinor} strong />
            </div>
          </div>

          <div className="w-64 space-y-3">
            <Field label="אמצעי תשלום">
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={FIELD}>
                <option value="">— ללא —</option>
                {PAYMENT_METHODS.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
              </select>
            </Field>
            <Field label="תנאי תשלום">
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="שוטף + 30" className={FIELD} />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const FIELD = 'w-full h-9 rounded-md border border-gray-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';

function LineRow({ line, computed, noteOpen, handle, onChange, onToggleNote, onRemove }) {
  const isProduct = line.kind === 'product';
  const disabled = !line.active;
  // Product price comes from the engine until manually overridden.
  const shownMinor = isProduct && !line.overridden ? (computed ? computed.unitPriceMinor : line.unitPriceMinor) : line.unitPriceMinor;
  const negative = Number(shownMinor) < 0;
  const cellBase = 'h-9 rounded-md border border-gray-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <div className={`px-1.5 py-2 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        {/* Right: drag handle + active toggle */}
        {handle}
        <Toggle checked={line.active} onChange={(v) => onChange({ active: v })} />

        {/* Center: description, unit price, quantity */}
        <input
          value={line.label}
          disabled={disabled}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="תיאור"
          className={`flex-1 min-w-[8rem] ${cellBase}`}
        />
        <div className="relative shrink-0">
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">₪</span>
          <input
            value={isProduct && !line.overridden ? minorToInput(shownMinor) : minorToInput(line.unitPriceMinor)}
            disabled={disabled}
            onChange={(e) => onChange({ unitPriceMinor: toMinor(e.target.value) ?? 0, ...(isProduct ? { overridden: true } : {}) })}
            inputMode="decimal"
            dir="ltr"
            className={`w-32 pr-6 text-left ${cellBase} ${negative ? 'text-red-600' : ''}`}
          />
        </div>
        <input
          value={line.quantity}
          disabled={disabled}
          onChange={(e) => onChange({ quantity: e.target.value.replace(/[^0-9]/g, '') })}
          inputMode="numeric"
          dir="ltr"
          title="כמות"
          className={`w-16 text-center ${cellBase}`}
        />

        {/* Left: note toggle + delete */}
        <NoteIcon open={noteOpen} onClick={onToggleNote} />
        {isProduct && !line.overridden ? (
          <span className="w-8" aria-hidden />
        ) : isProduct ? (
          <button type="button" onClick={() => onChange({ overridden: false })} title="חזרה למחיר מהמחירון" className="text-gray-400 hover:text-gray-600 text-sm px-1">
            ↺
          </button>
        ) : (
          <button type="button" onClick={onRemove} title="מחק שורה" className="text-gray-300 hover:text-red-600 p-1">
            <TrashIcon />
          </button>
        )}
      </div>

      {noteOpen && (
        <div className="mt-2 ps-9 pe-2">
          <RichEditor
            value={line.note}
            onChange={(html) => onChange({ note: html })}
            toolbar="lite"
            collapsible
            maxHeight="180px"
            ariaLabel="הערה לשורה"
            placeholder="הערה לשורה…"
          />
        </div>
      )}
    </div>
  );
}

function VatButton({ mode, rate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const detail =
    mode === 'exempt'
      ? 'העסקה פטורה ממע״מ.'
      : mode === 'excluded'
        ? `המחירים הם לפני מע״מ${rate ? ` (${rate}%)` : ''}; המע״מ מתווסף בסה"כ.`
        : mode === 'included'
          ? `המחירים כוללים מע״מ${rate ? ` (${rate}%)` : ''}.`
          : 'מצב המע״מ נקבע לפי המחירון.';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 inline-flex items-center rounded-lg border border-gray-200 px-3 text-[13px] text-gray-700 hover:bg-gray-50"
      >
        {vatLabel(mode)}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 text-[12px] text-gray-600 shadow-lg">
          {detail}
          <div className="mt-1 text-[11px] text-gray-400">נקבע לפי המחירון (לקריאה בלבד).</div>
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function NoteIcon({ open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? 'הסתר הערה' : 'הערה'}
      className={`shrink-0 p-1 rounded ${open ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={open ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </button>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function TotalRow({ label, minor, strong }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[17px] font-bold text-blue-700' : 'text-gray-700'}`} dir="ltr">
        {minor == null ? '—' : formatMinor(minor)}
      </span>
    </div>
  );
}
