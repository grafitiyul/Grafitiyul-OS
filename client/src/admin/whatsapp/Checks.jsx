// WhatsApp-style delivery checks for OUTGOING messages — the shared indicator
// every surface uses (message bubbles, inbox previews). Ladder:
//   sent      → one gray check
//   delivered → two gray checks
//   read      → two blue checks
//   played    → two blue checks (voice note listened)
// Unknown/null renders as 'sent' — an outgoing row exists only after the
// WhatsApp server accepted it.

const DOUBLE = new Set(['delivered', 'read', 'played']);
const BLUE = new Set(['read', 'played']);

export default function Checks({ status, size = 15 }) {
  const double = DOUBLE.has(status);
  const color = BLUE.has(status) ? 'text-sky-500' : 'text-gray-400';
  return (
    <svg
      viewBox="0 0 18 12"
      width={size}
      height={(size * 12) / 18}
      aria-label={double ? (BLUE.has(status) ? 'נקרא' : 'נמסר') : 'נשלח'}
      className={`inline-block shrink-0 ${color}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 6.5l3 3L10 3" />
      {double && <path d="M7.5 8.6l1 0.9L14 3" />}
    </svg>
  );
}
