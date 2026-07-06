// Compact history row for an email event (timeline kind='email' — read-time
// merged pseudo-entries; EmailMessage is the source of truth, nothing is
// copied into TimelineEntry). Shows direction, subject, snippet and the
// honest engagement signal for GOS-sent mail.

function GmailGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="15" height="15" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2L24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  );
}

export default function EmailEventRow({ entry }) {
  const data = entry.data || {};
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const outbound = data.direction === 'outbound';
  const opens = data.engagement?.openCount || 0;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <span className="shrink-0 leading-none"><GmailGlyph /></span>
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
          outbound ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-gray-100 text-gray-600 ring-gray-200'
        }`}
      >
        {outbound ? 'נשלח מייל' : 'התקבל מייל'}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800" dir="auto">
        <span className="font-medium">{data.subject || '(ללא נושא)'}</span>
        {data.snippet && <span className="text-gray-400"> — {data.snippet}</span>}
      </span>
      {outbound && opens > 0 && (
        <span
          className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
          title="אינדיקציית פתיחה — אינה מדויקת ב-100% (חוסמי תמונות, פרוקסי של Gmail וכד')"
        >
          נפתח · {opens}
        </span>
      )}
      {!outbound && data.fromName && (
        <span className="shrink-0 text-[11px] text-gray-400" dir="auto">{data.fromName}</span>
      )}
      <span className="shrink-0 text-[11px] text-gray-400">
        {when ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
        {outbound && ` · ${entry.createdByName || 'המערכת'}`}
      </span>
    </div>
  );
}
