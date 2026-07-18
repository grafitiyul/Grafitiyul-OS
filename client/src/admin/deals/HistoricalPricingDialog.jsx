import { useEffect, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import RichText from '../../editor/RichText.jsx';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput } from '../../lib/money.js';
import { historicalLineTotalMinor, reconciliationNote } from './historicalPricing.js';

// READ-ONLY viewer for a deal's frozen historical commercial breakdown (lines
// migrated from Pipedrive). It deliberately mirrors the Price Builder's look —
// same column layout, same money formatting — but is display-only: there is NO
// working-version load, NO autoCalc, NO save, NO editable control. It never
// calls PUT /price-lines. Totals are rendered via the PURE-READ engine endpoint
// (POST /api/pricing/builder persists nothing), with a client-side sum fallback.

function StaticCell({ children, className = '', dir }) {
  return (
    <div
      dir={dir}
      className={`h-10 rounded-md border border-gray-200 bg-gray-50 px-2.5 text-sm text-gray-700 flex items-center ${className}`}
    >
      {children}
    </div>
  );
}

function HistoricalRow({ line }) {
  const inactive = line.active === false;
  const parsedQty = Number.parseInt(line.quantity, 10);
  const qty = Number.isFinite(parsedQty) ? parsedQty : 1;
  const unitMinor = Number(line.unitPriceMinor) || 0;
  const lineTotalMinor = unitMinor * qty;
  const negative = lineTotalMinor < 0;
  const hasNote = !!(line.note && line.note.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, ''));

  return (
    <div className={`px-3 py-2.5 ${inactive ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Label (product / manual / discount description) */}
        <div className="flex-1 min-w-[12rem]">
          <StaticCell className="w-full">
            <span className="truncate">{line.label || '—'}</span>
            {inactive && <span className="ms-2 shrink-0 text-[11px] text-gray-400">(מוחרג)</span>}
          </StaticCell>
        </div>

        {/* Unit price */}
        <div className="w-32 shrink-0">
          <StaticCell dir="ltr" className={`justify-end ${unitMinor < 0 ? 'text-red-600' : ''}`}>
            {minorToInput(unitMinor)} ₪
          </StaticCell>
        </div>

        {/* Quantity */}
        <div className="w-20 shrink-0">
          <StaticCell dir="ltr" className="justify-center">{qty}</StaticCell>
        </div>

        {/* Line total */}
        <div className={`w-44 shrink-0 text-[13px] ${negative ? 'text-red-600' : 'text-gray-600'}`} dir="ltr">
          <span className="text-gray-400">{minorToInput(unitMinor) || 0} × {qty} = </span>
          <span className="font-semibold">{formatMinor(lineTotalMinor)}</span>
        </div>
      </div>

      {hasNote && (
        <div className="mt-2 ps-3 pe-2">
          <RichText html={line.note} tight />
        </div>
      )}
    </div>
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

export default function HistoricalPricingDialog({ open, data, onClose }) {
  const lines = data?.lines || [];
  const clientTotalMinor = historicalLineTotalMinor(lines);
  const note = reconciliationNote(data?.reconciliation);
  // Engine-computed net/vat/gross for display only. POST /api/pricing/builder is
  // a pure read (persists nothing); if it errors we fall back to the client-side
  // gross sum. `computed` is never written back anywhere.
  const [computed, setComputed] = useState(null);

  useEffect(() => {
    if (!open || !lines.length) {
      setComputed(null);
      return undefined;
    }
    let live = true;
    api.pricing
      .builder({ context: {}, lines })
      .then((r) => { if (live) setComputed(r?.ok === false ? null : r); })
      .catch(() => { if (live) setComputed(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data?.versionId]);

  if (!open) return null;

  const totals = computed?.totals;
  const vatRate = computed?.vatDefault?.rate;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="פירוט מסחרי היסטורי (מערכת קודמת)"
      size="2xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="bg-blue-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-blue-700"
        >
          סגור
        </button>
      }
    >
      <div className="space-y-6 px-2 py-2">
        {/* Prominent read-only banner. */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
            <span aria-hidden>🗄️</span>
            פירוט מסחרי היסטורי שיובא מפייפדרייב
          </div>
          <p className="mt-1 text-[12px] text-amber-700">
            תצוגה בלבד — נתונים מוקפאים מהמערכת הקודמת. לא ניתן לערוך, לחשב מחדש או לשמור.
          </p>
          {note && <p className="mt-1.5 text-[12px] text-amber-700/90">{note.text}</p>}
        </div>

        {/* Column labels — mirror the Price Builder. */}
        <div>
          <div className="flex items-center gap-3 px-3 pb-2 text-[12px] font-medium text-gray-400">
            <span className="flex-1 min-w-[12rem]">מוצר</span>
            <span className="w-32 shrink-0 text-center">מחיר</span>
            <span className="w-20 shrink-0 text-center">כמות</span>
            <span className="w-44 shrink-0">סה״כ שורה</span>
          </div>

          <div className="rounded-xl border border-gray-200 p-3 min-h-[120px] divide-y divide-gray-50">
            {lines.length ? (
              lines.map((line) => <HistoricalRow key={line.id} line={line} />)
            ) : (
              <p className="px-3 py-6 text-center text-sm text-gray-400">אין שורות מסחריות היסטוריות.</p>
            )}
          </div>
        </div>

        {/* Totals — engine breakdown when available, else the client-side gross. */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <div className="min-w-[18rem] space-y-2 text-[15px] pt-2">
            {totals ? (
              <>
                <TotalRow label="סכום ביניים" minor={totals.netMinor} />
                <TotalRow label={`מע״מ${vatRate ? ` (${vatRate}%)` : ''}`} minor={totals.vatMinor} />
                <div className="border-t border-gray-100 pt-2">
                  <TotalRow label='סה"כ' minor={totals.grossMinor} strong />
                </div>
              </>
            ) : (
              <TotalRow label='סה"כ' minor={clientTotalMinor} strong />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
