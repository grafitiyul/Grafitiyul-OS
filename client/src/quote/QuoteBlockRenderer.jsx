import { formatMinor } from '../lib/money.js';

// Quote document renderer — visual polish pass (Hebrew-first, premium).
//
// The ONE shared, presentational renderer. NO admin assumptions, NO controls.
// Hebrew is the design target for now; the bilingual scaffolding stays but English
// polish comes later. Typography over borders; generous whitespace; RTL-first.

export const TEAL = '#10a99b';

const RICH =
  'text-[16.5px] leading-[2] text-gray-700 text-right [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pr-6 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pr-6 [&_li]:mb-1.5 [&_a]:text-teal-700 [&_a]:underline [&_h2]:text-lg [&_h3]:text-[17px] [&_h3]:font-semibold [&_strong]:font-semibold';

const T = {
  he: {
    contact: 'מוזמינה', org: 'ארגון', by: 'הוכן ע"י', date: 'הופק בתאריך',
    city: 'איפה', tourDate: 'תאריך', time: 'שעה', participants: 'משתתפים', language: 'שפה', duration: 'משך',
    paymentTerm: 'תנאי תשלום', paymentMethod: 'אמצעי תשלום', total: 'סה״כ',
    vat: { included: 'כולל מע״מ', excluded: 'לפני מע״מ', exempt: 'פטור', inherit: '' },
    introPlaceholder: '— הוסיפו פתיח אישי ללקוח —',
  },
  en: {
    contact: 'Contact', org: 'Organization', by: 'By', date: 'Date',
    city: 'Location', tourDate: 'Date', time: 'Time', participants: 'Participants', language: 'Language', duration: 'Duration',
    paymentTerm: 'Payment terms', paymentMethod: 'Payment method', total: 'Total',
    vat: { included: 'incl. VAT', excluded: 'excl. VAT', exempt: 'VAT exempt', inherit: '' },
    introPlaceholder: '— add a personal introduction —',
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

function Empty() {
  return <p className="text-right text-sm italic text-gray-300">— אין תוכן —</p>;
}
function Html({ html }) {
  if (!html || !String(html).trim()) return <Empty />;
  return <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Right-aligned, RTL-first section heading.
function Heading({ children }) {
  if (!children) return null;
  return (
    <h2 className="mb-7 text-right text-[30px] font-extrabold leading-tight tracking-tight" style={{ color: TEAL }}>
      {children}
    </h2>
  );
}

// ── Hero — calm composition: big title primary, light glass metadata ─────────
function Meta({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <span className="text-xl leading-none" style={{ color: TEAL }}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-gray-400">{label}</div>
        <div className="text-[18px] font-bold leading-tight text-gray-900">{value || '—'}</div>
      </div>
    </div>
  );
}

// Hero overlay strength (from the global template). 'dark' reproduces the
// original hard-coded look; medium/light lift the top gradient so the image
// reads brighter. Only the top stop changes — bottom keeps text legibility.
const HERO_OVERLAY = {
  dark: 'linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,.05) 48%, rgba(0,0,0,.18))',
  medium: 'linear-gradient(to top, rgba(0,0,0,.42), rgba(0,0,0,.03) 48%, rgba(0,0,0,.12))',
  light: 'linear-gradient(to top, rgba(0,0,0,.25), rgba(0,0,0,0) 48%, rgba(0,0,0,.06))',
};

function Cover({ d, lang }) {
  const t = tt(lang);
  const bg = d.heroImageUrl
    ? { backgroundImage: `url(${d.heroImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `linear-gradient(135deg, ${TEAL}, #0b6f69)` };
  // Title/subtitle come from the global template; fall back to the built-in copy
  // so an unconfigured system looks exactly as before.
  const title = d.heroTitle || (lang === 'en' ? 'Proposal' : 'הצעת מחיר');
  const overlay = HERO_OVERLAY[d.heroOverlay] || HERO_OVERLAY.dark;
  return (
    <div className="relative w-full overflow-hidden" style={bg}>
      <div className="absolute inset-0" style={{ background: overlay }} />
      <div className="relative flex min-h-[560px] flex-col justify-between p-8 sm:p-12">
        {/* top: logo (leading/right) + light glass metadata (left) */}
        <div className="flex items-start justify-between gap-6">
          <div className="text-4xl font-extrabold tracking-tight text-white drop-shadow-md sm:text-[40px]">Grafitiyul</div>
          <div className="w-full max-w-[300px] rounded-2xl bg-white/90 px-6 py-3 shadow-xl ring-1 ring-white/40 backdrop-blur-md">
            <Meta icon="👤" label={t.contact} value={d.customerName} />
            <Meta icon="🏢" label={t.org} value={d.organizationName} />
            <Meta icon="📅" label={t.date} value={fmtDate(d.createdAt, lang)} />
            <Meta icon="🎨" label={t.by} value={d.by} />
          </div>
        </div>
        {/* bottom: title — the primary element */}
        <div className="text-right text-white">
          <div className="mb-5 h-1.5 w-16 rounded-full" style={{ background: TEAL }} />
          <h1 className="text-[56px] font-black leading-[1.02] drop-shadow-lg sm:text-[72px]">{title}</h1>
          {d.productName && <p className="mt-4 text-[24px] font-medium text-white/90 drop-shadow sm:text-[28px]">{d.productName}</p>}
          {d.heroSubtitle && <p className="mt-2 text-[17px] font-normal text-white/80 drop-shadow sm:text-[19px]">{d.heroSubtitle}</p>}
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
  duration: (t, d) => ['⏳', t.duration, d.durationHours ? `~${d.durationHours} שעות` : null],
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
          <div className="shrink-0 text-left">
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

function SectionItems({ d }) {
  if (d.customHtml != null) return <Html html={d.customHtml} />;
  const items = d.items || [];
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-6">
      {items.map((it) => (
        <div key={it.id}>
          {it.title && <h3 className="mb-2 text-right text-[18px] font-bold text-gray-900">{it.title}</h3>}
          <Html html={it.html} />
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
        <p className="text-right text-[19px] italic text-gray-300">{t.introPlaceholder}</p>
      );
    case 'tour_details':
      return <><Heading>{title}</Heading><FactCard d={d} lang={lang} /></>;
    case 'pricing':
      return <><Heading>{title}</Heading><PricingCard d={d} lang={lang} /></>;
    case 'payment_terms':
      return (
        <div className="flex flex-wrap justify-end gap-x-10 gap-y-1 text-right text-[15px]">
          {d.term && <div><span className="text-gray-400">{t.paymentTerm} · </span><span className="font-semibold text-gray-900">{d.term}</span></div>}
          {d.method && <div><span className="text-gray-400">{t.paymentMethod} · </span><span className="font-semibold text-gray-900">{d.method}</span></div>}
        </div>
      );
    case 'signature':
      return (
        <>
          <Heading>{title}</Heading>
          <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">אזור חתימה / אישור — ייבנה בשלב הבא</div>
        </>
      );
    case 'product_marketing':
    case 'classification':
    case 'city_content':
      return <>{title && <Heading>{title}</Heading>}<Html html={d.html} /></>;
    case 'why_us':
    case 'faq':
    case 'cancellation':
    case 'participant_policy':
    case 'terms':
      return <><Heading>{title}</Heading><SectionItems d={d} /></>;
    default:
      return <Empty />;
  }
}

export default function QuoteDocumentRenderer({ model }) {
  const blocks = (model?.blocks || []).filter((b) => !b.hidden);
  const lang = model?.language || 'he';
  const hero = blocks.find((b) => b.type === 'hero');
  const body = blocks.filter((b) => b.type !== 'hero');
  return (
    <article dir="rtl" className="overflow-hidden bg-white">
      {hero && <QuoteBlock block={hero} lang={lang} />}
      <div className="space-y-20 px-8 py-16 sm:px-16 sm:py-20">
        {body.map((b) => (<section key={b.key}><QuoteBlock block={b} lang={lang} /></section>))}
      </div>
    </article>
  );
}
