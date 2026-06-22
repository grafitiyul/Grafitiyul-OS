import Container from '../../../components/Container.jsx';
import Button from '../../../components/Button.jsx';
import { contactCta } from '../../../content/home.js';

// Contact call-to-action band ("...אנחנו כאן בשבילכם" + "שלחו הודעה").
export default function ContactCtaSection() {
  return (
    <section className="bg-brand-600 py-16 text-white lg:py-20">
      <Container>
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
