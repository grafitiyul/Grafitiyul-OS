import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

// Root + launch resolver. Mounted on TWO paths:
//
//   /        — bare-domain entry. Admins typing the URL go here. If
//              there's no portal token, they fall through to /admin
//              (which then handles login).
//   /launch  — manifest start_url. The PWA always opens this path on
//              icon launch. If there's no portal token here we DO
//              NOT redirect to /admin — that's the bug we keep
//              fighting. Instead, we render a public "missing portal
//              link" screen with diagnostics so the user can see
//              exactly why the PWA didn't recognise them.
//
// Token resolution order, applied to both paths:
//
//   1. URL `?p=<token>` query param. Lets a manifest-captured
//      start_url like /launch?p=<token> open the PWA directly into
//      portal mode regardless of any storage state.
//   2. localStorage `gos.portalToken` — set by the pre-mount block
//      in main.jsx, by GuidePortal, and by step 1 below as a side
//      effect.
//   3. None found → fallback (admin redirect on /, missing-portal
//      screen on /launch).
export default function Landing() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isLaunchPath = location.pathname === '/launch';

  let token = null;
  let urlTokenPresent = false;
  let storageTokenPresent = false;

  const fromQuery = searchParams.get('p');
  if (fromQuery && /^[A-Za-z0-9_-]+$/.test(fromQuery)) {
    token = fromQuery;
    urlTokenPresent = true;
    try {
      localStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }

  if (!token) {
    try {
      const stored = localStorage.getItem('gos.portalToken');
      if (stored && /^[A-Za-z0-9_-]+$/.test(stored)) {
        token = stored;
        storageTokenPresent = true;
      }
    } catch {
      /* ignore */
    }
  } else {
    // Even when URL won, also note whether storage already had a
    // value — useful for diagnostics if URL & storage disagree.
    try {
      const stored = localStorage.getItem('gos.portalToken');
      storageTokenPresent = !!stored;
    } catch {
      /* ignore */
    }
  }

  if (token) {
    return <Navigate to={`/p/${encodeURIComponent(token)}`} replace />;
  }

  // No token. Branch on path:
  //   /       → admin (admins typing the bare URL).
  //   /launch → public missing-portal screen with diagnostics.
  if (!isLaunchPath) {
    return <Navigate to="/admin" replace />;
  }
  return (
    <MissingPortalScreen
      path={location.pathname}
      urlTokenPresent={urlTokenPresent}
      storageTokenPresent={storageTokenPresent}
    />
  );
}

// Public launch fallback. No auth, no admin login redirect — the
// guide gets a calm Hebrew "ask your manager for a portal link"
// message plus a small diagnostic panel that surfaces the same
// state the developer would see in DevTools (path, URL token,
// localStorage token). This is what the user explicitly asked for:
// no DevTools required to understand why the PWA didn't open the
// portal.
//
// We intentionally do NOT auto-redirect to /admin from here — that
// was the original bug. An admin who lands here can tap the small
// "כניסת מנהל" link.
function MissingPortalScreen({ path, urlTokenPresent, storageTokenPresent }) {
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
        <p className="text-sm text-gray-700 leading-relaxed mb-4">
          האפליקציה הותקנה בלי קישור פורטל אישי, או שהקישור נמחק. בקש
          מהמנהל את הקישור האישי שלך לפורטל ופתח אותו פעם אחת — אחרי
          זה האפליקציה תזכור.
        </p>
        <div className="text-[12px] text-gray-500 mb-4">
          אפשר גם להדביק קישור פורטל בתיבת הכתובת של הדפדפן.
        </div>
        <a
          href="/admin"
          className="inline-block text-[12px] text-gray-500 hover:text-gray-800 underline underline-offset-2"
        >
          כניסת מנהל
        </a>
      </div>

      {/* Diagnostic panel. Always visible — user-facing, no DevTools
          required. Useful when the PWA opens here unexpectedly so we
          can see what the launcher actually saw. */}
      <details className="mt-4 max-w-md w-full bg-white border border-gray-200 rounded-lg text-[12px] text-gray-700">
        <summary className="px-3 py-2 cursor-pointer text-gray-500">
          פרטי איתור (Diagnostics)
        </summary>
        <dl className="px-3 py-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
          <dt className="text-gray-500">path</dt>
          <dd dir="ltr" className="text-gray-900">
            {path}
          </dd>
          <dt className="text-gray-500">url_token</dt>
          <dd dir="ltr" className="text-gray-900">
            {urlTokenPresent ? 'present' : 'none'}
          </dd>
          <dt className="text-gray-500">storage_token</dt>
          <dd dir="ltr" className="text-gray-900">
            {storageTokenPresent ? 'present' : 'none'}
          </dd>
          <dt className="text-gray-500">target</dt>
          <dd dir="ltr" className="text-gray-900">
            missing-portal-screen
          </dd>
        </dl>
      </details>
    </div>
  );
}
