import { useNavigate } from 'react-router-dom';

// Editor header: back button (mobile), title, "saved" indicator + preview +
// export + delete. There is no manual "save" button — autosave runs
// continuously; the indicator reports the last server-confirmed save time.
export default function EditorTopBar({
  kindLabel,
  title,
  savedIndicator,
  canDelete,
  onDelete,
  previewUrl,
  onExport,
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-white shrink-0">
      <button
        onClick={() => navigate('/admin/procedures/bank')}
        className="lg:hidden text-sm text-blue-600 px-1"
        aria-label="חזרה לרשימה"
      >
        חזרה
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-gray-500">{kindLabel}</div>
        <div className="font-medium text-gray-900 truncate">
          {title || '(ללא כותרת)'}
        </div>
      </div>
      {savedIndicator}
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="תצוגה מקדימה"
          title="תצוגה מקדימה"
          className="w-8 h-8 shrink-0 rounded-md text-gray-700 hover:bg-gray-200 flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </a>
      )}
      {onExport && (
        <button
          onClick={onExport}
          aria-label="ייצוא"
          title="ייצוא ל-Word / PDF"
          className="w-8 h-8 shrink-0 rounded-md text-gray-700 hover:bg-gray-200 flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          className="text-sm text-red-600 hover:bg-red-50 rounded px-3 py-1.5"
        >
          מחק
        </button>
      )}
    </div>
  );
}
