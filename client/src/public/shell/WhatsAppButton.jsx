import { WhatsAppGlyph } from '../components/Icon.jsx';
import { site } from '../content/site.js';

// Fixed floating WhatsApp button (Figma: green round button, layered shadow,
// pinned to the leading-bottom corner). Builds a wa.me deep link from the
// site content seam.
export default function WhatsAppButton() {
  const href = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
    site.whatsappMessage,
  )}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="פנייה בוואטסאפ"
      // start-4 keeps it on the leading edge (right in RTL, left in LTR).
      className="fixed bottom-5 start-4 z-50 grid h-14 w-14 place-items-center rounded-pill bg-[#34C759] text-white shadow-floating transition-transform hover:scale-105"
    >
      <WhatsAppGlyph className="h-8 w-8" />
    </a>
  );
}
