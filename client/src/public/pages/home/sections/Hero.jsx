import Container from '../../../components/Container.jsx';
import Button from '../../../components/Button.jsx';
import { hero } from '../../../content/home.js';
import heroWall from '../../../assets/home/hero-wall.png';
import heroArrow from '../../../assets/home/hero-arrow.svg';
import heroSplat from '../../../assets/home/hero-splat.png';

// Hero (Figma "Heros V14" #2196:3652) — faithful build.
// RTL composition: headline + subtitle + single gold CTA on the leading (right)
// side; the torn-brick-wall photo composite on the left; a hand-drawn arrow
// between them and an orange spray-splat off the right edge. Real Figma assets.
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#F6F3EC]">
      {/* Orange spray splat off the right edge (Figma #2196:3674). */}
      <img
        src={heroSplat}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 bottom-8 w-48 select-none opacity-90 lg:w-72"
      />

      <Container className="relative">
        <div className="grid items-center gap-8 py-12 lg:grid-cols-2 lg:gap-4 lg:py-16">
          {/* Text column — leading (right) side */}
          <div className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-end lg:text-right">
            <h1 className="font-bold text-brand-950 [font-size:clamp(2.5rem,5vw,4.5rem)] [line-height:1.02] [letter-spacing:0.02em]">
              {hero.titleBefore}{' '}
              <mark className="mx-1 -rotate-1 rounded-[0.32em] bg-breakerBay-500/85 px-2 text-white [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
                {hero.titleHighlight}
              </mark>{' '}
              {hero.titleAfter}
            </h1>
            <p className="mt-6 max-w-[440px] text-body-lg text-[#344054]">
              {hero.subtitle}
            </p>
            <Button variant="highlight" size="lg" href={hero.cta.href} className="mt-8">
              {hero.cta.label}
            </Button>
          </div>

          {/* Wall + photo composite — left side */}
          <div className="relative order-1 flex justify-center lg:order-2">
            <img
              src={heroWall}
              alt="סיור גרפיטי — אמני רחוב עם תרסיסי צבע"
              className="w-[min(86vw,560px)] drop-shadow-2xl lg:w-[600px]"
            />
            {/* Hand-drawn arrow pointing from the headline toward the photo
                (Figma #2196:3670). Desktop only — it sits between the columns. */}
            <img
              src={heroArrow}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -left-2 top-1/3 hidden w-28 -scale-x-100 lg:block"
            />
          </div>
        </div>
      </Container>

      {/* Soft fade into the page below (Figma bottom gradient). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-100" />
    </section>
  );
}
