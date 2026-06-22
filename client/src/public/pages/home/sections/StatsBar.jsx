import Container from '../../../components/Container.jsx';
import { stats } from '../../../content/home.js';
import statsDeco from '../../../assets/home/stats-deco.png';

// Stats strip (Figma "Wrapper" #2196:3679) — part of the hero band.
// Each card (EL-26eeb748): width 298, fill white/60% + backdrop-blur(2px),
// radius 8, padding 16px 0, gap 4. Number = Fredoka Bold 44/50 #1A6AF6 (the
// trailing "+" in cerulean-300 #8DCAFF); label = Fredoka Medium 20/34 #142657.
// A graffiti decoration sits to the leading side (#2196:3680).

function StatNumber({ value }) {
  const plus = value.endsWith('+');
  const base = plus ? value.slice(0, -1) : value;
  return (
    <span className="text-[44px] font-bold leading-[50px] text-[#1A6AF6]">
      {base}
      {plus && <span className="text-[#8DCAFF]">+</span>}
    </span>
  );
}

export default function StatsBar() {
  return (
    <section className="relative bg-ink-100 py-10 lg:py-12">
      {/* Graffiti decoration on the leading edge (desktop). */}
      <img
        src={statsDeco}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-2 hidden w-44 select-none opacity-90 xl:block"
      />
      <Container className="relative">
        <div className="mx-auto flex max-w-[1216px] flex-wrap justify-center gap-7">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex w-[calc(50%-0.875rem)] flex-col items-center gap-1 rounded-lg bg-white/60 px-2 py-4 text-center backdrop-blur-[2px] sm:w-[calc(33.333%-1.2rem)] lg:w-[298px]"
            >
              <StatNumber value={s.value} />
              <span className="text-[20px] font-medium leading-[34px] text-[#142657]">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
