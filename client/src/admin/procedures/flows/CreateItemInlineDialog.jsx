import { useState } from 'react';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS, ANSWER_TYPES, ANSWER_TYPE_LABELS } from '../bank/config.js';
import Dialog from '../../common/Dialog.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TitleEditor, { titleToPlain } from '../../../editor/TitleEditor.jsx';

// Minimal "create and drop into the flow" editor. Same title + body editors
// the full bank pages use; once saved, the created row is returned via
// onCreated so the flow picker can select it immediately.
export default function CreateItemInlineDialog({ kind, onClose, onCreated }) {
  const isQuestion = kind === ITEM_KINDS.QUESTION;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [answerType, setAnswerType] = useState(ANSWER_TYPES.OPEN_TEXT);
  const [options, setOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const canSave = titleToPlain(title).trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      if (isQuestion) {
        const created = await api.questionItems.create({
          title,
          questionText: body,
          answerType,
          options:
            answerType === ANSWER_TYPES.SINGLE_CHOICE
              ? options.map((o) => o.trim()).filter(Boolean)
              : [],
          internalNote: null,
        });
        onCreated(created);
      } else {
        const created = await api.contentItems.create({
          title,
          body,
          internalNote: null,
        });
        onCreated(created);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isQuestion ? 'שאלה חדשה' : 'תוכן חדש'}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="text-sm bg-blue-600 text-white rounded px-4 py-1.5 font-medium disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'צור והוסף לזרימה'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <div className="text-[12px] text-gray-600 mb-1">כותרת</div>
          <div className="w-full border border-gray-300 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400">
            <TitleEditor
              value={title}
              onChange={setTitle}
              placeholder={isQuestion ? 'כותרת לזיהוי השאלה' : 'כותרת הפריט'}
              ariaLabel="כותרת"
              autoFocus
            />
          </div>
        </label>

        <label className="block">
          <div className="text-[12px] text-gray-600 mb-1">
            {isQuestion ? 'נוסח השאלה' : 'תוכן'}
          </div>
          <RichEditor
            value={body}
            onChange={setBody}
            placeholder={
              isQuestion ? 'כתבו את נוסח השאלה…' : 'כתבו כאן תוכן…'
            }
            minContentHeight={160}
            maxHeight="40vh"
          />
        </label>

        {isQuestion && (
          <>
            <div>
              <div className="text-[12px] text-gray-600 mb-1">סוג תשובה</div>
              <div className="flex gap-1 bg-gray-100 rounded-md p-1">
                {Object.values(ANSWER_TYPES).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAnswerType(t)}
                    className={`flex-1 text-center px-3 py-1.5 text-sm rounded ${
                      answerType === t
                        ? 'bg-white shadow-sm text-gray-900 font-semibold'
                        : 'text-gray-600'
                    }`}
                  >
                    {ANSWER_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {answerType === ANSWER_TYPES.SINGLE_CHOICE && (
              <div>
                <div className="text-[12px] text-gray-600 mb-1">אפשרויות</div>
                <div className="space-y-2">
                  {options.map((opt, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={opt}
                        onChange={(e) => {
                          const next = [...options];
                          next[i] = e.target.value;
                          setOptions(next);
                        }}
                        placeholder={`אפשרות ${i + 1}`}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() =>
                          setOptions(options.filter((_, j) => j !== i))
                        }
                        className="text-xs text-red-600 hover:bg-red-50 rounded px-2"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setOptions([...options, ''])}
                    className="text-[12px] text-blue-700 hover:underline"
                  >
                    + הוספת אפשרות
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
            {err}
          </div>
        )}
      </div>
    </Dialog>
  );
}
