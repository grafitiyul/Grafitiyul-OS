import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import TourCard from '../../../components/TourCard.jsx';
import Button from '../../../components/Button.jsx';
import { openTours } from '../../../content/home.js';

// "תצטרפו לסיורים הפתוחים שלנו" — open tours (Figma "Content Cards V7").
export default function OpenToursSection() {
  return (
    <Section tone="white" space="lg">
      <SectionHeading title={openTours.title} subtitle={openTours.subtitle} />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {openTours.cards.map((tour) => (
          <TourCard key={tour.id} tour={tour} />
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
