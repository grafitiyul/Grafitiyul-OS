import { useSenderAccount } from './useSenderAccount.js';

// THE sender picker. One component, used by every surface that can START a
// WhatsApp message, so the control looks and behaves the same everywhere.
//
// Deliberately renders NOTHING when only one account is configured: a picker
// with a single option is noise, and it would imply a decision that does not
// exist. It appears the moment a second number is paired.
//
// When several accounts exist and the operator has never chosen, `mustChoose`
// is true — the server refuses to guess, so the control says so in amber rather
// than showing a confident default that would be wrong.
export default function SenderAccountSelect({ value = null, onChange = null, disabled = false, compact = false }) {
  const { accounts, hasChoice, accountId, mustChoose, select } = useSenderAccount();
  if (!hasChoice) return null;

  const current = value ?? accountId ?? '';

  const handle = (e) => {
    const id = e.target.value;
    if (!id) return;
    // Always update the global preference: choosing here IS choosing the mode.
    select(id);
    onChange?.(id);
  };

  return (
    <label className={`inline-flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <span className="text-gray-500 shrink-0">שולח מ־</span>
      <select
        value={current}
        onChange={handle}
        disabled={disabled}
        aria-label="בחירת מספר שליחה"
        className={`rounded-md border bg-white px-2 py-1 text-gray-800 disabled:opacity-50 ${
          mustChoose ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-300'
        } ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        {mustChoose && <option value="">בחר/י מספר…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.connected ? '' : ' (מנותק)'}
          </option>
        ))}
      </select>
    </label>
  );
}
