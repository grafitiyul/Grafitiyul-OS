import { useEffect, useState } from 'react';
import RichEditor from '../../../editor/RichEditor.jsx';
import { normalizeRichHtml } from '../../../editor/htmlNormalize.js';
import { useInlineScope } from './InlineEditScope.jsx';

// Collapsed-by-default note field for the inline platform pattern. Read state shows
// a light placeholder when empty, or the FORMATTED content when it has a value —
// rich notes render through the shared .gos-prose surface (same renderer as the
// timeline / learner runtime), plain notes keep their line breaks via pre-wrap.
// Click anywhere on the value to edit; ✓ saves and collapses, ✕ cancels. Governed
// by the one-at-a-time scope.
//
// Read mode never flattens formatting — paragraphs, line breaks and emphasis are
// preserved exactly as the editor produced them.
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Matches InlineField's LABEL so notes line up with the fields above them.
const LABEL = 'block text-[11px] text-gray-400 mb-1.5 px-2';

export default function CollapsibleNote({ id, label, value, rich = false, placeholder, onSave }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) { setDraft(value ?? ''); setError(null); }
  }, [value, open]);

  const hasText = rich ? !!stripHtml(value) : !!String(value || '').trim();
  const empty = !hasText;

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
  function openEdit() {
    setDraft(value ?? '');
    scope.requestOpen(id);
  }

  if (!open) {
    return (
      <div className="group">
        <span className={LABEL}>{label}</span>
        <div
          role="button"
          tabIndex={0}
          onClick={openEdit}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(); } }}
          className="relative w-full text-right rounded-md px-2 py-1.5 min-h-[38px] cursor-pointer transition-colors hover:bg-gray-50"
        >
          {empty ? (
            <span className="text-[15px] text-gray-300">{placeholder}</span>
          ) : rich ? (
            // Shared rich-render surface — preserves paragraphs/spacing/emphasis.
            <div
              className="gos-prose gos-prose-tight text-[15px] text-gray-900"
              dangerouslySetInnerHTML={{ __html: normalizeRichHtml(value) }}
            />
          ) : (
            // Plain note: keep the author's line breaks (pre-wrap), never flatten.
            <div className="text-[15px] text-gray-900 whitespace-pre-wrap leading-relaxed">{String(value)}</div>
          )}
          <span className="absolute top-2 left-1.5 shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-[inlineIn_120ms_ease-out]">
      <span className={LABEL}>{label}</span>
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
