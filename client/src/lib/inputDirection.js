// Canonical writing direction for a text INPUT inside the Hebrew (RTL) admin.
//
// The problem with a bare dir="auto": while the field is empty there is no
// strong character to detect, and browsers do not reliably fall back to the
// container's direction — the placeholder ends up left-aligned, so a Hebrew
// form reads as LTR until the user types.
//
// Rule:
//   empty    → 'rtl'  — the field belongs to a Hebrew form, so the placeholder
//                       and the caret start on the right.
//   non-empty→ 'auto' — the CONTENT decides: an email address or English text
//                       renders LTR (correct, readable order), Hebrew renders
//                       RTL. Same first-strong principle the outgoing-mail
//                       serializer uses (shared/textDirection.mjs).
//
// Use this for every composer-style field rather than per-screen CSS.
export function dirForInput(value) {
  return String(value ?? '').trim() ? 'auto' : 'rtl';
}
