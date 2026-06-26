import { Link } from 'react-router-dom';

// Admin-wide "back" control. The standard for every detail/settings subpage —
// do NOT hand-roll one-off back links per page.
//
// Looks like a normal secondary button (not a tiny text link), with a clear
// click target. In RTL the arrow points to the RIGHT — i.e. toward where
// "back" visually goes in a right-to-left layout. (DOM order [arrow, label]
// renders the arrow on the right of the label under RTL flex.)
//
// Usage:
//   <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
//   <BackButton onClick={() => navigate(-1)} />            // when there's no static target
//
// Props:
//   to       — route to navigate to (renders a react-router <Link>)
//   onClick  — handler used instead of `to` (renders a <button>)
//   label    — Hebrew text (default "חזרה")
//   className — extra classes appended to the base style

const BASE =
  'inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-gray-300 ' +
  'bg-white text-[13px] font-medium text-gray-700 shadow-sm transition ' +
  'hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 shrink-0 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

// Right-pointing arrow — the "back" direction in an RTL UI.
function BackArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function BackButton({ to, onClick, label = 'חזרה', className = '' }) {
  const cls = `${BASE} ${className}`.trim();
  const content = (
    <>
      <BackArrow />
      <span>{label}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {content}
    </button>
  );
}
