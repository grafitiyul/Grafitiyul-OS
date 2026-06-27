import { parsePhone } from '../../lib/phone.js';

// A light phone input: a normal text field (stores the raw string as typed) with
// a live country indicator derived from the value — flag + ISO letters (e.g.
// "🇮🇱 IL"). International numbers ("+44…") detect their country; a local "0…"
// number shows Israel; an unrecognised value shows a neutral globe. Hovering the
// indicator reveals the full country name. All country metadata comes from the
// shared phone utility — no telecom logic here.
export default function PhoneInput({ value, onChange, placeholder, autoFocus, id }) {
  const { flag, iso, name } = parsePhone(value);
  return (
    <div className="relative">
      <span
        className="absolute inset-y-0 left-2 flex items-center gap-1 cursor-default select-none"
        title={name || undefined}
      >
        <span className="text-base leading-none" aria-hidden>{flag || '🌐'}</span>
        {iso && <span className="text-[11px] font-semibold tracking-wide text-gray-500">{iso}</span>}
      </span>
      <input
        id={id}
        type="tel"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || '+972 50-000-0000'}
        autoFocus={autoFocus}
        className="h-10 w-full rounded-lg border border-gray-300 pl-14 pr-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
    </div>
  );
}
