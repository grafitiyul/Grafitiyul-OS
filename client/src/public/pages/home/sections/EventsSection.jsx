import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Card from '../../../components/Card.jsx';
import { events } from '../../../content/home.js';

// "מארגנים אירוע?" — event/private solutions (Figma "Content Cards V7").
export default function EventsSection() {
  return (
    <Section tone="light" space="lg">
      <SectionHeading title={events.title} subtitle={events.subtitle} />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.cards.map((card) => (
          <Card key={card.id} radius="xl" className="flex flex-col overflow-hidden">
            <div className="aspect-[16/10] w-full bg-ink-100">
              <img
                src={card.image}
                alt={card.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col gap-2 p-6">
              <h3 className="text-title text-brand-950">{card.title}</h3>
              <p className="text-body text-ink-500">{card.desc}</p>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
