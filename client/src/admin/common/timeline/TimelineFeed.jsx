import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import RichEditor from '../../../editor/RichEditor.jsx';
import ReorderableList from '../ReorderableList.jsx';
import NoteCard from './NoteCard.jsx';
import WhatsAppPanel from '../../whatsapp/WhatsAppPanel.jsx';
import TaskComposer from '../../deals/tasks/TaskComposer.jsx';
import OpenTasksStrip from '../../deals/tasks/OpenTasksStrip.jsx';
import TaskEventRow from '../../deals/tasks/TaskEventRow.jsx';
import FileEventRow from '../../deals/files/FileEventRow.jsx';
import ChangeEventRow from './ChangeEventRow.jsx';
import EmailEventRow from '../../email/EmailEventRow.jsx';
import EmailPanel from '../../email/EmailPanel.jsx';
import DealFilesTab from '../../deals/files/DealFilesTab.jsx';
import WhatsAppIconShared from '../icons/WhatsAppIcon.jsx';
import GmailIcon from '../icons/GmailIcon.jsx';
import AccountingEventRow from './AccountingEventRow.jsx';
import { DEAL_TASKS_CHANGED_EVENT } from '../../deals/tasks/taskEvents.js';
import { useDirtyForm } from '../../../lib/dirtyForms.js';

// Reusable Timeline / Activity-Feed. Entity-agnostic: it is scoped ONLY by
// `subjectType` + `subjectId`, so the exact same component drops into Deal,
// Contact, Organization (and future) pages with no redesign. V1 supports the
// 'note' kind (rich, yellow, pinnable, commentable); the other composer actions
// already exist as tabs so the structure naturally grows.

// Official brand marks for the composer tabs (recognizable logos, not custom
// graphics). Emoji covers the generic kinds. WhatsApp + Gmail use the shared
// marks from common/icons/.

// Paperclip (attachment) — inline SVG in the project's existing hand-rolled
// style (stroke = currentColor), matching the other tab icons. No new dependency.
function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-gray-500"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// Composer kinds. Only 'note' is functional in V1; the rest are visible tabs the
// architecture already expects (placeholders until their modules land).
// 'task' (משימה) + 'file' become functional on Deal pages (subjectType==='deal');
// elsewhere they stay "בקרוב" placeholders. NOTE: replaces the old disabled
// 'פעילות'/Activity tab — the product wording is now משימה, never "Activity".
const COMPOSER_TABS = [
  { key: 'note', label: 'פתק', enabled: true, icon: '📝' },
  { key: 'task', label: 'משימה', enabled: false, icon: '✅' },
  { key: 'whatsapp', label: 'וואטסאפ', enabled: true, icon: <WhatsAppIconShared /> },
  // Functional on Deal + Contact pages (EmailPanel); placeholder elsewhere.
  { key: 'email', label: 'אימייל', enabled: false, icon: <GmailIcon /> },
  { key: 'file', label: 'קובץ', enabled: false, icon: <PaperclipIcon /> },
];

// Local note-draft persistence (Pipedrive-style) — a half-written note must
// survive closing a drawer, leaving the page, or returning days later. Scoped
// by subjectType:subjectId so drafts never leak between deals/contacts/orgs.
// localStorage only (V1); saving or cancelling the note clears it.
const NOTE_DRAFTS_KEY = 'gos-note-drafts';

function readNoteDrafts() {
  try {
    return JSON.parse(localStorage.getItem(NOTE_DRAFTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

// RichEditor "empty" can be '<p></p>' / whitespace-only markup — strip tags to
// decide whether there is real content worth persisting.
function noteIsEmpty(html) {
  return !html || !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function writeNoteDraft(key, html) {
  try {
    const map = readNoteDrafts();
    if (noteIsEmpty(html)) delete map[key];
    else map[key] = html;
    // Safety valve: never let the map grow unbounded.
    const keys = Object.keys(map);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete map[k];
    localStorage.setItem(NOTE_DRAFTS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// `showWhatsApp={false}` drops the WhatsApp composer tab — the Deal page
// surfaces chat through the floating WhatsAppDock instead of the timeline.
export default function TimelineFeed({ subjectType, subjectId, aggregate = false, showWhatsApp = true, onSendDocument = null }) {
  const noteDraftKey = `${subjectType}:${subjectId}`;
  // Tasks + files are Deal-only features; on Contact/Organization they stay
  // "בקרוב" placeholders so the shared component keeps one shape.
  const isDeal = subjectType === 'deal';
  const composerTabs = COMPOSER_TABS
    .filter((t) => showWhatsApp || t.key !== 'whatsapp')
    .map((t) => {
      if (t.key === 'task' || t.key === 'file') return { ...t, enabled: isDeal };
      if (t.key === 'email') return { ...t, enabled: isDeal || subjectType === 'contact' };
      return t;
    });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('note');
  // Restore any saved draft for THIS subject on mount.
  const [draft, setDraft] = useState(() => readNoteDrafts()[noteDraftKey] || '');
  // True when the composer opened with a previously-saved draft (shows the
  // "טיוטה" indicator so restored text clearly reads as a draft).
  const [draftRestored, setDraftRestored] = useState(() => !noteIsEmpty(readNoteDrafts()[noteDraftKey]));
  // Bumped on ביטול / record switch — remounts the rich editor so its internal
  // DOM state clears/reloads along with the draft.
  const [editorNonce, setEditorNonce] = useState(0);
  const [posting, setPosting] = useState(false);
  const draftKeyRef = useRef(noteDraftKey);
  const draftValRef = useRef(draft);
  draftValRef.current = draft;

  // Persist the draft while typing (debounced) and flush on unmount, so
  // closing a drawer / navigating away never loses in-progress text.
  useEffect(() => {
    const t = setTimeout(() => writeNoteDraft(noteDraftKey, draft), 300);
    return () => clearTimeout(t);
  }, [noteDraftKey, draft]);
  useEffect(() => () => writeNoteDraft(draftKeyRef.current, draftValRef.current), []);

  // Switching to a different record: flush the old draft, load the new one.
  useEffect(() => {
    const prevKey = draftKeyRef.current;
    if (prevKey === noteDraftKey) return;
    writeNoteDraft(prevKey, draftValRef.current);
    draftKeyRef.current = noteDraftKey;
    const restored = readNoteDrafts()[noteDraftKey] || '';
    setDraft(restored);
    setDraftRestored(!noteIsEmpty(restored));
    setEditorNonce((n) => n + 1);
  }, [noteDraftKey]);

  function clearDraft() {
    setDraft('');
    setDraftRestored(false);
    writeNoteDraft(noteDraftKey, '');
    setEditorNonce((n) => n + 1);
  }
  // Global expand: default ON. Per-note overrides take precedence over it.
  const [expandAll, setExpandAll] = useState(true);
  const [expandOverrides, setExpandOverrides] = useState({});
  // Aggregate-view source filter (Contact/Organization pages): all|direct|deal|contact.
  const [scope, setScope] = useState('all');

  // Unsaved-work guard: a half-written note blocks an auto-update reload.
  useDirtyForm(!!draft.trim());

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setEntries(
        aggregate
          ? await api.timeline.aggregate(subjectType, subjectId)
          : await api.timeline.list(subjectType, subjectId),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId, aggregate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Open tasks (Deal focus area). Terminal tasks are NOT loaded here — they
  // arrive as kind='task' timeline events in HISTORY.
  const [openTasks, setOpenTasks] = useState([]);
  const loadTasks = useCallback(async () => {
    if (!isDeal) return;
    try {
      const list = await api.dealTasks.list(subjectId, 'open');
      setOpenTasks(Array.isArray(list) ? list : []);
    } catch {
      /* non-fatal — the strip just stays empty */
    }
  }, [isDeal, subjectId]);
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);
  // A task change can both move it out of the open list AND drop a history event.
  const onTaskChanged = useCallback(() => {
    loadTasks();
    refresh();
  }, [loadTasks, refresh]);

  // Immediate refresh when a task changes OUTSIDE this component (e.g. a WhatsApp
  // message scheduled from the floating dock creates a Task) — no page refresh.
  useEffect(() => {
    if (!isDeal) return undefined;
    const onExternal = (e) => {
      if (e?.detail?.dealId === subjectId) onTaskChanged();
    };
    window.addEventListener(DEAL_TASKS_CHANGED_EVENT, onExternal);
    return () => window.removeEventListener(DEAL_TASKS_CHANGED_EVENT, onExternal);
  }, [isDeal, subjectId, onTaskChanged]);

  // Background poll: a scheduled WhatsApp task is sent by a server-side worker,
  // so nothing on the client fires. While there's an open WhatsApp task, poll;
  // when the open-task set changes (one got sent/cancelled) refresh the history
  // too so it moves down immediately without a manual refresh.
  useEffect(() => {
    if (!isDeal) return undefined;
    const hasWhatsappTask = openTasks.some((t) => t.channel === 'whatsapp');
    if (!hasWhatsappTask) return undefined;
    const prevIds = openTasks.map((t) => t.id).join(',');
    const iv = setInterval(async () => {
      try {
        const list = await api.dealTasks.list(subjectId, 'open');
        const next = Array.isArray(list) ? list : [];
        setOpenTasks(next);
        if (next.map((t) => t.id).join(',') !== prevIds) refresh();
      } catch {
        /* transient — try again next tick */
      }
    }, 15000);
    return () => clearInterval(iv);
  }, [isDeal, subjectId, openTasks, refresh]);

  // An item is "direct" when it's owned by THIS page's subject; otherwise it's an
  // aggregated item from a related deal/contact (read-only, source-badged).
  const isDirect = (e) => e.subjectType === subjectType && e.subjectId === subjectId;

  // FOCUS = pinned DIRECT items, manual order (aggregated items can't be pinned here).
  const pinned = useMemo(
    () =>
      entries
        .filter((e) => e.isPinned && e.subjectType === subjectType && e.subjectId === subjectId)
        .sort((a, b) => a.pinSortOrder - b.pinSortOrder),
    [entries, subjectType, subjectId],
  );

  // Aggregate filter chips — only show a type chip when such items exist.
  const hasDeal = aggregate && entries.some((e) => e.sourceType === 'deal');
  const hasContact = aggregate && entries.some((e) => e.sourceType === 'contact');
  const scopeChips = aggregate
    ? [
        { key: 'all', label: 'הכל' },
        { key: 'direct', label: 'ישיר' },
        ...(hasDeal ? [{ key: 'deal', label: 'דילים' }] : []),
        ...(hasContact ? [{ key: 'contact', label: 'אנשי קשר' }] : []),
      ]
    : [];

  // HISTORY = all live items, newest first, filtered by the active scope chip.
  const history = entries.filter((e) => {
    if (!aggregate || scope === 'all') return true;
    if (scope === 'direct') return isDirect(e);
    return e.sourceType === scope; // 'deal' | 'contact'
  });
  const showFocus = !aggregate || scope === 'all' || scope === 'direct';

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
      clearDraft();
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
          {composerTabs.map((t) => (
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
        <div className="p-2">
          {tab === 'note' ? (
            <div className="space-y-2">
              <RichEditor
                key={editorNonce}
                preset="note"
                collapsible
                value={draft}
                onChange={setDraft}
                placeholder="כתבו פתק…"
                maxHeight="50vh"
                ariaLabel="פתק חדש"
              />
              {/* The action buttons appear once there's something to post —
                  keeps the collapsed composer minimal. ביטול discards the
                  draft entirely (nothing is saved). */}
              {draft.trim() && (
                // onMouseDown preventDefault: clicking a button blurs the
                // collapsible editor, which collapses and MOVES the buttons
                // before mouseup — so the click never fired (the "ביטול needs
                // two clicks" bug). Keeping focus during mousedown lets the
                // click land; the action itself then resets/collapses.
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                      draftRestored
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                        : 'text-gray-400'
                    }`}
                    title="הטקסט נשמר אוטומטית כטיוטה מקומית עד שתשמרו או תבטלו"
                  >
                    ● טיוטה שלא נשמרה
                  </span>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={clearDraft}
                      disabled={posting}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      בטל טיוטה
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={postNote}
                      disabled={posting}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {posting ? 'מוסיף…' : 'שמור פתק'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'whatsapp' ? (
            <WhatsAppPanel subjectType={subjectType} subjectId={subjectId} />
          ) : tab === 'email' && (isDeal || subjectType === 'contact') ? (
            <EmailPanel subjectType={subjectType} subjectId={subjectId} />
          ) : tab === 'task' && isDeal ? (
            <TaskComposer dealId={subjectId} onCreated={onTaskChanged} />
          ) : tab === 'file' && isDeal ? (
            <DealFilesTab dealId={subjectId} onChanged={refresh} />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
              {composerTabs.find((t) => t.key === tab)?.label} — ייפתח בגרסה הבאה.
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
          {/* Aggregate source filter (Contact / Organization pages) */}
          {scopeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {scopeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setScope(c.key)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium border transition ${
                    scope === c.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* OPEN TASKS — Deal focus area (fed by the tasks API, not the timeline) */}
          {isDeal && showFocus && (
            <OpenTasksStrip dealId={subjectId} tasks={openTasks} onChanged={onTaskChanged} />
          )}

          {/* FOCUS — pinned DIRECT items, manually ordered */}
          {showFocus && pinned.length > 0 && (
            <section>
              <SectionTitle>FOCUS</SectionTitle>
              <ReorderableList
                items={pinned}
                onReorder={reorderPins}
                renderRow={(entry, { handle }) =>
                  entry.kind === 'accounting' ? (
                    <AccountingEventRow entry={entry} dragHandle={handle} onTogglePin={actions.onTogglePin} onSendDocument={onSendDocument} />
                  ) : (
                    <NoteCard
                      entry={entry}
                      expanded={isExpanded(entry.id)}
                      onToggleExpand={() => toggleExpand(entry.id)}
                      dragHandle={handle}
                      {...actions}
                    />
                  )
                }
              />
            </section>
          )}

          {/* HISTORY — everything (scope-filtered), newest first */}
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
                {entries.length === 0 ? 'אין עדיין פתקים. כתבו את הראשון למעלה.' : 'אין פריטים בקטגוריה זו.'}
              </div>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => {
                  // Terminal task events render as compact rows (not editable notes).
                  if (entry.kind === 'task') {
                    return (
                      <li key={entry.id}>
                        <TaskEventRow entry={entry} />
                      </li>
                    );
                  }
                  // File upload/delete events (chronological, same history feed).
                  if (entry.kind === 'file') {
                    return (
                      <li key={entry.id}>
                        <FileEventRow entry={entry} />
                      </li>
                    );
                  }
                  // Structured Deal changelog events (field old → new, grouped per save).
                  if (entry.kind === 'change') {
                    return (
                      <li key={entry.id}>
                        <ChangeEventRow entry={entry} />
                      </li>
                    );
                  }
                  // Email events (read-time merged from the email mirror).
                  if (entry.kind === 'email') {
                    return (
                      <li key={entry.id}>
                        <EmailEventRow entry={entry} />
                      </li>
                    );
                  }
                  // Accounting events (iCount documents / custom payment links).
                  if (entry.kind === 'accounting') {
                    return (
                      <li key={entry.id}>
                        <AccountingEventRow
                          entry={entry}
                          onTogglePin={isDirect(entry) ? actions.onTogglePin : null}
                          onSendDocument={onSendDocument}
                        />
                      </li>
                    );
                  }
                  const direct = isDirect(entry);
                  return (
                    <li key={entry.id}>
                      <NoteCard
                        entry={entry}
                        expanded={isExpanded(entry.id)}
                        onToggleExpand={() => toggleExpand(entry.id)}
                        readOnly={aggregate && !direct}
                        source={aggregate && !direct ? { type: entry.sourceType, label: entry.sourceLabel } : null}
                        {...actions}
                      />
                    </li>
                  );
                })}
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
