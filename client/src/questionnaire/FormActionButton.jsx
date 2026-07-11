import { SUBMISSION_STATUS_LABELS } from './constants.js';

// A questionnaire action as a REAL button (spec: never plain text) — shared
// presentation for the coordination form and tour-summary actions in both
// the Admin Tour modal and the Guide Portal. Pure component: status +
// callbacks in, one tap target out.

const STATUS_CHIP = {
  draft: 'bg-amber-100 text-amber-800',
  submitted: 'bg-emerald-100 text-emerald-800',
  reviewed: 'bg-emerald-100 text-emerald-800',
};

export default function FormActionButton({
  icon = '📋',
  label,
  status, // null | 'draft' | 'submitted' | 'reviewed'
  onClick,
  busy = false,
  className = '',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
        status === 'submitted' || status === 'reviewed'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : status === 'draft'
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          : 'border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100'
      } ${className}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{busy ? 'פותח…' : label}</span>
      {status && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${STATUS_CHIP[status] || ''}`}>
          {SUBMISSION_STATUS_LABELS[status] || status}
        </span>
      )}
    </button>
  );
}
