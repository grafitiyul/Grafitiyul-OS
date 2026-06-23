import Section from '../../../components/Section.jsx';
import Card from '../../../components/Card.jsx';
import Button from '../../../components/Button.jsx';
import { privateCta } from '../../../content/home.js';

// Check glyph for the checklist (teal, matching the Figma).
function Check() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-accent-500" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.12" />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "רוצים סיור פרטי?" (Figma "Call To Action V17"): white rounded card with a
// photo + the "PRIVATE" graffiti word on the left, heading + checklist + outline
// CTA on the right, over a split dark/light background.
//
// HOLD STATE (backlog): the real private-tour photo + the "PRIVATE" graffiti
// lettering (custom "Graffiti City" font → image only) are pending export.
export default function PrivateCtaSection() {
  return (
    <div className="bg-gradient-to-b from-ink-900 from-[27%] to-ink-100 to-[27%]">
      <Section tone="white" space="md" className="!bg-transparent">
        <Card elevated className="overflow-hidden">
          <div className="grid items-stretch gap-0 md:grid-cols-2">
            {/* Image + graffiti word (leading/right side) */}
            <div className="relative order-1 min-h-[280px] bg-ink-800">
              <img
                src={privateCta.image}
                alt={privateCta.title}
                className="h-full w-full object-cover"
              />
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center font-spray text-[64px] uppercase tracking-wide text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
                aria-hidden="true"
              >
                {privateCta.word}
              </span>
            </div>

            {/* Copy + checklist + CTA (left side) */}
            <div className="order-2 flex flex-col items-end gap-5 p-8 text-end lg:p-12">
              <h2 className="text-h2 font-bold text-brand-950">{privateCta.title}</h2>
              <p className="text-body-lg text-ink-500">{privateCta.desc}</p>
              <ul className="flex flex-col gap-3 self-stretch">
                {privateCta.checklist.map((item) => (
                  <li key={item} className="flex flex-row-reverse items-center justify-start gap-2 text-body text-ink-700">
                    <Check />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="lg" href={privateCta.cta.href} className="mt-2 text-brand-700">
                {privateCta.cta.label}
              </Button>
            </div>
          </div>
        </Card>
      </Section>
    </div>
  );
}
