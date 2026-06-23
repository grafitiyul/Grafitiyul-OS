import Anchor from '../components/Anchor.jsx';
import { site } from '../content/site.js';
import logo from '../assets/home/photos/logo.png';

// Brand logo — the real Grafitiyul mark harvested from the site
// ("Feel The Street / Grafitiyul" teal graffiti roundel).
export default function Logo({ className }) {
  return (
    <Anchor href="/" className={className} aria-label={site.name}>
      <img src={logo} alt={site.name} className="h-12 w-auto" />
    </Anchor>
  );
}
