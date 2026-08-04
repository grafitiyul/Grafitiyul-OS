import { useEffect, useState } from 'react';
import { subscribeToasts } from '../lib/toast.js';

// The one toast surface. Mounted once by the app shell.
//
// Top-right, non-blocking (pointer-events only on the cards themselves, so the
// screen stays fully usable), no overlay, auto-dismiss after the toast's
// duration, and always dismissible with ×. RTL-native: the text reads
// right-to-left and the × sits on the left where a Hebrew reader expects it.
export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => subscribeToasts((t) => setToasts((cur) => [...cur, t])), []);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((t) =>
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), t.durationMs),
    );
    return () => timers.forEach(clearTimeout);
    // Re-arming on every change is fine: a cleared timer for an already-removed
    // toast is a no-op, and each toast keeps its own full duration.
  }, [toasts]);

  if (!toasts.length) return null;

  // z-index sits ABOVE the dialog layer (z-50): a send is confirmed from inside
  // the preview, so the toast must never be painted behind it. The width uses
  // plain utilities on purpose — an arbitrary calc() written without spaces
  // around the operator is invalid CSS and drops the whole declaration.
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-80 max-w-[90vw] flex-col gap-2"
      dir="rtl"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const success = t.tone !== 'error';
        return (
          <div
            key={t.id}
            role="status"
            // Fully opaque fills — no /NN alpha and no tinted-50 wash, so the
            // toast reads as solid colour over any page content behind it.
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-white shadow-lg ${
              success ? 'border-emerald-700 bg-emerald-600' : 'border-red-700 bg-red-600'
            }`}
          >
            <span className="mt-0.5 shrink-0 text-[15px] leading-none" aria-hidden>
              {success ? '✓' : '⚠'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{t.title}</div>
              {t.detail && <div className="text-[12px] text-white/85">{t.detail}</div>}
            </div>
            <button
              type="button"
              aria-label="סגירה"
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded-md px-1.5 text-[15px] leading-none text-white hover:bg-white/20"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
