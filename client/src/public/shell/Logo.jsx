import Anchor from '../components/Anchor.jsx';
import { site } from '../content/site.js';

// Wordmark placeholder for the brand logo. The Figma logo is a graffiti
// illustration ("Feel The Street" + גרפיטיול); the real SVG/PNG gets exported
// from Figma during the shell polish pass. Until then this typographic
// lockup keeps the navbar complete and on-brand.
export default function Logo({ className }) {
  return (
    <Anchor href="/" className={className} aria-label={site.name}>
      <span className="flex flex-col leading-none">
        <span className="font-bold text-body-lg text-white">{site.name}</span>
        <span className="text-caption tracking-widest text-highlight-400 uppercase">
          Feel The Street
        </span>
      </span>
    </Anchor>
  );
}
