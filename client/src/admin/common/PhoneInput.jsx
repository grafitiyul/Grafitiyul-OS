import { parsePhone } from '../../lib/phone.js';

// A light phone input: a normal text field (stores the raw string as typed) with
// a live country-flag indicator derived from the value. International numbers
// ("+44…") detect their country; a local "0…" number shows the Israel flag; an
// unrecognised value shows a neutral globe. No heavy telecom logic.
export default function PhoneInput({ value, onChange, placeholder, autoFocus, id }) {
  const { flag } = parsePhone(value);
  return (
    <div className="relative">
      <span className="absolute inset-y-0 left-2 flex items-center text-base pointer-events-none" aria-hidden>
        {flag || '🌐'}
      </span>
      <input
        id={id}
        type="tel"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || '+972 50-000-0000'}
        autoFocus={autoFocus}
        className="h-10 w-full rounded-lg border border-gray-300 pl-8 pr-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
    </div>
  );
}
