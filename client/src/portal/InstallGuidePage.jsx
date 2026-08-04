import { useEffect, useMemo, useState } from 'react';
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import PwaDiagnostics from '../shell/PwaDiagnostics.jsx';
import { portalDir, portalStrings } from './i18n.js';

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
//   * Browser context — render install instructions + a "continue to
//     the portal" link. iOS captures THIS URL on Add to Home Screen.
//   * Standalone launch — display-mode standalone OR
//     navigator.standalone is true → redirect immediately to
//     /p/<token>. The user never sees the install screen on a
//     relaunch.
//
// LANGUAGE: this page is reached with a token but renders BEFORE any portal
// screen, so it asks the shell bootstrap for the guide's language — the same
// ONE server-resolved value, never a browser guess. Until it answers (or if
// the token is unknown) the portal default is used; there is no identified
// guide to have a preference yet.
export default function InstallGuidePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [language, setLanguage] = useState(undefined);
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
    if (!token) return undefined;
    let alive = true;
    fetch(`/api/portal/${encodeURIComponent(token)}/home`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.language) setLanguage(data.language);
      })
      .catch(() => {
        /* an unreachable/disabled portal simply keeps the default wording */
      });
    return () => {
      alive = false;
    };
  }, [token]);

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

  const t = portalStrings(language);
  const dir = portalDir(language);
  const en = language === 'en';

  if (!token) {
    return <NoTokenScreen rawToken={tokenRaw} t={t} dir={dir} />;
  }

  return (
    <div
      dir={dir}
      className="min-h-screen bg-gray-50 flex items-center justify-center p-5"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-md p-6">
        <div className="text-4xl mb-2 text-center">📱</div>
        <h1 className="text-xl font-semibold text-gray-900 text-center mb-2">{t.install.title}</h1>
        <p className="text-sm text-gray-700 leading-relaxed text-center mb-5">{t.install.body}</p>

        <div className="space-y-3 mb-5">
          {/* The OS wording in each step is what the phone ITSELF shows, so it
              follows the device UI, not our copy — quoting a translated menu
              item the user cannot find would be worse than useless. */}
          <Step n={1} title={t.install.stepIosTitle}>
            {en ? (
              <>
                Tap the share button <span aria-hidden>⤴</span>, scroll and choose{' '}
                <b>&quot;Add to Home Screen&quot;</b>. Confirm.
              </>
            ) : (
              <>
                לחץ על כפתור השיתוף <span aria-hidden>⤴</span>, גלול ובחר{' '}
                <b>&quot;הוספה למסך הבית&quot;</b>. אשר.
              </>
            )}
          </Step>
          <Step n={2} title={t.install.stepAndroidTitle}>
            {en ? (
              <>
                Open the browser menu (three dots) and choose <b>&quot;Install app&quot;</b> or{' '}
                <b>&quot;Add to Home screen&quot;</b>.
              </>
            ) : (
              <>
                פתח את תפריט הדפדפן (שלוש נקודות), בחר <b>&quot;התקן אפליקציה&quot;</b> או{' '}
                <b>&quot;הוסף למסך הבית&quot;</b>.
              </>
            )}
          </Step>
          <Step n={3} title={t.install.stepAfterTitle}>
            {en ? (
              <>
                Tap the <b>Grafitiyul Team</b> icon that appears on your home screen — the app opens
                straight into your portal.
              </>
            ) : (
              <>
                לחץ על האייקון של <b>Grafitiyul Team</b> שיופיע במסך הבית — האפליקציה תיפתח ישר
                לפורטל שלך.
              </>
            )}
          </Step>
        </div>

        <a
          href={`/p/${encodeURIComponent(token)}`}
          className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white rounded-md py-2.5 text-base font-semibold"
        >
          {t.install.continueToPortal}
        </a>
        <div className="text-[11px] text-gray-500 text-center mt-3">{t.install.optional}</div>
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
        <div className="text-sm font-semibold text-gray-900 mb-0.5">{title}</div>
        <div className="text-[13px] text-gray-700 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function NoTokenScreen({ rawToken, t, dir }) {
  return (
    <div
      dir={dir}
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-5"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-md p-6 text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">{t.install.noTokenTitle}</h1>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">{t.install.noTokenBody}</p>
        <a
          href="/admin"
          className="inline-block text-[12px] text-gray-500 hover:text-gray-800 underline underline-offset-2"
        >
          {t.install.adminLogin}
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
