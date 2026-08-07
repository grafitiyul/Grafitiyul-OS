// WHO this conversation is with — one rule, every WhatsApp surface.
//
// GOS resolves the display name CRM-first (linked Contact → phone address-book
// name → WhatsApp profile name → group subject → digits, server-side in
// chatDisplayName). That stays: the CRM identity is the one the business works
// with.
//
// But the WhatsApp-native name is real information the operator was losing —
// "דור קורן" in the CRM is "Dor Koren Grafitiyul" on WhatsApp, and knowing that
// is how you recognise the person you are actually talking to. It is shown as a
// SECONDARY label, and only when it adds something: if it is merely a
// re-spelling of the name already on screen, a second line is noise.
//
// Group chats keep the group identity rule: the subject IS the group's name, so
// it is never repeated underneath itself.

/** Loose identity comparison: case, spacing and edge punctuation don't count. */
function sameName(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLocaleLowerCase()
      .replace(/[\s‎‏]+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  // A contains B (or vice versa) is still "the same person, spelled longer" —
  // "Dor" under "Dor Koren" tells the operator nothing new.
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The WhatsApp-native name to show beneath the CRM name, or null when it would
 * add nothing.
 *
 * @param chat server chat DTO — { displayName, providerName, phoneNumber, type }
 */
export function whatsAppSecondaryName(chat) {
  if (!chat) return null;
  const provider = String(chat.providerName || '').trim();
  if (!provider) return null;
  // A "name" that is just the number is the digits we already show.
  if (provider.replace(/\D/g, '') && !/\p{L}/u.test(provider)) return null;
  if (sameName(provider, chat.displayName)) return null;
  return provider;
}
