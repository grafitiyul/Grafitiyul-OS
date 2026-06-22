import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Card from '../../../components/Card.jsx';
import { testimonials } from '../../../content/home.js';

function Stars({ count = 5 }) {
  return (
    <div className="flex gap-0.5 text-highlight-400" aria-label={`דירוג ${count} מתוך 5`}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L10 14.8l-5.2 2.7.99-5.78L1.58 7.62l5.82-.85L10 1.5z" />
        </svg>
      ))}
    </div>
  );
}

// "אם הלקוחות שלנו שמחים, עשינו את שלנו:" — reviews (Figma "Testimonials V11").
export default function TestimonialsSection() {
  return (
    <Section tone="light" space="lg">
      <SectionHeading title={testimonials.title} />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {testimonials.items.map((t) => (
          <Card key={t.id} radius="xl" className="flex flex-col gap-3 p-6">
            <Stars count={t.rating} />
            <p className="flex-1 text-body text-ink-700">{t.text}</p>
            <div className="text-body font-medium text-brand-950">{t.name}</div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
