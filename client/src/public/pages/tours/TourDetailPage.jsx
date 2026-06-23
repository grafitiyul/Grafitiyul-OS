import { useState } from 'react';
import PublicLayout from '../../shell/PublicLayout.jsx';
import Seo from '../../seo/Seo.jsx';
import Container from '../../components/Container.jsx';
import Section from '../../components/Section.jsx';
import Card from '../../components/Card.jsx';
import Button from '../../components/Button.jsx';
import Icon from '../../components/Icon.jsx';
import { tourDetail as t } from '../../content/tourDetail.js';
import reviewsBlot from '../../assets/home/decor/product_reviews_blot.png';

function Stars({ count }) {
  return (
    <span className="inline-flex gap-0.5 text-highlight-300" aria-label={`דירוג ${count} מתוך 5`}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L10 14.8l-5.2 2.7.99-5.78L1.58 7.62l5.82-.85L10 1.5z" />
        </svg>
      ))}
    </span>
  );
}

// Tour Detail (Figma "Tour page" + WP woocommerce/content-single-product).
// UI-only: the date picker is interactive, but "continue to tickets" is the
// booking boundary and intentionally does nothing yet (no booking/payments/DB).
export default function TourDetailPage() {
  const [selected, setSelected] = useState('');

  return (
    <PublicLayout dir="rtl">
      <Seo
        title={t.title}
        description={t.description[0]}
        path={`/tours/${t.slug}`}
        noindex
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-900 text-white">
        <img src={t.heroImage} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/50 to-ink-900/20" />
        <Container className="relative py-20 lg:py-28">
          <h1 className="text-h1 font-bold sm:text-display">{t.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-lg text-white/90">
            <span className="inline-flex items-center gap-1"><Icon name="pin" className="h-5 w-5" />{t.meta.city}</span>
            <span className="inline-flex items-center gap-1"><Icon name="clock" className="h-5 w-5" />{t.meta.duration}</span>
            <span>{t.meta.activityType}</span>
          </div>
        </Container>
      </section>

      {/* Info: description + date picker */}
      <Section tone="white" space="lg">
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          {/* Description */}
          <div className="flex flex-col gap-4 text-right">
            {t.description.map((p, i) => (
              <p key={i} className="text-body-lg leading-relaxed text-ink-700">{p}</p>
            ))}
          </div>

          {/* Date picker */}
          <Card className="h-fit p-6">
            {t.dates.length > 0 ? (
              <form onSubmit={(e) => e.preventDefault()}>
                <fieldset>
                  <legend className="mb-4 text-title font-bold text-brand-950">בחרו מועד</legend>
                  <div className="flex flex-col gap-2">
                    {t.dates.map((d) => (
                      <label
                        key={d.id}
                        className="flex cursor-pointer items-center gap-3 rounded-cta border border-ink-200 p-3 text-right has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                      >
                        <input
                          type="radio"
                          name="tour-date"
                          value={d.id}
                          checked={selected === d.id}
                          onChange={() => setSelected(d.id)}
                          className="h-4 w-4 accent-brand-600"
                        />
                        <span className="text-body text-ink-800">
                          {d.date} {d.weekday} | {d.time}
                          {d.holiday && <span className="font-bold text-action-600"> · {d.holiday}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button
                  type="submit"
                  variant="action"
                  fullWidth
                  className="mt-5"
                  disabled={!selected}
                >
                  המשך לבחירת כרטיסים
                </Button>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-body text-ink-600">טרם נקבעו תאריכים לסיור זה</p>
                <Button variant="action" href="/contact">צרו קשר</Button>
              </div>
            )}
          </Card>
        </div>
      </Section>

      {/* Gallery */}
      <Section tone="light" space="lg">
        <h2 className="text-h2 font-bold text-brand-950">{t.galleryTitle}</h2>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {t.gallery.map((src, i) => (
            <div key={i} className="overflow-hidden rounded-cta bg-ink-100">
              <img src={src} alt={`תמונה מתוך ${t.title}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            </div>
          ))}
        </div>
      </Section>

      {/* Reviews */}
      <Section tone="white" space="lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative inline-block">
            <img src={reviewsBlot} alt="" aria-hidden="true" className="pointer-events-none absolute -top-4 right-0 w-28 select-none opacity-90" />
            <h2 className="relative text-h2 font-bold text-brand-950">{t.reviewsTitle}</h2>
          </div>
          <Button variant="highlight" size="sm" href="/contact">השאירו חוות דעת</Button>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {t.reviews.map((r) => (
            <Card key={r.id} radius="xl" className="flex flex-col gap-3 p-6" aria-label={`חוות דעת מאת ${r.name}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body font-bold text-brand-950">{r.name}</p>
                  <p className="text-body-sm text-ink-500">{r.date}</p>
                </div>
                <Stars count={r.stars} />
              </div>
              <p className="text-body text-ink-700">{r.text}</p>
            </Card>
          ))}
        </div>
      </Section>
    </PublicLayout>
  );
}
