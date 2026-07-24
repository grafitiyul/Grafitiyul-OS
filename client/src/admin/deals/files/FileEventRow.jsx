// Compact history row for a file event (TimelineEntry kind='file'), rendered on
// Deal AND Contact timelines. Emitted by the backend on upload/delete and on
// canonical document filing, so files show in the existing history in
// chronological order — no separate file history.
//
// When the event references a stored document (data.documentId), the row offers
// an inline "פתיחה" action that opens the SAME canonical PDF as the Files tab,
// reusing the EXISTING scoped download route for the event's own subject — no
// second file, no duplicated download logic, and each route re-verifies the
// document belongs to that subject (authorization preserved). The mapping is
// generic (subjectType → scoped door), so any future file event that carries a
// documentId becomes actionable without a per-feature visual hack.

import { api } from '../../../lib/api.js';

// Resolve the scoped, association-verified download URL for a file event from
// its OWN subject. Returns null when the event carries no stored document id.
function fileEventHref(entry) {
  const documentId = entry?.data?.documentId;
  if (!documentId) return null;
  if (entry.subjectType === 'deal' && entry.subjectId) {
    return api.dealFiles.reservationDocumentUrl(entry.subjectId, documentId);
  }
  if (entry.subjectType === 'contact' && entry.subjectId) {
    return api.contacts.reservationDocumentUrl(entry.subjectId, documentId);
  }
  return null;
}

const EVENT_STYLE = {
  file_uploaded: { label: 'קובץ הועלה', cls: 'bg-blue-50 text-blue-700 ring-blue-200', emoji: '📎' },
  file_deleted: { label: 'קובץ נמחק', cls: 'bg-gray-100 text-gray-500 ring-gray-200', emoji: '🗑️' },
  agent_reservation_summary_generated: {
    label: 'הופק סיכום הזמנת סוכן',
    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    emoji: '📕',
  },
};

export default function FileEventRow({ entry }) {
  const data = entry.data || {};
  const style = EVENT_STYLE[data.event] || { label: 'קובץ', cls: 'bg-gray-100 text-gray-600 ring-gray-200', emoji: '📎' };
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';
  // Not for deleted files (the bytes are gone) — only live, stored documents.
  const href = data.event === 'file_deleted' ? null : fileEventHref(entry);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <span aria-hidden className="text-[15px] leading-none">{style.emoji}</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${style.cls}`}>
        {style.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">{data.filename || entry.body}</span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-700"
        >
          פתיחה
        </a>
      )}
      <span className="shrink-0 text-[11px] text-gray-400">
        {when ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
        {' · '}
        {actor}
      </span>
    </div>
  );
}
