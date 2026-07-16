// בקרה dashboard config — severity + module presentation and entity-link
// resolution. The SERVER owns which actions exist per issue (the registry);
// this file only knows how to render/execute them.

import { dealPath } from '../deals/config.js';

export const SEVERITIES = [
  {
    key: 'critical',
    label: 'קריטי',
    countLabel: 'בעיות קריטיות',
    dot: 'bg-red-500',
    cardBorder: 'border-red-200',
    cardBg: 'bg-red-50',
    countText: 'text-red-700',
    stripe: 'border-s-red-500',
    chip: 'bg-red-50 text-red-700',
  },
  {
    key: 'warning',
    label: 'אזהרה',
    countLabel: 'אזהרות',
    dot: 'bg-amber-500',
    cardBorder: 'border-amber-200',
    cardBg: 'bg-amber-50',
    countText: 'text-amber-700',
    stripe: 'border-s-amber-400',
    chip: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'info',
    label: 'מידע',
    countLabel: 'עדכונים',
    dot: 'bg-blue-500',
    cardBorder: 'border-blue-200',
    cardBg: 'bg-blue-50',
    countText: 'text-blue-700',
    stripe: 'border-s-blue-400',
    chip: 'bg-blue-50 text-blue-700',
  },
];

export const SEVERITY_BY_KEY = Object.fromEntries(SEVERITIES.map((s) => [s.key, s]));

export const MODULE_LABELS = {
  gallery: 'גלריות',
  whatsapp: 'WhatsApp',
  tours: 'סיורים',
  deals: 'CRM',
  email: 'אימייל',
  calendar: 'יומן',
  payroll: 'שכר',
  payments: 'תשלומים',
  reservations: 'הזמנות סוכנים',
};

// Loose entity ref → client route. Issues must survive entity deletion, so a
// ref we can't route just renders as text.
export function entityHref(target) {
  if (!target?.type) return null;
  switch (target.type) {
    case 'deal':
      return dealPath({ orderNo: target.orderNo, id: target.id });
    case 'tour_event':
      return `/admin/tours/${target.id}`;
    case 'whatsapp':
      return '/admin/whatsapp';
    case 'reservation':
      return '/admin/crm/reservations';
    case 'contact':
      return target.id ? `/admin/crm/contacts/${target.id}` : null;
    default:
      return null;
  }
}

// "לפני 5 דקות" style relative time for the detected stamp; falls back to a
// short date once it's older than two days.
export function fmtDetected(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שעות`;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
