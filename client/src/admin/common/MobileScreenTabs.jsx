// Mobile bottom tab bar for a SCREEN's internal sections (not global module
// navigation — that's shell/MobileTabBar). Design language replicated from the
// recruitment module's candidate-evaluation bottom tabs: equal-width tabs,
// icon over a tiny label, colored active text + a small pill indicator on the
// tab's top edge, transition-colors only. Accent color is GOS blue (not the
// recruitment teal) so it belongs to this product's design system.
//
// Controlled component: the owning screen decides the active tab (it may need
// to switch tabs programmatically — e.g. "שלח ללקוח → WhatsApp" jumps to the
// chat tab). Rendered as a normal flex row (shrink-0), NOT fixed — the caller
// places it at the bottom of its own column so it works both on the full page
// and inside bounded panes like DealDrawer.
export default function MobileScreenTabs({ tabs, active, onChange }) {
  return (
    <nav
      role="tablist"
      aria-label="אזורי המסך"
      className="flex h-14 shrink-0 border-t border-gray-200 bg-white"
      style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.04)' }}
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
              isActive ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full bg-blue-600" />
            )}
            <span className="relative flex h-5 items-center justify-center text-base leading-none">
              {t.icon}
              {t.badge > 0 && (
                <span
                  dir="ltr"
                  className="absolute -left-3.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
                >
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium leading-tight">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
