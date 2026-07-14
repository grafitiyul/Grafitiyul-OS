import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { DateField, TimeField } from '../common/pickers/DateTimeFields.jsx';
import { productContextFor } from '../deals/tourContext.js';
import { TOUR_LANGS } from './config.js';

// Create/edit dialog for a GROUP Tour Slot ("סיור קבוצתי"). Group slots are
// the only manually-creatable TourEvents — private/business tours are created
// by the deal WON transition. Required fields (product, variant, date, time,
// language, capacity) are validated by the SERVER's declarative list; this
// form mirrors the same rules for instant feedback and renders the server's
// missing-field checklist verbatim when a 422 still occurs.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

const EMPTY = {
  productId: '',
  productVariantId: '',
  date: '',
  startTime: '',
  tourLanguage: 'he',
  capacity: '',
  notes: '',
};

export default function TourSlotModal({ open, tour, onClose, onSaved }) {
  const isEdit = !!tour?.id;
  const [form, setForm] = useState(EMPTY);
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState([]);
  // After a save that CHANGED the product on a tour that already has components,
  // we never silently overwrite them — we ask keep vs. replace-from-defaults.
  const [askReseed, setAskReseed] = useState(false);
  const [reseedBusy, setReseedBusy] = useState(false);
  // Registered tours can't be re-dated directly — the operator enters replace
  // mode ("צור מועד חדש והעבר משתתפים") which picks the NEW date/time.
  const [replaceMode, setReplaceMode] = useState(false);
  const activeSeats = tour?.activeSeats ?? tour?.occupancy?.activeSeats ?? 0;
  const registered = isEdit && activeSeats > 0;
  const lockDateTime = registered && !replaceMode;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMissing([]);
    setReplaceMode(false);
    api.products.list().then(setProducts).catch(() => {});
    if (tour?.id) {
      setForm({
        productId: tour.productId || '',
        productVariantId: tour.productVariantId || '',
        date: tour.date || '',
        startTime: tour.startTime || '',
        tourLanguage: tour.tourLanguage || 'he',
        capacity: tour.capacity ?? '',
        notes: tour.notes || '',
      });
      if (tour.productId) {
        productContextFor(tour.productId)
          .then((d) => setVariants(d.variants))
          .catch(() => setVariants([]));
      } else {
        setVariants([]);
      }
    } else {
      setForm(EMPTY);
      setVariants([]);
    }
  }, [open, tour]);

  async function chooseProduct(productId) {
    if (!productId) {
      setVariants([]);
      setForm((f) => ({ ...f, productId: '', productVariantId: '' }));
      return;
    }
    setForm((f) => ({ ...f, productId }));
    try {
      const d = await productContextFor(productId);
      setVariants(d.variants);
      setForm((f) => ({ ...f, productVariantId: d.productVariantId }));
    } catch {
      setVariants([]);
      setForm((f) => ({ ...f, productVariantId: '' }));
    }
  }

  async function submit(e) {
    e?.preventDefault?.();
    setBusy(true);
    setError(null);
    setMissing([]);
    try {
      const payload = {
        productId: form.productId,
        productVariantId: form.productVariantId,
        date: form.date,
        startTime: form.startTime,
        tourLanguage: form.tourLanguage,
        capacity: form.capacity === '' ? null : Number(form.capacity),
        notes: form.notes || null,
      };
      // The VARIANT is authoritative for default components — prompt when it
      // changes on a tour that already carries components.
      const variantChanged = isEdit && form.productVariantId !== (tour.productVariantId || '');
      const hasComponents = (tour?.activityComponents?.length || 0) > 0;

      // Registered tour → canonical REPLACEMENT (new occurrence + move everyone).
      if (replaceMode) {
        const result = await api.tours.replace(tour.id, payload);
        onSaved?.(result);
        onClose();
        return;
      }

      const saved = await (isEdit ? api.tours.update(tour.id, payload) : api.tours.create(payload));
      onSaved?.(saved);
      if (variantChanged && hasComponents) {
        setAskReseed(true);
      } else {
        onClose();
      }
    } catch (err) {
      const code = err.payload?.error;
      if (code === 'missing_required_fields') {
        setMissing(err.payload.missing || []);
      } else if (code === 'registered_tour_needs_replacement') {
        // Server enforced the invariant → switch to replacement mode.
        setReplaceMode(true);
        setError('לסיור זה יש נרשמים — לא ניתן לשנות תאריך/שעה ישירות. בחרו מועד חדש והמשתתפים יועברו אליו.');
      } else {
        setError(code || err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'עריכת סיור קבוצתי' : 'סיור קבוצתי חדש'}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            ביטול
          </button>
          {registered && !replaceMode ? (
            <button
              type="button"
              onClick={() => {
                setReplaceMode(true);
                setError(null);
              }}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              צור מועד חדש והעבר משתתפים
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : replaceMode ? 'אישור והעברת משתתפים' : isEdit ? 'שמירה' : 'יצירת סיור'}
            </button>
          )}
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        {registered && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            {replaceMode ? (
              <>בחרו <b>מועד חדש</b> — יווצר סיור חדש וכל {activeSeats} הנרשמים, ההזמנות והדילים יועברו אליו; הסיור הנוכחי יבוטל וישמר בהיסטוריה, ותיפתח משימת בקרה לעדכון לקוחות.</>
            ) : (
              <>לסיור זה יש {activeSeats} נרשמים — לא ניתן לשנות תאריך/שעה ישירות. השתמשו ב״צור מועד חדש והעבר משתתפים״.</>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">מוצר *</span>
            <select
              value={form.productId}
              onChange={(e) => chooseProduct(e.target.value)}
              className={INPUT + ' bg-white'}
            >
              <option value="">— בחר מוצר —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">וריאציה (עיר) *</span>
            <select
              value={form.productVariantId}
              onChange={(e) => setForm((f) => ({ ...f, productVariantId: e.target.value }))}
              disabled={!variants.length}
              className={INPUT + ' bg-white disabled:bg-gray-50 disabled:text-gray-400'}
            >
              <option value="">— בחר וריאציה —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
          <DateField
            label="תאריך *"
            value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
            clearable={false}
            disabled={lockDateTime}
          />
          <TimeField
            label="שעה *"
            value={form.startTime}
            onChange={(v) => setForm((f) => ({ ...f, startTime: v }))}
            clearable={false}
            disabled={lockDateTime}
          />
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">שפת סיור *</span>
            <select
              value={form.tourLanguage}
              onChange={(e) => setForm((f) => ({ ...f, tourLanguage: e.target.value }))}
              className={INPUT + ' bg-white'}
            >
              {TOUR_LANGS.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">קיבולת *</span>
            <input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              placeholder="לדוגמה: 30"
              className={INPUT}
            />
            <span className="mt-0.5 block text-[11px] text-gray-400">
              קיבולת היא אזהרה בלבד — ניתן לחרוג ממנה במפורש.
            </span>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-gray-600">הערות תפעוליות</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </label>

        {missing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[13px] font-semibold text-amber-800 mb-1">שדות חובה חסרים:</div>
            <ul className="list-disc pr-5 text-[13px] text-amber-800">
              {missing.map((m) => (
                <li key={m.field}>{m.labelHe}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={askReseed}
        title="הוריאציה של הסיור השתנתה"
        body="מרכיבי הפעילות הנוכחיים של הסיור נשמרו כפי שהם. להחליף אותם במרכיבי ברירת המחדל של הוריאציה החדשה? הבחירות הנוכחיות (כולל מיקומי סדנה) יימחקו."
        confirmLabel={reseedBusy ? 'מחליף…' : 'החלף מברירת המחדל'}
        cancelLabel="השאר כפי שהם"
        danger
        onCancel={() => {
          setAskReseed(false);
          onClose();
        }}
        onConfirm={async () => {
          setReseedBusy(true);
          try {
            await api.tours.reseedComponents(tour.id);
            onSaved?.();
            onClose();
          } catch (e) {
            // Keep the modal open and surface the failure in the inline error
            // banner (never a native alert; closing would hide the message).
            setError('החלפת המרכיבים נכשלה — ' + (e.payload?.error || e.message));
          } finally {
            setReseedBusy(false);
            setAskReseed(false);
          }
        }}
      />
    </Dialog>
  );
}
