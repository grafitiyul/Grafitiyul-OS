import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import TourSlotModal from './TourSlotModal.jsx';
import { TOUR_LANG_LABELS, fmtTourDate } from './config.js';

// Group Tour Slot picker — the ONE surface for attaching a group deal to a
// scheduled slot (first WON and "שבץ לסיור"/"החלף סיור" all use it). Shows
// derived occupancy per slot; joining past capacity is allowed but demands an
// explicit overbook confirmation (capacity is a warning, never a hard limit).
// Inline slot creation is available when the needed slot wasn't pre-scheduled.

export default function TourSlotPickerDialog({ open, deal, currentTourEventId = null, onClose, onPick }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [overbookSlot, setOverbookSlot] = useState(null); // slot pending overbook confirm
  const [busy, setBusy] = useState(false);

  const seatsNeeded = Number(deal?.participants) || 0;

  async function load() {
    setLoading(true);
    try {
      const all = await api.tours.list({ kind: 'group_slot', status: 'scheduled' });
      setSlots(all);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setOverbookSlot(null);
      load();
    }
  }, [open]);

  // Upcoming slots only, soonest first (a slot in the past can't be joined —
  // scheduled group tours are future work).
  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return slots
      .filter((s) => s.date >= today)
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  }, [slots]);

  function wouldOverbook(slot) {
    return slot.capacity != null && slot.activeSeats + seatsNeeded > slot.capacity;
  }

  async function pick(slot) {
    if (wouldOverbook(slot) && overbookSlot?.id !== slot.id) {
      setOverbookSlot(slot);
      return;
    }
    setBusy(true);
    try {
      await onPick(slot.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open && !createOpen}
        onClose={onClose}
        title="בחירת סיור קבוצתי"
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="me-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              + צור סיור קבוצתי חדש
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              ביטול
            </button>
          </>
        }
      >
        {seatsNeeded > 0 && (
          <p className="mb-3 text-[13px] text-gray-500">
            שיבוץ של <span className="font-semibold text-gray-800">{seatsNeeded} משתתפים</span> — בחרו סיור מתוכנן:
          </p>
        )}
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">טוען סיורים…</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : upcoming.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3 opacity-70">📅</div>
            <p className="text-sm text-gray-600 font-medium mb-1">אין סיורים קבוצתיים מתוכננים</p>
            <p className="text-[13px] text-gray-500">אפשר ליצור סיור חדש עם הכפתור למטה.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-[52vh] overflow-y-auto -mx-1 px-1">
            {upcoming.map((s) => {
              const isCurrent = s.id === currentTourEventId;
              const over = wouldOverbook(s);
              const pendingConfirm = overbookSlot?.id === s.id;
              return (
                <li key={s.id} className="py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{fmtTourDate(s.date)}</span>
                        <span className="tabular-nums text-gray-700" dir="ltr">{s.startTime}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                            הסיור הנוכחי
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[13px] text-gray-500">
                        {s.product?.nameHe || '—'}
                        {(s.location?.nameHe || s.productVariant?.location?.nameHe) &&
                          ` · ${s.location?.nameHe || s.productVariant?.location?.nameHe}`}
                        {s.tourLanguage && ` · ${TOUR_LANG_LABELS[s.tourLanguage]}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-left">
                      <div className="tabular-nums text-[13px]" dir="ltr">
                        <span className={over ? 'font-bold text-red-600' : 'font-semibold text-gray-800'}>
                          {s.activeSeats}
                        </span>
                        <span className="text-gray-400"> / {s.capacity ?? '—'}</span>
                      </div>
                      {over && (
                        <div className="text-[11px] font-semibold text-red-600">יעבור את הקיבולת</div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy || isCurrent}
                      onClick={() => pick(s)}
                      className={`shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
                        pendingConfirm
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {pendingConfirm ? 'אישור חריגה' : 'בחר'}
                    </button>
                  </div>
                  {pendingConfirm && (
                    <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-[12px] text-red-700">
                      השיבוץ יביא ל-{overbookSlot.activeSeats + seatsNeeded} משתתפים — מעל הקיבולת (
                      {overbookSlot.capacity}). לחיצה נוספת מאשרת חריגה במפורש.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      <TourSlotModal
        open={createOpen}
        tour={null}
        onClose={() => setCreateOpen(false)}
        onSaved={() => load()}
      />
    </>
  );
}
