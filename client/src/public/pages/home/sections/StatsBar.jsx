import Section from '../../../components/Section.jsx';
import { stats } from '../../../content/home.js';

// Stats strip (Figma hero "Wrapper" row): six big numbers in cerulean with a
// label beneath. Wraps responsively (3-up on tablet, 6-up on desktop).
export default function StatsBar() {
  return (
    <Section tone="light" space="sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col items-center text-center">
            <span className="text-h2 font-bold text-brand-600 sm:text-h1">{s.value}</span>
            <span className="mt-1 text-body text-brand-950">{s.label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
