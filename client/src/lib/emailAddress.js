// Client re-export of THE canonical email sanitizer (shared/emailAddress.mjs).
// Same convention as lib/duration.js. Import from here in client code so the
// relative path to shared/ lives in exactly one place.
//
// The operator is warned AT THE INPUT: an address pasted out of a Hebrew (RTL)
// context routinely carries an invisible U+200F, which used to be saved
// silently and then rejected by Gmail on every send (#27099/#27100).

export {
  sanitizeEmailAddress,
  normalizeEmailAddress,
  isEmailShaped,
  toSendableAddress,
  hasInvisibleChars,
  describeEmailInput,
  EMAIL_INPUT_MESSAGE_HE,
  EMAIL_CLEANED_NOTE_HE,
} from '../../../shared/emailAddress.mjs';
