import {
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import PwaDiagnostics from './PwaDiagnostics.jsx';
import { resolveLanding } from './landingResolve.js';

// Root + launch resolver. Mounted on FOUR paths:
//
//   /                  — bare-domain entry. Admins typing the URL land
//                         here; with no URL token they go to /admin
//                         (which then handles login).
//   /launch            — launcher with no token → fail-closed
//                         missing-portal screen.
//   /launch/:token     — PATH-BASED launch URL (the deterministic one;
//                         iOS Safari preserves path segments through the
//                         standalone launch). Redirects to /p/:token.
//
// Token resolution (see ./landingResolve.js) is URL-ONLY:
//   1. URL path `:token`
//   2. URL `?p=<token>` query
//
// SECURITY INVARIANT: this route NEVER reads a device-global token from
// localStorage/sessionStorage/cookies. A device that previously opened a
// guide's portal must still land on the admin flow at "/". Portal identity
// is URL-token scoped, not device-global. (Incident 2026-07-13: the bare
// "/" opened another user's portal because Landing used to fall back to
// localStorage['gos.portalToken'].)
export default function Landing() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isLaunchPath = location.pathname.startsWith('/launch');

  const result = resolveLanding({
    pathToken: params.token || null,
    queryToken: searchParams.get('p'),
    isLaunchPath,
  });

  if (result.kind === 'portal' || result.kind === 'admin') {
    return <Navigate to={result.to} replace />;
  }
  return <MissingPortalScreen />;
}

function MissingPortalScreen() {
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
          האפליקציה נפתחה בלי קישור פורטל אישי. בקש מהמנהל את הקישור
          האישי שלך לפורטל ופתח אותו. כדי שהאפליקציה תיפתח ישר לפורטל
          שלך בכל פעם — התקן אותה למסך הבית מתוך הקישור האישי שלך.
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
      <PwaDiagnostics />
    </div>
  );
}
