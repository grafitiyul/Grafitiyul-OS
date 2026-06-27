import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep country-flag SVGs (flag-icons) as separate, content-hashed files so
    // the browser fetches only the flags actually shown and caches them
    // immutably — instead of base64-inlining ~260 flags into the main CSS. All
    // other assets keep Vite's default inline-below-4KB behaviour.
    assetsInlineLimit(filePath) {
      if (filePath.includes('flag-icons')) return false;
      return undefined;
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: true,
  },
});
