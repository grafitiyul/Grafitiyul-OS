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
      <NavBar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppButton />
    </PublicRoot>
  );
}
