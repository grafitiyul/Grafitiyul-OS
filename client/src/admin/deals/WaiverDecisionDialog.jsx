import Dialog from '../common/Dialog.jsx';

// System dialog (NOT a browser confirm) shown when the builder of a deal that is
// registered WITHOUT PAYMENT is INCREASED (more of an existing ticket, or a new
// card/ticket). The system cannot guess the commercial intent, so it offers three
// EXPLICIT actions. `added` = [{ cardTitle, ticketLabel, addedQty }] from the
// server (labels resolved by the caller from the current cards). onDecide gets
// 'expand' | 'charge_added' | 'cancel'.
export default function WaiverDecisionDialog({ added = [], onDecide, onCancel, busy = false }) {
  const OPTIONS = [
    {
      key: 'charge_added',
      title: 'לחייב רק על התוספת (מומלץ)',
      desc: 'הכרטיסים שנוספו יהיו לתשלום; שאר הכרטיסים נותרים ללא תשלום.',
      cls: 'border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800',
    },
    {
      key: 'expand',
      title: 'להשאיר את הכל ללא תשלום',
      desc: 'הפטור יורחב לכלול גם את הכרטיסים החדשים. סכום העסקה יישאר ₪0.',
      cls: 'border-gray-200 hover:bg-gray-50 text-gray-800',
    },
    {
      key: 'cancel',
      title: 'לבטל את הפטור לגמרי',
      desc: 'הפטור יוסר והעסקה תחזור לתמחור מסחרי מלא.',
      cls: 'border-gray-200 hover:bg-gray-50 text-gray-800',
    },
  ];
  return (
    <Dialog open onClose={onCancel} title="נוספו כרטיסים לעסקה ללא תשלום" size="md-wide">
      <div className="space-y-3">
        <p className="text-[13.5px] text-gray-600">
          העסקה רשומה כרגע <span className="font-semibold">ללא תשלום</span>. נוספו כרטיסים חדשים, והמערכת אינה יכולה להחליט לבד — בחרו כיצד להמשיך:
        </p>
        {added.length > 0 && (
          <ul className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700">
            {added.map((a, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span>{[a.cardTitle, a.ticketLabel].filter(Boolean).join(' · ') || 'כרטיס'}</span>
                <span className="font-bold tabular-nums text-gray-900">+{a.addedQty}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              onClick={() => onDecide(o.key)}
              className={`block w-full rounded-lg border px-3.5 py-2.5 text-right transition disabled:opacity-50 ${o.cls}`}
            >
              <span className="block text-[13.5px] font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-[12px] opacity-80">{o.desc}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            ביטול
          </button>
        </div>
      </div>
    </Dialog>
  );
}
