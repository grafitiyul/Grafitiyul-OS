import TranslateButton from './TranslateButton.jsx';

// THE bilingual settings field pair — one component behind every He/En input in
// the admin, so the layout, the direction rules and the translate action can
// never drift between screens.
//
// Layout is the canonical one already used by Locations / Products / Quote
// sections: side-by-side on lg+, stacked below it so tablet and mobile never
// crush the two columns.
//
// Direction is stamped per side and never inherited from the RTL page:
//   * Hebrew side  — dir="rtl", right-aligned
//   * English side — dir="ltr", LEFT-aligned, so an operator typing English
//     never fights the page's RTL default
//
// The translate action is the shared TranslateButton: it FILLS the English
// field for review and never saves. Saving stays the host screen's job, which
// is why this component is controlled (value/onChange only) and has no
// autosave of its own.
//
// `render` swaps the control without duplicating the chrome:
//   'input' (default) | 'textarea' | a function ({ value, onChange, dir, lang,
//   ariaLabel, placeholder }) => node — used for rich editors.

const INPUT_CLS =
  'h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

function Control({ render, rows, ...props }) {
  if (typeof render === 'function') return render(props);
  const { value, onChange, dir, ariaLabel, placeholder, autoFocus } = props;
  const align = dir === 'ltr' ? 'text-left' : 'text-right';
  if (render === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={dir}
        rows={rows || 2}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${INPUT_CLS} h-auto resize-y py-2 ${align}`}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      dir={dir}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`${INPUT_CLS} ${align}`}
    />
  );
}

export default function BilingualField({
  label, // Hebrew-side label (the screen's own vocabulary)
  labelEn, // English-side label; defaults to "<label> (אנגלית)"
  he,
  en,
  onHe,
  onEn,
  render = 'input',
  rows,
  placeholderHe,
  placeholderEn,
  // Focus the HEBREW side on mount — Hebrew is the authoring language, so a
  // new-row form should land the cursor there, not in the translation.
  autoFocus = false,
  // 'html' for rich editors (the translator preserves markup), 'text' for
  // plain inputs — passed straight through to the shared translate service.
  format = 'text',
  translate = true,
  className = '',
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4 ${className}`}>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-gray-700">{label}</label>
        <Control
          render={render}
          rows={rows}
          value={he}
          onChange={onHe}
          dir="rtl"
          ariaLabel={label}
          placeholder={placeholderHe}
          autoFocus={autoFocus}
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="block text-[13px] font-medium text-gray-700">
            {labelEn || `${label} (אנגלית)`}
          </label>
          {translate && (
            <TranslateButton
              getSource={() => he}
              getTarget={() => en}
              onResult={onEn}
              format={format}
            />
          )}
        </div>
        <Control
          render={render}
          rows={rows}
          value={en}
          onChange={onEn}
          dir="ltr"
          ariaLabel={labelEn || `${label} (English)`}
          placeholder={placeholderEn}
        />
      </div>
    </div>
  );
}
