import { formatMinor } from '../lib/money.js';
import defaultHeroLogo from '../public/assets/home/photos/footer-logo.png';

// Quote document renderer — visual polish pass (Hebrew-first, premium).
//
// The ONE shared, presentational renderer. NO admin assumptions, NO controls.
// Hebrew is the design target for now; the bilingual scaffolding stays but English
// polish comes later. Typography over borders; generous whitespace; RTL-first.

export const TEAL = '#10a99b';

// Rich text: logical alignment/padding (text-start, ps-*) so it follows the
// document direction (RTL → right, LTR → left) instead of being hard-right.
const RICH =
  'text-[16.5px] leading-[2] text-gray-700 text-start [&_p]:mb-4 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:ps-6 [&_li]:mb-1.5 [&_a]:text-teal-700 [&_a]:underline [&_h2]:text-lg [&_h3]:text-[17px] [&_h3]:font-semibold [&_strong]:font-semibold';

const T = {
  he: {
    contact: 'מוזמינה', org: 'ארגון', by: 'הוכן ע"י', date: 'הופק בתאריך',
    city: 'איפה', tourDate: 'תאריך', time: 'שעה', participants: 'משתתפים', language: 'שפה', duration: 'משך',
    paymentTerm: 'תנאי תשלום', paymentMethod: 'אמצעי תשלום', total: 'סה״כ',
    vat: { included: 'כולל מע״מ', excluded: 'לפני מע״מ', exempt: 'פטור', inherit: '' },
    introPlaceholder: '— הוסיפו פתיח אישי ללקוח —',
    hours: 'שעות', noContent: '— אין תוכן —', signaturePlaceholder: 'אזור חתימה / אישור — ייבנה בשלב הבא',
  },
  en: {
    contact: 'Contact', org: 'Organization', by: 'By', date: 'Date',
    city: 'Location', tourDate: 'Date', time: 'Time', participants: 'Participants', language: 'Language', duration: 'Duration',
    paymentTerm: 'Payment terms', paymentMethod: 'Payment method', total: 'Total',
    vat: { included: 'incl. VAT', excluded: 'excl. VAT', exempt: 'VAT exempt', inherit: '' },
    introPlaceholder: '— add a personal introduction —',
    hours: 'hours', noContent: '— no content —', signaturePlaceholder: 'Signature / approval area — coming soon',
  },
};

const TITLES = {
  he: {
    tour_details: 'פרטים טכניים', product_marketing: 'מה כולל הסיור?', pricing: 'כמה עולה?',
    why_us: 'למה גרפיתיול?', faq: 'שאלות נפוצות', cancellation: 'מדיניות ביטול ודחייה',
    participant_policy: 'מדיניות שינוי כמות משתתפים', signature: 'חתימה',
  },
  en: {
    tour_details: 'Technical Details', product_marketing: "What's Included?", pricing: 'Pricing',
    why_us: 'Why Grafitiyul?', faq: 'FAQ', cancellation: 'Cancellation', participant_policy: 'Participant Policy', signature: 'Signature',
  },
};

const LANG_NAMES = {
  he: { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' },
  en: { he: 'Hebrew', en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' },
};

const tt = (lang) => T[lang] || T.he;

function fmtDate(v, lang) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  try { return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'he-IL'); } catch { return String(v); }
}

function Empty({ lang }) {
  return <p className="text-start text-sm italic text-gray-300">{tt(lang).noContent}</p>;
}
function Html({ html, lang }) {
  if (!html || !String(html).trim()) return <Empty lang={lang} />;
  return <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Section heading — aligned to the reading start (right in RTL, left in LTR).
function Heading({ children }) {
  if (!children) return null;
  return (
    <h2 className="mb-7 text-start text-[30px] font-extrabold leading-tight tracking-tight" style={{ color: TEAL }}>
      {children}
    </h2>
  );
}

// ── Hero — a premium proposal cover ──────────────────────────────────────────
// The image is the ground; a configurable overlay + permanent legibility scrims
// keep every element readable. Logo (corner), a bold title/product thesis, and a
// single dark-glass metadata card — no dashboard, no duplicated facts.

const HERO_LABELS = {
  he: { preparedFor: 'הוכן עבור', org: 'ארגון', generatedOn: 'הופק בתאריך', preparedBy: 'הוכן על ידי' },
  en: { preparedFor: 'Prepared for', org: 'Organization', generatedOn: 'Generated on', preparedBy: 'Prepared by' },
};
const LOGO_SIZE_PX = { sm: 46, md: 62, lg: 82 };

const svgProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
const HERO_ICONS = {
  preparedFor: (<svg {...svgProps}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>),
  org: (<svg {...svgProps}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" /></svg>),
  generatedOn: (<svg {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>),
  preparedBy: (<svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>),
};

function hexToRgba(hex, alpha) {
  const h = String(hex || '#0b1220').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function CoverMetaRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[.07] text-teal-300">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-[.14em] text-white/45">{label}</div>
        <div className="truncate text-[14.5px] font-semibold leading-snug text-white">{value || '—'}</div>
      </div>
    </div>
  );
}

function Cover({ d, lang }) {
  const en = lang === 'en';
  const L = HERO_LABELS[en ? 'en' : 'he'];
  const bg = d.heroImageUrl
    ? { backgroundImage: `url(${d.heroImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `linear-gradient(135deg, ${TEAL}, #0b6f69)` };
  const title = d.heroTitle || (en ? 'Proposal' : 'הצעת מחיר');

  const overlayOn = d.heroOverlayEnabled !== false;
  const overlayColor = d.heroOverlayColor || '#0b1220';
  const overlayOpacity = (typeof d.heroOverlayOpacity === 'number' ? d.heroOverlayOpacity : 40) / 100;
  const logoUrl = d.heroLogoUrl || defaultHeroLogo;
  const logoPx = LOGO_SIZE_PX[d.heroLogoSize] || LOGO_SIZE_PX.md;
  const logoAtStart = (d.heroLogoPosition || 'start') === 'start';
  const titleCenter = d.heroTitleAlign === 'center';

  // Card position resolved to PHYSICAL sides so RTL/LTR both place it natively.
  const [cardV, cardH] = (d.heroCardPosition || 'top-end').split('-');
  const cardSide = cardH === 'start' ? (en ? 'left' : 'right') : en ? 'right' : 'left';
  const cardAlpha = (typeof d.heroCardOpacity === 'number' ? d.heroCardOpacity : 82) / 100;

  return (
    <div className="relative w-full overflow-hidden" style={bg}>
      {/* configurable overlay — above the image, below all content */}
      {overlayOn && <div className="absolute inset-0" style={{ background: overlayColor, opacity: overlayOpacity }} />}
      {/* permanent legibility scrims — guarantee contrast whatever the overlay is */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,0))' }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.28), rgba(0,0,0,0))' }} />

      {/* floating info card — one metadata panel, generous margin so it never
          covers the subject or the title. */}
      <div className="absolute z-20" style={{ [cardV]: '1.75rem', [cardSide]: '1.75rem', width: 250, maxWidth: '68%' }}>
        <div className="rounded-2xl px-5 py-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-md" style={{ background: hexToRgba('#090d16', cardAlpha) }}>
          <CoverMetaRow icon={HERO_ICONS.preparedFor} label={L.preparedFor} value={d.customerName} />
          <div className="border-t border-white/10" />
          <CoverMetaRow icon={HERO_ICONS.org} label={L.org} value={d.organizationName} />
          <div className="border-t border-white/10" />
          <CoverMetaRow icon={HERO_ICONS.generatedOn} label={L.generatedOn} value={fmtDate(d.createdAt, lang)} />
          <div className="border-t border-white/10" />
          <CoverMetaRow icon={HERO_ICONS.preparedBy} label={L.preparedBy} value={d.by} />
        </div>
      </div>

      <div className="relative z-10 flex min-h-[600px] flex-col justify-between p-8 sm:p-12">
        {/* logo — corner (reading start/end) */}
        <div className={`flex ${logoAtStart ? 'justify-start' : 'justify-end'}`}>
          <img src={logoUrl} alt="Grafitiyul" style={{ height: logoPx }} className="w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,.45)]" />
        </div>
        {/* title thesis — proposal title + product */}
        <div className={`max-w-[82%] ${titleCenter ? 'mx-auto text-center' : 'text-start'}`}>
          <div className={`mb-5 h-1.5 w-14 rounded-full ${titleCenter ? 'mx-auto' : ''}`} style={{ background: TEAL }} />
          <h1 className="text-[50px] font-black leading-[1.03] text-white [text-wrap:balance] drop-shadow-[0_2px_16px_rgba(0,0,0,.5)] sm:text-[66px]">{title}</h1>
          {d.productName && <p className="mt-4 text-[22px] font-medium text-white/90 drop-shadow-[0_1px_10px_rgba(0,0,0,.5)] sm:text-[26px]">{d.productName}</p>}
          {d.heroSubtitle && <p className="mt-2 text-[16px] text-white/75 drop-shadow-[0_1px_8px_rgba(0,0,0,.5)] sm:text-[18px]">{d.heroSubtitle}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Technical Details — value-dominant tiles (no table feel) ─────────────────
// Which facts show, and in what order, is driven by the global template's
// `fieldOrder` (stable keys). When absent (no template configured) the built-in
// default key order is used — identical to before. Icon + label stay here.
const TECH_FIELD_DEFS = {
  city: (t, d) => ['📍', t.city, d.city],
  date: (t, d, lang) => ['📅', t.tourDate, fmtDate(d.tourDate, lang)],
  time: (t, d) => ['🕒', t.time, d.tourTime],
  participants: (t, d) => ['👥', t.participants, d.participants],
  duration: (t, d) => ['⏳', t.duration, d.durationHours ? `~${d.durationHours} ${t.hours}` : null],
  language: (t, d, lang) => ['🌍', t.language, d.tourLanguage ? LANG_NAMES[lang]?.[d.tourLanguage] || d.tourLanguage : null],
};
const TECH_DEFAULT_ORDER = ['city', 'date', 'time', 'participants', 'duration', 'language'];

function FactCard({ d, lang }) {
  const t = tt(lang);
  const order = Array.isArray(d.fieldOrder) ? d.fieldOrder : TECH_DEFAULT_ORDER;
  const facts = order
    .map((key) => TECH_FIELD_DEFS[key])
    .filter(Boolean)
    .map((def) => def(t, d, lang))
    .filter(([, , v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {facts.map(([icon, label, value]) => (
        <div key={label} className="flex flex-col items-center gap-3 rounded-2xl bg-gray-50 px-4 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full text-2xl" style={{ background: 'rgba(16,169,155,.10)', color: TEAL }}>{icon}</div>
          <div className="text-[19px] font-bold leading-tight text-gray-900">{value}</div>
          <div className="text-[12px] text-gray-400">{label}</div>
        </div>
      ))}
    </div>
  );
}

function PricingCard({ d, lang }) {
  const t = tt(lang);
  const vat = t.vat;
  const lines = d.lines || [];
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start justify-between gap-4 border-b border-gray-100 px-7 py-6">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold text-gray-900">{l.label || '—'}</div>
            {l.quantity > 1 && <div className="mt-0.5 text-[13px] text-gray-400" dir="ltr">{l.quantity} × {formatMinor(l.unitPriceMinor, d.currency)}</div>}
            {l.note && <div className="mt-2 text-[14px] leading-relaxed text-gray-500">{l.note}</div>}
          </div>
          <div className="shrink-0 text-end">
            <div className="text-[17px] font-bold text-gray-900" dir="ltr">{formatMinor(l.lineTotalMinor, d.currency)}</div>
            {vat[l.vatMode] ? <div className="text-[11px] text-gray-400">{vat[l.vatMode]}</div> : null}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between bg-gray-50/60 px-7 py-6">
        <span className="text-[16px] font-semibold text-gray-500">{t.total}</span>
        <span className="text-[26px] font-extrabold" style={{ color: TEAL }} dir="ltr">{formatMinor(d.totals?.grossMinor, d.currency)}</span>
      </div>
    </div>
  );
}

function SectionItems({ d, lang }) {
  if (d.customHtml != null) return <Html html={d.customHtml} lang={lang} />;
  const items = d.items || [];
  if (items.length === 0) return <Empty lang={lang} />;
  return (
    <div className="space-y-6">
      {items.map((it) => (
        <div key={it.id}>
          {it.title && <h3 className="mb-2 text-start text-[18px] font-bold text-gray-900">{it.title}</h3>}
          <Html html={it.html} lang={lang} />
        </div>
      ))}
    </div>
  );
}

export function QuoteBlock({ block, lang = 'he' }) {
  const d = block?.data || {};
  const t = tt(lang);
  const title = d.title || TITLES[lang]?.[block?.type] || '';
  switch (block?.type) {
    case 'hero':
      return <Cover d={d} lang={lang} />;
    case 'personal_intro':
      return d.text ? (
        <div className={`${RICH} whitespace-pre-line text-[20px] leading-[2.1] text-gray-700`} dangerouslySetInnerHTML={{ __html: d.text }} />
      ) : (
        <p className="text-start text-[19px] italic text-gray-300">{t.introPlaceholder}</p>
      );
    case 'tour_details':
      return <><Heading>{title}</Heading><FactCard d={d} lang={lang} /></>;
    case 'pricing':
      return <><Heading>{title}</Heading><PricingCard d={d} lang={lang} /></>;
    case 'payment_terms':
      return (
        <div className="flex flex-wrap justify-start gap-x-10 gap-y-1 text-start text-[15px]">
          {d.term && <div><span className="text-gray-400">{t.paymentTerm} · </span><span className="font-semibold text-gray-900">{d.term}</span></div>}
          {d.method && <div><span className="text-gray-400">{t.paymentMethod} · </span><span className="font-semibold text-gray-900">{d.method}</span></div>}
        </div>
      );
    case 'signature':
      return (
        <>
          <Heading>{title}</Heading>
          <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">{t.signaturePlaceholder}</div>
        </>
      );
    case 'product_marketing':
    case 'classification':
    case 'city_content':
      return <>{title && <Heading>{title}</Heading>}<Html html={d.html} lang={lang} /></>;
    case 'why_us':
    case 'faq':
    case 'cancellation':
    case 'participant_policy':
    case 'terms':
      return <><Heading>{title}</Heading><SectionItems d={d} lang={lang} /></>;
    default:
      return <Empty lang={lang} />;
  }
}

export default function QuoteDocumentRenderer({ model }) {
  const blocks = (model?.blocks || []).filter((b) => !b.hidden);
  const lang = model?.language || 'he';
  const hero = blocks.find((b) => b.type === 'hero');
  const body = blocks.filter((b) => b.type !== 'hero');
  return (
    <article dir={lang === 'en' ? 'ltr' : 'rtl'} className="overflow-hidden bg-white">
      {hero && <QuoteBlock block={hero} lang={lang} />}
      <div className="space-y-20 px-8 py-16 sm:px-16 sm:py-20">
        {body.map((b) => (<section key={b.key}><QuoteBlock block={b} lang={lang} /></section>))}
      </div>
    </article>
  );
}
