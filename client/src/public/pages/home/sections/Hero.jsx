import Container from '../../../components/Container.jsx';
import Button from '../../../components/Button.jsx';
import { hero } from '../../../content/home.js';
import heroWall from '../../../assets/home/hero-wall.png';
import heroArrow from '../../../assets/home/hero-arrow.svg';
import heroSplat from '../../../assets/home/hero-splat.png';
import heroHighlight from '../../../assets/home/hero-highlight.png';
import blotTeal from '../../../assets/home/decor/blot_teal.png';

// Hero (Figma "Heros V14" #2196:3652) — pixel-fidelity build.
//
// Exact Figma metrics:
//   headline  Fredoka Bold 72px / line-height 70.5px / letter-spacing 0.0417em / #142657
//   highlight word "הסיפורים" = white text over the real teal spray blob (#2196:3660)
//   subtitle  Fredoka Regular 18px / line-height 28px / #344054 / width 430px
//   CTA       gold pill (Golden Tainoi #FDAD22) 18/24 padding, h54, Fredoka Medium 18
// Real exported assets: wall+photo composite, hand-drawn arrow, orange splat.
//
// NOTE: the faint full-bleed graffiti background texture is reproduced as the
// cream tone + white radial fade rather than the 9.4MB raster Figma exposes
// (un-transcodable to WebP here) — see the fidelity report.
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#F6F3EC]">
      {/* White radial wash over the cream (Figma radial/linear white overlays). */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.92),rgba(255,255,255,0.45)_60%,rgba(255,255,255,0)_100%)]" />
      {/* Orange spray splat off the right edge (Figma #2196:3674). */}
      <img
        src={heroSplat}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 bottom-6 w-44 select-none lg:w-64"
      />
      {/* Teal spray splat, bottom-left (real brand asset blot_teal). */}
      <img
        src={blotTeal}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -left-10 bottom-0 w-40 select-none opacity-90 lg:w-56"
      />

      <Container className="relative">
        <div className="grid items-center gap-8 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-2 lg:py-20">
          {/* Text column — leading (right) side */}
          <div className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-end lg:text-right">
            <h1 className="font-bold text-brand-950 [font-size:clamp(2.75rem,4.6vw,4.5rem)] [letter-spacing:0.04em] [line-height:0.98]">
              <span className="block">{hero.titleBefore}</span>
              <span className="relative my-1 inline-block">
                <img
                  src={heroHighlight}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-1/2 w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
                />
                <span className="relative px-2 text-white">{hero.titleHighlight}</span>
              </span>
              <span className="block">שמאחורי</span>
              <span className="block">הקירות</span>
            </h1>

            <p className="mt-7 max-w-[430px] text-[18px] leading-[28px] text-[#344054]">
              {hero.subtitle}
            </p>

            <Button
              variant="highlight"
              href={hero.cta.href}
              shape="pill"
              className="mt-8 h-[54px] px-6 text-[18px] font-medium"
            >
              {hero.cta.label}
            </Button>
          </div>

          {/* Wall + photo composite — left side */}
          <div className="relative order-1 flex justify-center lg:order-2 lg:justify-start">
            <img
              src={heroWall}
              alt="סיור גרפיטי — אמני רחוב עם תרסיסי צבע"
              className="w-[min(86vw,620px)] drop-shadow-2xl"
            />
            {/* Hand-drawn arrow pointing from the headline toward the photo
                (Figma #2196:3670). Desktop only. */}
            <img
              src={heroArrow}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -left-4 top-[36%] hidden w-28 -scale-x-100 lg:block"
            />
          </div>
        </div>
      </Container>

      {/* Soft fade into the section below. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-ink-100" />
    </section>
  );
}
