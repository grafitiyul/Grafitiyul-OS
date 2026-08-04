import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CenteredMessage, DisabledScreen, NotFoundScreen } from './shellScreens.jsx';
import BrandMark from '../brand/BrandMark.jsx';
import { PortalLanguageProvider, usePortalLanguage } from './PortalLanguage.jsx';
import { portalDir, portalStrings } from './i18n.js';

// Guide Portal shell — the app frame every portal page renders inside.
//
// Responsibilities:
//   * tab-scoped token hand-off (sessionStorage only — see the effect
//     below). The authoritative PWA persistence is the token-scoped
//     manifest start_url (see server/src/pwa/manifest.js). The token is
//     NEVER written to localStorage: portal identity is URL-token scoped,
//     not device-global (root Landing security invariant, incident
//     2026-07-13).
//   * ONE bootstrap call (/api/portal/:token/home) → person + permissions +
//     LANGUAGE. The language comes from the canonical staff field, resolved
//     server-side; the shell simply distributes it (PortalLanguageProvider)
//     so no page makes a language decision of its own.
//   * sticky top header + fixed bottom navigation (mobile app pattern),
//     with safe-area padding for notched devices
//   * hamburger sheet for the secondary destinations
//
// Pages receive { token, person, permissions } via Outlet context and read the
// language + strings via usePortalLanguage().

export default function PortalShell() {
  const { token } = useParams();
  const [state, setState] = useState({ phase: 'loading' });
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Tab-scoped hand-off ONLY: the attempt runtime (opened in the SAME
  // tab from a procedure) reads this to render its "back to portal"
  // button if a refresh dropped the ?p= query. sessionStorage is
  // per-tab and is NEVER read by the root/launch resolver, so it cannot
  // cause the bare domain to open a portal. We deliberately do NOT write
  // localStorage — portal identity is URL-token scoped, not device-global.
  useEffect(() => {
    if (!token) return;
    try {
      sessionStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }, [token]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setState({ phase: 'loading' });
      try {
        const res = await fetch(`/api/portal/${encodeURIComponent(token)}/home`, {
          cache: 'no-store',
        });
        if (res.status === 404) return setState({ phase: 'not_found' });
        if (res.status === 403) return setState({ phase: 'disabled' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ phase: 'ready', data: await res.json() });
      } catch (e) {
        if (!silent) setState({ phase: 'error', message: e?.message || 'network_error' });
      }
    },
    [token],
  );

  // Pages call this after profile edits so the header (name/photo) updates
  // immediately without a full reload.
  const refreshHome = useCallback(() => load({ silent: true }), [load]);

  useEffect(() => {
    load();
  }, [load]);

  // Language is only known after the bootstrap resolves. Before that the shell
  // renders the pre-auth states in the DEFAULT language — there is no guide yet
  // to have a preference, and guessing from the browser is exactly what this
  // architecture rules out.
  const language = state.phase === 'ready' ? state.data?.language : undefined;

  useEffect(() => {
    const t = portalStrings(language);
    const name = state.phase === 'ready' ? state.data?.person?.displayName : null;
    document.title = name ? `${name} · ${t.shell.documentTitle}` : t.shell.documentTitle;
  }, [state, language]);

  // Close the menu sheet on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const boot = portalStrings(language);
  if (state.phase === 'loading') return <CenteredMessage text={boot.common.loading} />;
  if (state.phase === 'not_found') return <NotFoundScreen />;
  if (state.phase === 'disabled') return <DisabledScreen />;
  if (state.phase === 'error') {
    return (
      <CenteredMessage text={boot.shell.loadError} sub={state.message} onRetry={load} />
    );
  }

  const person = state.data?.person || {};
  const permissions = state.data?.permissions || {};

  return (
    <PortalLanguageProvider language={language}>
      <div
        className="min-h-screen bg-gray-50"
        dir={portalDir(language)}
        data-page="guide-portal"
        data-portal-lang={language}
      >
        <Header
          displayName={person.displayName}
          imageUrl={person.imageUrl}
          token={token}
        />
        {/* pb clears the fixed bottom nav (h-16 + safe area). */}
        <main className="mx-auto max-w-2xl px-3 pb-28 pt-4 sm:px-6">
          <Outlet context={{ token, person, permissions, refreshHome }} />
        </main>
        <BottomNav token={token} permissions={permissions} onMenu={() => setMenuOpen(true)} />
        {menuOpen && (
          <MenuSheet token={token} permissions={permissions} onClose={() => setMenuOpen(false)} />
        )}
      </div>
    </PortalLanguageProvider>
  );
}

function Header({ displayName, imageUrl, token }) {
  const { t } = usePortalLanguage();
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        {/* Photo + name open פרטים אישיים (product rule). */}
        <NavLink
          to={`/p/${encodeURIComponent(token)}/profile`}
          className="flex min-w-0 flex-1 items-center gap-3"
          aria-label={t.shell.profileAria}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full border border-gray-200 object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {(displayName || '?').slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] leading-tight text-gray-500">{t.shell.greeting}</div>
            <div className="truncate text-[15px] font-semibold text-gray-900">
              {displayName || t.shell.guest}
            </div>
          </div>
        </NavLink>
        <BrandMark className="h-7 w-auto shrink-0 opacity-90" />
      </div>
    </header>
  );
}

// ── bottom navigation ────────────────────────────────────────────────

function BottomNav({ token, permissions, onMenu }) {
  const { t } = usePortalLanguage();
  const base = `/p/${encodeURIComponent(token)}`;
  const tabs = [
    { to: base, end: true, label: t.shell.navTours, icon: <CompassIcon /> },
    // סיורי עבר is a permanent tab (product decision 2026-07) — completed
    // tours move here for their assigned guides; never permission-gated.
    { to: `${base}/past`, label: t.shell.navPast, icon: <HistoryIcon /> },
    permissions.viewPay && { to: `${base}/pay`, label: t.shell.navPay, icon: <WalletIcon /> },
  ].filter(Boolean);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label={t.shell.navAria}
    >
      <div
        className="mx-auto grid h-16 max-w-2xl"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                isActive ? 'text-blue-700' : 'text-gray-500'
              }`
            }
          >
            {tab.icon}
            {tab.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMenu}
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-gray-500"
        >
          <MenuIcon />
          {t.shell.navMenu}
        </button>
      </div>
    </nav>
  );
}

// ── hamburger sheet ──────────────────────────────────────────────────

function MenuSheet({ token, permissions, onClose }) {
  const navigate = useNavigate();
  const { t, dir, rtl } = usePortalLanguage();
  const base = `/p/${encodeURIComponent(token)}`;
  const items = [
    { to: `${base}/feedback`, label: t.shell.menuFeedback, icon: '💬' },
    permissions.viewProcedures && { to: `${base}/procedures`, label: t.shell.menuProcedures, icon: '📋' },
    permissions.viewTraining && { to: `${base}/training`, label: t.shell.menuTraining, icon: '🎓' },
    { to: `${base}/profile`, label: t.shell.menuProfile, icon: '👤' },
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      dir={dir}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-t-2xl bg-white shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300" aria-hidden />
        <div className="px-3 py-3">
          {items.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-[15px] font-medium text-gray-800 active:bg-gray-100 ${
                rtl ? 'text-right' : 'text-left'
              }`}
            >
              <span className="text-xl" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-[14px] font-medium text-gray-500 active:bg-gray-100"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── icons (inline SVG — crisp at any DPI, never bidi-mirrored) ──────

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15.5 8.5l-2 5-5 2 2-5 5-2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 108-8 8.2 8.2 0 00-6 2.7L4 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 4.5V9h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8v4.5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="3.5" y="6" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
