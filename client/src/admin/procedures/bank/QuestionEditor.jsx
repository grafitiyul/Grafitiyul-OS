import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import {
  ANSWER_TYPES,
  ANSWER_TYPE_LABELS,
  ITEM_KINDS,
  ITEM_KIND_LABELS,
} from './config.js';
import EditorTopBar from './EditorTopBar.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';
import DeleteItemDialog from '../../common/DeleteItemDialog.jsx';

// Question-item editor. Same autosave pattern as ContentEditor — the server
// row already exists when this page loads; every change is PUT-saved.
export default function QuestionEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext();

  const [form, setForm] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const formRef = useRef(null);
  formRef.current = form;
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setLoadError(null);
    (async () => {
      try {
        const item = await api.questionItems.get(id);
        if (cancelled) return;
        setForm({
          title: item.title || '',
          questionText: item.questionText || '',
          answerType: item.answerType || ANSWER_TYPES.OPEN_TEXT,
          options: Array.isArray(item.options) ? item.options : [],
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

  useEffect(() => {
    if (!form) return;
    const handle = setTimeout(async () => {
      const snapshot = formRef.current;
      const targetId = idRef.current;
      if (!snapshot || !targetId) return;
      setSaving(true);
      try {
        const updated = await api.questionItems.update(targetId, {
          title: snapshot.title,
          questionText: snapshot.questionText,
          answerType: snapshot.answerType,
          options:
            snapshot.answerType === ANSWER_TYPES.SINGLE_CHOICE
              ? snapshot.options.map((o) => o.trim()).filter(Boolean)
              : [],
          internalNote: snapshot.internalNote.trim() || null,
        });
        setSavedAt(updated.updatedAt);
        await refresh?.();
      } catch (e) {
        console.warn('autosave failed:', e.message);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [form, refresh]);

  function setField(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function setOption(idx, value) {
    setForm((f) => {
      const next = [...f.options];
      next[idx] = value;
      return { ...f, options: next };
    });
  }
  function addOption() {
    setForm((f) => ({ ...f, options: [...f.options, ''] }));
  }
  function removeOption(idx) {
    setForm((f) => {
      const next = [...f.options];
      next.splice(idx, 1);
      return { ...f, options: next };
    });
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const onDelete = useCallback(() => setDeleteOpen(true), []);
  const onDeleted = useCallback(async () => {
    await refresh?.();
    navigate('/admin/procedures/bank', { replace: true });
  }, [navigate, refresh]);

  if (loadError) return <LoadError error={loadError} />;
  if (!form) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  const previewUrl = `/preview/question/${id}`;

  return (
    <div className="h-full w-full flex flex-col">
      <EditorTopBar
        kindLabel={ITEM_KIND_LABELS[ITEM_KINDS.QUESTION]}
        title={titleToPlain(form.title) || 'טיוטה'}
        savedIndicator={<SavedIndicator saving={saving} savedAt={savedAt} />}
        canDelete
        onDelete={onDelete}
        previewUrl={previewUrl}
      />

      <DeleteItemDialog
        open={deleteOpen}
        kind="question"
        itemId={id}
        itemTitle={titleToPlain(form.title)}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
          <Section title="תצוגה לעובד">
            <Field
              label="כותרת"
              hint="תומך בשדות דינמיים בתוך הכותרת."
            >
              <div className="w-full border border-gray-300 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400">
                <TitleEditor
                  value={form.title}
                  onChange={(html) => setField({ title: html })}
                  placeholder="כותרת פנימית לזיהוי השאלה"
                  ariaLabel="כותרת"
                />
              </div>
            </Field>
            <Field
              label="נוסח השאלה"
              hint="הטקסט שיראה העובד. תומך בעיצוב, קישורים ושדות דינמיים."
            >
              <RichEditor
                value={form.questionText}
                onChange={(html) => setField({ questionText: html })}
                ariaLabel="נוסח השאלה"
                minContentHeight={160}
              />
            </Field>
          </Section>

          <Section title="סוג תשובה">
            <div className="flex gap-1 bg-gray-100 rounded-md p-1">
              {Object.values(ANSWER_TYPES).map((t) => (
                <button
                  key={t}
                  onClick={() => setField({ answerType: t })}
                  className={`flex-1 text-center px-3 py-2 text-sm rounded transition ${
                    form.answerType === t
                      ? 'bg-white shadow-sm text-gray-900 font-semibold'
                      : 'text-gray-600'
                  }`}
                >
                  {ANSWER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {form.answerType === ANSWER_TYPES.SINGLE_CHOICE && (
              <div className="space-y-2 mt-4">
                <div className="text-sm font-medium text-gray-800">אפשרויות</div>
                {form.options.length === 0 && (
                  <div className="text-xs text-gray-500">
                    אין אפשרויות. הוסיפו לפחות אחת.
                  </div>
                )}
                {form.options.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                      placeholder={`אפשרות ${i + 1}`}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                    />
                    <button
                      onClick={() => removeOption(i)}
                      className="border border-gray-300 rounded-md px-3 text-sm text-red-600 hover:bg-red-50"
                      aria-label="הסר"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={addOption}
                  className="text-sm text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-1.5"
                >
                  + הוספת אפשרות
                </button>
              </div>
            )}
          </Section>

          <Section title="מטה-מידע">
            <Field label="הערה פנימית" hint="לא מוצג לעובדים.">
              <textarea
                value={form.internalNote}
                onChange={(e) => setField({ internalNote: e.target.value })}
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
  return (
    <span className="text-[12px] text-gray-500">
      נשמר {formatRelative(savedAt)}
    </span>
  );
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
