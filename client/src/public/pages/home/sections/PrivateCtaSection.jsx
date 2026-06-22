import Section from '../../../components/Section.jsx';
import Card from '../../../components/Card.jsx';
import Button from '../../../components/Button.jsx';
import { privateCta } from '../../../content/home.js';

// "PRIVATE" call-to-action (Figma "Call To Action V17"): a white rounded card
// with an image and a big graffiti "PRIVATE" word over it, on a split
// dark/light background.
export default function PrivateCtaSection() {
  return (
    <div className="bg-gradient-to-b from-ink-900 from-[27%] to-ink-100 to-[27%]">
      <Section tone="white" space="md" className="!bg-transparent">
        <Card elevated className="overflow-hidden">
          <div className="grid items-center gap-0 md:grid-cols-2">
            {/* Image + graffiti word */}
            <div className="relative aspect-square w-full bg-ink-200">
              <img
                src={privateCta.image}
                alt={privateCta.title}
                className="h-full w-full object-cover"
              />
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-display font-bold uppercase tracking-wide text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
                aria-hidden="true"
              >
                {privateCta.word}
              </span>
            </div>
            {/* Copy + CTA */}
            <div className="flex flex-col items-end gap-4 p-8 text-end lg:p-12">
              <h2 className="text-h2 font-bold text-brand-950">{privateCta.title}</h2>
              <p className="text-body-lg text-ink-500">{privateCta.desc}</p>
              <Button variant="action" size="lg" href={privateCta.cta.href}>
                {privateCta.cta.label}
              </Button>
            </div>
          </div>
        </Card>
      </Section>
    </div>
  );
}
