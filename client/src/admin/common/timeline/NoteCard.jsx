import { useRef, useState } from 'react';
import RichEditor from '../../../editor/RichEditor.jsx';
import AnchoredMenu from '../AnchoredMenu.jsx';
import AlertDialog from '../AlertDialog.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { normalizeRichHtml } from '../../../editor/htmlNormalize.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import { actorDisplay } from './actor.js';
import { useDirtyForm } from '../../../lib/dirtyForms.js';

// Origin + absolute date & time stamp shown on every timeline object. The origin
// is never anonymous: a human shows their name; an API/automation/system/import
// shows its source label + a small typed badge.
//
// Reading hierarchy (index.css §GOS READING HIERARCHY): the AUTHOR is the
// secondary level — .gos-meta-key, so the eye lands on "who" first — and the
// date/time/source ride .gos-meta at a smaller size with tabular figures, so
// stamps line up column-wise between stacked notes and become scannable
// without being loud. Nothing was removed: badge, name, date, time and the
// "נערך" flag all still render.
function fmtDatePart(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '';
  }
}
function fmtTimePart(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
// WHO — the leading (right, in RTL) edge of the identity strip, because that is
// where the eye starts. Badge first when the origin is not a human.
function ActorTag({ item, compact = false }) {
  const { name, badge } = actorDisplay(item);
  return (
    <span className="gos-meta-cluster min-w-0 shrink-0">
      {badge && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      <span className={`truncate ${compact ? 'gos-meta' : 'gos-meta-key'}`}>{name}</span>
    </span>
  );
}

// WHEN — the trailing edge. Date and time are two tokens, not one string: at
// tabular figures they align between stacked notes, so the operator finds the
// stamp by position instead of reading it.
function TimeTag({ item, edited }) {
  return (
    <span className="gos-meta-cluster shrink-0">
      <span className="gos-meta whitespace-nowrap" dir="ltr">{fmtDatePart(item.createdAt)}</span>
      <span className="gos-meta whitespace-nowrap" dir="ltr">{fmtTimePart(item.createdAt)}</span>
      {edited && (
        <>
          <span className="gos-sep" aria-hidden>·</span>
          <span className="gos-meta">נערך</span>
        </>
      )}
    </span>
  );
}

// Comments are one line each — WHO and WHEN stay in a single trailing cluster.
function StampLine({ item, edited }) {
  return (
    <span className="gos-meta-cluster shrink-0">
      <ActorTag item={item} compact />
      <span className="gos-sep" aria-hidden>·</span>
      <TimeTag item={item} edited={edited} />
    </span>
  );
}

// A single timeline note. Permanent light-yellow card. Supports edit / delete /
// pin / collapse-expand and nested white comments. The note BODY is rich HTML
// (rendered via the shared .gos-prose surface, same as everywhere else). The
// small muted origin label (e.g. "תוכן הפנייה") shows only when the entry carries
// data.origin — otherwise it's a perfectly normal note.
const ORIGIN_LABELS = { inquiry: 'תוכן הפנייה' };

// Source badge prefix for aggregated items (shown on Contact / Organization
// pages where the feed mixes in items owned by related deals / contacts).
const SOURCE_PREFIX = { deal: 'מדיל', contact: 'מאיש קשר', organization: 'מארגון' };

export default function NoteCard({
  entry,
  expanded,
  onToggleExpand,
  dragHandle,
  onEdit,
  onDelete,
  onTogglePin,
  onAddComment,
  onEditComment,
  onDeleteComment,
  // Aggregated (related-subject) items are read-only here and carry a source
  // badge. Direct items on the page's own subject are fully interactive.
  readOnly = false,
  source = null,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body || '');
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef(null);

  const originLabel = ORIGIN_LABELS[entry.data?.origin];
  const comments = entry.comments || [];

  // Unsaved-work guard: an in-progress note edit (changed from the original body)
  // or a half-typed comment blocks an auto-update reload.
  useDirtyForm((editing && draft !== (entry.body || '')) || !!commentDraft.trim());

  async function saveEdit() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onEdit(entry.id, body);
      setEditing(false);
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setConfirmDelete(false);
    try {
      await onDelete(entry.id);
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    }
  }
  async function addComment() {
    const b = commentDraft.trim();
    if (!b || busy) return;
    setBusy(true);
    try {
      await onAddComment(entry.id, b);
      setCommentDraft('');
      setReplying(false);
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
      {/* Identity strip — its OWN band, separated from the content by a hairline.
          Reading order in RTL: who wrote it (leading edge) → what kind of note
          it is (origin/source chips) → when (trailing edge) → actions. The
          operator answers "who / when / source" before a single word of the
          note is read, which is the whole point of giving it a band. */}
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-2">
        {dragHandle}
        <ActorTag item={entry} />
        {originLabel && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800">
            {originLabel}
          </span>
        )}
        {source && source.label && (
          <span className="rounded bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none truncate max-w-[12rem]">
            {/* A merge-provenance label already reads as a full sentence
                ("במקור מדיל #27100") — prefixing it would produce
                "מקור: במקור מדיל…". Every other source type keeps its prefix. */}
            {source.type === 'merged_deal'
              ? source.label
              : `${SOURCE_PREFIX[source.type] || 'מקור'}: ${source.label}`}
          </span>
        )}
        {entry.isPinned && (
          <span className="text-amber-500 text-[12px] leading-none" title="נעוץ ל-FOCUS" aria-hidden>📌</span>
        )}
        <div className="flex-1" />
        {/* Metadata — trailing edge, low-emphasis, out of the reading path. */}
        <TimeTag item={entry} edited={!!entry.editedAt} />
        <IconBtn title={expanded ? 'כווץ' : 'הרחב'} onClick={onToggleExpand}>{expanded ? '▾' : '▸'}</IconBtn>
        {/* Actions live in a 3-dot menu so the card stays calm. Read-only
            (aggregated) items expose no actions at all. */}
        {!readOnly && (
          <>
            <button
              ref={menuRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="פעולות"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[15px] leading-none text-gray-400 hover:text-gray-700 hover:bg-amber-100"
            >
              ⋮
            </button>
            <AnchoredMenu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={160}>
              <button
                onClick={() => { setMenuOpen(false); onTogglePin(entry); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                {entry.isPinned ? 'בטל נעיצה' : 'נעץ ל-FOCUS'}
              </button>
              <button
                onClick={() => { setMenuOpen(false); setDraft(entry.body || ''); setEditing(true); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                עריכה
              </button>
              <button
                onClick={() => { setMenuOpen(false); setReplying(true); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                תגובה
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                className="block w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                מחיקה
              </button>
            </AnchoredMenu>
          </>
        )}
      </div>

      {/* Body — the PRIMARY level. The hairline above it is what turns the
          metadata into a header instead of a first line of content. */}
      <div className="border-t border-amber-200/60 px-4 pb-3 pt-2.5">
        {editing ? (
          <div className="space-y-2">
            <RichEditor preset="note" value={draft} onChange={setDraft} minContentHeight={80} maxHeight="50vh" ariaLabel="עריכת פתק" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                ביטול
              </button>
              <button onClick={saveEdit} disabled={busy || !draft.trim()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'שומר…' : 'שמור'}
              </button>
            </div>
          </div>
        ) : expanded ? (
          <div className="gos-prose gos-prose-tight text-[15px]" dangerouslySetInnerHTML={{ __html: normalizeRichHtml(entry.body || '', 'tight') }} />
        ) : (
          // Collapsed → single preview line (click to expand). Still the
          // primary level: a collapsed note is content, not metadata.
          <button type="button" onClick={onToggleExpand} className="gos-body block w-full truncate text-right">
            {titleToPlain(entry.body || '') || '(ריק)'}
          </button>
        )}
      </div>

      {/* Comments — white, nested under the yellow note. The reply editor is
          hidden by default (history stays clean); "תגובה" reveals it per-note. */}
      {/* Comments — white, nested. Existing comments always show; the reply
          editor opens only from the 3-dot "תגובה" action (never by default). */}
      {!editing && (comments.length > 0 || replying) && (
        <div className="border-t border-amber-200/70 bg-amber-100/30 px-3 py-2 rounded-b-2xl space-y-2">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} onEdit={onEditComment} onDelete={onDeleteComment} readOnly={readOnly} />
          ))}
          {replying && !readOnly && (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addComment(); }
                  else if (e.key === 'Escape') { setReplying(false); setCommentDraft(''); }
                }}
                placeholder="הוסיפו תגובה…"
                className="flex-1 h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button onClick={addComment} disabled={busy || !commentDraft.trim()} className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-900 disabled:opacity-50">
                הגב
              </button>
              <button onClick={() => { setReplying(false); setCommentDraft(''); }} className="text-[12px] text-gray-500 hover:text-gray-700">
                ביטול
              </button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת פתק"
        body="למחוק את הפתק? התגובות שלו יימחקו איתו. לא ניתן לבטל פעולה זו."
        confirmLabel="מחק פתק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}

function CommentRow({ comment, onEdit, onDelete, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Unsaved-work guard: an in-progress comment edit (changed from the original).
  useDirtyForm(editing && draft !== comment.body);

  async function save() {
    const b = draft.trim();
    if (!b || busy) return;
    setBusy(true);
    try {
      await onEdit(comment.id, b);
      setEditing(false);
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setConfirmDelete(false);
    try {
      await onDelete(comment.id);
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 h-8 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button onClick={save} disabled={busy} className="text-[12px] text-blue-700">שמור</button>
          <button onClick={() => setEditing(false)} className="text-[12px] text-gray-500">ביטול</button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="gos-subject flex-1 whitespace-pre-wrap">{comment.body}</div>
          <StampLine item={comment} />
          {!readOnly && (
            <>
              <button onClick={() => { setDraft(comment.body); setEditing(true); }} className="text-[12px] text-blue-700 shrink-0">ערוך</button>
              <button onClick={() => setConfirmDelete(true)} className="text-[12px] text-red-600 shrink-0">מחק</button>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת תגובה"
        body="למחוק את התגובה? לא ניתן לבטל פעולה זו."
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}

function IconBtn({ children, title, onClick, active }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-[13px] transition ${
        active ? 'bg-amber-200 text-amber-800' : 'text-gray-400 hover:text-gray-700 hover:bg-amber-100'
      }`}
    >
      {children}
    </button>
  );
}
