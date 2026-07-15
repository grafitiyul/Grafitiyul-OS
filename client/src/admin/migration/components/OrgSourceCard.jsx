import { num } from './format.js';

// ONE source organization record with enough business context to decide its role
// without guessing from the name alone.
export default function OrgSourceCard({ m, assignment, unitName, onShowSource }) {
  const rows = [
    ['ח.פ / עוסק מורשה', m.taxId],
    ['טלפון', m.phones?.join(' · ')],
    ['אימייל', m.emails?.slice(0, 3).join(' · ')],
    ['כתובת', m.address],
    ['עיר', m.city],
  ].filter(([, v]) => v);

  const role =
    assignment === 'separate' ? 'ארגון נפרד'
      : assignment?.startsWith('unit:') ? `יחידה: ${unitName || '—'}`
        : 'הארגון הראשי';

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 break-words">{m.name}</div>
          <div className="text-[11px] text-gray-400">מזהה מקור: {m.legacyId}</div>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">{role}</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        <Stat label="עסקאות" value={num(m.dealCount)} />
        <Stat label="פעילות" value={num(m.activeDealCount)} tone={m.activeDealCount ? 'text-green-700' : 'text-gray-400'} />
        <Stat label="סיורים עתידיים" value={num(m.futureTourDeals)} tone={m.futureTourDeals ? 'text-blue-700' : 'text-gray-400'} />
        <Stat label="אנשי קשר" value={num(m.contactCount)} />
        {m.operationallyActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 self-center">פעיל תפעולית</span>}
      </div>

      {rows.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1 mb-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[11px] text-gray-500">{k}</dt>
              <dd className="text-[12px] text-gray-900 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {m.primaryContact && (
        <div className="text-[12px] bg-gray-50 rounded px-2 py-1.5 mb-2">
          <span className="text-gray-500 text-[11px]">איש קשר מרכזי (נגזר · {m.primaryContact.basis}): </span>
          <b className="text-gray-900">{m.primaryContact.name}</b>
          {m.primaryContact.email ? <span className="text-gray-600"> · {m.primaryContact.email}</span> : null}
          {m.primaryContact.phone ? <span className="text-gray-600"> · {m.primaryContact.phone}</span> : null}
        </div>
      )}

      {m.contacts?.length > 1 && (
        <details className="mb-2">
          <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-700">
            כל אנשי הקשר המקושרים ({num(m.contactCount)})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {m.contacts.map((c) => (
              <li key={c.legacyId} className="text-[12px] text-gray-700">
                • {c.name}
                {c.email ? <span className="text-gray-500"> · {c.email}</span> : null}
                {c.phone ? <span className="text-gray-500"> · {c.phone}</span> : null}
                {c.deals ? <span className="text-gray-400"> · {num(c.deals)} עסקאות</span> : null}
              </li>
            ))}
            {m.contactCount > m.contacts.length && (
              <li className="text-[11px] text-gray-400">ועוד {num(m.contactCount - m.contacts.length)}…</li>
            )}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
        {m.gosMatch ? (
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-800">
            קיים ב-GOS: {m.gosMatch.name} (לפי {m.gosMatch.matchedOn === 'taxId' ? 'ח.פ' : 'שם'})
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">אין התאמה ב-GOS</span>
        )}
        <button type="button" onClick={() => onShowSource(m.source)} className="text-[11px] text-blue-700 hover:underline mr-auto">
          רשומת המקור המלאה →
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'text-gray-900' }) {
  return (
    <span className="text-[11px] text-gray-500">
      {label}: <b className={`tabular-nums ${tone}`}>{value}</b>
    </span>
  );
}
