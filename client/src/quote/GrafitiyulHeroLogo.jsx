// Grafitiyul Hero logo — the built-in DEFAULT brand mark for the quote cover.
//
// A self-contained, resolution-independent SVG lockup:
//   • a confident slanted marker-script "Grafitiyul" wordmark (on-brand for a
//     graffiti/street company),
//   • a centered tapered teal brush underline with a rising tail,
//   • a spray-can glyph on the reading-end side with a teal spray + base accent.
//
// It is a *default* only — the Quote Structure editor can upload an official
// asset that overrides it (composer prefers hero.logo.url). Everything here is
// pure SVG (no fonts, no external files), so it renders identically on every
// device — preview, produced output, and PDF — and scales to any size. The white
// parts use `currentColor` so the mark inherits the cover's white; only the teal
// accents are fixed to the brand colour.

const TEAL = '#10a99b';

export default function GrafitiyulHeroLogo({ height = 120, className = '', title = 'Grafitiyul' }) {
  const VB_W = 660;
  const VB_H = 210;
  const width = (height * VB_W) / VB_H;

  return (
    <svg
      role="img"
      aria-label={title}
      width={width}
      height={height}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      style={{ color: '#ffffff', overflow: 'visible' }}
      fill="none"
    >
      <title>{title}</title>

      {/* teal brush underline — centered under the wordmark, rising tail */}
      <path
        d="M96 168 C 210 156, 340 155, 470 160 C 486 162, 500 158, 512 150 C 502 164, 486 172, 468 172 C 338 168, 210 169, 100 178 C 92 178, 90 170, 96 168 Z"
        fill={TEAL}
      />

      {/* wordmark "Grafitiyul" — gentle handwriting slant, monoline marker script */}
      <g transform="translate(14,0) skewX(-8)">
        <g stroke="currentColor" strokeWidth="12.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* G */}
          <path d="M108 60 C 88 42, 54 44, 46 78 C 38 110, 60 130, 88 126 C 108 123, 116 106, 112 90 L 88 90" />
          {/* r */}
          <path d="M130 130 L 138 90 M136 108 C 144 92, 158 88, 170 96" />
          {/* a */}
          <path d="M212 98 C 200 86, 178 88, 174 108 C 170 126, 194 132, 206 118 L 210 92 L 206 128 C 206 137, 216 138, 226 130" />
          {/* f */}
          <path d="M250 134 C 248 154, 242 176, 226 176 M240 118 L 258 58 C 262 42, 250 38, 244 50 M230 96 L 264 94" />
          {/* i */}
          <path d="M282 130 L 290 96 M295 74 L 295 76" />
          {/* t */}
          <path d="M320 130 C 330 134, 342 128, 346 120 M328 66 L 314 130 M306 96 L 340 94" />
          {/* i */}
          <path d="M362 130 L 370 96 M375 74 L 375 76" />
          {/* y */}
          <path d="M396 96 L 400 120 C 402 130, 414 132, 422 122 L 432 94 L 418 154 C 412 178, 396 182, 384 172" />
          {/* u */}
          <path d="M456 96 L 452 120 C 450 132, 466 136, 476 124 L 486 94 L 480 128 C 480 135, 490 137, 500 130" />
          {/* l */}
          <path d="M520 56 L 506 124 C 504 134, 514 138, 524 130" />
        </g>
      </g>

      {/* spray-can — reading-end side */}
      <g>
        <rect x="566" y="72" width="50" height="86" rx="13" fill="currentColor" />
        <rect x="584" y="60" width="14" height="14" fill="currentColor" />
        <rect x="578" y="50" width="26" height="12" rx="3" fill="currentColor" />
        <rect x="585" y="40" width="12" height="10" rx="2" fill="currentColor" />
        <rect x="576" y="150" width="30" height="5" rx="2.5" fill={TEAL} />
        <g fill={TEAL}>
          <circle cx="616" cy="36" r="4" />
          <circle cx="632" cy="30" r="3.2" />
          <circle cx="630" cy="46" r="2.8" />
          <circle cx="644" cy="40" r="2.4" />
        </g>
      </g>
    </svg>
  );
}
