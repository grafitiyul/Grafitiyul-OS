import SectionHeading from '../../../components/SectionHeading.jsx';
import Accordion from '../../../components/Accordion.jsx';
import Button from '../../../components/Button.jsx';
import Container from '../../../components/Container.jsx';
import { faq } from '../../../content/home.js';

// "שאלות נפוצות במיוחד" — FAQ accordion (Figma "Accordion V2"), on a dark
// graffiti wall. HOLD STATE (backlog): the brick-wall texture + the "NO RULES"
// graffiti mural + character illustration are pending Figma asset export.
export default function FaqSection() {
  return (
    <section className="relative overflow-hidden bg-ink-900 py-20 text-white lg:py-28">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(48,137,255,0.14),transparent_55%)]" />
      <Container size="narrow" className="relative">
        <SectionHeading tone="dark" title={faq.title} subtitle={faq.subtitle} />
        <div className="mt-10">
          <Accordion items={faq.items} />
        </div>
        <div className="mt-8 flex justify-center">
          <Button variant="highlight" size="md" href={faq.cta.href}>
            {faq.cta.label}
          </Button>
        </div>
      </Container>
    </section>
  );
}
