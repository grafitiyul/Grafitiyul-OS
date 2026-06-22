import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Button from '../../../components/Button.jsx';
import { press } from '../../../content/home.js';

// "מדברים עלינו בתקשורת" — press/media logos (Figma "Testimonials V13").
export default function PressSection() {
  return (
    <Section tone="light" space="lg">
      <SectionHeading title={press.title} subtitle={press.subtitle} />
      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {press.logos.map((p) => (
          <img
            key={p.id}
            src={p.logo}
            alt={p.name}
            loading="lazy"
            className="h-9 w-auto opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0"
          />
        ))}
      </div>
      <div className="mt-10 flex justify-center">
        <Button variant="brand" size="md" href={press.cta.href}>
          {press.cta.label}
        </Button>
      </div>
    </Section>
  );
}
