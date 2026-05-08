import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Dedicated install entry. Two distinct jobs in one component:
//
//   * "I'm in the browser preparing to install" — render install
//     instructions. Crucially, the URL the user is on right now (this
//     page, with the token in the query) is what iOS Safari captures
//     when the user taps Share → Add to Home Screen. iOS DOES NOT
//     read the manifest's start_url; it uses the current page URL as
//     the future launch URL. So we need a stable, public, token-bearing
//     URL — that's exactly what /install-guide?p=<token> is.
//
//   * "I'm a relaunch from the home-screen icon" — detect standalone
//     display-mode (PWA-installed) and redirect immediately to
//     /p/<token>. The user never sees the install instructions twice.
//
// We also rewrite the document's manifest link to the per-token
// dynamic manifest. That covers Android Chrome, which DOES honor
// start_url and would otherwise replay /launch with no token.
//
// Two failure modes the UX handles explicitly:
//   * Missing or malformed token → render NoTokenScreen with a
//     diagnostics panel (mirrors MissingPortalScreen style).
//   * Token present but user wandered here from somewhere unrelated →
//     show "המשך לפורטל" button to bounce them out manually.
export default function InstallGuidePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenRaw = searchParams.get('p') || '';
  const token = useMemo(
    () =>
      /^[A-Za-z0-9_-]+$/.test(tokenRaw) ? tokenRaw : null,
    [tokenRaw],
  );

  // Standalone-detect redirect. Runs once on mount with the resolved
  // token. window.matchMedia covers Chrome / Android / desktop PWA;
  // window.navigator.standalone is iOS Safari's specific signal.
  useEffect(() => {
    if (!token) return;
    const isStandalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    if (isStandalone) {
      navigate(`/p/${encodeURIComponent(token)}`, { replace: true });
    }
  }, [token, navigate]);

  // Persist the token to localStorage before any interaction. Belt-
  // and-braces: if the user wanders elsewhere on the same origin in
  // the same browser, they still get the right Landing redirect.
  useEffect(() => {
    if (!token) return;
    try {
      localStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }, [token]);

  // Rewrite the manifest link to per-token URL while THIS page is
  // mounted. Android Chrome's install captures the link the moment
  // the install prompt resolves; the per-token start_url then becomes
  // the launch URL, so even Android paths land on /launch?p=<token>
  // rather than the bare /launch.
  useEffect(() => {
    if (!token) return undefined;
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const original = link.getAttribute('href') || '/manifest.webmanifest';
    link.setAttribute(
      'href',
      `/manifest.webmanifest?p=${encodeURIComponent(token)}`,
    );
    return () => {
      try {
        link.setAttribute('href', original);
      } catch {
        /* ignore */
      }
    };
  }, [token]);

  if (!token) {
    return <NoTokenScreen rawToken={tokenRaw} />;
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gray-50 flex items-center justify-center p-5"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-md p-6">
        <div className="text-4xl mb-2 text-center">📱</div>
        <h1 className="text-xl font-semibold text-gray-900 text-center mb-2">
          התקן את אפליקציית ההדרכה
        </h1>
        <p className="text-sm text-gray-700 leading-relaxed text-center mb-5">
          הוסף את האפליקציה למסך הבית כדי לקבל גישה מהירה לפורטל
          האישי שלך, גם בלי לזכור את הקישור.
        </p>

        <div className="space-y-3 mb-5">
          <Step n={1} title="iOS / iPhone (Safari)">
            לחץ על כפתור השיתוף{' '}
            <span aria-hidden>⤴</span>, גלול ובחר{' '}
            <b>"הוספה למסך הבית"</b>. אשר.
          </Step>
          <Step n={2} title="Android (Chrome)">
            פתח את תפריט הדפדפן (שלוש נקודות), בחר{' '}
            <b>"התקן אפליקציה"</b> או{' '}
            <b>"הוסף למסך הבית"</b>.
          </Step>
          <Step n={3} title="לאחר ההתקנה">
            לחץ על האייקון של <b>Grafitiyul Team</b> שיופיע במסך
            הבית — האפליקציה תיפתח ישר לפורטל שלך.
          </Step>
        </div>

        <a
          href={`/p/${encodeURIComponent(token)}`}
          className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white rounded-md py-2.5 text-base font-semibold"
        >
          המשך לפורטל
        </a>
        <div className="text-[11px] text-gray-500 text-center mt-3">
          לא חייבים להתקין — אפשר תמיד להמשיך ישירות לפורטל.
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 flex gap-3">
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold">
        {n}
      </span>
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900 mb-0.5">
          {title}
        </div>
        <div className="text-[13px] text-gray-700 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}

function NoTokenScreen({ rawToken }) {
  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-5"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-md p-6 text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          לא נמצא קישור מדריך
        </h1>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          כדי להתקין את האפליקציה צריך לפתוח את הקישור האישי שלך
          לפורטל ולחזור לדף ההתקנה משם.
        </p>
        <a
          href="/admin"
          className="inline-block text-[12px] text-gray-500 hover:text-gray-800 underline underline-offset-2"
        >
          כניסת מנהל
        </a>
      </div>
      <details className="mt-4 max-w-md w-full bg-white border border-gray-200 rounded-lg text-[12px] text-gray-700">
        <summary className="px-3 py-2 cursor-pointer text-gray-500">
          פרטי איתור (Diagnostics)
        </summary>
        <dl className="px-3 py-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
          <dt className="text-gray-500">path</dt>
          <dd dir="ltr" className="text-gray-900">
            /install-guide
          </dd>
          <dt className="text-gray-500">url_token_raw</dt>
          <dd dir="ltr" className="text-gray-900 break-all">
            {rawToken || 'none'}
          </dd>
          <dt className="text-gray-500">url_token_valid</dt>
          <dd dir="ltr" className="text-gray-900">
            {rawToken ? 'no (rejected by validator)' : 'no'}
          </dd>
        </dl>
      </details>
    </div>
  );
}
