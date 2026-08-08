import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_MEDIA_LANGUAGE, mediaDir, mediaStrings, normalizeMediaLanguage } from './i18n.js';

// The public gallery's language context — the same shape as the Guide Portal's,
// with ONE deliberate difference in where the language comes from.
//
// The portal's language is decided by the SERVER from the staff member's
// canonical language field. A public gallery visitor is anonymous: nobody knows
// their language, so the gallery's own `defaultLanguage` opens the page and the
// visitor switches it themselves. That choice is the single source of truth for
// both the wording AND the text direction, so the two can never disagree.
//
// Every gallery component reads `t` from here. No component keeps its own
// language state, its own copy of the strings, or its own inline ternary.

const GalleryLanguageContext = createContext(null);

export function GalleryLanguageProvider({ lang, children }) {
  const value = useMemo(() => {
    const language = normalizeMediaLanguage(lang);
    return { lang: language, dir: mediaDir(language), t: mediaStrings(language) };
  }, [lang]);
  return (
    <GalleryLanguageContext.Provider value={value}>{children}</GalleryLanguageContext.Provider>
  );
}

/**
 * Gallery strings + language + direction.
 *
 * Falls back to the default language rather than throwing when a component is
 * rendered outside a provider: a missing provider must never blank a customer's
 * gallery, and Hebrew is the correct default for this business.
 */
export function useGalleryLang() {
  return (
    useContext(GalleryLanguageContext) || {
      lang: DEFAULT_MEDIA_LANGUAGE,
      dir: mediaDir(DEFAULT_MEDIA_LANGUAGE),
      t: mediaStrings(DEFAULT_MEDIA_LANGUAGE),
    }
  );
}
