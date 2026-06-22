import { useState } from 'react';
import Anchor from '../components/Anchor.jsx';
import Button from '../components/Button.jsx';
import Icon from '../components/Icon.jsx';
import Logo from './Logo.jsx';
import { primaryNav, headerCtas } from '../content/site.js';

// Public top navigation. Dark navy bar (Figma #1D2939), RTL: logo on the
// leading (right) edge, links + CTAs toward the centre/left. Desktop shows the
// full nav; below `lg` it collapses to a hamburger sheet.
//
// Presentational: links are <Anchor> (plain <a> today, router Link after
// Step 3/4). Active-route highlighting is intentionally deferred to routing.
export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-ink-800 text-white">
      <nav className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-12">
        {/* Leading edge (right in RTL): logo */}
        <Logo />

        {/* Desktop links */}
        <ul className="hidden items-center gap-7 lg:flex">
          {primaryNav.map((item) => (
            <li key={item.href}>
              <Anchor
                href={item.href}
                className="inline-flex items-center gap-1 text-body text-brand-100 hover:text-white"
              >
                {item.label}
                {item.hasMenu && <Icon name="chevronDown" className="h-4 w-4" />}
              </Anchor>
            </li>
          ))}
        </ul>

        {/* Desktop CTAs + locale */}
        <div className="hidden items-center gap-3 lg:flex">
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-pill bg-white/20 text-body font-medium text-white hover:bg-white/30"
            aria-label="Switch language to English"
          >
            EN
          </button>
          <Button {...headerCtas.contact} size="sm" />
          <Button {...headerCtas.search} size="sm" />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-pill bg-white/10 lg:hidden"
          aria-label={open ? 'סגירת תפריט' : 'פתיחת תפריט'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'close' : 'menu'} className="h-6 w-6" />
        </button>
      </nav>

      {/* Mobile sheet */}
      {open && (
        <div className="border-t border-white/10 lg:hidden">
          <ul className="flex flex-col px-4 py-2">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <Anchor
                  href={item.href}
                  className="block py-3 text-body-lg text-brand-100 hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Anchor>
              </li>
            ))}
          </ul>
          <div className="flex gap-3 px-4 pb-4">
            <Button {...headerCtas.search} size="sm" fullWidth />
            <Button {...headerCtas.contact} size="sm" fullWidth />
          </div>
        </div>
      )}
    </header>
  );
}
