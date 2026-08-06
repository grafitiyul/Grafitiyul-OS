// The organization gate for quote generation — ONE definition, shared by the
// generation modal and its tests.
//
// A quote is always issued TO AN ORGANIZATION. The authority for that rule is
// the SERVER (server/src/quote/produce.js refuses with `organization_required`);
// this module is the client's half: it decides when to open the completion
// dialog INSTEAD of generating, and it recognises the server's refusal so a
// deal whose organization vanished in another tab still lands in the dialog and
// never in a raw error toast.

export const ORGANIZATION_REQUIRED = 'organization_required';

// Does this deal still need an organization before a quote may be generated?
export function needsOrganization(deal) {
  return !deal?.organizationId;
}

// Is this failure the organization invariant (from any quote-creation path)?
export function isOrganizationRequiredError(e) {
  const code = e?.payload?.error ?? e?.error ?? e?.message;
  return code === ORGANIZATION_REQUIRED;
}

// The completion dialog's wording. Kept beside the gate so the copy for
// "why am I seeing this" cannot drift from the rule that raised it.
export const ORG_REQUIRED_COPY = {
  title: 'נדרש ארגון להפקת הצעת מחיר',
  body: 'כדי להפיק הצעת מחיר יש לשייך את הדיל לארגון.',
  confirmLabel: 'שמור ארגון והמשך להפקת ההצעה',
};

// Suggestions come from the canonical contact-membership helper — proven
// ContactOrganization links only (see crm/common/contactOrganizations.js).
export { contactOrganizationSuggestions } from '../../crm/common/contactOrganizations.js';
