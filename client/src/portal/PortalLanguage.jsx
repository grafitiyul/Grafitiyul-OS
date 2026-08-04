import { createContext, useContext, useMemo } from 'react';
import {
  DEFAULT_PORTAL_LANGUAGE,
  normalizePortalLanguage,
  portalDir,
  portalStrings,
} from './i18n.js';

// THE Guide Portal language context — the client half of the ONE language
// decision. The server resolves the language from the canonical staff field and
// ships it on every portal payload; this provider distributes that single value
// to every screen and shared component.
//
// Rules this enforces by construction:
//   * no screen reads navigator.language, a cookie, or a URL parameter
//   * no screen keeps its own language state or its own copy of the strings
//   * `dir` comes from the same value as the wording, so text direction and
//     translation can never disagree (Hebrew RTL, English LTR)
//
// Two entry points exist because two portal surfaces render OUTSIDE the shell
// (the full-screen tour gallery and the install page). They wrap themselves in
// the provider using the language their own API payload carried.

const PortalLanguageContext = createContext(null);

function buildValue(lang) {
  const language = normalizePortalLanguage(lang);
  return {
    lang: language,
    t: portalStrings(language),
    dir: portalDir(language),
    rtl: portalDir(language) === 'rtl',
  };
}

const FALLBACK = buildValue(DEFAULT_PORTAL_LANGUAGE);

export function PortalLanguageProvider({ language, children }) {
  const value = useMemo(() => buildValue(language), [language]);
  return (
    <PortalLanguageContext.Provider value={value}>{children}</PortalLanguageContext.Provider>
  );
}

/**
 * `{ lang, t, dir, rtl }` for the current guide.
 *
 * Outside a provider this returns the Hebrew default rather than throwing: a
 * shared component (participant card, gallery grid, crop dialog) is also
 * rendered by ADMIN screens, and there the portal language simply does not
 * apply — those keep their existing Hebrew wording untouched.
 */
export function usePortalLanguage() {
  return useContext(PortalLanguageContext) || FALLBACK;
}
