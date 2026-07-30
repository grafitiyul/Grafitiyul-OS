import CountryFlag from '../common/CountryFlag.jsx';
import { countryName, isoForIntlDigits } from '../../lib/phone.js';

// Country flag for FOREIGN phone numbers next to WhatsApp identities — a
// scanning aid. Israeli numbers deliberately show NOTHING (the home market
// needs no decoration), and unknown prefixes show nothing (never guess) —
// which is why this does not reuse <PhoneDisplay> (whose unknown state is a
// globe placeholder: right for a contact form, noise in a chat list).
//
// Since 2026-07-30 this is a thin wrapper: prefix detection lives in the ONE
// shared table (lib/phone.js isoForIntlDigits) and rendering is the ONE shared
// <CountryFlag> — the duplicate WhatsApp-only table and span are gone.
export default function PhoneFlag({ phone }) {
  const iso = isoForIntlDigits(phone);
  if (!iso) return null;
  return <CountryFlag iso={iso} name={countryName(iso)} className="shrink-0 text-[9px]" />;
}
