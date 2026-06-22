// ============================================================================
// Public website design tokens — single source of truth.
//
// Extracted from the Figma "Brand Styleguide" (colors #34:77, typography
// #607:11481) and reconciled with the real UI screens (the styleguide
// documented `Discovery_Fs`, but every built screen uses Fredoka — approved
// decision: Fredoka is the public font).
//
// This file is imported BOTH by `tailwind.config.js` (to generate utilities)
// and by runtime code that needs raw values. Keep it plain ESM, no JSX.
//
// Scoping note: every key here is a NEW name (cerulean, breakerBay, cranberry,
// goldenTainoi, thunderbird, ink, brand, action, …). None collide with
// Tailwind's default palette, so adding them only ADDS utilities — the
// existing admin/learner/portal styling (default Tailwind colors + Heebo
// font) is left completely untouched.
// ============================================================================

// ── Brand colour scales (exact hex from Figma) ──────────────────────────────

// Primary brand blue. Figma name: "Thunderbird/Cerulean Blue".
export const cerulean = {
  50: '#EEF7FF',
  100: '#D9ECFF',
  200: '#BBDEFF',
  300: '#8DCAFF',
  400: '#57ACFF',
  500: '#3089FF',
  600: '#1A6AF6',
  700: '#1356EB',
  800: '#1644B7',
  900: '#183D90',
  950: '#142657',
};

// Teal accent. Figma name: "Breaker Bay".
export const breakerBay = {
  50: '#F1FCFB',
  100: '#D1F6F3',
  200: '#A2EDE9',
  300: '#6CDCDB',
  400: '#3DC2C4',
  500: '#23A0A4',
  600: '#1A8287',
  700: '#19666C',
  800: '#185257',
  900: '#194448',
  950: '#08272B',
};

// Primary action / CTA pink. Figma name: "Cranberry" (the checkout
// "continue to billing" button is Cranberry/500).
export const cranberry = {
  50: '#FCF3F7',
  100: '#FAE9F0',
  200: '#F7D3E1',
  300: '#F2AFC9',
  400: '#E97DA4',
  500: '#DC4E7E',
  600: '#CB3762',
  700: '#AF274A',
  800: '#91233E',
  900: '#7A2137',
  950: '#4A0D1B',
};

// Secondary CTA / highlight amber. Figma name: "Golden Tainoi" (the
// "search tour" navbar button is Golden Tainoi/400).
export const goldenTainoi = {
  50: '#FFF9EB',
  100: '#FFEEC6',
  200: '#FEDD89',
  300: '#FEC449',
  400: '#FDAD22',
  500: '#F88A08',
  600: '#DB6404',
  700: '#B64407',
  800: '#94340C',
  900: '#792C0E',
  950: '#461402',
};

// Danger / alert red. Figma name: "Thunderbird".
export const thunderbird = {
  50: '#FFF1F0',
  100: '#FFE0DD',
  200: '#FFC6C1',
  300: '#FF9E96',
  400: '#FF675A',
  500: '#FF3827',
  600: '#FB1A07',
  700: '#D71201',
  800: '#AF1305',
  900: '#90160C',
  950: '#4F0600',
};

// Neutral ramp. NOTE: Figma only formally defines "Gray/500" (#667085); the
// rest of this ramp is our addition, built from observed neutral usage across
// the screens (dark navbar #1D2939, page text #101828, borders #98A2B3, etc.).
// Named `ink` to avoid colliding with Tailwind's default `neutral`/`gray`.
export const ink = {
  0: '#FFFFFF',
  50: '#F9FAFB',
  100: '#F8F8F7',
  200: '#EAECF0',
  300: '#D0D5DD',
  400: '#98A2B3',
  500: '#667085',
  600: '#475467',
  700: '#344054',
  800: '#1D2939',
  900: '#101828',
  950: '#000000',
};

// One-off success / WhatsApp green (not a documented scale in Figma).
export const success = '#34C759';

// ── Semantic aliases ────────────────────────────────────────────────────────
// Components reference MEANING (brand/action/highlight/…) not raw scale names,
// so a future palette tweak is one edit here.
export const colors = {
  cerulean,
  breakerBay,
  cranberry,
  goldenTainoi,
  thunderbird,
  ink,
  brand: cerulean, // primary brand (navbar, links, headings)
  action: cranberry, // primary CTA buttons
  highlight: goldenTainoi, // secondary CTA / emphasis
  accent: breakerBay, // teal accents
  danger: thunderbird, // errors / validation
  success: { DEFAULT: success, 500: success },
};

// ── Typography ──────────────────────────────────────────────────────────────
// Fredoka is the public font; it carries Latin + Hebrew, so it covers the
// Hebrew-first UI. Heebo is the in-house fallback already loaded by the app.
export const fontFamily = {
  fredoka: ['Fredoka', 'Heebo', 'system-ui', '-apple-system', 'sans-serif'],
};

// Type ramp merges the styleguide scale (46/32/26/20/18/16/14/10) with the
// real-screen sizes (H1 36/50, card title 22). Keys are NEW (display/h1/…)
// so they never override Tailwind's xs/sm/base/lg/xl defaults used by admin.
export const fontSize = {
  display: ['46px', { lineHeight: '1.1', fontWeight: '500' }],
  h1: ['36px', { lineHeight: '50px', fontWeight: '500' }],
  h2: ['32px', { lineHeight: '1.25', fontWeight: '500' }],
  h3: ['26px', { lineHeight: '1.3', fontWeight: '500' }],
  title: ['22px', { lineHeight: '1.3', fontWeight: '700' }],
  'body-lg': ['18px', { lineHeight: '30px' }],
  body: ['16px', { lineHeight: '1.5' }],
  'body-sm': ['14px', { lineHeight: '1.5' }],
  caption: ['12px', { lineHeight: '1.4' }],
};

// ── Radius (observed: buttons 4–30, inputs 8, CTA 10, cards 16/36, round) ────
export const borderRadius = {
  cta: '10px',
  card: '36px',
  pill: '9999px',
};

// ── Elevation (refined per component; floating = the WhatsApp button stack) ──
export const boxShadow = {
  card: '0 4px 24px -8px rgba(16, 24, 40, 0.12)',
  elevated: '0 12px 32px -8px rgba(16, 24, 40, 0.18)',
  floating:
    '-1px 1px 3px 0 rgba(0,0,0,0.29), -4px 4px 5px 0 rgba(0,0,0,0.26), -8px 9px 7px 0 rgba(0,0,0,0.15)',
};

// ── Breakpoints (Figma fixed canvases: mobile 375 / desktop 1440) ───────────
// Exposed for JS (useMediaQuery); Tailwind keeps its default breakpoints.
export const breakpoints = {
  mobile: 375,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};
