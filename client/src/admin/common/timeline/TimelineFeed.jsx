import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { readDraftMap, writeDraftEntry } from '../../../lib/localDrafts.js';
import RichEditor from '../../../editor/RichEditor.jsx';
import ReorderableList from '../ReorderableList.jsx';
import NoteCard from './NoteCard.jsx';
import AlertDialog from '../AlertDialog.jsx';
import WhatsAppPanel from '../../whatsapp/WhatsAppPanel.jsx';
import TaskComposer from '../../deals/tasks/TaskComposer.jsx';
import OpenTasksStrip from '../../deals/tasks/OpenTasksStrip.jsx';
import NextTaskDialog from '../../deals/tasks/NextTaskDialog.jsx';
import { shouldPromptNextTask } from '../../deals/tasks/nextTaskPrompt.js';
import TaskEventRow from '../../deals/tasks/TaskEventRow.jsx';
import FileEventRow from '../../deals/files/FileEventRow.jsx';
import ChangeEventRow from './ChangeEventRow.jsx';
import EmailEventRow from '../../email/EmailEventRow.jsx';
import EmailThreadModal from '../../email/EmailThreadModal.jsx';
import TourEventRow from './TourEventRow.jsx';
import EmailPanel from '../../email/EmailPanel.jsx';
import DealFilesTab from '../../deals/files/DealFilesTab.jsx';
import WhatsAppTemplateModal from '../../deals/whatsapp/WhatsAppTemplateModal.jsx';
import WhatsAppIconShared from '../icons/WhatsAppIcon.jsx';
import GmailIcon from '../icons/GmailIcon.jsx';
import AccountingEventRow from './AccountingEventRow.jsx';
import QuoteEventRow from './QuoteEventRow.jsx';
import CommunicationEventRow from './CommunicationEventRow.jsx';
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
  // Opens a MODAL instead of switching the composer body (see MODAL_TABS) —
  // picking a stored wording is a short focused task, not an authoring surface.
  // Deal-only: it resolves variables against the deal's primary contact.
  { key: 'wa_template', label: 'תבנית ווטסאפ', enabled: false, icon: <WhatsAppIconShared /> },
];

// Composer tabs that open a dialog rather than becoming the active tab.
const MODAL_TABS = new Set(['wa_template']);

// History-only subject types — surfaces where the timeline is a READ-ONLY
// record of what happened, never an authoring/composer surface. Tours are an
// operational execution surface: their events (created / joined / left) are a
// log, and CRM authoring (notes / tasks / email / WhatsApp / files) belongs to
// the Deal, not the Tour. Listing the subject here (rather than relying on a
// caller to pass a prop) guarantees the composer can NEVER be re-enabled for it
// by accident from a future call site.
const HISTORY_ONLY_SUBJECTS = new Set(['tour_event']);

// Local note-draft persistence (Pipedrive-style) — a half-written note must
// survive closing a drawer, leaving the page, or returning days later. Scoped
// by subjectType:subjectId so drafts never leak between deals/contacts/orgs.
// Storage engine is the shared lib/localDrafts.js (same one the task drafts
// use); saving or cancelling the note clears it.
const NOTE_DRAFTS_KEY = 'gos-note-drafts';

function readNoteDrafts() {
  return readDraftMap(NOTE_DRAFTS_KEY);
}

// RichEditor "empty" can be '<p></p>' / whitespace-only markup — strip tags to
// decide whether there is real content worth persisting.
function noteIsEmpty(html) {
  return !html || !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function writeNoteDraft(key, html) {
  writeDraftEntry(NOTE_DRAFTS_KEY, key, noteIsEmpty(html) ? null : html);
}

// `showWhatsApp={false}` drops the WhatsApp composer tab — the Deal page
// surfaces chat through the floating WhatsAppDock instead of the timeline.
export default function TimelineFeed({ subjectType, subjectId, aggregate = false, showWhatsApp = true, onSendDocument = null, readOnly = false, dealStatus = null }) {
  // History-only: no composer, no authoring actions — a pure read-only event
  // log. Forced ON for HISTORY_ONLY_SUBJECTS (e.g. tours) so a caller can never
  // accidentally surface Deal CRM authoring on an execution surface; an explicit
  // `readOnly` prop can also request it for any subject.
  const historyOnly = readOnly || HISTORY_ONLY_SUBJECTS.has(subjectType);
  const noteDraftKey = `${subjectType}:${subjectId}`;
  // Tasks + files are Deal-only features; on Contact/Organization they stay
  // "בקרוב" placeholders so the shared component keeps one shape.
  const isDeal = subjectType === 'deal';
  const composerTabs = COMPOSER_TABS
    .filter((t) => showWhatsApp || t.key !== 'whatsapp')
    .map((t) => {
      if (t.key === 'task' || t.key === 'file' || t.key === 'wa_template') return { ...t, enabled: isDeal };
      if (t.key === 'email') return { ...t, enabled: isDeal || subjectType === 'contact' };
      return t;
    });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('note');
  // Latched so the task-completion callback reads the CURRENT tab without
  // taking it as a dependency (which would re-create the callback on every tab
  // change and re-arm the prompt).
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [waTemplateOpen, setWaTemplateOpen] = useState(false);
  // The email thread opened FROM the feed. One modal for the whole list, not
  // one per row, and the same component the אימייל tab mounts.
  const [openEmailThread, setOpenEmailThread] = useState(null); // { id, subject }
  // Restore any saved draft for THIS subject on mount.
  const [draft, setDraft] = useState(() => readNoteDrafts()[noteDraftKey] || '');
  // True when the composer opened with a previously-saved draft (shows the
  // "טיוטה" indicator so restored text clearly reads as a draft).
  const [draftRestored, setDraftRestored] = useState(() => !noteIsEmpty(readNoteDrafts()[noteDraftKey]));
  // Bumped on ביטול / record switch — remounts the rich editor so its internal
  // DOM state clears/reloads along with the draft.
  const [editorNonce, setEditorNonce] = useState(0);
  // The nonce of the editor instance ALLOWED to write the draft. A remounted
  // (destroyed) TipTap editor fires one final blur flush with its OLD content
  // during teardown; without this guard that flush resurrected the
  // just-cleared draft — save left the composer "open" with the note text and
  // a second click posted a DUPLICATE note (production bug), and ביטול needed
  // two clicks for the same reason.
  const liveEditorNonce = useRef(0);
  const [posting, setPosting] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert
  // Composer tab strip — keeps the ACTIVE tab visible when the strip scrolls
  // horizontally (narrow viewports).
  const tabStripRef = useRef(null);
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    strip
      .querySelector(`[data-composer-tab="${tab}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab]);
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
    setEditorNonce((n) => {
      liveEditorNonce.current = n + 1;
      return n + 1;
    });
  }, [noteDraftKey]);

  function clearDraft() {
    setDraft('');
    setDraftRestored(false);
    writeNoteDraft(noteDraftKey, '');
    setEditorNonce((n) => {
      liveEditorNonce.current = n + 1;
      return n + 1;
    });
  }

  // Draft writes are accepted ONLY from the live editor instance — the
  // teardown blur of a replaced editor (see liveEditorNonce) is ignored.
  const draftChangeFor = (nonce) => (html) => {
    if (nonce !== liveEditorNonce.current) return;
    setDraft(html);
  };
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

  // EVERY task on the deal, in one read.
  //
  // A task lives in exactly one section, and that section IS its status: OPEN
  // in the Focus strip, TERMINAL in HISTORY. Loading only the open ones was
  // enough while History rows were inert text; now a completed row carries the
  // live reopen control, and a control must act on the real record — not on the
  // snapshot frozen into the timeline event when it was written.
  const [allTasks, setAllTasks] = useState([]);
  const loadTasks = useCallback(async () => {
    if (!isDeal) return null;
    try {
      const list = await api.dealTasks.list(subjectId);
      const next = Array.isArray(list) ? list : [];
      setAllTasks(next);
      return next.filter((t) => t.status === 'open');
    } catch {
      /* non-fatal — the strip just stays empty */
      return null;
    }
  }, [isDeal, subjectId]);
  const openTasks = useMemo(() => allTasks.filter((t) => t.status === 'open'), [allTasks]);
  const tasksById = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  // The newest task event per task id — the row that represents where that
  // task stands right now. Entries arrive newest-first, so the first one wins.
  const latestTaskEntryId = useMemo(() => {
    const seen = new Map();
    for (const e of entries || []) {
      const id = e?.kind === 'task' ? e.data?.taskId : null;
      if (id && !seen.has(id)) seen.set(id, e.id);
    }
    return seen;
  }, [entries]);

  // Owner names for the shared task editor, reached from a HISTORY row.
  const [taskUserMap, setTaskUserMap] = useState({});
  useEffect(() => {
    if (!isDeal) return;
    api.adminUsers
      .list()
      .then((res) => {
        const arr = Array.isArray(res) ? res : res?.users || [];
        setTaskUserMap(Object.fromEntries(arr.map((u) => [u.id, u.username])));
      })
      .catch(() => {});
  }, [isDeal]);

  // Reopen from a HISTORY row — the canonical terminal→open transition (the
  // same /api/tasks/bulk path every other reopen uses, so there is one
  // transition code path however a task gets reopened). On success the task
  // reloads as OPEN and moves itself back to Focus; on failure nothing moved,
  // and the row stays exactly where it was.
  const reopenFromHistory = useCallback(
    async (task) => {
      await api.tasks.bulk({ action: 'reopen', ids: [task.id] });
      await loadTasks();
      refresh();
    },
    [loadTasks, refresh],
  );
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // ── "what happens next?" ────────────────────────────────────────────────
  //
  // Completing the LAST open task on an OPEN deal leaves it with nothing
  // scheduled — which is exactly how a live lead goes quiet. So GOS offers the
  // next task. It is a PROMPT, not a write: nothing is created unless the
  // operator saves, and closing it creates nothing at all.
  //
  // The offer is a DIALOG. It first switched to the משימה tab, which unmounted
  // whatever the operator had open underneath — a half-written note, an email
  // draft, the WhatsApp panel — so a prompt meant to help destroyed the work in
  // progress. The composer already had the right pattern for this (MODAL_TABS /
  // תבנית ווטסאפ): an action that opens a dialog and leaves the tab alone.
  //
  // Every condition for showing it lives in the pure shouldPromptNextTask.
  // Keyed by the completed task id so one completion prompts at most once
  // (realtime refetch, double-click, poll tick) while a genuine second
  // completion later still prompts.
  const promptedForRef = useRef(null);
  const [nextTaskOpen, setNextTaskOpen] = useState(false);
  const onTaskChanged = useCallback(
    async (cause) => {
      // The SERVER's current task state decides whether that was really the
      // last one — never the row the client happened to be looking at. A stale
      // client that disagrees loses. loadTasks returns null when the read
      // failed, which the rule treats as "do not guess".
      const next = await loadTasks();
      refresh();
      if (
        !shouldPromptNextTask({
          cause,
          dealStatus,
          openTasks: next,
          promptedFor: promptedForRef.current,
          activeTab: tabRef.current,
        })
      ) {
        return;
      }
      promptedForRef.current = cause.taskId;
      // A DIALOG, never a tab switch. Switching tabs unmounted whatever was
      // open underneath — a half-written note, an email draft, the WhatsApp
      // panel — so a helpful prompt destroyed the operator's actual work.
      setNextTaskOpen(true);
    },
    [loadTasks, refresh, dealStatus],
  );

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
      const next = await loadTasks();
      if (next && next.map((t) => t.id).join(',') !== prevIds) refresh();
    }, 15000);
    return () => clearInterval(iv);
  }, [isDeal, subjectId, openTasks, refresh, loadTasks]);

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
      setAlertMsg('שגיאה בשמירת הפתק: ' + (e.payload?.error || e.message));
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
      setAlertMsg('שגיאה בשינוי הסדר: ' + e.message);
      refresh();
    }
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* Composer — authoring only. Hidden entirely in history-only mode so the
          Deal CRM composer (notes / tasks / email / WhatsApp / files) never
          appears on read-only surfaces like the Tour timeline. */}
      {!historyOnly && (
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* The tab strip SCROLLS horizontally when it doesn't fit (phones):
            labels never clip, every tab stays reachable, and the active tab is
            auto-scrolled into view. Desktop is unaffected (no overflow). */}
        <div ref={tabStripRef} className="flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-gray-100 px-2 pt-2">
          {composerTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              data-composer-tab={t.key}
              onClick={() => {
                if (!MODAL_TABS.has(t.key)) return setTab(t.key);
                if (t.enabled) setWaTemplateOpen(true);
                return undefined;
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13px] font-medium rounded-t-lg -mb-px border-b-2 transition ${
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
                onChange={draftChangeFor(editorNonce)}
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
            // Keyed by deal: a deal→deal navigation must remount the composer
            // so it rehydrates THAT deal's draft (state never leaks across).
            <TaskComposer key={subjectId} dealId={subjectId} onCreated={onTaskChanged} />
          ) : tab === 'file' && isDeal ? (
            <DealFilesTab dealId={subjectId} onChanged={refresh} />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
              {composerTabs.find((t) => t.key === tab)?.label} — ייפתח בגרסה הבאה.
            </div>
          )}
        </div>
      </div>
      )}

      {/* Template picker → resolved draft → the REAL chat composer/send path.
          Refresh after a send so any resulting activity lands in the feed. */}
      {!historyOnly && isDeal && (
        <WhatsAppTemplateModal
          open={waTemplateOpen}
          dealId={subjectId}
          onClose={() => setWaTemplateOpen(false)}
          onSent={() => refresh()}
        />
      )}

      {/* The canonical Email Thread modal, opened from a timeline row. Exactly
          the component the אימייל tab and the Contact page use, so all three
          open the same thread with the same reply / reply-all / forward /
          attachments / mark-read behaviour. Closing refreshes the feed so a
          reply sent inside it shows up as a row without a Deal reload. */}
      <EmailThreadModal
        open={!!openEmailThread}
        thread={openEmailThread}
        dealId={isDeal ? subjectId : null}
        contactId={subjectType === 'contact' ? subjectId : null}
        onClose={() => {
          setOpenEmailThread(null);
          refresh();
        }}
        onChanged={refresh}
      />

      {/* "מה הצעד הבא?" — the last open task on an OPEN deal was just
          completed. Rendered HERE, outside the composer body, exactly like the
          template modal above: the active tab keeps rendering underneath, so
          every draft in it survives untouched.

          onCreated runs the SAME refresh path as the tab composer, then closes.
          Closing without saving creates nothing. */}
      {!historyOnly && isDeal && (
        <NextTaskDialog
          open={nextTaskOpen}
          dealId={subjectId}
          onClose={() => setNextTaskOpen(false)}
          onCreated={() => {
            setNextTaskOpen(false);
            onTaskChanged();
          }}
        />
      )}

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
          {isDeal && !historyOnly && showFocus && (
            <OpenTasksStrip dealId={subjectId} tasks={openTasks} onChanged={onTaskChanged} />
          )}

          {/* FOCUS — pinned DIRECT items, manually ordered. History-only surfaces
              show a flat event log, so FOCUS/pinning is suppressed there. */}
          {!historyOnly && showFocus && pinned.length > 0 && (
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
                {entries.length === 0
                  ? historyOnly
                    ? 'אין עדיין היסטוריה.'
                    : 'אין עדיין פתקים. כתבו את הראשון למעלה.'
                  : 'אין פריטים בקטגוריה זו.'}
              </div>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => {
                  // Task events render as compact rows (not editable notes).
                  // The NEWEST event for a task is the one that represents its
                  // current state, so that is the only row that may carry the
                  // live control — an older completion from a previous
                  // complete → reopen → complete cycle stays an audit line.
                  if (entry.kind === 'task') {
                    const taskId = entry.data?.taskId;
                    return (
                      <li key={entry.id}>
                        <TaskEventRow
                          entry={entry}
                          task={taskId ? tasksById.get(taskId) : null}
                          live={!!taskId && latestTaskEntryId.get(taskId) === entry.id}
                          dealId={subjectId}
                          userMap={taskUserMap}
                          onReopen={reopenFromHistory}
                          onChanged={onTaskChanged}
                        />
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
                  // Clicking one opens the SAME canonical thread modal the
                  // אימייל tab and the Contact page use — the feed is a way IN
                  // to the conversation, never a second reader.
                  if (entry.kind === 'email') {
                    return (
                      <li key={entry.id}>
                        <EmailEventRow entry={entry} onOpenThread={setOpenEmailThread} />
                      </li>
                    );
                  }
                  // Quote events (generated / sent — permanent public URL).
                  if (entry.kind === 'quote') {
                    return (
                      <li key={entry.id}>
                        <QuoteEventRow entry={entry} />
                      </li>
                    );
                  }
                  // Tours lifecycle events (created / joined / left / orphaned).
                  if (entry.kind === 'tour') {
                    return (
                      <li key={entry.id}>
                        <TourEventRow entry={entry} />
                      </li>
                    );
                  }
                  // Communication Center automated sends (kind='communication').
                  if (entry.kind === 'communication') {
                    return (
                      <li key={entry.id}>
                        <CommunicationEventRow entry={entry} />
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
                        readOnly={historyOnly || (aggregate && !direct)}
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
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-[12px] font-bold tracking-wide text-gray-500 mb-2">{children}</h3>;
}
