import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from './Dialog.jsx';
import { api } from '../../lib/api.js';

// Bank-item delete flow. On open:
//   1) Fetch the list of flows that currently reference this item.
//   2) If the list is non-empty: show a "can't delete — in use" state with
//      links to every flow. This is the V1 safe path: block the delete and
//      tell the user exactly where to clean up first.
//   3) If the list is empty: show step 1 of the double confirmation.
//   4) Step 2 is the destructive confirm. Errors stay inside the dialog.
export default function DeleteItemDialog({
  open,
  kind, // 'content' | 'question'
  itemId,
  itemTitle,
  onClose,
  onDeleted,
}) {
  const [phase, setPhase] = useState('loading'); // loading | in_use | confirm1 | confirm2 | error
  const [usage, setUsage] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setUsage([]);
    setError(null);
    setBusy(false);
    let cancelled = false;
    (async () => {
      try {
        const fetcher =
          kind === 'question'
            ? api.questionItems.usage
            : api.contentItems.usage;
        const flows = await fetcher(itemId);
        if (cancelled) return;
        setUsage(flows);
        setPhase(flows.length > 0 ? 'in_use' : 'confirm1');
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'שגיאה בטעינת מצב השימוש');
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, itemId, kind]);

  async function finalDelete() {
    setBusy(true);
    setError(null);
    try {
      const remove =
        kind === 'question'
          ? api.questionItems.remove
          : api.contentItems.remove;
      await remove(itemId);
      onDeleted?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'המחיקה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const kindLabel = kind === 'question' ? 'השאלה' : 'הפריט';
  const quoted = itemTitle ? `"${itemTitle}"` : '';

  let title = 'מחיקת פריט';
  let footer = null;
  let body = null;

  if (phase === 'loading') {
    title = 'טוען…';
    body = <div className="text-sm text-gray-500">בודק באילו זרימות הפריט בשימוש…</div>;
    footer = (
      <button
        type="button"
        onClick={onClose}
        className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50"
      >
        סגור
      </button>
    );
  } else if (phase === 'error') {
    title = 'שגיאה';
    body = (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
        {error}
      </div>
    );
    footer = (
      <button
        type="button"
        onClick={onClose}
        className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50"
      >
        סגור
      </button>
    );
  } else if (phase === 'in_use') {
    title = 'לא ניתן למחוק';
    body = (
      <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
        <p>
          {kindLabel} {quoted} נמצא בשימוש ב-{usage.length}{' '}
          {usage.length === 1 ? 'זרימה' : 'זרימות'}:
        </p>
        <ul className="border border-gray-200 rounded divide-y divide-gray-100 max-h-60 overflow-y-auto">
          {usage.map((f) => (
            <li key={f.id}>
              <Link
                to={`/admin/procedures/flows/${f.id}`}
                onClick={onClose}
                className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-blue-700"
              >
                <span className="truncate">{f.title || '(ללא שם)'}</span>
                <span className="text-[11px] text-gray-400">פתח</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-gray-600">
          הסירו את {kindLabel} מכל הזרימות האלה, ולאחר מכן נסו למחוק שוב.
        </p>
      </div>
    );
    footer = (
      <button
        type="button"
        onClick={onClose}
        className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50"
      >
        סגור
      </button>
    );
  } else if (phase === 'confirm1') {
    title = 'מחיקת פריט';
    body = (
      <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
        <p>האם למחוק את {kindLabel} {quoted}?</p>
        <p className="text-[13px] text-gray-600">
          {kindLabel} ייעלם מהבנק ולא ניתן יהיה לשחזר אותו. אף זרימה אינה משתמשת
          בו כרגע.
        </p>
      </div>
    );
    footer = (
      <>
        <button
          type="button"
          onClick={onClose}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          ביטול
        </button>
        <button
          type="button"
          onClick={() => setPhase('confirm2')}
          className="text-sm bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1.5 font-medium"
        >
          המשך למחיקה
        </button>
      </>
    );
  } else if (phase === 'confirm2') {
    title = 'אישור אחרון';
    body = (
      <div className="space-y-3 text-sm">
        <p className="font-semibold text-red-700">פעולה זו בלתי הפיכה.</p>
        <p className="text-gray-800">
          המחיקה תסיר את {kindLabel} {quoted} לצמיתות.
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-[13px] text-red-700">
            {error}
          </div>
        )}
      </div>
    );
    footer = (
      <>
        <button
          type="button"
          onClick={() => setPhase('confirm1')}
          disabled={busy}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          חזרה
        </button>
        <button
          type="button"
          onClick={finalDelete}
          disabled={busy}
          className="text-sm bg-red-600 hover:bg-red-700 text-white rounded px-3 py-1.5 font-medium disabled:opacity-50"
        >
          {busy ? 'מוחק…' : 'מחק לצמיתות'}
        </button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      size="md"
      title={title}
      ariaLabel="מחיקת פריט"
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
