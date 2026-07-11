// Full-screen portal states — shared by the shell and standalone portal pages.
// Moved verbatim out of GuidePortal.jsx when the portal grew a real shell.

export function CenteredMessage({ text, sub, onRetry }) {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="text-center max-w-sm">
        <div className="text-base text-gray-700">{text}</div>
        {sub && (
          <div className="text-[12px] text-gray-500 mt-1 font-mono" dir="ltr">
            {sub}
          </div>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-white"
          >
            נסה שוב
          </button>
        )}
      </div>
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-base font-semibold text-gray-900 mb-1">
          הקישור אינו תקף
        </div>
        <div className="text-sm text-gray-600">
          הקישור שגוי או פג. פנה למנהל לקבלת קישור מעודכן.
        </div>
      </div>
    </div>
  );
}

export function DisabledScreen() {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">⛔</div>
        <div className="text-base font-semibold text-gray-900 mb-1">
          הגישה לפורטל סגורה
        </div>
        <div className="text-sm text-gray-600">
          המנהל סגר את הגישה שלך לפורטל. ניתן לפנות אליו לפרטים נוספים.
        </div>
      </div>
    </div>
  );
}
