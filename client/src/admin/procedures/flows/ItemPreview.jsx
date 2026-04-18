import {
  ANSWER_TYPES,
  ANSWER_TYPE_LABELS,
  ITEM_KINDS,
  ITEM_KIND_LABELS,
} from '../bank/config.js';

// Read-only preview of a content or question item. Renders the same HTML
// the learner will see, via the shared .gos-prose surface.
export default function ItemPreview({ kind, item }) {
  if (!item) {
    return (
      <div className="text-center text-gray-500 text-sm py-10">
        הפריט לא נמצא.
      </div>
    );
  }
  const badgeCls =
    kind === ITEM_KINDS.QUESTION
      ? 'bg-amber-100 text-amber-800'
      : 'bg-blue-100 text-blue-800';

  return (
    <article className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-3 text-[11px]">
        <span className={`px-2 py-0.5 rounded ${badgeCls}`}>
          {ITEM_KIND_LABELS[kind]}
        </span>
        <span className="text-gray-500 truncate">{item.title || '(ללא כותרת)'}</span>
      </div>

      {kind === ITEM_KINDS.CONTENT ? (
        <ContentView item={item} />
      ) : (
        <QuestionView item={item} />
      )}

      {item.internalNote && (
        <aside className="mt-6 border border-amber-200 bg-amber-50 rounded-md p-3 text-sm text-amber-900">
          <div className="text-[11px] text-amber-700 font-medium mb-1">
            הערה פנימית (לא מוצגת לעובד)
          </div>
          <div className="whitespace-pre-wrap">{item.internalNote}</div>
        </aside>
      )}
    </article>
  );
}

function ContentView({ item }) {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4 text-gray-900">
        {item.title}
      </h1>
      {item.body ? (
        <div
          className="gos-prose"
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      ) : (
        <div className="text-sm text-gray-400 italic">(אין תוכן)</div>
      )}
    </>
  );
}

function QuestionView({ item }) {
  const isChoice = item.answerType === ANSWER_TYPES.SINGLE_CHOICE;
  const options = Array.isArray(item.options) ? item.options : [];
  return (
    <>
      <h1 className="text-2xl font-semibold mb-2 text-gray-900">
        {item.title}
      </h1>
      <div className="text-[11px] text-gray-500 mb-4">
        סוג תשובה: {ANSWER_TYPE_LABELS[item.answerType] || '—'}
      </div>
      {item.questionText ? (
        <div
          className="gos-prose mb-5"
          dangerouslySetInnerHTML={{ __html: item.questionText }}
        />
      ) : (
        <div className="text-sm text-gray-400 italic mb-5">(אין נוסח שאלה)</div>
      )}
      {isChoice ? (
        <div className="space-y-2">
          {options.length === 0 && (
            <div className="text-sm text-gray-400 italic">
              אין אפשרויות מוגדרות.
            </div>
          )}
          {options.map((opt, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 bg-white"
            >
              <span className="text-[11px] text-gray-400 me-2" dir="ltr">
                {i + 1}.
              </span>
              {opt}
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-gray-300 rounded-md p-3 text-sm text-gray-500">
          (העובד יזין כאן תשובה חופשית)
        </div>
      )}
    </>
  );
}
