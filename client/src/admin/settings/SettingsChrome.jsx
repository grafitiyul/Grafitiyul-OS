import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  getTrail,
  parentOf,
  recordSettingsVisit,
  previousSettingsPath,
} from './settingsNav.js';

// Shared chrome for EVERY settings subpage: a breadcrumb (root → current) plus a
// smart Back button. Back returns to the previous settings location visited this
// session; if there is none (deep link / fresh load) it falls back to the page's
// parent in the settings tree. One component — replaces per-page BackButton links.
//
// Props:
//   currentLabel — overrides the last crumb's label (for dynamic pages, e.g. a
//                  product name on …/products/:id).
//   backLabel    — Back button text (default "חזרה").

// Same visual language as the old BackButton (RTL: arrow points right).
const BACK_CLS =
  'inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-gray-300 ' +
  'bg-white text-[13px] font-medium text-gray-700 shadow-sm transition ' +
  'hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 shrink-0 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function SettingsChrome({ currentLabel, backLabel = 'חזרה' }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const trail = getTrail(pathname, currentLabel);

  useEffect(() => {
    recordSettingsVisit(pathname);
  }, [pathname]);

  function goBack() {
    navigate(previousSettingsPath(pathname) || parentOf(pathname, currentLabel));
  }

  return (
    <div className="mb-5">
      <button type="button" onClick={goBack} className={BACK_CLS}>
        <BackArrow />
        <span>{backLabel}</span>
      </button>
      {trail.length > 1 && (
        <nav
          aria-label="מיקום בהגדרות"
          className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500"
        >
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={c.path} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-gray-300" aria-hidden="true">/</span>}
                {last ? (
                  <span className="font-medium text-gray-700" aria-current="page">{c.label}</span>
                ) : (
                  <Link to={c.path} className="hover:text-gray-700 hover:underline">{c.label}</Link>
                )}
              </span>
            );
          })}
        </nav>
      )}
    </div>
  );
}
