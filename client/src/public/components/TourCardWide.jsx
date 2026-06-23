import Button from './Button.jsx';

// Wide horizontal tour card (Figma Open Tours "Content Cards V7", template
// EL-c094fdcc). RTL: photo on the leading (right) side, text on the left —
// category tag, title, description, then price + book CTA. Presentational;
// `tour` is a plain object. Reused on /tours later.
//
// Card photo currently uses the content placeholder (hold state) — real photos
// are pending the Figma asset export (rate-limited).
export default function TourCardWide({ tour }) {
  return (
    <article className="flex overflow-hidden rounded-2xl bg-white shadow-card">
      {/* Photo — leading (right) side */}
      <div className="w-[42%] shrink-0 bg-ink-100">
        <img
          src={tour.image}
          alt={tour.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>

      {/* Content — left side */}
      <div className="flex flex-1 flex-col gap-2 p-5 text-right">
        {tour.category && (
          <span className="text-body-sm font-medium text-action-500">
            {tour.category}
          </span>
        )}
        <h3 className="text-title leading-tight text-brand-950">{tour.title}</h3>
        {tour.desc && (
          <p className="text-body-sm leading-relaxed text-ink-500">{tour.desc}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          {tour.priceFrom != null && (
            <div className="text-body-sm text-ink-500">
              החל מ־
              <span className="text-title text-action-600">₪{tour.priceFrom}</span>
            </div>
          )}
          <Button size="sm" variant="action" href={`/tours/${tour.id}`}>
            הזמנה
          </Button>
        </div>
      </div>
    </article>
  );
}
