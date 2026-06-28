import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import RichEditor from '../../../editor/RichEditor.jsx';
import ReorderableList from '../ReorderableList.jsx';
import NoteCard from './NoteCard.jsx';
import { useDirtyForm } from '../../../lib/dirtyForms.js';

// Reusable Timeline / Activity-Feed. Entity-agnostic: it is scoped ONLY by
// `subjectType` + `subjectId`, so the exact same component drops into Deal,
// Contact, Organization (and future) pages with no redesign. V1 supports the
// 'note' kind (rich, yellow, pinnable, commentable); the other composer actions
// already exist as tabs so the structure naturally grows.

// Official brand marks for the composer tabs (recognizable logos, not custom
// graphics). Emoji covers the generic kinds.
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#25D366" d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24z" />
      <path fill="#FFF" d="M12.05 21.785h-.005a9.87 9.87 0 0 1-5.03-1.378l-.36-.214-3.742.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.889-9.884a9.82 9.82 0 0 1 6.991 2.898 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.884 9.884m5.422-7.403c-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.149-.173.198-.297.297-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347" />
    </svg>
  );
}
function GmailIcon() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2L24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  );
}

// Composer kinds. Only 'note' is functional in V1; the rest are visible tabs the
// architecture already expects (placeholders until their modules land).
const COMPOSER_TABS = [
  { key: 'note', label: 'פתק', enabled: true, icon: '📝' },
  { key: 'activity', label: 'פעילות', enabled: false, icon: '✅' },
  { key: 'whatsapp', label: 'וואטסאפ', enabled: false, icon: <WhatsAppIcon /> },
  { key: 'email', label: 'אימייל', enabled: false, icon: <GmailIcon /> },
  { key: 'file', label: 'קובץ', enabled: false, icon: '📎' },
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

  // Unsaved-work guard: a half-written note blocks an auto-update reload.
  useDirtyForm(!!draft.trim());

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
    <div className="space-y-3" dir="rtl">
      {/* Composer */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-1 border-b border-gray-100 px-2 pt-2">
          {COMPOSER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg -mb-px border-b-2 transition ${
                tab === t.key ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span aria-hidden className="inline-flex items-center text-[14px] leading-none">{t.icon}</span>
              <span>{t.label}</span>
              {!t.enabled && <span className="text-[10px] text-gray-400">בקרוב</span>}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === 'note' ? (
            <div className="space-y-2">
              <RichEditor
                tone="note"
                collapsible
                value={draft}
                onChange={setDraft}
                placeholder="כתבו פתק…"
                maxHeight="50vh"
                ariaLabel="פתק חדש"
              />
              {/* The post button appears once there's something to post — keeps
                  the collapsed composer minimal. */}
              {draft.trim() && (
                <div className="flex justify-end">
                  <button
                    onClick={postNote}
                    disabled={posting}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {posting ? 'מוסיף…' : 'הוסף פתק'}
                  </button>
                </div>
              )}
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
