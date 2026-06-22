import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Accordion from '../../../components/Accordion.jsx';
import Button from '../../../components/Button.jsx';
import { faq } from '../../../content/home.js';

// "שאלות נפוצות במיוחד" — FAQ accordion (Figma "Accordion V2").
export default function FaqSection() {
  return (
    <Section tone="white" space="lg" containerSize="narrow">
      <SectionHeading title={faq.title} subtitle={faq.subtitle} />
      <div className="mt-10">
        <Accordion items={faq.items} />
      </div>
      <div className="mt-8 flex justify-center">
        <Button variant="brand" size="md" href={faq.cta.href}>
          {faq.cta.label}
        </Button>
      </div>
    </Section>
  );
}
