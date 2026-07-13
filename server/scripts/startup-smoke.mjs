// Startup smoke check — boots the REAL server entrypoint (src/index.js) exactly
// as Railway does and fails if it cannot reach a listening state cleanly. This
// catches the whole class of deploy-crashing bugs that unit tests DON'T:
//   • duplicate ESM identifier declarations in route files (link-time SyntaxError)
//   • bad/missing imports, ReferenceErrors in module top-level or the listen hook
//   • any throw before "listening on port"
//
// It runs index.js in a child process with a throwaway DATABASE_URL and a random
// high PORT, watches stdout/stderr, and:
//   • SUCCESS  → sees the "[grafitiyul-os-server] listening on port" line AND no
//                startup error was printed → exit 0
//   • FAILURE  → the process exits before listening, OR a SyntaxError/ReferenceError/
//                "already been declared" appears on startup → exit 1 with the output
//
// No real DB is needed: listen() happens before any query, and workers only query
// lazily/on interval — so a clean boot is fully observable without infrastructure.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');
const PORT = String(20000 + Math.floor(process.uptime() * 1000) % 20000 || 24123);

const child = spawn(process.execPath, [entry], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT,
    DATABASE_URL: 'postgresql://smoke:smoke@127.0.0.1:5432/smoke_check',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let listened = false;
let failed = false;
const FATAL = /(SyntaxError|ReferenceError|has already been declared|Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|is not defined)/;

function scan(buf) {
  const s = buf.toString();
  out += s;
  process.stdout.write(s);
  if (s.includes('listening on port')) listened = true;
  // A fatal startup error before we consider the boot healthy.
  if (!listened && FATAL.test(s)) failed = true;
  // Guard: a fatal error inside the listen hook (e.g. a ReferenceError in a
  // startup worker) must also fail even though "listening" was printed.
  if (FATAL.test(s)) failed = true;
}

child.stdout.on('data', scan);
child.stderr.on('data', scan);

// Give it a bounded window to reach listen + emit any startup-hook errors.
const DEADLINE_MS = 15000;
const timer = setTimeout(() => finish(), DEADLINE_MS);
// Once listening, wait a short grace for the listen-hook workers to throw, then decide.
let graceTimer = null;
const iv = setInterval(() => {
  if (listened && !graceTimer) graceTimer = setTimeout(() => finish(), 1500);
}, 200);

child.on('exit', (code) => {
  // An early exit before listening is a hard failure (crash on boot).
  if (!listened) failed = true;
  finish(code);
});

let done = false;
function finish(exitCode) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  clearInterval(iv);
  if (graceTimer) clearTimeout(graceTimer);
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  if (listened && !failed) {
    console.log('\n[startup-smoke] OK — server booted and reached listening state cleanly.');
    process.exit(0);
  }
  console.error(
    `\n[startup-smoke] FAILED — server did not reach a clean listening state (listened=${listened}, fatalError=${failed}, exit=${exitCode ?? 'n/a'}).`,
  );
  process.exit(1);
}
