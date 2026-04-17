import { useNavigate } from 'react-router-dom';

// Editor header: back button (mobile), title, delete + save actions.
export default function EditorTopBar({
  kindLabel,
  title,
  dirty,
  saving,
  canSave,
  canDelete,
  onSave,
  onDelete,
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
      {canDelete && (
        <button
          onClick={onDelete}
          className="text-sm text-red-600 hover:bg-red-50 rounded px-3 py-1.5"
        >
          מחק
        </button>
      )}
      <button
        onClick={onSave}
        disabled={!canSave || saving}
        className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'שומר…' : dirty ? 'שמור' : 'נשמר'}
      </button>
    </div>
  );
}
