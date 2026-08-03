// Customer-safe generic wording — the ONLY strings allowed when a canonical
// display source (organization / contact / product) is missing.
//
// PRIVACY RULE (2026-08-03, gallery incident): Deal.title is internal CRM
// wording ("ליד חדש - …", pipeline labels) and must NEVER reach a
// customer-facing surface — not as a customer label, not as an activity name,
// not as a payment/invoice line description. When nothing canonical resolves,
// fall back to these neutral strings instead. Names/products stay as stored;
// only these fallbacks are localized.

// An activity with no product (coordination context "הפעילות" field).
export const GENERIC_ACTIVITY_HE = 'הפעילות';
export const GENERIC_ACTIVITY_EN = 'the activity';

// A customer with no organization and no resolvable contact name.
export const GENERIC_CUSTOMER_HE = 'הלקוח';
export const GENERIC_CUSTOMER_EN = 'the customer';

// A payment / iCount document line for a deal with no product. Deliberately a
// product-shaped description — organization/customer names are never used as
// a product line.
export const GENERIC_PRODUCT_LINE_HE = 'פעילות גרפיטיול';
export const GENERIC_PRODUCT_LINE_EN = 'Grafitiyul activity';
