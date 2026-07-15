import { num, bytes, dateTime } from './format.js';

// Snapshot #1 status, from the real snapshot manifest. Safe summary facts only —
// no credentials, no raw payloads, no shard contents.
export default function SnapshotCard({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-1">צילום הנתונים</div>
        <p className="text-sm text-gray-500">עדיין לא נוצר צילום של המערכת הקודמת.</p>
      </div>
    );
  }

  const v = snapshot.verification;
  const verified = v?.verdict === 'PASS';
  const rows = [
    ['נוצר', dateTime(snapshot.createdAt)],
    ['הושלם', dateTime(snapshot.finishedAt)],
    ['ישויות', num(snapshot.entityCount)],
    ['רשומות', num(snapshot.recordCount)],
    ['קבצים באחסון', num(snapshot.objectCount)],
    ['נפח כולל', bytes(snapshot.totalBytes)],
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-semibold text-gray-900">צילום הנתונים מהמערכת הקודמת</div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
            snapshot.complete ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {snapshot.complete ? 'הושלם' : 'לא הושלם'}
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true">{verified ? '✅' : '⚠️'}</span>
          <span className="text-[12px] text-gray-700">
            {verified ? 'שלמות הנתונים אומתה' : v ? 'האימות לא עבר' : 'טרם אומת'}
            {v?.verifiedAt ? ` · ${dateTime(v.verifiedAt)}` : ''}
          </span>
        </div>
        {v && (
          <span className="text-[12px] text-gray-500">
            {num(v.blocking)} תקלות · {num(v.warnings)} אזהרות
          </span>
        )}
        {snapshot.requests?.used != null && (
          <span className="text-[12px] text-gray-500">
            פניות ל-Pipedrive: {num(snapshot.requests.used)}
            {snapshot.requests.limit != null ? ` מתוך תקרה של ${num(snapshot.requests.limit)}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
