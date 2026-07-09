// CollapsibleCard — THE shared accordion pattern for long configuration lists
// in Settings (image library, video library, and future catalogs). A finished
// item collapses into a single summary row (thumb · title · meta · actions);
// clicking the row expands the full editor. Controlled: the parent owns
// open/onToggle, so a list can enforce single-open or free-multi as it likes.
//
// This is deliberately dumber than VariantEditor's workspace Accordion (which
// carries completion chips and group navigation) — that one stays specialized;
// this one is the reusable list-editor shell.
export default function CollapsibleCard({ open, onToggle, title, subtitle, thumb, meta, actions, children }) {
  return (
    <section className={'overflow-hidden rounded-xl border bg-white transition ' + (open ? 'border-gray-200 shadow-sm' : 'border-gray-200/70')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-right">
          {thumb && <span className="shrink-0">{thumb}</span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-gray-900">{title}</span>
              {meta}
            </span>
            {subtitle && <span className="mt-0.5 block truncate text-[12.5px] text-gray-500">{subtitle}</span>}
          </span>
          <Chevron open={open} />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </section>
  );
}

function Chevron({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={'shrink-0 text-gray-400 transition-transform ' + (open ? 'rotate-180' : '')}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
