import { parsePhone, formatPhoneDisplay } from '../../lib/phone.js';
import CountryFlag from './CountryFlag.jsx';

// Read-only phone display: a real SVG country flag + the number in THE product
// display convention — Israeli numbers local ("🇮🇱 052-426-4020"), foreign
// numbers international ("🇬🇧 +44 7974905044"). One shared component so the
// contacts table, the contact page and anywhere else render phones identically.
//
// Uses formatPhoneDisplay — the same formatter the WhatsApp surfaces already
// used. It previously used formatPhoneNumber, which rendered an Israeli number
// as "+972 52-426-4020"; local 05X form is the convention operators read
// (owner decision, 2026-08-07). All country detection lives in the shared phone
// utility — none here.
export default function PhoneDisplay({ value, className = '' }) {
  const { iso, name } = parsePhone(value);
  return (
    <span dir="ltr" className={`inline-flex items-center gap-1.5 ${className}`}>
      <CountryFlag iso={iso} name={name} />
      <span>{formatPhoneDisplay(value)}</span>
    </span>
  );
}
