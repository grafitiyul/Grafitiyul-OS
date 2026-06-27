import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build identity — the single value that tells an already-open tab whether the
// frontend it is running matches what's currently deployed. On Railway the build
// runs with RAILWAY_GIT_COMMIT_SHA set; locally we fall back to the git SHA, and
// to 'dev' if git isn't available. It is baked into the bundle (via `define`,
// below) AND written to /version.json (emitted by the plugin), so the running
// tab compares its own baked id against the live file. Keep them in lock-step.
function resolveBuildId() {
  const env = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || '';
  if (env) return env.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}
const BUILD_ID = resolveBuildId();
const BUILT_AT = new Date().toISOString();

// Emit a tiny, unhashed version.json into the build output. Served `no-store`
// by the server so the version check always sees the truly-deployed build.
function versionJsonPlugin() {
  return {
    name: 'gos-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit: BUILD_ID, builtAt: BUILT_AT }) + '\n',
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  // Bake the build id (+ build time) into the bundle as compile-time constants.
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
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
