import { Link } from 'react-router-dom';

// Settings home has TWO deliberately different card languages, because the two
// things behave differently and users should feel that before they click:
//
//   CategoryCard — system CONFIGURATION. A light square card, icon on top, in a
//                  plain grid. You go there to change a setting and come back.
//   ModuleCard   — a complete MODULE. A horizontal row on a tinted panel, with
//                  the icon in a dark gray-900 tile (the nav rail's own colour,
//                  so the tile reads as "this is a navigation module") and an
//                  enter-arrow pointing the RTL reading direction. You go there
//                  to work, not to configure.

// ── System configuration ─────────────────────────────────────────────────────
// Square category cards, Challenge-system style. Active cards link somewhere;
// placeholder cards show a "בקרוב" badge and are not clickable.

export function CategoryGrid({ children }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
  );
}

export function CategoryCard({ to, icon, title, description, comingSoon }) {
  const inner = (
    <div
      className={`h-full min-h-[140px] rounded-xl border p-5 flex flex-col gap-2 transition ${
        comingSoon
          ? 'border-gray-200 bg-gray-50'
          : 'border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-blue-300'
      }`}
    >
      <div className="text-3xl leading-none">{icon}</div>
      <div className="font-semibold text-gray-900 text-[15px]">{title}</div>
      <div className="text-[12px] text-gray-500 leading-relaxed flex-1">
        {description}
      </div>
      {comingSoon && (
        <span className="self-start rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          בקרוב
        </span>
      )}
    </div>
  );

  if (comingSoon || !to) {
    return <div className="cursor-default opacity-75">{inner}</div>;
  }
  return (
    <Link to={to} className="block">
      {inner}
    </Link>
  );
}

// ── Section headings ─────────────────────────────────────────────────────────
// The quiet eyebrow label above the configuration grid, and the louder titled
// header that opens the modules band. The asymmetry is the point: it tells you
// the second group is a different KIND of thing, not more of the same.

export function SectionEyebrow({ children }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        {children}
      </span>
      <span className="h-px flex-1 bg-gray-200" aria-hidden="true" />
    </div>
  );
}

// `action` sits on the far edge of the header row — in RTL that is the LEFT
// corner, opposite the title. It is the section's own control, not a card in
// the grid: configuring which modules appear in the navigation belongs to the
// whole section, not to any one module inside it.
export function SectionHeader({ title, description, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight text-gray-900">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// The section-level control in a SectionHeader's `action` slot.
export function SectionAction({ to, icon, children }) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      {icon && <span className="text-[15px] leading-none">{icon}</span>}
      <span>{children}</span>
    </Link>
  );
}

// ── Management modules ───────────────────────────────────────────────────────

export function ModuleGrid({ children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

// RTL: forward motion reads right→left, so the "enter" arrow points LEFT. The
// SVG is drawn explicitly rather than using an arrow character, which the bidi
// algorithm would flip inside a Hebrew line.
function EnterArrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// Every full module has a card here, so `badge` carries its navigation status —
// which group of the rail it sits in, or that it is currently out of the menu.
export function ModuleCard({ to, icon, Icon, title, description, badge }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gray-900 text-[20px] leading-none shadow-sm transition group-hover:bg-gray-800">
        {Icon ? <Icon size={20} /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-[15px] text-gray-900">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-gray-500 line-clamp-2">
          {description}
        </span>
      </span>
      <span className="shrink-0 text-gray-300 transition group-hover:-translate-x-0.5 group-hover:text-gray-600">
        <EnterArrow />
      </span>
    </Link>
  );
}
