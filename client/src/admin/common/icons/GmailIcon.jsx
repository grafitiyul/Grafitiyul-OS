// Official Gmail brand mark (full-color, Material style) — the ONE Gmail icon
// for the platform: composer email tab, nav, and anywhere else email needs a
// recognizable logo. Brand colors are embedded, so surrounding text-color
// classes never wash it out.
// The path data is exported so the module favicon (shell/moduleFavicon.js) can
// serialize the exact same mark — ONE source for the brand geometry.
export const GMAIL_ICON_VIEWBOX = '0 0 48 48';
export const GMAIL_ICON_PATHS = [
  { fill: '#4caf50', d: 'M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z' },
  { fill: '#1e88e5', d: 'M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z' },
  { fill: '#e53935', d: 'M35 11.2L24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25 1-6.7z' },
  { fill: '#c62828', d: 'M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z' },
  { fill: '#fbc02d', d: 'M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z' },
];

export default function GmailIcon({ size = 16 }) {
  return (
    <svg viewBox={GMAIL_ICON_VIEWBOX} width={size} height={size} aria-hidden>
      {GMAIL_ICON_PATHS.map((p, i) => (
        <path key={i} fill={p.fill} d={p.d} />
      ))}
    </svg>
  );
}
