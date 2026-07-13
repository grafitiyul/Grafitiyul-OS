import { useEffect, useMemo } from 'react';
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import PwaDiagnostics from '../shell/PwaDiagnostics.jsx';

// Dedicated install entry. Mounted on TWO routes:
//
//   /install-guide?p=<token>          — back-compat (query form)
//   /install-guide/:token             — PATH form. iOS Safari's
//                                        "Add to Home Screen"
//                                        captures the page URL
//                                        verbatim. Path segments
//                                        survive the standalone
//                                        launch even on iOS versions
//                                        that strip queries or
//                                        ignore the manifest's
//                                        start_url.
//
// Token resolution order: path → query. The path version is the one
// the install button on /p/:token now points at; the query version
// stays alive for any older bookmarks.
//
// Two distinct behaviors in one component:
//
//   * Browser context — render install instructions + a "המשך
//     לפורטל" link. iOS captures THIS URL on Add to Home Screen.
//   * Standalone launch — display-mode standalone OR
//     navigator.standalone is true → redirect immediately to
//     /p/<token>. The user never sees the install screen on a
//     relaunch.
//
// We also rewrite the document's manifest link to the per-token
// dynamic manifest. Belt-and-braces with the URL itself; the URL
// is the authoritative path.
export default function InstallGuidePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenRaw =
    params.token ||
    searchParams.get('p') ||
    '';
  const token = useMemo(
    () =>
      /^[A-Za-z0-9_-]+$/.test(tokenRaw) ? tokenRaw : null,
    [tokenRaw],
  );

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

  // NOTE: we intentionally do NOT persist the token to localStorage.
  // Portal identity is URL-token scoped, not device-global — the root
  // Landing resolver must never infer a guide from device storage
  // (security invariant, incident 2026-07-13). Installing from this
  // page captures the token in the PWA's start_url (the token-scoped
  // manifest), which is the authoritative "remember me".

  // (Manifest link is now rewritten server-side in the SPA fallback
  // for any /install-guide/:token / /p/:token / /launch/:token URL.
  // The post-mount JS rewrite that used to live here was ineffective
  // on iOS — Safari fetches the manifest at HTML parse time and
  // ignores later href mutations.)

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
        {rawToken && (
          <div className="text-[11px] text-gray-500 mt-3">
            (raw token: <span dir="ltr">{rawToken}</span>)
          </div>
        )}
      </div>
      <PwaDiagnostics />
    </div>
  );
}
