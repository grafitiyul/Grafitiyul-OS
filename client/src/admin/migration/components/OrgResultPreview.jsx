import { num } from './format.js';

// "מה ייווצר ב-GOS" — the live preview of the final migration result.
// Updates on every keystroke while the owner edits the overrides.
export default function OrgResultPreview({ result, typeLabel }) {
  return (
    <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">התוצאה לאחר ההעברה</h3>
        <span className="text-[11px] text-gray-500">
          {num(result.totals.organizations)} ארגונים · {num(result.totals.units)} יחידות · {num(result.totals.records)} רשומות מקור
        </span>
      </div>

      <div className="text-[11px] text-gray-500 mb-1">ארגון</div>
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 mb-3">
        <div className="text-[15px] font-semibold text-gray-900 break-words">
          {result.organization.name || <span className="text-red-500 font-normal">— חסר שם —</span>}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {typeLabel ? `סוג: ${typeLabel} · ` : ''}
          {num(result.organization.deals)} עסקאות · {num(result.organization.contacts)} אנשי קשר
          {result.organization.mergeIntoGosId ? ' · ימוזג לארגון קיים ב-GOS' : ''}
        </div>
        {result.organization.members.length > 0 && (
          <div className="text-[11px] text-gray-400 mt-1 break-words">
            מרשומות: {result.organization.members.map((m) => m.name).join(' · ')}
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-500 mb-1">יחידות</div>
      {result.units.length ? (
        <ul className="space-y-1 mb-3">
          {result.units.map((u) => (
            <li key={u.key} className="bg-white border border-gray-200 rounded-lg px-3 py-2">
              <div className="text-[13px] font-medium text-gray-900 break-words">
                • {u.name || <span className="text-red-500 font-normal">— חסר שם —</span>}
              </div>
              <div className="text-[11px] text-gray-400 break-words">
                {num(u.deals)} עסקאות · מרשומות: {u.members.map((m) => m.name).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-gray-400 mb-3">אין יחידות</div>
      )}

      {result.emptyUnits.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
          יחידות ללא רשומות משויכות לא ייווצרו: {result.emptyUnits.map((u) => u.name || '(ללא שם)').join(' · ')}
        </p>
      )}

      {result.separate.length > 0 && (
        <>
          <div className="text-[11px] text-gray-500 mb-1">ארגונים נפרדים</div>
          <ul className="space-y-1">
            {result.separate.map((s) => (
              <li key={s.legacyId} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-900 break-words">
                {s.name} <span className="text-[11px] text-gray-400">· {num(s.deals)} עסקאות</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.problems.length > 0 && (
        <ul className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-0.5">
          {result.problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}
    </div>
  );
}
