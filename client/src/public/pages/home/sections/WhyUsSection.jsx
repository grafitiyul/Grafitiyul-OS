import SectionHeading from '../../../components/SectionHeading.jsx';
import Button from '../../../components/Button.jsx';
import Container from '../../../components/Container.jsx';
import { whyUs } from '../../../content/home.js';

// "פעילות עם גרפיטיול זו הצלחה בטוחה!" — values over a dark graffiti backdrop,
// plus a white "companies that joined us" logo card (Figma "Content Cards V13").
export default function WhyUsSection() {
  return (
    <section className="relative overflow-hidden bg-ink-900 py-20 text-white lg:py-28">
      {/* Dark graffiti backdrop tint (image asset pending export). */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(48,137,255,0.18),transparent_60%)]" />

      <Container className="relative">
        <SectionHeading tone="dark" title={whyUs.title} subtitle={whyUs.subtitle} />

        {/* Value points */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {whyUs.values.map((v) => (
            <div
              key={v.id}
              className="rounded-card border border-white/10 bg-white/5 p-6 text-center backdrop-blur-sm"
            >
              <h3 className="text-title text-white">{v.title}</h3>
              <p className="mt-2 text-body text-white/75">{v.desc}</p>
            </div>
          ))}
        </div>

        {/* Companies logo card */}
        <div className="mt-14 rounded-card bg-white/90 p-8 text-center">
          <h3 className="text-h3 font-bold text-ink-900">{whyUs.companiesTitle}</h3>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            {whyUs.companies.map((c) => (
              <img
                key={c.id}
                src={c.logo}
                alt={c.name}
                loading="lazy"
                className="h-10 w-auto opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0"
              />
            ))}
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <Button variant="highlight" size="lg" href={whyUs.cta.href}>
            {whyUs.cta.label}
          </Button>
        </div>
      </Container>
    </section>
  );
}
