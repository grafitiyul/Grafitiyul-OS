import { formatMinor } from '../lib/money.js';

// Quote document renderer — v2 (document-first, Prospero-grade polish).
//
// The ONE shared, presentational renderer: a composed section in → polished
// proposal markup out. NO admin assumptions, NO controls. The admin canvas wraps
// these with hover affordances; the same renderer is intended to drive the future
// public page + PDF (one source, no fork).

// Brand teal, inferred from the Prospero proposals (section-heading green-teal).
export const TEAL = '#10a99b';

const RICH =
  'text-[15.5px] leading-[1.85] text-gray-700 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pr-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pr-5 [&_li]:mb-1 [&_a]:text-teal-700 [&_a]:underline [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold';

// Default section titles (teal headings). data.title (a quote override) wins.
const TITLES = {
  tour_details: 'פרטי הסיור',
  product_marketing: 'מה כולל הסיור?',
  pricing: 'כמה עולה?',
  payment_terms: '',
  why_us: 'למה גרפיתיול?',
  classification: '',
  city_content: '',
  faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול / דחייה',
  participant_policy: 'מדיניות שינוי כמות משתתפים',
  signature: 'חתימה',
};

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
    <h2 className="mb-4 text-[26px] font-extrabold leading-tight tracking-tight" style={{ color: TEAL }}>
      {children}
    </h2>
  );
}

function Cover({ d }) {
  const hero = d.heroImageUrl;
  const bg = hero
    ? { backgroundImage: `url(${hero})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `linear-gradient(135deg, ${TEAL}, #0b6f69)` };
  return (
    <div className="relative flex min-h-[300px] items-end overflow-hidden rounded-2xl" style={bg}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,.25) 55%, rgba(0,0,0,.1))' }} />
      <div className="absolute top-5 left-6 text-lg font-extrabold tracking-tight text-white/90">Grafitiyul</div>
      <div className="relative w-full p-8 text-white">
        <div className="text-[34px] font-extrabold leading-[1.1] drop-shadow-sm">{d.productName || '—'}</div>
        {(d.customerName || d.organizationName) && (
          <div className="mt-4 text-[15px] text-white/90">
            הוכן עבור · {[d.customerName, d.organizationName].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="mt-1 text-[13px] text-white/75">{[d.by && `על ידי ${d.by}`, d.tourDate].filter(Boolean).join('   ·   ')}</div>
      </div>
    </div>
  );
}

function Facts({ d }) {
  const rows = [
    ['איפה', d.city],
    ['תאריך', d.tourDate],
    ['שעה', d.tourTime],
    ['משתתפים', d.participants],
    ['משך', d.durationHours ? `~${d.durationHours} שעות` : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k} className="text-[16px]">
            <span className="text-gray-400">{k} </span>
            <span className="font-semibold text-gray-900">{v}</span>
          </div>
        ))}
      </div>
      {d.meetingPoint && (
        <div className="mt-5">
          <div className="mb-1 text-[12px] uppercase tracking-wide text-gray-400">נקודת מפגש</div>
          <Html html={d.meetingPoint} />
        </div>
      )}
    </>
  );
}

const VAT_LABEL = { included: 'כולל מע״מ', excluded: 'לפני מע״מ', exempt: 'פטור', inherit: '' };

function PricingCard({ d }) {
  const lines = d.lines || [];
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {lines.length === 0 && <div className="px-6 py-6 text-center text-gray-400">אין שורות תמחור</div>}
      {lines.map((l, i) => (
        <div key={i} className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-gray-900">{l.label || '—'}</div>
            {l.quantity > 1 && (
              <div className="mt-0.5 text-[13px] text-gray-400" dir="ltr">
                {l.quantity} × {formatMinor(l.unitPriceMinor, d.currency)}
              </div>
            )}
            {l.note && (
              <div className="mt-2 text-[13.5px] leading-relaxed text-gray-500">{l.note}</div>
            )}
          </div>
          <div className="shrink-0 text-left">
            <div className="text-[16px] font-bold text-gray-900" dir="ltr">{formatMinor(l.lineTotalMinor, d.currency)}</div>
            {VAT_LABEL[l.vatMode] ? <div className="text-[11px] text-gray-400">{VAT_LABEL[l.vatMode]}</div> : null}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-[15px] font-semibold text-gray-500">
          סה״כ{d.excludedInactive > 0 ? ` · (${d.excludedInactive} שורות לא נכללות)` : ''}
        </span>
        <span className="text-[22px] font-extrabold" style={{ color: TEAL }} dir="ltr">
          {formatMinor(d.totals?.grossMinor, d.currency)}
        </span>
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

// Render one composed section. Pure + presentational.
export function QuoteBlock({ block }) {
  const d = block?.data || {};
  const title = d.title || TITLES[block?.type] || '';
  switch (block?.type) {
    case 'hero':
      return <Cover d={d} />;
    case 'personal_intro':
      return d.text ? (
        <div className={`${RICH} whitespace-pre-line text-[17px] text-gray-700`} dangerouslySetInnerHTML={{ __html: d.text }} />
      ) : (
        <p className="text-[17px] italic text-gray-300">— הוסיפו פתיח אישי ללקוח —</p>
      );
    case 'tour_details':
      return <><Heading>{title}</Heading><Facts d={d} /></>;
    case 'pricing':
      return <><Heading>{title}</Heading><PricingCard d={d} /></>;
    case 'payment_terms':
      return (
        <div className="flex flex-wrap gap-x-10 gap-y-1 text-[15px]">
          {d.term && <div><span className="text-gray-400">תנאי תשלום · </span><span className="font-semibold text-gray-900">{d.term}</span></div>}
          {d.method && <div><span className="text-gray-400">אמצעי תשלום · </span><span className="font-semibold text-gray-900">{d.method}</span></div>}
        </div>
      );
    case 'signature':
      return (
        <>
          <Heading>{title}</Heading>
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            אזור חתימה / אישור — ייבנה בשלב הבא
          </div>
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
  return (
    <article dir="rtl" className="mx-auto max-w-2xl space-y-12 bg-white px-10 py-12">
      {blocks.map((b) => (
        <section key={b.key}>
          <QuoteBlock block={b} />
        </section>
      ))}
    </article>
  );
}
