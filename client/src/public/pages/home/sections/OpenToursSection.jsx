import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import TourCardWide from '../../../components/TourCardWide.jsx';
import Button from '../../../components/Button.jsx';
import { openTours } from '../../../content/home.js';

// "תצטרפו לסיורים הפתוחים שלנו" — open tours (Figma "Content Cards V7"
// #2384:4011). Wide horizontal cards in a 2-column grid, centered heading,
// blue pill CTA. Section splat decoration pending asset export (backlog).
export default function OpenToursSection() {
  return (
    <Section tone="white" space="lg">
      <SectionHeading title={openTours.title} subtitle={openTours.subtitle} />
      <div className="mt-12 grid gap-x-6 gap-y-6 lg:grid-cols-2">
        {openTours.cards.map((tour) => (
          <TourCardWide key={tour.id} tour={tour} />
        ))}
      </div>
      <div className="mt-10 flex justify-center">
        <Button variant="brand" size="lg" href={openTours.cta.href}>
          {openTours.cta.label}
        </Button>
      </div>
    </Section>
  );
}
