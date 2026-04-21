import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from './config.js';
import {
  REQUIREMENTS,
  REQUIREMENT_LABELS,
  validRequirementsFor,
  coerceRequirement,
} from '../../../lib/questionRequirement.js';
import EditorTopBar from './EditorTopBar.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';
import DeleteItemDialog from '../../common/DeleteItemDialog.jsx';
import {
  commitPending,
  getPending,
  clearPending,
} from '../flows/pendingFlowInsert.js';

// Question-item editor. Same autosave pattern as ContentEditor — the server
// row already exists when this page loads; every change is PUT-saved.
export default function QuestionEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh, patchItem } = useOutletContext();
  const [searchParams] = useSearchParams();
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
  // Dirty flag — only genuine user edits should trigger autosave.
  // Loading an item transitions form from null → loaded; without this guard,
  // that transition would schedule a no-op save whose refresh() re-flowed
  // the whole bank list through props and caused a visible jump after click.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setLoadError(null);
    dirtyRef.current = false;
    (async () => {
      try {
        const item = await api.questionItems.get(id);
        if (cancelled) return;
        setForm({
          title: item.title || '',
          questionText: item.questionText || '',
          options: Array.isArray(item.options) ? item.options : [],
          allowTextAnswer: !!item.allowTextAnswer,
          requirement: item.requirement || REQUIREMENTS.OPTIONAL,
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
    if (!form || !dirtyRef.current) return;
    const handle = setTimeout(async () => {
      const snapshot = formRef.current;
      const targetId = idRef.current;
      if (!snapshot || !targetId) return;
      setSaving(true);
      try {
        // Coerce requirement to something valid for the current shape
        // before saving — e.g. if the admin removed the last option
        // while requirement was 'choice', persist 'optional' instead of
        // a contradictory value.
        const cleanOptions = snapshot.options
          .map((o) => o.trim())
          .filter(Boolean);
        const coerced = coerceRequirement({
          options: cleanOptions,
          allowTextAnswer: snapshot.allowTextAnswer,
          requirement: snapshot.requirement,
        });
        const updated = await api.questionItems.update(targetId, {
          title: snapshot.title,
          questionText: snapshot.questionText,
          options: cleanOptions,
          allowTextAnswer: !!snapshot.allowTextAnswer,
          requirement: coerced,
          internalNote: snapshot.internalNote.trim() || null,
        });
        setSavedAt(updated.updatedAt);
        // Surgical sidebar update — see ContentEditor for the full
        // rationale. Keeps the list's title live without a refetch.
        patchItem?.('question', targetId, {
          title: updated.title,
          updatedAt: updated.updatedAt,
        });
      } catch (e) {
        console.warn('autosave failed:', e.message);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [form, patchItem]);

  function setField(patch) {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, ...patch }));
  }
  function setOption(idx, value) {
    dirtyRef.current = true;
    setForm((f) => {
      const next = [...f.options];
      next[idx] = value;
      return { ...f, options: next };
    });
  }
  function addOption() {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, options: [...f.options, ''] }));
  }
  function removeOption(idx) {
    dirtyRef.current = true;
    setForm((f) => {
      const next = [...f.options];
      next.splice(idx, 1);
      return { ...f, options: next };
    });
  }

  const location = useLocation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const onDelete = useCallback(() => setDeleteOpen(true), []);
  const onDeleted = useCallback(async () => {
    await refresh?.();
    // Preserve any folder param so we return to the folder the user
    // was in before opening this question.
    navigate(`/admin/procedures/bank${location.search || ''}`, {
      replace: true,
    });
  }, [navigate, refresh, location.search]);

  async function addToFlow() {
    if (!id || !pending) return;
    setInsertingToFlow(true);
    try {
      const cleanOptions = form.options
        .map((o) => o.trim())
        .filter(Boolean);
      const coerced = coerceRequirement({
        options: cleanOptions,
        allowTextAnswer: form.allowTextAnswer,
        requirement: form.requirement,
      });
      await api.questionItems.update(id, {
        title: form.title,
        questionText: form.questionText,
        options: cleanOptions,
        allowTextAnswer: !!form.allowTextAnswer,
        requirement: coerced,
        internalNote: form.internalNote.trim() || null,
      });
      const { flowId } = await commitPending(ITEM_KINDS.QUESTION, id, form);
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
    navigate(`/admin/procedures/bank/question/${id}`, { replace: true });
  }

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
            <Field
              label="אפשרויות לבחירה"
              hint="אם ריק — לא תוצגנה אפשרויות. ניתן להשאיר ריק כאשר רוצים רק שדה טקסט חופשי."
            >
              <div className="space-y-2">
                {form.options.length === 0 && (
                  <div className="text-[12px] text-gray-500 italic">
                    אין אפשרויות.
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
            </Field>

            <Field
              label="שדה טקסט חופשי"
              hint='אפשר למדריך להוסיף הערה בטקסט חופשי. משולב עם אפשרויות: ניתן להציג גם רשימת אפשרויות וגם שדה טקסט.'
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.allowTextAnswer}
                  onChange={(e) =>
                    setField({ allowTextAnswer: e.target.checked })
                  }
                />
                <span>הצג שדה טקסט חופשי</span>
              </label>
            </Field>

            <RequirementControl
              options={form.options}
              allowTextAnswer={form.allowTextAnswer}
              value={form.requirement}
              onChange={(r) => setField({ requirement: r })}
            />
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

// Single control for "when is this question required?". Renders only
// the requirement values that make sense for the current question
// shape — no contradictory options (e.g. "must select a choice" when
// there are no choices). If the current value stops being valid
// because the shape changed, we fall back to 'optional' visually.
function RequirementControl({ options, allowTextAnswer, value, onChange }) {
  const valid = validRequirementsFor({ options, allowTextAnswer });
  // Render in a canonical order regardless of valid-set membership.
  const order = [
    REQUIREMENTS.OPTIONAL,
    REQUIREMENTS.CHOICE,
    REQUIREMENTS.TEXT,
    REQUIREMENTS.ANY,
    REQUIREMENTS.BOTH,
  ];
  const visible = order.filter((r) => valid.has(r));
  const effective = valid.has(value) ? value : REQUIREMENTS.OPTIONAL;

  return (
    <Field
      label="מתי חובה?"
      hint="מה נדרש כדי שהתשובה תיחשב מלאה."
    >
      <div className="flex flex-col gap-1.5">
        {visible.map((r) => (
          <label
            key={r}
            className={`flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1 ${
              effective === r ? 'bg-blue-50 text-blue-900' : ''
            }`}
          >
            <input
              type="radio"
              name="requirement"
              value={r}
              checked={effective === r}
              onChange={() => onChange(r)}
            />
            <span>{REQUIREMENT_LABELS[r]}</span>
          </label>
        ))}
      </div>
    </Field>
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
