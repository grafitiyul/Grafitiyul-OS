import logo from '../public/assets/home/photos/logo.png';

// Canonical application-identity mark: the official Grafitiyul Team logo
// (the teal "Feel The Street" graffiti roundel). This is the ONE source of
// truth for every in-app surface where the brand appears — admin top bar,
// admin login, learner name gate. The favicon / PWA / apple-touch icons are
// rasterised from the same artwork (client/public/icons/*).
//
// The user-facing product name is always "Grafitiyul Team". "GOS" is the
// internal development name and must never be shown to users.
export default function BrandMark({ className = 'h-9 w-auto', showName = false }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <img
        src={logo}
        // When the name is rendered as text alongside, keep the image
        // decorative so screen readers don't announce the brand twice.
        alt={showName ? '' : 'Grafitiyul Team'}
        className={className}
        draggable={false}
      />
      {showName && (
        <span className="font-bold text-gray-900 text-[15px]">
          Grafitiyul Team
        </span>
      )}
    </span>
  );
}
