import PublicRoot from '../theme/PublicRoot.jsx';
import NavBar from './NavBar.jsx';
import Footer from './Footer.jsx';
import WhatsAppButton from './WhatsAppButton.jsx';

// The public-page frame: establishes the public surface (PublicRoot scope +
// RTL), then NavBar → page content → Footer, with the floating WhatsApp button.
//
// Every public page renders inside this. `dir` is forwarded to PublicRoot so a
// future English page can request LTR without changing the layout.
export default function PublicLayout({ children, dir = 'rtl' }) {
  return (
    <PublicRoot dir={dir}>
      {/* Skip link — first focusable element; visible only on keyboard focus. */}
      <a
        href="#main-content"
        className="sr-only z-[100] rounded bg-brand-600 px-4 py-2 text-white focus:not-sr-only focus:absolute focus:right-3 focus:top-3"
      >
        דלגו לתוכן הראשי
      </a>
      <NavBar />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
      <WhatsAppButton />
    </PublicRoot>
  );
}
