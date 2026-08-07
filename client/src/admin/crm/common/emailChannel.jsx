// The email flavour of ChannelSection, in ONE place.
//
// Any address editor that uses ChannelSection spreads these props, so the
// canonical sanitizer and the operator warning are impossible to forget:
//   <ChannelSection title="כתובות אימייל" {...EMAIL_CHANNEL_PROPS} … />
//
// Repair happens BEFORE the request leaves the browser — the server sanitizes
// again (never trust the client), but the operator sees what will be stored.

import EmailInputHint from '../../common/EmailInputHint.jsx';
import { sanitizeEmailAddress } from '../../../lib/emailAddress.js';

export const EMAIL_CHANNEL_PROPS = {
  sanitizeValue: sanitizeEmailAddress,
  renderHint: (value) => <EmailInputHint value={value} />,
};
