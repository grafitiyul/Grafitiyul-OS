import { formatMinor } from '../lib/money.js';

// Quote document renderer — Phase 1 (premium, document-first; existing data).
//
// The ONE shared, presentational renderer: a composed section in → polished
// proposal markup out. NO admin assumptions, NO controls. The admin canvas wraps
// these with hover affordances; the same renderer drives the future public page +
// PDF (one source, no fork). Everything is bilingual and localized by `lang` —
// labels and values never mix languages.

export const TEAL = '#10a99b';

const RICH =
  'text-[15.5px] leading-[1.85] text-gray-700 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pr-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pr-5 [&_li]:mb-1 [&_a]:text-teal-700 [&_a]:underline [&_h2]:text-lg [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold';

// Structural micro-labels (NOT user content) — localized by quote language so the
// document is never mixed. Section *titles* (below) are separate and become
// configurable in Phase 2; defaults here for now.
const T = {
  he: {
    heroTitle: 'הצעת מחיר',
    contact: 'מוזמינה', org: 'הוכן עבור', by: 'על ידי', date: 'תאריך הפקה',
    city: 'איפה', tourDate: 'תאריך הסיור', time: 'שעה', participants: 'משתתפים', language: 'שפת הסיור', duration: 'משך הסיור',
    paymentTerm: 'תנאי תשלום', paymentMethod: 'אמצעי תשלום', meetingPoint: 'נקודת מפגש', total: 'סה״כ',
    vat: { included: 'כולל מע״מ', excluded: 'לפני מע״מ', exempt: 'פטור', inherit: '' },
  },
  en: {
    heroTitle: 'Proposal',
    contact: 'Contact', org: 'Prepared for', by: 'By', date: 'Date',
    city: 'Location', tourDate: 'Date', time: 'Time', participants: 'Participants', language: 'Language', duration: 'Duration',
    paymentTerm: 'Payment terms', paymentMethod: 'Payment method', meetingPoint: 'Meeting point', total: 'Total',
    vat: { included: 'incl. VAT', excluded: 'excl. VAT', exempt: 'VAT exempt', inherit: '' },
  },
};

// Default system section titles (Phase 2 makes these template-configurable).
const TITLES = {
  he: {
    tour_details: 'פרטים טכניים', product_marketing: 'מה כולל הסיור?', pricing: 'כמה עולה?',
    why_us: 'למה גרפיתיול?', faq: 'שאלות נפוצות', cancellation: 'מדיניות ביטול / דחייה',
    participant_policy: 'מדיניות שינוי כמות משתתפים', signature: 'חתימה',
  },
  en: {
    tour_details: 'Technical Details', product_marketing: "What's Included?", pricing: 'Pricing',
    why_us: 'Why Grafitiyul?', faq: 'FAQ', cancellation: 'Cancellation / Postponement', participant_policy: 'Participant Policy', signature: 'Signature',
  },
};

// Tour-language value, displayed in the quote language.
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
  return <p className="text-sm italic text-gray-300">— אין תוכן —</p>;
}
function Html({ html }) {
  if (!html || !String(html).trim()) return <Empty />;
  return <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} />;
}
function Heading({ children }) {
  if (!children) return null;
  return (
    <h2 className="mb-6 text-center text-[30px] font-extrabold leading-tight tracking-tight" style={{ color: TEAL }}>
      {children}
    </h2>
  );
}

// ── Hero / cover (full-bleed; the canvas renders it edge-to-edge) ─────────────
function IdentityRow({ icon, label, value, first }) {
  return (
    <div className="flex items-center justify-between gap-5 py-3.5" style={first ? {} : { borderTop: '1px solid rgba(255,255,255,.14)' }}>
      <div className="text-right">
        <div className="text-[11px] tracking-wide text-white/55">{label}</div>
        <div className="text-[15px] font-bold leading-tight text-white">{value || '—'}</div>
      </div>
      <span className="text-lg" style={{ color: TEAL }}>{icon}</span>
    </div>
  );
}

function Cover({ d, lang }) {
  const t = tt(lang);
  const bg = d.heroImageUrl
    ? { backgroundImage: `url(${d.heroImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `linear-gradient(135deg, ${TEAL}, #0b6f69)` };
  return (
    <div className="relative w-full overflow-hidden" style={bg}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.15), rgba(0,0,0,.45) 55%, rgba(0,0,0,.72))' }} />
      <div className="relative flex min-h-[300px] flex-col justify-between gap-6 px-8 py-8 sm:min-h-[420px] sm:px-12 sm:py-10 lg:flex-row-reverse lg:items-stretch">
        {/* Identity panel (leading / right) */}
        <div className="w-full max-w-[320px] self-start rounded-2xl bg-black/45 px-7 py-2 backdrop-blur-sm">
          <IdentityRow first icon="👤" label={t.contact} value={d.customerName} />
          <IdentityRow icon="🏢" label={t.org} value={d.organizationName} />
          <IdentityRow icon="🎨" label={t.by} value={d.by} />
          <IdentityRow icon="📅" label={t.date} value={fmtDate(d.createdAt, lang)} />
        </div>
        {/* Title block (left) */}
        <div className="flex flex-col justify-end text-right text-white">
          <div className="mb-5 text-2xl font-extrabold tracking-tight drop-shadow">Grafitiyul</div>
          <div className="mb-4 h-1.5 w-14 rounded" style={{ background: TEAL }} />
          <h1 className="text-[44px] font-extrabold leading-[1.05] drop-shadow sm:text-[54px]">{t.heroTitle}</h1>
          {d.productName && <p className="mt-3 text-xl text-white/85">{d.productName}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Technical Details — premium icon card ─────────────────────────────────────
function FactCard({ d, lang }) {
  const t = tt(lang);
  const facts = [
    ['📍', t.city, d.city],
    ['📅', t.tourDate, fmtDate(d.tourDate, lang)],
    ['🕒', t.time, d.tourTime],
    ['👥', t.participants, d.participants],
    ['⏳', t.duration, d.durationHours ? `~${d.durationHours}` : null],
    ['🌍', t.language, d.tourLanguage ? LANG_NAMES[lang]?.[d.tourLanguage] || d.tourLanguage : null],
  ].filter(([, , v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="flex flex-wrap divide-x divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      {facts.map(([icon, label, value]) => (
        <div key={label} className="flex min-w-[130px] flex-1 flex-col items-center gap-3 px-4 py-7 text-center">
          <div className="text-[12px] text-gray-400">{label}</div>
          <div className="text-[16px] font-bold text-gray-900">{value}</div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full text-lg" style={{ background: 'rgba(16,169,155,.10)', color: TEAL }}>{icon}</div>
        </div>
      ))}
    </div>
  );
}

const VAT_LABEL = (lang) => tt(lang).vat;

function PricingCard({ d, lang }) {
  const t = tt(lang);
  const vat = VAT_LABEL(lang);
  const lines = d.lines || [];
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start justify-between gap-4 border-b border-gray-100 px-7 py-5">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-gray-900">{l.label || '—'}</div>
            {l.quantity > 1 && <div className="mt-0.5 text-[13px] text-gray-400" dir="ltr">{l.quantity} × {formatMinor(l.unitPriceMinor, d.currency)}</div>}
            {l.note && <div className="mt-2 text-[13.5px] leading-relaxed text-gray-500">{l.note}</div>}
          </div>
          <div className="shrink-0 text-left">
            <div className="text-[16px] font-bold text-gray-900" dir="ltr">{formatMinor(l.lineTotalMinor, d.currency)}</div>
            {vat[l.vatMode] ? <div className="text-[11px] text-gray-400">{vat[l.vatMode]}</div> : null}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between px-7 py-5">
        <span className="text-[15px] font-semibold text-gray-500">{t.total}</span>
        <span className="text-[24px] font-extrabold" style={{ color: TEAL }} dir="ltr">{formatMinor(d.totals?.grossMinor, d.currency)}</span>
      </div>
    </div>
  );
}

function SectionItems({ d }) {
  if (d.customHtml != null) return <Html html={d.customHtml} />;
  const items = d.items || [];
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-5">
      {items.map((it) => (
        <div key={it.id}>
          {it.title && <h3 className="mb-1.5 text-[17px] font-bold text-gray-900">{it.title}</h3>}
          <Html html={it.html} />
        </div>
      ))}
    </div>
  );
}

// Render one composed section. Pure + presentational. `lang` localizes labels.
export function QuoteBlock({ block, lang = 'he' }) {
  const d = block?.data || {};
  const t = tt(lang);
  const title = d.title || TITLES[lang]?.[block?.type] || '';
  switch (block?.type) {
    case 'hero':
      return <Cover d={d} lang={lang} />;
    case 'personal_intro':
      return d.text ? (
        <div className={`${RICH} whitespace-pre-line text-center text-[18px] text-gray-600`} dangerouslySetInnerHTML={{ __html: d.text }} />
      ) : (
        <p className="text-center text-[17px] italic text-gray-300">— הוסיפו פתיח אישי ללקוח —</p>
      );
    case 'tour_details':
      return <><Heading>{title}</Heading><FactCard d={d} lang={lang} /></>;
    case 'pricing':
      return <><Heading>{title}</Heading><PricingCard d={d} lang={lang} /></>;
    case 'payment_terms':
      return (
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-1 text-[15px]">
          {d.term && <div><span className="text-gray-400">{t.paymentTerm} · </span><span className="font-semibold text-gray-900">{d.term}</span></div>}
          {d.method && <div><span className="text-gray-400">{t.paymentMethod} · </span><span className="font-semibold text-gray-900">{d.method}</span></div>}
        </div>
      );
    case 'signature':
      return (
        <>
          <Heading>{title}</Heading>
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">אזור חתימה / אישור — ייבנה בשלב הבא</div>
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

// Full document (visible sections in order) — for the future public page + PDF.
export default function QuoteDocumentRenderer({ model }) {
  const blocks = (model?.blocks || []).filter((b) => !b.hidden);
  const lang = model?.language || 'he';
  const hero = blocks.find((b) => b.type === 'hero');
  const body = blocks.filter((b) => b.type !== 'hero');
  return (
    <article dir="rtl" className="overflow-hidden bg-white">
      {hero && <QuoteBlock block={hero} lang={lang} />}
      <div className="space-y-14 px-8 py-12 sm:px-14">
        {body.map((b) => (
          <section key={b.key}><QuoteBlock block={b} lang={lang} /></section>
        ))}
      </div>
    </article>
  );
}
