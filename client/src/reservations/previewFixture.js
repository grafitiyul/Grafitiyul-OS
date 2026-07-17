// Design-preview fixture for /r/__preview — the agent form rendered with
// representative data and NO network/persistence (project rule: previews use
// the real runtime and never save). Lets the owner see the exact agent
// experience without minting a link.

export const PREVIEW_BOOT = {
  agent: {
    nameHe: 'איילת שמיר',
    nameEn: 'Ayelet Shamir',
    phone: '054-1234567',
    email: 'ayelet@travel.co.il',
  },
  organization: {
    name: 'מסעות עולם',
    financeContactName: 'רותי לוין',
    financeEmail: 'finance@travel.co.il',
  },
  defaultLanguage: 'he',
  maxGroups: 30,
  requiredConfirmations: ['flexible_cancellation', 'reservation_request'],
  catalog: {
    cities: [
      { key: 'תל אביב', nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
      { key: 'חיפה', nameHe: 'חיפה', nameEn: 'Haifa' },
    ],
    variants: [
      {
        id: 'pv1',
        cityKey: 'תל אביב',
        nameHe: 'סיור גרפיטי בנושא 7/10 כולל התנסות',
        nameEn: 'October 7th Graffiti Tour incl. hands-on',
        description: 'גילאי 13 ומעלה',
      },
      {
        id: 'pv2',
        cityKey: 'תל אביב',
        nameHe: 'סיור וסדנת גרפיטי בפלורנטין',
        nameEn: 'Florentin Graffiti Tour & Workshop',
        description: 'גילאי 10 ומעלה',
      },
      {
        id: 'pv3',
        cityKey: 'חיפה',
        nameHe: 'סיור אמנות רחוב בעיר התחתית',
        nameEn: 'Downtown Street-Art Tour',
        description: null,
      },
    ],
  },
};
