// Identity Import readiness — derived from the live ledger on every load.
// It REPORTS. There is deliberately no button here: the import itself is Slice 6,
// and a gate that can be clicked is a gate that can be clicked by mistake.
export default function ReadinessCard({ readiness }) {
  if (!readiness) return null;
  const { ready, requirements, informational, blockers } = readiness;

  return (
    <div className={`mt-3 border rounded-xl p-3 ${ready ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <h2 className="text-[13px] font-semibold text-gray-900">מוכנות לייבוא הזהויות</h2>
        {ready
          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">כל התנאים מתקיימים</span>
          : <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
              {blockers.length} תנאים חסרים
            </span>}
        <span className="text-[11px] text-gray-400 mr-auto">נגזר מהנתונים החיים — לא מתג</span>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
        {requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-1.5 text-[12px]">
            <span className={r.ready ? 'text-green-600' : 'text-red-600'}>{r.ready ? '✓' : '✗'}</span>
            <span className="min-w-0">
              <span className={r.ready ? 'text-gray-700' : 'text-gray-900 font-medium'}>{r.label}</span>
              {!r.ready && <span className="block text-[11px] text-red-700">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {informational?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200/70">
          {informational.map((i) => (
            <p key={i.key} className="text-[11px] text-gray-500">
              <span className="text-gray-400">◦</span> {i.detail}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
