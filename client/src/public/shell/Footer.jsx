import Anchor from '../components/Anchor.jsx';
import Container from '../components/Container.jsx';
import { footerNav, legalNav, copyright, site } from '../content/site.js';
import footerLogo from '../assets/home/photos/footer-logo.png';

// Public footer. Dark navy (Figma), link groups + legal row + copyright.
export default function Footer() {
  return (
    <footer className="bg-ink-800 text-white">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand blurb */}
          <div className="lg:col-span-2">
            <img src={footerLogo} alt={site.name} className="h-20 w-auto" />
            <p className="mt-4 max-w-sm text-body text-brand-100/80">
              סיורי וסדנאות גרפיטי — חוויה אורבנית בלב הסצנה.
            </p>
          </div>

          {/* Link groups */}
          {footerNav.map((group) => (
            <div key={group.title}>
              <div className="text-body font-bold text-white">{group.title}</div>
              <ul className="mt-3 flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Anchor
                      href={link.href}
                      className="text-body text-brand-100/80 hover:text-white"
                    >
                      {link.label}
                    </Anchor>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal row */}
        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-body-sm text-brand-100/70 sm:flex-row sm:items-center sm:justify-between">
          <span>{copyright}</span>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {legalNav.map((link) => (
              <li key={link.href}>
                <Anchor href={link.href} className="hover:text-white">
                  {link.label}
                </Anchor>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </footer>
  );
}
