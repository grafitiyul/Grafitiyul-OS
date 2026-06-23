import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Button from '../../../components/Button.jsx';
import { events } from '../../../content/home.js';

// "מארגנים אירוע?" — event/private solutions (Figma "Content Cards V7"
// #2091:291). Wide horizontal cards stacked. Photos on hold (backlog).
export default function EventsSection() {
  return (
    <Section tone="light" space="lg">
      <SectionHeading title={events.title} subtitle={events.subtitle} />
      <div className="mx-auto mt-12 flex max-w-[1000px] flex-col gap-6">
        {events.cards.map((card) => (
          <article
            key={card.id}
            className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-card sm:flex-row"
          >
            <div className="bg-ink-100 sm:w-[40%] sm:shrink-0">
              <img
                src={card.image}
                alt={card.title}
                loading="lazy"
                className="h-48 w-full object-cover sm:h-full"
              />
            </div>
            <div className="flex flex-1 flex-col justify-center gap-2 p-6 text-right">
              <h3 className="text-title text-brand-950">{card.title}</h3>
              <p className="text-body text-ink-500">{card.desc}</p>
              <div className="mt-2">
                <Button size="sm" variant="action" href="/contact">
                  לפרטים
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
