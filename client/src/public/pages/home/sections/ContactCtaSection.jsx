import Container from '../../../components/Container.jsx';
import Button from '../../../components/Button.jsx';
import { contactCta } from '../../../content/home.js';
import contactLeft from '../../../assets/home/decor/contact_section_left.png';
import contactRight from '../../../assets/home/decor/contact_section_right.png';

// Contact call-to-action band ("...אנחנו כאן בשבילכם" + "שלחו הודעה") with the
// real brand side decorations (contact_section_left/right).
export default function ContactCtaSection() {
  return (
    <section className="relative overflow-hidden bg-brand-600 py-16 text-white lg:py-20">
      <img
        src={contactRight}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-auto select-none opacity-80 md:block"
      />
      <img
        src={contactLeft}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 hidden h-full w-auto select-none opacity-80 md:block"
      />
      <Container className="relative">
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="max-w-3xl text-h3 font-medium">{contactCta.text}</p>
          <Button variant="highlight" size="lg" href={contactCta.cta.href}>
            {contactCta.cta.label}
          </Button>
        </div>
      </Container>
    </section>
  );
}
