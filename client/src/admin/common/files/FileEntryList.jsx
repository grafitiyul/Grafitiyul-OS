// THE one file-entry list renderer for the unified Files system. Every
// canonical binary artifact in GOS (uploaded attachment, generated
// reservation summary, future signed forms/exports) renders through this
// list — never a parallel "documents" browser. Entries carry a `source`
// ('upload' default | 'reservation_summary' | …); system-generated sources
// are read-only (no delete) and show their origin badge.

export function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileEmoji(mime) {
  const m = String(mime || '');
  if (m.startsWith('image/')) return '🖼️';
  if (m === 'application/pdf') return '📕';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.includes('word') || m.includes('document')) return '📄';
  if (m.includes('sheet') || m.includes('excel')) return '📊';
  if (m.includes('zip') || m.includes('compressed')) return '🗜️';
  return '📎';
}

const SOURCE_BADGES = {
  reservation_summary: 'סיכום הזמנת סוכן',
};

/**
 * @param files       unified file entries (see routes/dealFiles.js DTO)
 * @param downloadHref (file) => URL — the caller picks the scoped door per source
 * @param onRemove    optional (file) => void; offered only for non-readonly entries
 * @param userMap     optional { adminUserId: username } for uploader attribution
 */
export default function FileEntryList({ files, downloadHref, onRemove, userMap = {} }) {
  return (
    <ul className="space-y-2">
      {files.map((f) => {
        const badge = SOURCE_BADGES[f.source];
        return (
          <li key={f.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <span aria-hidden className="text-[18px] leading-none">{fileEmoji(f.mimeType)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-medium text-gray-800">{f.filename}</span>
                {badge && (
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {badge}
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-gray-500">
                {fmtSize(f.sizeBytes)}
                {' · '}
                {new Date(f.createdAt).toLocaleDateString('he-IL')}
                {f.uploadedById && userMap[f.uploadedById] ? ` · ${userMap[f.uploadedById]}` : ''}
                {f.sessionNo ? ` · בקשה #${f.sessionNo}` : ''}
              </div>
            </div>
            <a
              href={downloadHref(f)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12.5px] text-gray-700 hover:bg-gray-50"
            >
              פתיחה
            </a>
            {!f.readonly && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(f)}
                className="rounded-lg px-2 py-1 text-[12.5px] text-red-600 hover:bg-red-50"
              >
                מחיקה
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
