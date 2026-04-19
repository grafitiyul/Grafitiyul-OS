import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { ITEM_KIND_LABELS, ITEM_KINDS } from './config.js';
import EditorTopBar from './EditorTopBar.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';
import DeleteItemDialog from '../../common/DeleteItemDialog.jsx';
import {
  commitPending,
  getPending,
  clearPending,
} from '../flows/pendingFlowInsert.js';

// Content-item editor. Autosaves to the server on every change so the user
// never loses work; the row exists from the first keystroke (see the bank
// list's "+ new" flow which pre-creates the item before this page loads).
// No separate draft layer — the server row IS the draft.
export default function ContentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext();
  const [searchParams] = useSearchParams();
  // If this editor was opened from a flow's "+ create new" button, the
  // return-to-flow context is stashed in sessionStorage; the flag below
  // unlocks the "הוסף לזרימה" primary action in the header.
  const returnToFlow = searchParams.get('returnTo') === 'flow';
  const pending = returnToFlow ? getPending() : null;

  const [form, setForm] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [insertingToFlow, setInsertingToFlow] = useState(false);

  const formRef = useRef(null);
  formRef.current = form;
  const idRef = useRef(id);
  idRef.current = id;
  // Dirty flag — only the user's actual edits should trigger autosave.
  // Loading an item from the server is NOT an edit; the old code let that
  // transition schedule a no-op save, whose refresh() re-flowed the entire
  // bank list through props and caused a visible jump ~700 ms after click.
  const dirtyRef = useRef(false);

  // Load the existing item (row already exists — created by the bank "+ new"
  // pre-create or a prior edit session).
  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setLoadError(null);
    // Fresh id = not dirty until the user types.
    dirtyRef.current = false;
    (async () => {
      try {
        const item = await api.contentItems.get(id);
        if (cancelled) return;
        setForm({
          title: item.title || '',
          body: item.body || '',
          internalNote: item.internalNote || '',
        });
        setSavedAt(item.updatedAt || null);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Debounced server autosave — gated on dirtyRef so it runs only for
  // genuine user edits. Successful saves do NOT trigger a full bank refresh:
  // the "נשמר" indicator here is local state, and the bank list's titles
  // can stay slightly stale while editing (they refresh on next real action
  // like create / delete / move / folder op). This keeps the list DOM
  // absolutely stable when the user is just clicking around.
  useEffect(() => {
    if (!form || !dirtyRef.current) return;
    const handle = setTimeout(async () => {
      const snapshot = formRef.current;
      const targetId = idRef.current;
      if (!snapshot || !targetId) return;
      setSaving(true);
      try {
        const updated = await api.contentItems.update(targetId, {
          title: snapshot.title,
          body: snapshot.body,
          internalNote: snapshot.internalNote.trim() || null,
        });
        setSavedAt(updated.updatedAt);
      } catch (e) {
        console.warn('autosave failed:', e.message);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [form]);

  function updateForm(patch) {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, ...patch }));
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const onDelete = useCallback(() => setDeleteOpen(true), []);
  const onDeleted = useCallback(async () => {
    await refresh?.();
    navigate('/admin/procedures/bank', { replace: true });
  }, [navigate, refresh]);

  async function addToFlow() {
    if (!id || !pending) return;
    setInsertingToFlow(true);
    try {
      // Make sure any in-flight autosave finishes so the flow inserts the
      // latest version of the item. A simple immediate PUT is enough —
      // the server accepts concurrent updates (last write wins).
      await api.contentItems.update(id, {
        title: form.title,
        body: form.body,
        internalNote: form.internalNote.trim() || null,
      });
      const { flowId } = await commitPending(ITEM_KINDS.CONTENT, id, form);
      await refresh?.();
      navigate(`/admin/procedures/flows/${flowId}`);
    } catch (e) {
      window.alert('הוספה לזרימה נכשלה: ' + e.message);
    } finally {
      setInsertingToFlow(false);
    }
  }

  function cancelReturnToFlow() {
    clearPending();
    // Keep the draft in the bank so the user doesn't lose what they typed.
    navigate(`/admin/procedures/bank/content/${id}`, { replace: true });
  }

  if (loadError) return <LoadError error={loadError} />;
  if (!form) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  const previewUrl = `/preview/content/${id}`;

  return (
    <div className="h-full w-full flex flex-col">
      <EditorTopBar
        kindLabel={ITEM_KIND_LABELS[ITEM_KINDS.CONTENT]}
        title={titleToPlain(form.title) || 'טיוטה'}
        savedIndicator={<SavedIndicator saving={saving} savedAt={savedAt} />}
        canDelete
        onDelete={onDelete}
        previewUrl={previewUrl}
      />

      <DeleteItemDialog
        open={deleteOpen}
        kind="content"
        itemId={id}
        itemTitle={titleToPlain(form.title)}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      {returnToFlow && pending && (
        <ReturnToFlowBanner
          busy={insertingToFlow}
          onSubmit={addToFlow}
          onCancel={cancelReturnToFlow}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
          <Section title="תצוגה לעובד">
            <Field
              label="כותרת"
              hint="תומך בשדות דינמיים — השתמש בכפתור {{ } בתוך הכותרת."
            >
              <div className="w-full border border-gray-300 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400">
                <TitleEditor
                  value={form.title}
                  onChange={(html) => updateForm({ title: html })}
                  placeholder="כותרת הפריט"
                  ariaLabel="כותרת"
                />
              </div>
            </Field>
            <Field
              label="תוכן"
              hint="עיצוב, רשימות, קישורים ושדות דינמיים נתמכים."
            >
              <RichEditor
                value={form.body}
                onChange={(html) => updateForm({ body: html })}
                ariaLabel="תוכן הפריט"
                minContentHeight={260}
              />
            </Field>
          </Section>

          <Section title="מטה-מידע">
            <Field label="הערה פנימית" hint="לא מוצג לעובדים. לשימוש פנימי בלבד.">
              <textarea
                value={form.internalNote}
                onChange={(e) => updateForm({ internalNote: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                placeholder="הערה פנימית (אופציונלי)"
              />
            </Field>
          </Section>
        </div>
      </div>
    </div>
  );
}

function SavedIndicator({ saving, savedAt }) {
  if (saving) {
    return <span className="text-[12px] text-gray-500">שומר…</span>;
  }
  if (!savedAt) return null;
  const rel = formatRelative(savedAt);
  return <span className="text-[12px] text-gray-500">נשמר {rel}</span>;
}

function formatRelative(iso) {
  const d = new Date(iso);
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 5) return 'עכשיו';
  if (sec < 60) return `לפני ${Math.round(sec)} שניות`;
  const min = Math.round(sec / 60);
  if (min < 60) return `לפני ${min} דקות`;
  return d.toLocaleString('he-IL');
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
        {title}
      </h2>
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        {children}
      </div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function ReturnToFlowBanner({ busy, onSubmit, onCancel }) {
  return (
    <div className="bg-blue-50 border-b border-blue-200 px-5 py-3 flex items-center gap-3 shrink-0">
      <span>⤴</span>
      <div className="flex-1 text-sm text-blue-900">
        נוצר כחלק מזרימה. סיים את הפריט וסגור אותו מיד לתוך הזרימה.
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-[12px] text-gray-600 px-3 py-1.5 rounded hover:bg-blue-100 disabled:opacity-40"
      >
        השאר בבנק
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="text-sm bg-blue-600 text-white rounded px-4 py-1.5 font-medium hover:bg-blue-700 disabled:opacity-40"
      >
        {busy ? 'מוסיף…' : 'הוסף לזרימה'}
      </button>
    </div>
  );
}

function LoadError({ error }) {
  return (
    <div className="p-6 text-center">
      <div className="text-sm text-red-600 mb-2">שגיאה בטעינת הפריט</div>
      <div className="text-xs text-gray-500 font-mono" dir="ltr">
        {error}
      </div>
    </div>
  );
}
