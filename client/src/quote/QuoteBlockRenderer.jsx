import { formatMinor } from '../lib/money.js';

// Quote document renderer — Slice 3.
//
// This is the ONE shared, presentational block renderer. It takes a composed
// block (from the composer preview/render model) and draws it. It makes NO
// admin assumptions and holds NO admin controls — the admin canvas wraps these
// blocks with its own controls. The same renderer is intended to later power the
// public quote page and the PDF export (one renderer source, no fork).

const RICH = 'text-[15px] leading-relaxed text-gray-800 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base [&_*]:font-[inherit]';

function Empty() {
  return <p className="text-sm italic text-gray-400">— אין תוכן —</p>;
}

function Html({ html }) {
  if (!html || !String(html).trim()) return <Empty />;
  return <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Field({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="text-[15px] text-gray-900">{children}</dd>
    </div>
  );
}

const VAT_LABEL = { included: 'כולל מע״מ', excluded: 'לפני מע״מ', exempt: 'פטור', inherit: 'לפי ההצעה' };

function PricingTable({ d }) {
  const lines = d.lines || [];
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full text-sm" dir="rtl">
        <thead className="bg-gray-50 text-[12px] text-gray-500">
          <tr>
            <th className="px-3 py-2 text-right font-medium">פריט</th>
            <th className="px-3 py-2 text-center font-medium">כמות</th>
            <th className="px-3 py-2 text-left font-medium">מחיר יחידה</th>
            <th className="px-3 py-2 text-left font-medium">סה״כ</th>
            <th className="px-3 py-2 text-center font-medium">מע״מ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">אין שורות תמחור</td></tr>
          )}
          {lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="px-3 py-2">
                <div className="text-gray-900">{l.label || '—'}</div>
                {l.note && (
                  <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[12px] text-amber-800 ring-1 ring-amber-100">
                    {l.note}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-center text-gray-700">{l.quantity}</td>
              <td className="px-3 py-2 text-left text-gray-700" dir="ltr">{formatMinor(l.unitPriceMinor)}</td>
              <td className="px-3 py-2 text-left text-gray-900" dir="ltr">{formatMinor(l.lineTotalMinor)}</td>
              <td className="px-3 py-2 text-center text-[12px] text-gray-500">{VAT_LABEL[l.vatMode] || l.vatMode}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50">
          <tr>
            <td colSpan={3} className="px-3 py-2 text-right text-[12px] text-gray-500">
              {d.excludedInactive > 0 ? `(${d.excludedInactive} שורות לא פעילות אינן נכללות)` : ''}
            </td>
            <td className="px-3 py-2 text-left font-bold text-gray-900" dir="ltr">
              {formatMinor(d.totals?.grossMinor, d.currency)}
            </td>
            <td className="px-3 py-2 text-center text-[12px] text-gray-500">סה״כ</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SectionItems({ d }) {
  if (d.customHtml != null) return <Html html={d.customHtml} />;
  const items = d.items || [];
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-4">
      {items.map((it) => (
        <div key={it.id}>
          {it.title && <h4 className="mb-1 text-[15px] font-semibold text-gray-900">{it.title}</h4>}
          <Html html={it.html} />
        </div>
      ))}
    </div>
  );
}

// Render one composed block. Pure + presentational.
export function QuoteBlock({ block }) {
  const d = block?.data || {};
  switch (block?.type) {
    case 'hero':
      return (
        <header className="border-b border-gray-100 pb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{d.productName || '—'}</h1>
          {d.organizationName && <p className="mt-1 text-gray-600">{d.organizationName}</p>}
          {d.tourDate && <p className="mt-1 text-sm text-gray-500">{d.tourDate}</p>}
        </header>
      );
    case 'personal_intro':
      return d.text ? (
        <div className={`${RICH} whitespace-pre-line`} dangerouslySetInnerHTML={{ __html: d.text }} />
      ) : (
        <Empty />
      );
    case 'tour_details':
      return (
        <div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Field label="מוצר">{d.productName}</Field>
            <Field label="עיר">{d.city}</Field>
            <Field label="תאריך">{d.tourDate}</Field>
            <Field label="שעה">{d.tourTime}</Field>
            <Field label="משתתפים">{d.participants}</Field>
            <Field label="משך (שעות)">{d.durationHours}</Field>
          </dl>
          {d.meetingPoint && (
            <div className="mt-4">
              <div className="text-[11px] text-gray-400">נקודת מפגש</div>
              <Html html={d.meetingPoint} />
            </div>
          )}
        </div>
      );
    case 'pricing':
      return <PricingTable d={d} />;
    case 'payment_terms':
      return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Field label="תנאי תשלום">{d.term}</Field>
          <Field label="אמצעי תשלום">{d.method}</Field>
        </dl>
      );
    case 'signature':
      return (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          אזור חתימה / אישור — ייבנה בשלב מאוחר יותר
        </div>
      );
    // Content blocks: single HTML body or a list of sections.
    case 'product_marketing':
    case 'classification':
    case 'city_content':
      return (
        <div>
          {d.title && <h3 className="mb-2 text-lg font-semibold text-gray-900">{d.title}</h3>}
          <Html html={d.html} />
        </div>
      );
    case 'why_us':
    case 'faq':
    case 'cancellation':
    case 'participant_policy':
    case 'terms':
      return (
        <div>
          {d.title && <h3 className="mb-2 text-lg font-semibold text-gray-900">{d.title}</h3>}
          <SectionItems d={d} />
        </div>
      );
    default:
      return <Empty />;
  }
}

// Render the full document (visible blocks in order). For the future public page
// + PDF. The admin canvas does its own per-block wrapping instead.
export default function QuoteDocumentRenderer({ model }) {
  const blocks = (model?.blocks || []).filter((b) => !b.hidden);
  return (
    <article dir="rtl" className="mx-auto max-w-2xl space-y-8 bg-white">
      {blocks.map((b) => (
        <section key={b.key}>
          <QuoteBlock block={b} />
        </section>
      ))}
    </article>
  );
}
