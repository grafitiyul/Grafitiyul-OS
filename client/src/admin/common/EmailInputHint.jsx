// Operator-facing feedback for any email input, driven by THE canonical
// sanitizer (shared/emailAddress.mjs). Drop it under any address field.
//
// WHY: an address copied out of a Hebrew (RTL) context routinely carries an
// invisible U+200F. It looks perfect on screen, saves without complaint, and
// then Gmail rejects every message to it — that is how deals #27099/#27100 went
// unsent for a day. The operator now sees the repair as it happens.

import { describeEmailInput, EMAIL_INPUT_MESSAGE_HE, EMAIL_CLEANED_NOTE_HE } from '../../lib/emailAddress.js';

/**
 * @param value  the raw input text
 * @param show   render nothing until the operator has typed something real
 */
export default function EmailInputHint({ value, className = '' }) {
  const raw = String(value ?? '');
  if (!raw.trim()) return null;
  const d = describeEmailInput(raw);

  // Invisible characters were present but the address is otherwise fine —
  // tell the operator what will be saved, and that it was repaired.
  if (d.valid && d.hadInvisible) {
    return (
      <p className={`mt-1 text-[11.5px] text-amber-700 ${className}`} dir="rtl">
        ⚠ {EMAIL_CLEANED_NOTE_HE}{' '}
        <span className="font-medium">ייִשמר:</span>{' '}
        <span dir="ltr" className="font-mono">{d.sanitized}</span>
      </p>
    );
  }
  if (d.valid) return null;
  return (
    <p className={`mt-1 text-[11.5px] text-red-600 ${className}`} dir="rtl">
      {EMAIL_INPUT_MESSAGE_HE[d.reason] || EMAIL_INPUT_MESSAGE_HE.invalid_shape}
    </p>
  );
}
