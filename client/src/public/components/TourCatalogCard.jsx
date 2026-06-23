import Icon from './Icon.jsx';
import Button from './Button.jsx';

// Rich tour card for the catalog (Figma "Our Tours" + WP tours-listing.php).
// Three regions, RTL: photo (leading/right) · text (cities, title, duration,
// excerpt) · booking (closest dates + price CTA). Presentational; `tour` is a
// plain object (mock now, GOS later). Reused on /tours.
//
// a11y: rendered as <article> with an accessible label; the price/info button
// is the single meaningful link; all icons are decorative (aria-hidden).
export default function TourCatalogCard({ tour }) {
  const dur =
    tour.durationMin && tour.durationMax && tour.durationMin !== tour.durationMax
      ? `${tour.durationMin}–${tour.durationMax} דק׳`
      : `${tour.durationMin || tour.durationMax} דק׳`;

  return (
    <article
      aria-label={tour.title}
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-card lg:flex-row"
    >
      {/* Photo — leading side */}
      <div className="bg-ink-100 lg:w-[34%] lg:shrink-0">
        <img
          src={tour.image}
          alt={tour.title}
          loading="lazy"
          className="h-48 w-full object-cover lg:h-full"
        />
      </div>

      {/* Text */}
      <div className="flex flex-1 flex-col gap-2 p-5 text-right">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {tour.cities.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 text-body-sm font-bold text-highlight-600">
              <Icon name="pin" className="h-4 w-4" />
              {c}
            </span>
          ))}
        </div>
        <h3 className="text-title text-brand-950">{tour.title}</h3>
        <div className="inline-flex items-center gap-1 text-body-sm text-ink-600">
          <Icon name="clock" className="h-4 w-4" />
          <span>{dur}</span>
          <span className="px-1 text-ink-300" aria-hidden="true">·</span>
          <span>{tour.activityType}</span>
        </div>
        <p className="hidden text-body-sm text-ink-600 sm:block">{tour.excerpt}</p>
      </div>

      {/* Booking */}
      <div className="flex flex-col justify-between gap-4 border-t border-ink-100 p-5 lg:w-[26%] lg:border-r lg:border-t-0">
        {tour.closestDates.length > 0 ? (
          <div className="flex flex-col gap-1.5 text-right">
            <span className="inline-flex items-center gap-1 text-body-sm font-bold text-brand-950">
              <Icon name="calendar" className="h-4 w-4" />
              המועדים הקרובים:
            </span>
            <ul className="flex flex-col gap-0.5 text-body-sm text-ink-600">
              {tour.closestDates.map((d) => (
                <li key={`${d.date}-${d.time}`}>
                  {d.date} | {d.time}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-body-sm text-ink-500">אין מועדים פתוחים כרגע — דברו איתנו לתיאום.</p>
        )}

        <div className="flex justify-end">
          {tour.priceFrom ? (
            <Button size="sm" variant="action" href={`/tours/${tour.slug}`}>
              החל מ-₪{tour.priceFrom} לכרטיס
            </Button>
          ) : (
            <Button size="sm" variant="outline" href={`/tours/${tour.slug}`} className="text-brand-700">
              מידע נוסף
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
