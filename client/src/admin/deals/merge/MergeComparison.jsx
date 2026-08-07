import { money, fmtDate, fmtWhen, STATUS_HE, ACTIVITY_HE, TOUR_KIND_HE } from './mergeFormat.js';

// Side-by-side comparison — the screen where an operator decides whether these
// two deals really are one transaction.
//
// The design rule: DIFFERENCES must be impossible to miss and identical values
// must be quiet. A table where every row looks the same makes the operator read
// thirty rows to find the two that matter, which is how a wrong merge happens.
// Rows that differ get a marker and a tinted background; rows that agree stay
// plain; rows empty on both sides are hidden entirely rather than padding the
// screen with "—".
//
// Internal ids are never shown (product standard 9): every value here is
// business language — the organization's name, the product's name, the city.

export default function MergeComparison({ preview, loading }) {
  if (loading && !preview) return <div className="py-6 text-center text-sm text-gray-500">טוען השוואה…</div>;
  if (!preview) return null;

  const a = preview.survivor;
  const b = preview.other;
  const moneyA = preview.money.survivor;
  const moneyB = preview.money.other;
  const tourA = preview.operational.survivorTour;
  const tourB = preview.operational.otherTour;

  const rows = [
    ['מספר הזמנה', `#${a.orderNo}`, `#${b.orderNo}`],
    ['כותרת', a.title, b.title],
    ['סטטוס', STATUS_HE[a.status] || a.status, STATUS_HE[b.status] || b.status],
    ['סוג פעילות', ACTIVITY_HE[a.activityType] || '—', ACTIVITY_HE[b.activityType] || '—'],
    ['איש קשר ראשי', a.primaryContactName, b.primaryContactName],
    ['אנשי קשר', a.contactCount, b.contactCount],
    ['ארגון', a.organizationName, b.organizationName],
    ['מוצר', a.productName, b.productName],
    ['עיר', a.variantName, b.variantName],
    ['תאריך פעילות', a.tourDate ? fmtDate(a.tourDate) : null, b.tourDate ? fmtDate(b.tourDate) : null],
    ['שעה', a.tourTime, b.tourTime],
    ['משתתפים', a.participants, b.participants],
    ['שפת סיור', a.tourLanguage, b.tourLanguage],
    ['סכום הדיל', money(a.valueMinor, a.currency), money(b.valueMinor, b.currency)],
    ['בילדר', a.hasBuilder ? `${a.builderLineCount} שורות` : 'ריק', b.hasBuilder ? `${b.builderLineCount} שורות` : 'ריק'],
    ['שולם', money(moneyA.paidMinor, moneyA.currency), money(moneyB.paidMinor, moneyB.currency)],
    ['יתרה', money(moneyA.balanceMinor, moneyA.currency), money(moneyB.balanceMinor, moneyB.currency)],
    ['מסמכים חשבונאיים', moneyA.documentCount, moneyB.documentCount],
    ['סיור משובץ', tourA ? `${TOUR_KIND_HE[tourA.kind] || tourA.kind} · ${fmtWhen(tourA)}` : null,
      tourB ? `${TOUR_KIND_HE[tourB.kind] || tourB.kind} · ${fmtWhen(tourB)}` : null],
    ['מקומות בסיור', tourA?.registrationSeats ?? null, tourB?.registrationSeats ?? null],
    ['משימות פתוחות', preview.tasks.survivor.length, preview.tasks.other.length],
    ['הערות והיסטוריה', a.notesCount, b.notesCount],
    ['נוצר', fmtDate(a.createdAt), fmtDate(b.createdAt)],
    ['פעילות אחרונה', fmtDate(a.lastActivityAt), fmtDate(b.lastActivityAt)],
  ];

  const visible = rows.filter(([, x, y]) => !isBlank(x) || !isBlank(y));
  const diffCount = visible.filter(([, x, y]) => differs(x, y)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-gray-600">
          {diffCount > 0
            ? <>נמצאו <b>{diffCount}</b> הבדלים בין הדילים. שדות זהים מוצגים ללא הדגשה.</>
            : 'כל השדות המשמעותיים זהים בשני הדילים.'}
        </p>
      </div>

      {/* Wide content scrolls inside its own container — the dialog body must
          never scroll horizontally. */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[560px] text-[12.5px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="w-40 px-3 py-2 text-right font-medium" />
              <th className="px-3 py-2 text-right font-semibold text-gray-800">דיל #{a.orderNo}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-800">דיל #{b.orderNo}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(([label, x, y]) => {
              const d = differs(x, y);
              return (
                <tr key={label} className={`border-t border-gray-100 ${d ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-3 py-1.5 text-gray-400">
                    {d && <span className="ml-1 text-amber-600" aria-label="שונה">●</span>}
                    {label}
                  </td>
                  <td className={`px-3 py-1.5 ${d ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{show(x)}</td>
                  <td className={`px-3 py-1.5 ${d ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{show(y)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview.warnings?.length > 0 && (
        <ul className="space-y-1">
          {preview.warnings.map((w, i) => (
            <li key={i} className="rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] text-blue-800">{w.messageHe}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const isBlank = (v) => v === null || v === undefined || v === '' || v === '—';
const show = (v) => (isBlank(v) ? '—' : v);
const differs = (x, y) => String(show(x)) !== String(show(y));
