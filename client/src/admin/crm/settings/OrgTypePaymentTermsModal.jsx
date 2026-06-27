import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';

// Default "תנאי תשלום" for an Organization Type.
//
// Reuses the Payment Configuration catalog (PaymentTerm + PaymentMethod) — it
// NEVER defines its own terms/methods. The payment METHOD is INHERITED from the
// chosen term's configured default (PaymentTerm.defaultPaymentMethod) unless the
// user overrides it. A null override means "inherit". NOT wired to Quotes/Deals.

// Small action button rendered per Organization Type row; opens the modal.
export function PaymentTermsButton({ type, onSaved }) {
  const [open, setOpen] = useState(false);
  const hasDefaults = !!(type.defaultPaymentTermId || type.defaultPaymentMethodId);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="תנאי תשלום"
        title="תנאי תשלום"
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition ${
          hasDefaults
            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <CoinIcon />
        <span className="hidden sm:inline">תנאי תשלום</span>
      </button>
      {open && (
        <PaymentTermsModal
          type={type}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function PaymentTermsModal({ type, onClose, onSaved }) {
  const [terms, setTerms] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [termId, setTermId] = useState(type.defaultPaymentTermId || '');
  // null = inherit the term's default method; a value = manual override.
  const [methodOverrideId, setMethodOverrideId] = useState(
    type.defaultPaymentMethodId || null,
  );
  const [note, setNote] = useState(type.paymentTermsNote || '');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, m] = await Promise.all([
          api.payment.listTerms(),
          api.payment.listMethods(),
        ]);
        if (!alive) return;
        setTerms(t);
        setMethods(m);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedTerm = useMemo(
    () => terms.find((t) => t.id === termId) || null,
    [terms, termId],
  );
  const termDefaultMethodId = selectedTerm?.defaultPaymentMethodId || null;
  const effectiveMethodId = methodOverrideId || termDefaultMethodId || '';
  const isOverride =
    !!methodOverrideId && methodOverrideId !== termDefaultMethodId;

  // Keep selections valid even if a referenced term/method is now inactive.
  const termOptions = terms.filter((t) => t.active || t.id === termId);
  const methodOptions = methods.filter(
    (m) => m.active || m.id === effectiveMethodId,
  );

  function changeTerm(id) {
    setTermId(id);
    // New term → drop any override so the method follows the new term's default.
    setMethodOverrideId(null);
  }

  function changeMethod(id) {
    if (!id || id === termDefaultMethodId) {
      setMethodOverrideId(null); // back to inherited
    } else {
      setMethodOverrideId(id); // explicit override
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.organizationTypes.update(type.id, {
        defaultPaymentTermId: termId || null,
        // Without a term there is nothing to inherit/override.
        defaultPaymentMethodId: termId && isOverride ? methodOverrideId : null,
        paymentTermsNote: note.trim() || null,
      });
      await onSaved?.();
      onClose();
    } catch (e) {
      setError(e.payload?.error || e.message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-gray-200"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-[16px] font-semibold text-gray-900">
              תנאי תשלום — ברירת מחדל
            </h3>
            <p className="text-[12px] text-gray-500 mt-0.5">{type.label}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="סגור"
            className="text-gray-400 hover:text-gray-600 rounded-md p-1 -m-1"
          >
            <CloseIcon />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Default Payment Terms */}
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">
                תנאי תשלום ברירת מחדל
              </label>
              <select
                value={termId}
                onChange={(e) => changeTerm(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              >
                <option value="">— ללא —</option>
                {termOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameHe}
                    {!t.active ? ' (לא פעיל)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                מתוך הגדרת התשלומים (Payment Configuration).
              </p>
            </div>

            {/* Default Payment Method */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[12px] font-medium text-gray-600">
                  אמצעי תשלום ברירת מחדל
                </label>
                {termId &&
                  (isOverride ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                      נבחר ידנית
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                      יורש מתנאי התשלום
                    </span>
                  ))}
              </div>
              <select
                value={effectiveMethodId}
                disabled={!termId}
                onChange={(e) => changeMethod(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{termId ? '— ללא —' : 'בחרו תנאי תשלום תחילה'}</option>
                {methodOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameHe}
                    {!m.active ? ' (לא פעיל)' : ''}
                  </option>
                ))}
              </select>
              {termId && isOverride && (
                <button
                  type="button"
                  onClick={() => setMethodOverrideId(null)}
                  className="mt-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-700"
                >
                  אפס לברירת המחדל של התנאי
                </button>
              )}
              {termId && !isOverride && !termDefaultMethodId && (
                <p className="text-[11px] text-gray-400 mt-1">
                  לתנאי התשלום הזה אין אמצעי תשלום מוגדר בהגדרת התשלומים.
                </p>
              )}
            </div>

            {/* Optional note */}
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">
                הערה (אופציונלי)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="הערה חופשית…"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 resize-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                שגיאה: <span dir="ltr" className="font-mono">{error}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            onClick={save}
            disabled={busy || loading}
            className="h-10 flex-1 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-600 hover:bg-gray-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function CoinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1 1.6 2.5 1.6 2.5-.6 2.5-1.6M12 7v10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
