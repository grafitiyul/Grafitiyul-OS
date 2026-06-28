import { useState } from 'react';
import RichEditor from '../../../editor/RichEditor.jsx';
import { normalizeRichHtml } from '../../../editor/htmlNormalize.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import { actorDisplay } from './actor.js';
import { useDirtyForm } from '../../../lib/dirtyForms.js';

// Origin + absolute date & time stamp shown on every timeline object. The origin
// is never anonymous: a human shows their name; an API/automation/system/import
// shows its source label + a small typed badge.
function fmtStamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}
function StampLine({ item, edited, className = 'text-[11px] text-gray-400' }) {
  const { name, badge } = actorDisplay(item);
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {badge && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
      )}
      <span className="font-medium text-gray-500">{name}</span>
      {' · '}
      {fmtStamp(item.createdAt)}
      {edited ? ' · נערך' : ''}
    </span>
  );
}

// A single timeline note. Permanent light-yellow card. Supports edit / delete /
// pin / collapse-expand and nested white comments. The note BODY is rich HTML
// (rendered via the shared .gos-prose surface, same as everywhere else). The
// small muted origin label (e.g. "תוכן הפנייה") shows only when the entry carries
// data.origin — otherwise it's a perfectly normal note.
const ORIGIN_LABELS = { inquiry: 'תוכן הפנייה' };

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
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body || '');
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');

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
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm('למחוק את הפתק?')) return;
    try {
      await onDelete(entry.id);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
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
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3">
        {dragHandle}
        {originLabel && <span className="text-[11px] font-medium text-amber-700/80">{originLabel}</span>}
        <StampLine item={entry} edited={!!entry.editedAt} />
        <div className="flex-1" />
        <IconBtn title={entry.isPinned ? 'בטל נעיצה' : 'נעץ ל-FOCUS'} active={entry.isPinned} onClick={() => onTogglePin(entry)}>📌</IconBtn>
        {!editing && (
          <IconBtn title="עריכה" onClick={() => { setDraft(entry.body || ''); setEditing(true); }}>✎</IconBtn>
        )}
        <IconBtn title="מחק" onClick={remove}>🗑</IconBtn>
        <IconBtn title={expanded ? 'כווץ' : 'הרחב'} onClick={onToggleExpand}>{expanded ? '▾' : '▸'}</IconBtn>
      </div>

      {/* Body */}
      <div className="px-4 pb-3 pt-1">
        {editing ? (
          <div className="space-y-2">
            <RichEditor tone="note" value={draft} onChange={setDraft} minContentHeight={80} maxHeight="50vh" ariaLabel="עריכת פתק" />
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
          <div className="gos-prose text-[15px]" dangerouslySetInnerHTML={{ __html: normalizeRichHtml(entry.body || '') }} />
        ) : (
          // Collapsed → single preview line (click to expand).
          <button type="button" onClick={onToggleExpand} className="block w-full text-right text-sm text-gray-600 truncate">
            {titleToPlain(entry.body || '') || '(ריק)'}
          </button>
        )}
      </div>

      {/* Comments — white, nested under the yellow note. The reply editor is
          hidden by default (history stays clean); "תגובה" reveals it per-note. */}
      {!editing && (
        <div
          className={`border-t border-amber-200/70 px-3 py-2 rounded-b-2xl space-y-2 ${
            comments.length || replying ? 'bg-amber-100/30' : ''
          }`}
        >
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} onEdit={onEditComment} onDelete={onDeleteComment} />
          ))}
          {replying ? (
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
          ) : (
            <button type="button" onClick={() => setReplying(true)} className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">
              + תגובה
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);

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
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm('למחוק את התגובה?')) return;
    try {
      await onDelete(comment.id);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
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
          <div className="flex-1 text-sm text-gray-800 whitespace-pre-wrap">{comment.body}</div>
          <StampLine item={comment} className="text-[10px] text-gray-400 shrink-0" />
          <button onClick={() => { setDraft(comment.body); setEditing(true); }} className="text-[12px] text-blue-700 shrink-0">ערוך</button>
          <button onClick={remove} className="text-[12px] text-red-600 shrink-0">מחק</button>
        </div>
      )}
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
