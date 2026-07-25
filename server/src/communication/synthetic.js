// Synthetic simulator context — builds an object with EXACTLY the shape of
// loadTriggerContext's output from user-entered test fields, then hands it to
// the same canonical pipeline (prepare/render/recipients). Pure construction:
// nothing here reads or writes Deals, Contacts, Organizations, Tours, files,
// timeline or deliveries.
//
// ID-based applicability conditions (product/variant/city catalog IDs) cannot
// match synthetic text input by design — the applicability panel reports those
// checks honestly instead of pretending.

import { publicOrigin } from './context.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v == null ? null : String(v).trim() || null);

export function buildSyntheticContext(fields = {}) {
  const f = fields || {};
  const totalMinor = num(f.totalAmount) != null ? Math.round(num(f.totalAmount) * 100) : null;
  const paidMinor = num(f.paidAmount) != null ? Math.round(num(f.paidAmount) * 100) : 0;
  const balanceMinor = totalMinor != null ? totalMinor - paidMinor : null;

  const contact = (str(f.contactFirstName) || str(f.contactLastName) || str(f.phone) || str(f.email)) ? {
    id: 'synthetic-contact',
    firstNameHe: str(f.contactFirstName) || '',
    lastNameHe: str(f.contactLastName) || '',
    firstNameEn: str(f.contactFirstNameEn) || '',
    lastNameEn: str(f.contactLastNameEn) || '',
    communicationLanguage: f.language === 'en' ? 'en' : 'he',
    phones: str(f.phone) ? [{ value: str(f.phone), isPrimary: true }] : [],
    emails: str(f.email) ? [{ value: str(f.email), isPrimary: true }] : [],
  } : null;

  const org = str(f.organization) ? {
    id: 'synthetic-org',
    name: str(f.organization),
    organizationTypeId: null,
    organizationType: null,
  } : null;

  const activityType = ['group', 'private', 'business'].includes(f.activityType) ? f.activityType : null;

  const deal = {
    id: 'synthetic-deal',
    orderNo: num(f.orderNo),
    title: str(f.dealTitle) || 'דיל בדיקה',
    groupName: str(f.groupName),
    // Classification SSOT: a linked org forces business — mirror it here so
    // the applicability gate behaves identically to a real deal.
    organizationId: org ? org.id : null,
    organizationTypeId: null,
    organizationSubtypeId: null,
    organizationUnit: str(f.subOrganization) ? { id: 'synthetic-unit', name: str(f.subOrganization) } : null,
    activityType,
    productId: null,
    productVariantId: null,
    locationId: null,
    dealSourceId: null,
    participants: num(f.participants),
    tourDate: str(f.tourDate),
    tourTime: str(f.tourTime),
    tourLanguage: str(f.tourLanguage) || null,
    communicationLanguage: f.language === 'en' ? 'en' : 'he',
    paymentToken: null,
  };

  const tour = str(f.tourDate) ? {
    id: 'synthetic-tour',
    status: 'scheduled',
    date: str(f.tourDate),
    startTime: str(f.tourTime),
    tourLanguage: str(f.tourLanguage) || null,
    product: str(f.product) ? { nameHe: str(f.product), nameEn: str(f.productEn) || str(f.product) } : null,
    productVariant: null,
    location: str(f.city) ? { nameHe: str(f.city), nameEn: str(f.cityEn) || str(f.city) } : null,
    assignments: [],
  } : null;

  const payment = totalMinor != null ? {
    totalMinor,
    paidMinor,
    balanceMinor,
    currency: 'ILS',
    status: totalMinor <= 0 ? 'no_amount' : paidMinor <= 0 ? 'unpaid' : paidMinor < totalMinor ? 'partial' : 'paid',
  } : null;

  return {
    synthetic: true,
    deal,
    contact,
    fieldContact: null,
    org,
    tour,
    payment,
    reservation: null,
    quoteDoc: null,
    owner: str(f.ownerName) ? { username: str(f.ownerName), displayName: str(f.ownerName) } : null,
    links: { origin: publicOrigin(), paymentUrl: null },
  };
}
