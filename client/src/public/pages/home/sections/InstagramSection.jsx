import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Anchor from '../../../components/Anchor.jsx';
import { instagram } from '../../../content/home.js';

// "מתוך האינסטגרם שלנו" — Instagram gallery grid.
export default function InstagramSection() {
  return (
    <Section tone="white" space="lg">
      <SectionHeading title={instagram.title} subtitle={instagram.subtitle} />
      <div className="mt-4 text-center">
        <Anchor href="#" tone="brand" className="text-body-lg font-medium">
          {instagram.handle}
        </Anchor>
      </div>
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {instagram.images.map((img) => (
          <div key={img.id} className="aspect-square overflow-hidden rounded-cta bg-ink-100">
            <img
              src={img.image}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition hover:scale-105"
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
