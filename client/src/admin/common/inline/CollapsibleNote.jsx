import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
// Read mode never flattens formatting — paragraphs, line breaks, empty lines and
// emphasis are preserved exactly as the editor produced them. By default it shows
// only the first ~3 lines (height clip, NOT a text flatten) with a "show more"
// control when there is additional content.
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Matches InlineField's LABEL so notes line up with the fields above them.
const LABEL = 'block text-[11px] text-gray-400 mb-1.5 px-2';
// Collapsed height ≈ 3 lines at the read font size. Clipping by height preserves
// the formatting of the visible lines (unlike a text/line truncation).
const COLLAPSED_MAXH = '4.6rem';
const COLLAPSED_PX = 74;

export default function CollapsibleNote({ id, label, value, rich = false, placeholder, onSave }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!open) { setDraft(value ?? ''); setError(null); }
  }, [value, open]);
  // New content resets to the collapsed view.
  useEffect(() => { setExpanded(false); }, [value]);

  const hasText = rich ? !!stripHtml(value) : !!String(value || '').trim();
  const empty = !hasText;

  // Show the expand control only when the full content exceeds the collapsed height.
  // scrollHeight reflects the full content even while clipped, so this is stable in
  // both collapsed and expanded states.
  useLayoutEffect(() => {
    if (open || empty) { setHasMore(false); return; }
    const el = contentRef.current;
    if (el) setHasMore(el.scrollHeight > COLLAPSED_PX + 4);
  }, [value, open, empty, expanded, rich]);

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
    // Height clip (not text truncation) so the visible lines keep their formatting.
    const clip = !expanded ? { maxHeight: COLLAPSED_MAXH, overflow: 'hidden' } : undefined;
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
              ref={contentRef}
              style={clip}
              className="gos-prose gos-prose-tight text-[15px] text-gray-900"
              dangerouslySetInnerHTML={{ __html: normalizeRichHtml(value) }}
            />
          ) : (
            // Plain note: keep the author's line breaks (pre-wrap), never flatten.
            <div ref={contentRef} style={clip} className="text-[15px] text-gray-900 whitespace-pre-wrap leading-relaxed">{String(value)}</div>
          )}
          <span className="absolute top-2 left-1.5 shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
        </div>
        {/* Expand control — sibling of the click-to-edit area, so it never edits. */}
        {!empty && hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 ms-2 inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline"
          >
            {expanded ? 'הצג פחות' : 'הצג עוד'}
            <span className="text-[8px]" aria-hidden>{expanded ? '▲' : '▼'}</span>
          </button>
        )}
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
