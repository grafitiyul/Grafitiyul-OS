import PublicLayout from '../../shell/PublicLayout.jsx';
import Seo from '../../seo/Seo.jsx';
import Container from '../../components/Container.jsx';
import { accessibilityStatement as a } from '../../content/legal.js';

// Accessibility statement page (Hebrew-first). Rendered as a semantic legal
// document: one <h1>, <h2> per section, real lists. DRAFT — see the banner +
// content/legal.js draftReview.
export default function AccessibilityPage() {
  return (
    <PublicLayout dir="rtl">
      <Seo
        title={a.title}
        description="הצהרת הנגישות של אתר גרפיטיול — מחויבות, רמת התאמה (ת״י 5568 / WCAG 2.1 AA), התאמות שבוצעו ודרכי פנייה."
        path="/legal/accessibility"
        noindex
      />
      <Container size="narrow" className="py-14 lg:py-20">
        {/* Draft notice (not legal advice) */}
        <div
          role="note"
          className="mb-8 rounded-cta border border-highlight-300 bg-highlight-50 px-5 py-4 text-body-sm text-ink-800"
        >
          ⚠️ {a.draftBanner}
        </div>

        <h1 className="text-h2 font-bold text-brand-950 sm:text-h1">{a.title}</h1>
        <p className="mt-3 text-body-sm text-ink-600">עודכן לאחרונה: {a.updated}</p>

        <p className="mt-6 text-body-lg text-ink-700">{a.intro}</p>

        <div className="mt-10 flex flex-col gap-10">
          {a.sections.map((s) => (
            <section key={s.id} aria-labelledby={`sec-${s.id}`}>
              <h2 id={`sec-${s.id}`} className="text-h3 font-bold text-brand-950">
                {s.heading}
              </h2>
              {s.body?.map((p, i) => (
                <p key={i} className="mt-3 text-body text-ink-700">
                  {p}
                </p>
              ))}
              {s.list && (
                <ul className="mt-4 flex list-disc flex-col gap-2 pr-5 text-body text-ink-700 marker:text-brand-500">
                  {s.list.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </Container>
    </PublicLayout>
  );
}
