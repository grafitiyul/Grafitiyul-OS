import PublicLayout from '../../shell/PublicLayout.jsx';
import Seo from '../../seo/Seo.jsx';
import Hero from './sections/Hero.jsx';
import StatsBar from './sections/StatsBar.jsx';
import OpenToursSection from './sections/OpenToursSection.jsx';
import EventsSection from './sections/EventsSection.jsx';
import WhyUsSection from './sections/WhyUsSection.jsx';
import PrivateCtaSection from './sections/PrivateCtaSection.jsx';
import TestimonialsSection from './sections/TestimonialsSection.jsx';
import InstagramSection from './sections/InstagramSection.jsx';
import PressSection from './sections/PressSection.jsx';
import ContactCtaSection from './sections/ContactCtaSection.jsx';
import FaqSection from './sections/FaqSection.jsx';

// The real public Homepage, built from the Figma desktop frame (#2091:195) and
// rendered responsively for mobile (the Figma mobile frame #2270:7031 is the
// same sections stacked single-column). Sections are composed top-to-bottom in
// Figma order. Content comes from content/home.js (mock today, GOS/WP later).
export default function HomePage() {
  return (
    <PublicLayout dir="rtl">
      <Seo
        title="סיורי וסדנאות גרפיטי"
        description="סיורי גרפיטי וסדנאות אורבניות בלב הסצנה. בחרו סיור, חפשו מועד והזמינו כרטיסים עם גרפיטיול."
        path="/"
        noindex
      />
      <Hero />
      <StatsBar />
      <OpenToursSection />
      <EventsSection />
      <WhyUsSection />
      <PrivateCtaSection />
      <TestimonialsSection />
      <InstagramSection />
      <PressSection />
      <ContactCtaSection />
      <FaqSection />
    </PublicLayout>
  );
}
