import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS, ANSWER_TYPES, ANSWER_TYPE_LABELS } from '../bank/config.js';
import SidePanel from '../../common/SidePanel.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';

// Full-height side panel for creating a new item from inside the flow
// editor — same working pattern as the bank editor, not a cramped modal.
//
// Flow:
//   1. On mount: pre-create an empty row on the server (so the work is
//      already autosaved from the first keystroke).
//   2. The admin edits; every change PUT-saves.
//   3. "הוסף לזרימה" (Finalize) hands the saved row to the picker which
//      drops it into the flow at the current placement context.
//   4. If the admin cancels, the row remains as a draft in the bank —
//      same behavior as abandoning a bank-editor session.
export default function InlineItemEditor({ kind, onClose, onFinalize }) {
  const isQuestion = kind === ITEM_KINDS.QUESTION;
  const [item, setItem] = useState(null);
  const [createErr, setCreateErr] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const formRef = useRef(null);
  formRef.current = form;
  const itemRef = useRef(null);
  itemRef.current = item;

  // Pre-create the row on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const created = isQuestion
          ? await api.questionItems.create({
              title: '',
              questionText: '',
              answerType: ANSWER_TYPES.OPEN_TEXT,
              options: [],
            })
          : await api.contentItems.create({ title: '', body: '' });
        if (cancelled) return;
        setItem(created);
        setForm(
          isQuestion
            ? {
                title: created.title || '',
                questionText: created.questionText || '',
                answerType: created.answerType || ANSWER_TYPES.OPEN_TEXT,
                options: Array.isArray(created.options) ? created.options : [],
              }
            : {
                title: created.title || '',
                body: created.body || '',
              },
        );
        setSavedAt(created.updatedAt || null);
      } catch (e) {
        if (!cancelled) setCreateErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // isQuestion is effectively constant for a given mount — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave (same cadence as the bank editors).
  useEffect(() => {
    if (!form || !item) return;
    const handle = setTimeout(async () => {
      const snapshot = formRef.current;
      const current = itemRef.current;
      if (!snapshot || !current) return;
      setSaving(true);
      try {
        const api_ = isQuestion ? api.questionItems : api.contentItems;
        const payload = isQuestion
          ? {
              title: snapshot.title,
              questionText: snapshot.questionText,
              answerType: snapshot.answerType,
              options:
                snapshot.answerType === ANSWER_TYPES.SINGLE_CHOICE
                  ? snapshot.options.map((o) => o.trim()).filter(Boolean)
                  : [],
            }
          : {
              title: snapshot.title,
              body: snapshot.body,
            };
        const updated = await api_.update(current.id, payload);
        setSavedAt(updated.updatedAt);
        setItem(updated);
      } catch (e) {
        console.warn('inline autosave failed:', e.message);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [form, item, isQuestion]);

  function finalize() {
    if (!item) return;
    onFinalize(item);
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={isQuestion ? 'שאלה חדשה' : 'תוכן חדש'}
      footer={
        <>
          <span className="text-[12px] text-gray-500 ml-auto">
            {saving ? 'שומר…' : savedAt ? 'נשמר' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            סגור
          </button>
          <button
            type="button"
            onClick={finalize}
            disabled={!item}
            className="text-sm bg-blue-600 text-white rounded px-4 py-1.5 font-medium disabled:opacity-40"
          >
            הוסף לזרימה
          </button>
        </>
      }
    >
      {createErr && (
        <div className="m-4 bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
          יצירה נכשלה: {createErr}
        </div>
      )}
      {!item && !createErr && (
        <div className="p-6 text-sm text-gray-500">מכין טיוטה…</div>
      )}
      {item && form && (
        <div className="p-4 lg:p-6 space-y-5">
          <label className="block">
            <div className="text-[12px] text-gray-600 mb-1">כותרת</div>
            <div className="w-full border border-gray-300 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400">
              <TitleEditor
                value={form.title}
                onChange={(html) => setForm((f) => ({ ...f, title: html }))}
                placeholder={
                  isQuestion ? 'כותרת לזיהוי השאלה' : 'כותרת הפריט'
                }
                ariaLabel="כותרת"
                autoFocus
              />
            </div>
          </label>

          <label className="block">
            <div className="text-[12px] text-gray-600 mb-1">
              {isQuestion ? 'נוסח השאלה' : 'תוכן'}
            </div>
            {isQuestion ? (
              <RichEditor
                value={form.questionText}
                onChange={(html) =>
                  setForm((f) => ({ ...f, questionText: html }))
                }
                placeholder="כתבו את נוסח השאלה…"
                minContentHeight={160}
                maxHeight="40vh"
              />
            ) : (
              <RichEditor
                value={form.body}
                onChange={(html) => setForm((f) => ({ ...f, body: html }))}
                placeholder="כתבו כאן תוכן…"
                minContentHeight={160}
                maxHeight="40vh"
              />
            )}
          </label>

          {isQuestion && (
            <>
              <div>
                <div className="text-[12px] text-gray-600 mb-1">סוג תשובה</div>
                <div className="flex gap-1 bg-gray-100 rounded-md p-1">
                  {Object.values(ANSWER_TYPES).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm((f) => ({ ...f, answerType: t }))}
                      className={`flex-1 text-center px-3 py-1.5 text-sm rounded ${
                        form.answerType === t
                          ? 'bg-white shadow-sm text-gray-900 font-semibold'
                          : 'text-gray-600'
                      }`}
                    >
                      {ANSWER_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {form.answerType === ANSWER_TYPES.SINGLE_CHOICE && (
                <div>
                  <div className="text-[12px] text-gray-600 mb-1">אפשרויות</div>
                  <div className="space-y-2">
                    {form.options.map((opt, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          value={opt}
                          onChange={(e) => {
                            const next = [...form.options];
                            next[i] = e.target.value;
                            setForm((f) => ({ ...f, options: next }));
                          }}
                          placeholder={`אפשרות ${i + 1}`}
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              options: f.options.filter((_, j) => j !== i),
                            }))
                          }
                          className="text-xs text-red-600 hover:bg-red-50 rounded px-2"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setForm((f) => ({ ...f, options: [...f.options, ''] }))
                      }
                      className="text-[12px] text-blue-700 hover:underline"
                    >
                      + הוספת אפשרות
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="text-[11px] text-gray-500">
            {titleToPlain(form.title).trim()
              ? 'הכותרת שתישמר בבנק.'
              : 'טיוטה ללא כותרת — ניתן להשלים בהמשך מתוך הבנק.'}
          </div>
        </div>
      )}
    </SidePanel>
  );
}
