import {
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import PwaDiagnostics from './PwaDiagnostics.jsx';

// Root + launch resolver. Mounted on FOUR paths:
//
//   /                  — bare-domain entry. Admins typing the URL go
//                         here. If there's no portal token, they fall
//                         through to /admin (which then handles login).
//   /launch            — query-based launch fallback. Renders the
//                         missing-portal screen when no token is
//                         resolvable from URL or storage.
//   /launch/:token     — PATH-BASED launch URL. This is the
//                         deterministic one — iOS Safari preserves
//                         path segments through "Add to Home Screen"
//                         and through the standalone launch even on
//                         versions that strip queries or ignore the
//                         manifest's start_url. The token sits in the
//                         path, so it always survives.
//
// Token resolution order, applied to ALL three paths:
//
//   1. URL path `:token`        — the most reliable shape.
//   2. URL `?p=<token>` query   — works in browsers that preserve
//                                 queries.
//   3. localStorage `gos.portalToken` — final fallback for shared-
//                                 storage contexts.
//
// On `/` with NO token: redirect to `/admin` (admins typing the bare
// URL still want admin login). On `/launch*` with no token: render
// the public missing-portal screen + diagnostics — never bounce to
// admin.
export default function Landing() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isLaunchPath = location.pathname.startsWith('/launch');

  let token = null;
  let urlPathTokenPresent = false;
  let urlQueryTokenPresent = false;
  let storageTokenPresent = false;

  const fromPath = params.token || null;
  if (fromPath && /^[A-Za-z0-9_-]+$/.test(fromPath)) {
    token = fromPath;
    urlPathTokenPresent = true;
    try {
      localStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }

  if (!token) {
    const fromQuery = searchParams.get('p');
    if (fromQuery && /^[A-Za-z0-9_-]+$/.test(fromQuery)) {
      token = fromQuery;
      urlQueryTokenPresent = true;
      try {
        localStorage.setItem('gos.portalToken', token);
      } catch {
        /* ignore */
      }
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

  if (!isLaunchPath) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <MissingPortalScreen
      urlPathTokenPresent={urlPathTokenPresent}
      urlQueryTokenPresent={urlQueryTokenPresent}
      storageTokenPresent={storageTokenPresent}
    />
  );
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
      <PwaDiagnostics />
    </div>
  );
}
