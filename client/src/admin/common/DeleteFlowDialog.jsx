import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';

// Two-step deletion for flows. Step 1 is a soft "are you sure", step 2 is
// the explicit destructive action. Errors surface inside the dialog so the
// user can retry without losing their context.
export default function DeleteFlowDialog({
  open,
  flowTitle,
  onClose,
  onConfirm,
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function finalConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'המחיקה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const quoted = flowTitle ? `"${flowTitle}"` : '';

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      size="md"
      title={step === 1 ? 'מחיקת זרימה' : 'אישור אחרון'}
      ariaLabel="מחיקת זרימה"
      footer={
        step === 1 ? (
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
              onClick={() => setStep(2)}
              className="text-sm bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1.5 font-medium"
            >
              המשך למחיקה
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={busy}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              חזרה
            </button>
            <button
              type="button"
              onClick={finalConfirm}
              disabled={busy}
              className="text-sm bg-red-600 hover:bg-red-700 text-white rounded px-3 py-1.5 font-medium disabled:opacity-50"
            >
              {busy ? 'מוחק…' : 'מחק לצמיתות'}
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
          <p>
            האם למחוק את הזרימה {quoted}?
          </p>
          <p className="text-[13px] text-gray-600">
            פעולה זו תמחק את הזרימה על כל הפריטים המשוייכים אליה, ואת כל
            הניסיונות והתשובות שנרשמו בה.
          </p>
          <p className="text-[13px] text-gray-600">
            פריטי התוכן והשאלות שלה יישארו בבנק הפריטים.
          </p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-red-700">
            פעולה זו בלתי הפיכה.
          </p>
          <p className="text-gray-800">
            המחיקה תסיר את הזרימה {quoted}, את כל הפריטים המוקצים אליה, ואת
            כל הניסיונות והתשובות. לא ניתן לשחזר.
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-[13px] text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
