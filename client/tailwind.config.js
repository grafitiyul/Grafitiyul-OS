/** @type {import('tailwindcss').Config} */
import {
  colors as publicColors,
  fontFamily as publicFontFamily,
  fontSize as publicFontSize,
  borderRadius as publicBorderRadius,
  boxShadow as publicBoxShadow,
} from './src/public/theme/tokens.js';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Existing admin/learner/portal font — unchanged.
        sans: [
          '"Heebo"',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Arial',
          'sans-serif',
        ],
        // Public website font (Fredoka). New key → does not affect `sans`.
        ...publicFontFamily,
      },
      // Public website design tokens. Every key is a NEW name that does not
      // collide with Tailwind defaults, so these ADD utilities only and leave
      // the existing app styling untouched. See src/public/theme/tokens.js.
      colors: publicColors,
      fontSize: publicFontSize,
      borderRadius: publicBorderRadius,
      boxShadow: publicBoxShadow,
    },
  },
  plugins: [],
};
