import { parsePhone, formatPhoneNumber } from '../../lib/phone.js';
import CountryFlag from './CountryFlag.jsx';

// Read-only phone display: a real SVG country flag + the international number
// ("🇮🇱 +972 52-426-4020"). One shared component so the contacts table, the
// contact page and anywhere else render phones identically. All country
// detection lives in the shared phone utility — none here.
export default function PhoneDisplay({ value, className = '' }) {
  const { iso, name } = parsePhone(value);
  return (
    <span dir="ltr" className={`inline-flex items-center gap-1.5 ${className}`}>
      <CountryFlag iso={iso} name={name} />
      <span>{formatPhoneNumber(value)}</span>
    </span>
  );
}
