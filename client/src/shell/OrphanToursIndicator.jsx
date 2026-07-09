import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Dialog from '../admin/common/Dialog.jsx';
import ConfirmDialog from '../admin/common/ConfirmDialog.jsx';
import { fmtTourDate } from '../admin/tours/config.js';
import { dealPath } from '../admin/deals/config.js';

// Global orphan-tours warning — ALWAYS visible in the app header while any
// orphaned Booking exists (product rule: operational work is never silently
// lost AND never hidden). Clicking opens the resolution queue: reconnect the
// tour to its (re-won) deal, or cancel it. Count refreshes on navigation, on
// a 60s poll, and immediately after any flow that can change it (listeners on
// the ORPHANS_EVENT below).

export const ORPHANS_EVENT = 'gos:tours-orphans-changed';

export function notifyOrphansChanged() {
  window.dispatchEvent(new Event(ORPHANS_EVENT));
}

export default function OrphanToursIndicator() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null); // orphan row | null
  const [busyId, setBusyId] = useState(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const refreshCount = useCallback(() => {
    api.tours
      .orphansCount()
      .then((r) => setCount(r.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    window.addEventListener(ORPHANS_EVENT, refreshCount);
    return () => {
      clearInterval(t);
      window.removeEventListener(ORPHANS_EVENT, refreshCount);
    };
  }, [refreshCount]);

  // Route changes are the cheapest "something may have happened" signal.
  useEffect(() => {
    refreshCount();
  }, [pathname, refreshCount]);

  async function openQueue() {
    setOpen(true);
    setLoading(true);
    try {
      setRows(await api.tours.orphans());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function act(row, fn, errMap) {
    setBusyId(row.id);
    try {
      await fn(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      refreshCount();
      notifyOrphansChanged();
    } catch (e) {
      alert(errMap[e.payload?.error] || 'שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusyId(null);
    }
  }

  if (count === 0 && !open) return null;

  return (
    <>
      <button
        type="button"
        onClick={openQueue}
        title="סיורים מנותקים ממתינים לטיפול"
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-300 px-2.5 py-1 text-[12px] font-bold text-amber-800 hover:bg-amber-100 animate-none"
      >
        <span aria-hidden>⚠️</span>
        <span>{count} סיורים מנותקים</span>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="סיורים מנותקים (orphans)"
        size="lg"
        footer={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            סגירה
          </button>
        }
      >
        <p className="mb-3 text-[13px] text-gray-500">
          סיורים שנשמרו כשהדיל שלהם נפתח מחדש. חברו מחדש לדיל (לאחר שחזר ל-WON) או בטלו את הסיור.
        </p>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">אין סיורים מנותקים. 🎉</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const dealWon = r.deal?.status === 'won';
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-semibold text-gray-900">{fmtTourDate(r.tourEvent?.date)}</span>
                        <span dir="ltr" className="tabular-nums text-gray-700">{r.tourEvent?.startTime}</span>
                        <span className="text-gray-500">{r.tourEvent?.product?.nameHe || ''}</span>
                        {r.tourEvent?.location?.nameHe && (
                          <span className="text-gray-400">· {r.tourEvent.location.nameHe}</span>
                        )}
                        {r.seats > 0 && <span className="text-gray-400">· {r.seats} משתתפים</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setOpen(false); navigate(dealPath(r.deal)); }}
                        className="mt-0.5 text-[13px] text-blue-700 hover:underline"
                      >
                        {r.deal?.title}
                        {r.deal?.orderNo && <span dir="ltr" className="tabular-nums"> #{r.deal.orderNo}</span>}
                        {r.deal?.organization?.name && ` · ${r.deal.organization.name}`}
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === r.id || !dealWon}
                        title={dealWon ? 'חיבור הסיור חזרה לדיל' : 'חיבור מחדש אפשרי רק כשהדיל חזר ל-WON'}
                        onClick={() =>
                          act(r, api.tours.reconnectOrphan, {
                            deal_not_won: 'הדיל אינו WON — יש לסגור אותו מחדש לפני חיבור הסיור.',
                            deal_already_on_tour: 'הדיל כבר משובץ לסיור אחר — בטלו את הסיור המנותק או החליפו סיור בדיל.',
                          })
                        }
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        חבר מחדש
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => setConfirmCancel(r)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                      >
                        בטל סיור
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!confirmCancel}
        title="ביטול סיור מנותק"
        body={
          confirmCancel
            ? `לבטל את ההשתתפות בסיור בתאריך ${fmtTourDate(confirmCancel.tourEvent?.date)}? סיור פרטי/עסקי שיישאר ריק יבוטל אוטומטית.`
            : ''
        }
        confirmLabel="בטל סיור"
        danger
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          const row = confirmCancel;
          setConfirmCancel(null);
          act(row, api.tours.cancelOrphan, {});
        }}
      />
    </>
  );
}
