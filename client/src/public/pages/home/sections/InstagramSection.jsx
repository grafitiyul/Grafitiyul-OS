import Section from '../../../components/Section.jsx';
import SectionHeading from '../../../components/SectionHeading.jsx';
import Anchor from '../../../components/Anchor.jsx';
import { instagram } from '../../../content/home.js';

// "מתוך האינסטגרם שלנו" — gallery (Figma masonry). Real graffiti photos.
// CSS-columns masonry: images keep their natural aspect ratios and flow into
// balanced columns, matching the Figma's varied-height grid.
export default function InstagramSection() {
  return (
    <Section tone="white" space="lg">
      <SectionHeading title={instagram.title} subtitle={instagram.subtitle} />
      <div className="mt-4 text-center">
        <Anchor href="#" tone="brand" className="text-body-lg font-medium">
          {instagram.handle}
        </Anchor>
      </div>
      <div className="mt-10 columns-2 gap-4 sm:columns-3 lg:columns-4 [&>*]:mb-4">
        {instagram.images.map((img) => (
          <div
            key={img.id}
            className="overflow-hidden rounded-cta bg-ink-100 break-inside-avoid"
          >
            <img
              src={img.image}
              alt=""
              loading="lazy"
              className="w-full transition duration-300 hover:scale-105"
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
