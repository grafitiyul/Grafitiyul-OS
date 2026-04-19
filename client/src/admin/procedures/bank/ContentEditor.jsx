import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { ITEM_KIND_LABELS, ITEM_KINDS } from './config.js';
import EditorTopBar from './EditorTopBar.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';
import DeleteItemDialog from '../../common/DeleteItemDialog.jsx';
import {
  draftKeys,
  loadDraft,
  clearDraft,
  makeDebouncedDraftSaver,
} from '../../../lib/drafts.js';

const EMPTY = { title: '', body: '', internalNote: '' };

export default function ContentEditor({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext();

  const [form, setForm] = useState(mode === 'new' ? EMPTY : null);
  const [original, setOriginal] = useState(mode === 'new' ? EMPTY : null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [draftInfo, setDraftInfo] = useState(null); // { data, savedAt } | null
  const baseSavedAtRef = useRef(null);

  const draftKey = useMemo(
    () => draftKeys.contentItem(mode === 'edit' ? id : 'new'),
    [id, mode],
  );

  // Debounced draft writer. Recreated when the key changes so drafts from
  // one editor session don't leak into another.
  const draftSaverRef = useRef(null);
  useEffect(() => {
    draftSaverRef.current = makeDebouncedDraftSaver(
      draftKey,
      baseSavedAtRef.current,
    );
    return () => {
      draftSaverRef.current?.flush();
    };
  }, [draftKey]);

  // Load existing item when editing.
  useEffect(() => {
    if (mode !== 'edit') return;
    let cancelled = false;
    setForm(null);
    setOriginal(null);
    setLoadError(null);
    (async () => {
      try {
        const item = await api.contentItems.get(id);
        if (cancelled) return;
        const data = {
          title: item.title || '',
          body: item.body || '',
          internalNote: item.internalNote || '',
        };
        baseSavedAtRef.current = item.updatedAt || null;
        setForm(data);
        setOriginal(data);
        // Check for a newer draft than the server copy.
        const draft = await loadDraft(draftKey);
        if (!cancelled && draft && isDraftNewer(draft, item.updatedAt)) {
          setDraftInfo({ data: draft.data, savedAt: draft.savedAt });
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, mode, draftKey]);

  // Reset on mode switch from edit -> new (fresh form) + check for pending new-draft.
  useEffect(() => {
    if (mode !== 'new') return;
    let cancelled = false;
    setForm(EMPTY);
    setOriginal(EMPTY);
    setLoadError(null);
    baseSavedAtRef.current = null;
    (async () => {
      const draft = await loadDraft(draftKey);
      if (!cancelled && draft?.data) {
        setDraftInfo({ data: draft.data, savedAt: draft.savedAt });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, draftKey]);

  const dirty =
    form && original && JSON.stringify(form) !== JSON.stringify(original);
  const canSave =
    !!form && titleToPlain(form.title).trim().length > 0 && (mode === 'new' || dirty);

  // Persist a debounced draft whenever the form diverges from the server copy.
  useEffect(() => {
    if (!form || !draftSaverRef.current) return;
    if (!dirty && mode === 'edit') return; // nothing to draft
    if (mode === 'new' && isFormEmpty(form)) return; // don't seed an empty draft
    draftSaverRef.current.save(form);
  }, [form, dirty, mode]);

  function updateForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function restoreDraft() {
    if (!draftInfo) return;
    setForm(draftInfo.data);
    setDraftInfo(null);
  }

  async function discardDraft() {
    await clearDraft(draftKey);
    setDraftInfo(null);
  }

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        body: form.body,
        internalNote: form.internalNote.trim() || null,
      };
      if (mode === 'new') {
        const created = await api.contentItems.create(payload);
        draftSaverRef.current?.cancel();
        await clearDraft(draftKey);
        await refresh();
        navigate(`/admin/procedures/bank/content/${created.id}`, { replace: true });
      } else {
        await api.contentItems.update(id, payload);
        setOriginal(form);
        draftSaverRef.current?.cancel();
        await clearDraft(draftKey);
        await refresh();
      }
    } catch (e) {
      alert(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  function onDelete() {
    if (mode !== 'edit') return;
    setDeleteOpen(true);
  }
  async function onDeleted() {
    await clearDraft(draftKey);
    await refresh();
    navigate('/admin/procedures/bank', { replace: true });
  }

  if (loadError) {
    return <LoadError error={loadError} />;
  }
  if (!form) {
    return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  }

  return (
    <div className="h-full w-full flex flex-col">
      <EditorTopBar
        kindLabel={ITEM_KIND_LABELS[ITEM_KINDS.CONTENT]}
        title={titleToPlain(form.title) || 'פריט חדש'}
        dirty={dirty}
        saving={saving}
        canSave={canSave}
        canDelete={mode === 'edit'}
        onSave={onSave}
        onDelete={onDelete}
      />

      <DeleteItemDialog
        open={deleteOpen}
        kind="content"
        itemId={id}
        itemTitle={titleToPlain(form.title)}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
          {draftInfo && (
            <DraftBanner
              savedAt={draftInfo.savedAt}
              onRestore={restoreDraft}
              onDiscard={discardDraft}
            />
          )}
          <Section title="תצוגה לעובד">
            <Field label="כותרת" hint="ניתן להשתמש בשדות דינמיים ({{key}}) גם בכותרת.">
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

function isDraftNewer(draft, serverUpdatedAt) {
  if (!draft?.savedAt) return false;
  if (!serverUpdatedAt) return true;
  return new Date(draft.savedAt).getTime() > new Date(serverUpdatedAt).getTime();
}

function isFormEmpty(form) {
  return (
    titleToPlain(form.title).trim() === '' &&
    !form.body &&
    (!form.internalNote || form.internalNote.trim() === '')
  );
}

function DraftBanner({ savedAt, onRestore, onDiscard }) {
  const when = savedAt ? new Date(savedAt).toLocaleString('he-IL') : '';
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3 flex items-start gap-2 text-sm">
      <span>📝</span>
      <div className="flex-1">
        <div className="font-semibold">יש טיוטה לא שמורה</div>
        <div className="text-[12px]">
          נשמרה אוטומטית ב-{when}. ניתן לשחזר את העבודה או להמשיך מהגרסה השמורה בשרת.
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onRestore}
          className="text-[12px] bg-amber-600 text-white rounded px-3 py-1 hover:bg-amber-700"
        >
          שחזר
        </button>
        <button
          onClick={onDiscard}
          className="text-[12px] text-gray-700 hover:bg-amber-100 rounded px-3 py-1"
        >
          בטל
        </button>
      </div>
    </div>
  );
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
