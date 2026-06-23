import SectionHeading from '../../../components/SectionHeading.jsx';
import Button from '../../../components/Button.jsx';
import Container from '../../../components/Container.jsx';
import { whyUs } from '../../../content/home.js';
import clientsBlot from '../../../assets/home/decor/clients_title_blot.png';

// "פעילות עם גרפיטיול זו הצלחה בטוחה!" — values over a dark graffiti backdrop,
// plus a white "companies that joined us" logo card (Figma "Content Cards V13").
// 8 value items as icon + paragraph in a 2×4 grid.
//
// HOLD STATE (backlog): brick-wall texture, the 8 line-icons, scribble
// decorations, and the ~24 real company logos are pending Figma asset export.
export default function WhyUsSection() {
  return (
    <section className="relative overflow-hidden bg-ink-900 py-20 text-white lg:py-28">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(48,137,255,0.16),transparent_60%)]" />

      <Container className="relative">
        <SectionHeading tone="dark" title={whyUs.title} subtitle={whyUs.subtitle} />

        {/* 8 value items — icon (hold) + paragraph */}
        <div className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {whyUs.values.map((v) => (
            <div key={v.id} className="flex flex-col items-center gap-3 text-center">
              {/* Icon hold state — real Figma line-icon pending export */}
              <span
                className="grid h-12 w-12 place-items-center rounded-full border border-brand-400/40 text-brand-300"
                aria-hidden="true"
              >
                <span className="h-3 w-3 rounded-sm bg-brand-400" />
              </span>
              <p className="text-body text-white/80">{v.text}</p>
            </div>
          ))}
        </div>

        {/* Companies logo card */}
        <div className="mt-16 rounded-card bg-white/95 p-8 text-center lg:p-10">
          <div className="relative inline-block">
            <img
              src={clientsBlot}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -top-6 left-1/2 w-44 -translate-x-1/2 select-none opacity-90"
            />
            <h3 className="relative text-h3 font-bold text-ink-900">{whyUs.companiesTitle}</h3>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {whyUs.companies.map((c) => (
              <img
                key={c.id}
                src={c.logo}
                alt={c.name}
                loading="lazy"
                className="h-9 w-auto opacity-70"
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
