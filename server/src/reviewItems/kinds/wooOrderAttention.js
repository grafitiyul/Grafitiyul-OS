import { registerReviewKind } from '../registry.js';

// A paid WooCommerce order that could NOT be made fully operational
// automatically — unresolvable lines, an order spanning several tour dates, a
// Builder a human already edited, or a tour that could not be joined. The deal
// itself is always created (and WON when paid — the money is real); this card
// is the loud "finish it by hand" signal, never a silent skip.
export const WOO_ORDER_ATTENTION_KIND = 'woo_order_attention';

registerReviewKind(WOO_ORDER_ATTENTION_KIND, {
  labelHe: 'הזמנת אתר לטיפול',
  tone: 'alert',
  descriptionHe:
    'נוצר כשהזמנה מהאתר לא הפכה לעסקה מבצעית באופן מלא — למשל כרטיסים שלא זוהו, '
    + 'הזמנה שמפוצלת בין כמה תאריכים או סיור שלא ניתן היה לשבץ. העסקה קיימת; נדרשת השלמה ידנית.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.dealOrderNo ?? ''}` : null),
});
