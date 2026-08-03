import SettingsChrome from './SettingsChrome.jsx';

// THE canonical settings-page container — one width system instead of a
// hardcoded max-w class per page. Presets (pick by CONTENT, not habit):
//   narrow   — simple catalogs / small forms (the old max-w-3xl default)
//   standard — hub pages, medium forms
//   wide     — bilingual rich-text editors: two He/En columns must each hold a
//              full sentence + toolbar without cramping (the complaint that
//              triggered this: logistics editors ~300px wide inside max-w-3xl)
//   full     — complex workspaces (the EventEditorPage/VariantEditor scale)
// Below lg the bilingual grids stack (their own grid-cols-1), and this shell
// keeps comfortable mobile padding — width presets are a desktop concern.
export const SETTINGS_WIDTHS = {
  narrow: 'max-w-3xl',
  standard: 'max-w-4xl',
  wide: 'max-w-6xl',
  full: 'max-w-[1600px]',
};

export default function SettingsShell({ width = 'standard', title, subtitle, actions, children }) {
  return (
    <div className={`px-5 py-8 lg:px-10 lg:py-10 ${SETTINGS_WIDTHS[width] || SETTINGS_WIDTHS.standard} mx-auto`}>
      <header className="mb-8">
        <SettingsChrome />
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          {actions}
        </div>
        {subtitle && <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}
