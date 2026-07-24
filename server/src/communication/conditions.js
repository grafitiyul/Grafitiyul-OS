// Applicability evaluation for Communication Events — PURE (no I/O, fully
// unit-tested). Two layers, both explicit and declarative (never stored code):
//
//   1. Activity gate: all | include | exclude over the canonical activity
//      types (group | private | business), plus the business org-type/subtype
//      filters (real OrganizationType/OrganizationSubtype IDs — never names).
//   2. Generic conditions: [{ field, op, values }] with op in
//      eq | neq | any_of | none_of | exists | not_exists, over the registered
//      CONDITION_FIELDS below. Unknown fields/ops fail CLOSED (the event does
//      not fire) and are reported, so a typo can never broadcast a message.
//
// The evaluation context is the loaded trigger context (context.js) — the
// same object the variable resolver uses, so preview and the live engine can
// never disagree.

export const ACTIVITY_TYPES = ['group', 'private', 'business'];
export const CONDITION_OPS = ['eq', 'neq', 'any_of', 'none_of', 'exists', 'not_exists'];

// field key → { labelHe, get(ctx) → scalar | null }.  Values compared as
// strings (IDs / enum keys) or numbers; null/undefined = "does not exist".
export const CONDITION_FIELDS = {
  product: { labelHe: 'מוצר', get: (ctx) => ctx.deal?.productId ?? null, ref: 'product' },
  product_variant: { labelHe: 'וריאציה', get: (ctx) => ctx.deal?.productVariantId ?? null, ref: 'productVariant' },
  location: { labelHe: 'עיר', get: (ctx) => ctx.deal?.locationId ?? null, ref: 'location' },
  tour_language: { labelHe: 'שפת הסיור', get: (ctx) => ctx.tour?.tourLanguage ?? ctx.deal?.tourLanguage ?? null, ref: 'tourLanguage' },
  communication_language: { labelHe: 'שפת תקשורת', get: (ctx) => ctx.contact?.communicationLanguage ?? null, ref: 'language' },
  deal_source: { labelHe: 'מקור הדיל', get: (ctx) => ctx.deal?.dealSourceId ?? null, ref: 'dealSource' },
  payment_status: {
    labelHe: 'מצב תשלום',
    // collection.js ladder: no_amount | unpaid | partial | paid
    get: (ctx) => ctx.payment?.status ?? null,
    ref: 'paymentStatus',
  },
  has_tour: { labelHe: 'קיים סיור', get: (ctx) => (ctx.tour ? 'yes' : null), ref: 'flag' },
  has_assigned_guide: {
    labelHe: 'הוקצה מדריך',
    get: (ctx) => ((ctx.tour?.assignments?.length || 0) > 0 ? 'yes' : null),
    ref: 'flag',
  },
  guides_count: { labelHe: 'מספר מדריכים', get: (ctx) => ctx.tour?.assignments?.length ?? null, ref: 'number' },
};

function toComparable(v) {
  return v == null ? null : String(v);
}

/** One condition → { pass, error? }. Fails CLOSED on unknown field/op. */
export function evaluateCondition(cond, ctx) {
  const field = CONDITION_FIELDS[cond?.field];
  if (!field) return { pass: false, error: `unknown_field:${cond?.field}` };
  if (!CONDITION_OPS.includes(cond?.op)) return { pass: false, error: `unknown_op:${cond?.op}` };
  const raw = field.get(ctx);
  const value = toComparable(raw);
  const values = (Array.isArray(cond.values) ? cond.values : []).map(toComparable);
  switch (cond.op) {
    case 'exists': return { pass: value != null };
    case 'not_exists': return { pass: value == null };
    case 'eq': return { pass: value != null && value === values[0] };
    case 'neq': return { pass: value == null || value !== values[0] };
    case 'any_of': return { pass: value != null && values.includes(value) };
    case 'none_of': return { pass: value == null || !values.includes(value) };
    default: return { pass: false, error: `unknown_op:${cond.op}` };
  }
}

/**
 * Full event applicability → { applicable, checks: [{label, pass, detail?}] }.
 * `checks` powers the preview's "which condition passed/failed" panel.
 */
export function evaluateApplicability(event, ctx) {
  const checks = [];
  let applicable = true;

  // 1. Activity gate. Effective activity type: linked org forces business
  //    (classification SSOT); otherwise the deal's own value.
  const activity = ctx.deal?.organizationId ? 'business' : (ctx.deal?.activityType ?? null);
  const mode = event.activityMode || 'all';
  const listed = Array.isArray(event.activityTypes) ? event.activityTypes : [];
  if (mode === 'include') {
    const pass = activity != null && listed.includes(activity);
    checks.push({ key: 'activity', label: 'סוג פעילות (כלול)', pass, detail: activity || '—' });
    if (!pass) applicable = false;
  } else if (mode === 'exclude') {
    const pass = activity == null || !listed.includes(activity);
    checks.push({ key: 'activity', label: 'סוג פעילות (לא כלול)', pass, detail: activity || '—' });
    if (!pass) applicable = false;
  } else {
    checks.push({ key: 'activity', label: 'סוג פעילות', pass: true, detail: 'הכל' });
  }

  // 2. Business org filters — only meaningful when the event targets business
  //    activity; an empty list means "all types/subtypes".
  const orgTypeIds = Array.isArray(event.orgTypeIds) ? event.orgTypeIds : [];
  const orgSubtypeIds = Array.isArray(event.orgSubtypeIds) ? event.orgSubtypeIds : [];
  if (orgTypeIds.length) {
    // Effective org type: the linked org's type (SSOT) else the deal's manual copy.
    const typeId = ctx.org?.organizationTypeId ?? ctx.deal?.organizationTypeId ?? null;
    const pass = typeId != null && orgTypeIds.includes(typeId);
    checks.push({ key: 'orgType', label: 'סוג ארגון', pass });
    if (!pass) applicable = false;
  }
  if (orgSubtypeIds.length) {
    const subId = ctx.deal?.organizationSubtypeId ?? null;
    const pass = subId != null && orgSubtypeIds.includes(subId);
    checks.push({ key: 'orgSubtype', label: 'תת-סוג ארגון', pass });
    if (!pass) applicable = false;
  }

  // 3. Generic conditions (AND semantics).
  const conds = Array.isArray(event.conditions) ? event.conditions : [];
  for (const cond of conds) {
    const r = evaluateCondition(cond, ctx);
    const label = CONDITION_FIELDS[cond?.field]?.labelHe || cond?.field || '?';
    checks.push({ key: `cond:${cond?.field}`, label, pass: r.pass, detail: r.error || undefined });
    if (!r.pass) applicable = false;
  }

  return { applicable, checks };
}
