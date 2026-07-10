import { languageLabel } from './constants.js';

// Small language pill switcher — public form page, preview, and the builder's
// editing-language tabs all use this one component. `missing` (optional set/
// array) marks languages with incomplete translations (builder indicator).

export default function LanguageSwitcher({ languages, value, onChange, missing }) {
  if (!languages || languages.length < 2) return null;
  const missingSet = new Set(missing || []);
  return (
    <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
      {languages.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`relative rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
            value === l
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {languageLabel(l)}
          {missingSet.has(l) ? (
            <span
              title="חסרים תרגומים בשפה זו"
              className="absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full border border-white bg-amber-400"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
