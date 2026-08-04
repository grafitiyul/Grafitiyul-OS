import { usePortalLanguage } from './PortalLanguage.jsx';

// Full-screen portal states — shared by the shell and standalone portal pages.
//
// These render BEFORE the guide is known (bad token, disabled access) or while
// the bootstrap is still in flight, so they resolve their wording from the
// context when one exists and fall back to the portal default otherwise. There
// is no browser-language guess: an unidentified visitor has no preference for
// the portal to honour.

export function CenteredMessage({ text, sub, onRetry }) {
  const { t, dir } = usePortalLanguage();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir={dir}>
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
            {t.common.retry}
          </button>
        )}
      </div>
    </div>
  );
}

export function NotFoundScreen() {
  const { t, dir } = usePortalLanguage();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir={dir}>
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-base font-semibold text-gray-900 mb-1">{t.shell.notFoundTitle}</div>
        <div className="text-sm text-gray-600">{t.shell.notFoundBody}</div>
      </div>
    </div>
  );
}

export function DisabledScreen() {
  const { t, dir } = usePortalLanguage();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir={dir}>
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">⛔</div>
        <div className="text-base font-semibold text-gray-900 mb-1">{t.shell.disabledTitle}</div>
        <div className="text-sm text-gray-600">{t.shell.disabledBody}</div>
      </div>
    </div>
  );
}
