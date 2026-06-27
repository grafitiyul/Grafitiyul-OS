import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import RichEditor from '../../../editor/RichEditor.jsx';
import ReorderableList from '../ReorderableList.jsx';
import NoteCard from './NoteCard.jsx';

// Reusable Timeline / Activity-Feed. Entity-agnostic: it is scoped ONLY by
// `subjectType` + `subjectId`, so the exact same component drops into Deal,
// Contact, Organization (and future) pages with no redesign. V1 supports the
// 'note' kind (rich, yellow, pinnable, commentable); the other composer actions
// already exist as tabs so the structure naturally grows.

// Composer kinds. Only 'note' is functional in V1; the rest are visible tabs the
// architecture already expects (placeholders until their modules land).
const COMPOSER_TABS = [
  { key: 'note', label: 'פתק', enabled: true },
  { key: 'activity', label: 'פעילות', enabled: false },
  { key: 'whatsapp', label: 'וואטסאפ', enabled: false },
  { key: 'email', label: 'אימייל', enabled: false },
  { key: 'file', label: 'קובץ', enabled: false },
];

export default function TimelineFeed({ subjectType, subjectId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('note');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  // Global expand: default ON. Per-note overrides take precedence over it.
  const [expandAll, setExpandAll] = useState(true);
  const [expandOverrides, setExpandOverrides] = useState({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setEntries(await api.timeline.list(subjectType, subjectId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // FOCUS = pinned, in manual order (newest pinned is NOT necessarily first).
  const pinned = useMemo(
    () => entries.filter((e) => e.isPinned).sort((a, b) => a.pinSortOrder - b.pinSortOrder),
    [entries],
  );
  // HISTORY = all live entries, newest first (server already orders by createdAt desc).
  const history = entries;

  const isExpanded = (id) => (id in expandOverrides ? expandOverrides[id] : expandAll);
  const toggleExpand = (id) => setExpandOverrides((o) => ({ ...o, [id]: !isExpanded(id) }));
  const setExpandAllReset = (v) => { setExpandAll(v); setExpandOverrides({}); };

  const replaceEntry = (updated) =>
    setEntries((es) => es.map((e) => (e.id === updated.id ? updated : e)));

  async function postNote() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await api.timeline.create({ subjectType, subjectId, kind: 'note', body });
      setDraft('');
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירת הפתק: ' + (e.payload?.error || e.message));
    } finally {
      setPosting(false);
    }
  }

  // Per-note actions handed to every NoteCard. Each mutation returns the updated
  // entry (with comments) so we can replace it in place — no full reload.
  const actions = {
    onEdit: async (id, body) => replaceEntry(await api.timeline.update(id, { body })),
    onDelete: async (id) => {
      await api.timeline.remove(id);
      setEntries((es) => es.filter((e) => e.id !== id));
    },
    onTogglePin: async (entry) => replaceEntry(await api.timeline.pin(entry.id, !entry.isPinned)),
    onAddComment: async (id, body) => replaceEntry(await api.timeline.addComment(id, body)),
    onEditComment: async (commentId, body) => replaceEntry(await api.timeline.updateComment(commentId, body)),
    onDeleteComment: async (commentId) => replaceEntry(await api.timeline.removeComment(commentId)),
  };

  async function reorderPins(ids) {
    // Optimistic local reorder, then persist (same reorder pattern as catalogs).
    setEntries((es) =>
      es.map((e) => {
        const i = ids.indexOf(e.id);
        return i >= 0 ? { ...e, pinSortOrder: i } : e;
      }),
    );
    try {
      await api.timeline.reorderPins(subjectType, subjectId, ids);
    } catch (e) {
      alert('שגיאה בשינוי הסדר: ' + e.message);
      refresh();
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Composer */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-1 border-b border-gray-100 px-2 pt-2">
          {COMPOSER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-[13px] font-medium rounded-t-lg -mb-px border-b-2 transition ${
                tab === t.key ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {!t.enabled && <span className="ms-1 text-[10px] text-gray-400">בקרוב</span>}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === 'note' ? (
            <div className="space-y-2">
              <RichEditor
                value={draft}
                onChange={setDraft}
                placeholder="כתבו פתק…"
                minContentHeight={120}
                ariaLabel="פתק חדש"
              />
              <div className="flex justify-end">
                <button
                  onClick={postNote}
                  disabled={posting || !draft.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {posting ? 'מוסיף…' : 'הוסף פתק'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
              {COMPOSER_TABS.find((t) => t.key === tab)?.label} — ייפתח בגרסה הבאה.
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-red-600">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <>
          {/* FOCUS — pinned, manually ordered */}
          {pinned.length > 0 && (
            <section>
              <SectionTitle>FOCUS</SectionTitle>
              <ReorderableList
                items={pinned}
                onReorder={reorderPins}
                renderRow={(entry, { handle }) => (
                  <NoteCard
                    entry={entry}
                    expanded={isExpanded(entry.id)}
                    onToggleExpand={() => toggleExpand(entry.id)}
                    dragHandle={handle}
                    {...actions}
                  />
                )}
              />
            </section>
          )}

          {/* HISTORY — everything, newest first */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle>היסטוריה</SectionTitle>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandAllReset(!expandAll)}
                  className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1"
                >
                  {expandAll ? 'כווץ הכל' : 'הרחב הכל'}
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">
                אין עדיין פתקים. כתבו את הראשון למעלה.
              </div>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <NoteCard
                      entry={entry}
                      expanded={isExpanded(entry.id)}
                      onToggleExpand={() => toggleExpand(entry.id)}
                      {...actions}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-[12px] font-bold tracking-wide text-gray-500 mb-2">{children}</h3>;
}
