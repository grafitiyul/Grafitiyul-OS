import Container from '../../../components/Container.jsx';
import Button from '../../../components/Button.jsx';
import { hero } from '../../../content/home.js';

// Hero (Figma "Heros V14"): graffiti background that fades into the off-white
// page, headline + subtitle + two CTAs on the leading (right, RTL) side.
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink-100">
      {/* Background image + white fade overlays (mimics the Figma gradients). */}
      <div className="absolute inset-0">
        <img
          src={hero.image}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-white/40 to-ink-100" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.85),rgba(255,255,255,0.5))]" />
      </div>

      <Container className="relative">
        <div className="flex min-h-[560px] flex-col items-end justify-center gap-6 py-20 text-end lg:min-h-[680px]">
          <span className="text-body font-medium uppercase tracking-widest text-action-500">
            {hero.eyebrow}
          </span>
          <h1 className="whitespace-pre-line text-h1 font-bold text-brand-950 sm:text-display">
            {hero.title}
          </h1>
          <p className="max-w-xl text-body-lg text-ink-600">{hero.subtitle}</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="highlight" size="lg" href={hero.primaryCta.href}>
              {hero.primaryCta.label}
            </Button>
            <Button variant="outline" size="lg" href={hero.secondaryCta.href} className="text-brand-700">
              {hero.secondaryCta.label}
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
