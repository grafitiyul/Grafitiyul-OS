// ============================================================================
// Site content seam.
//
// This is the SINGLE place the shell reads its copy/links from. Today the
// values are hardcoded (Hebrew-first, taken from the Figma navbar/footer).
// Later they get sourced from GOS content / the WordPress export WITHOUT
// changing any component — callers just import from here.
//
// Routes are placeholders for now; the real route map is wired when the
// public router lands (Step 3/4). Keeping them here means a route rename is
// one edit, not a hunt through the shell.
// ============================================================================

export const site = {
  name: 'גרפיטיול',
  nameEn: 'Grafitiyul',
  // Phone in international format for the WhatsApp deep link (no +, no spaces).
  // Placeholder until confirmed from the business / WP data.
  whatsappNumber: '972500000000',
  whatsappMessage: 'היי, אשמח לקבל פרטים על סיור 🙂',
  locales: ['he', 'en'], // he is the V1 default; en is structurally prepared
  defaultLocale: 'he',
};

// Primary navigation (RTL reading order). `cta` marks the two header buttons.
export const primaryNav = [
  { label: 'בית', href: '/' },
  { label: 'סיורים וסדנאות', href: '/tours', hasMenu: true },
  { label: 'חוות דעת', href: '/reviews' },
  { label: 'בלוג', href: '/blog' },
  { label: 'אודות', href: '/about' },
  { label: 'שאלות תשובות', href: '/faq' },
];

export const headerCtas = {
  search: { label: 'חפשו סיור', href: '/tours', variant: 'highlight' },
  contact: { label: 'צרו קשר', href: '/contact', variant: 'outline' },
};

// Footer link groups + legal row (from the Figma footer).
export const footerNav = [
  {
    title: 'ניווט',
    links: [
      { label: 'בית', href: '/' },
      { label: 'סיורים וסדנאות', href: '/tours' },
      { label: 'אודות', href: '/about' },
      { label: 'חוות דעת', href: '/reviews' },
      { label: 'בלוג', href: '/blog' },
    ],
  },
  {
    title: 'תמיכה',
    links: [
      { label: 'שאלות תשובות', href: '/faq' },
      { label: 'מרכז עזרה', href: '/help' },
      { label: 'צרו קשר', href: '/contact' },
    ],
  },
];

export const legalNav = [
  { label: 'תנאי שימוש', href: '/legal/terms' },
  { label: 'מדיניות פרטיות', href: '/legal/privacy' },
  { label: 'נגישות', href: '/legal/accessibility' },
];

// Copyright line. Year is a literal (the design shows 2025); when this becomes
// dynamic it will be set server-side, not via Date in a client component.
export const copyright = `כל הזכויות שמורות © 2025 ${site.name}`;
