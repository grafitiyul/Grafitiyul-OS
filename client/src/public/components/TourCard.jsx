import Card from './Card.jsx';
import Badge from './Badge.jsx';
import Button from './Button.jsx';

// Tour/workshop card for the catalog + homepage "open tours" row. Image on top,
// title, meta (city · duration), price "from", and a book CTA. Presentational —
// `tour` is a plain object (mock today, GOS data later). Reused on /tours.
export default function TourCard({ tour }) {
  return (
    <Card radius="xl" className="flex flex-col overflow-hidden">
      <div className="aspect-[16/10] w-full overflow-hidden bg-ink-100">
        {tour.image && (
          <img
            src={tour.image}
            alt={tour.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-title text-brand-950">{tour.title}</h3>
          {tour.tag && <Badge tone="highlight">{tour.tag}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-body-sm text-ink-500">
          {tour.city && <span>{tour.city}</span>}
          {tour.city && tour.duration && <span aria-hidden>·</span>}
          {tour.duration && <span>{tour.duration}</span>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          {tour.priceFrom != null && (
            <div className="text-body-sm text-ink-500">
              החל מ־<span className="text-title text-action-600">₪{tour.priceFrom}</span>
            </div>
          )}
          <Button size="sm" variant="action" href={`/tours/${tour.id}`}>
            הזמנה
          </Button>
        </div>
      </div>
    </Card>
  );
}
