import { useEffect, useState } from 'react';
import RichEditor from '../../../editor/RichEditor.jsx';
import { useInlineScope } from './InlineEditScope.jsx';

// Collapsed-by-default note field for the inline platform pattern. Read state shows
// a lightweight placeholder when empty, or a compact 2-line preview when it has
// content. Click expands into the editor (rich for `rich`, plain textarea
// otherwise); ✓ saves and collapses, ✕ cancels. Governed by the one-at-a-time scope.
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function CollapsibleNote({ id, label, value, rich = false, placeholder, onSave }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) { setDraft(value ?? ''); setError(null); }
  }, [value, open]);

  const previewText = rich ? stripHtml(value) : String(value || '').trim();
  const empty = !previewText;

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      await onSave?.(draft);
      scope.close();
    } catch (e) {
      setError(e.payload?.error || e.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setDraft(value ?? '');
    setError(null);
    scope.close();
  }

  if (!open) {
    return (
      <div className="group">
        <div className="text-[11px] text-gray-400 mb-0.5">{label}</div>
        <button
          type="button"
          onClick={() => { setDraft(value ?? ''); scope.requestOpen(id); }}
          className="w-full text-right rounded-md -mx-2 px-2 py-1.5 min-h-[36px] flex items-start gap-2 transition-colors hover:bg-gray-50"
        >
          {empty ? (
            <span className="text-sm text-gray-300">{placeholder}</span>
          ) : (
            <span className="text-[13px] text-gray-700 leading-snug line-clamp-2">{previewText}</span>
          )}
          <span className="ms-auto shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
        </button>
      </div>
    );
  }

  return (
    <div className="animate-[inlineIn_120ms_ease-out]">
      <div className="text-[11px] text-gray-400 mb-1">{label}</div>
      {rich ? (
        <RichEditor value={draft} onChange={setDraft} toolbar="lite" collapsible maxHeight="220px" ariaLabel={label} placeholder={placeholder} />
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          placeholder={placeholder}
          className="w-full rounded-md border border-blue-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      )}
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={commit} disabled={saving} className="bg-emerald-600 text-white text-sm rounded-md px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
          {saving ? 'שומר…' : 'שמור'}
        </button>
        <button type="button" onClick={cancel} disabled={saving} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
          ביטול
        </button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}
