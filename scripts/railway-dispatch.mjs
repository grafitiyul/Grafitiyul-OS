// One repo, multiple Railway services (gos-server, gos-whatsapp-main,
// gos-whatsapp-office). Railway's default Node deploy runs the ROOT
// package.json scripts, which used to hard-code the GOS server — so a bridge
// service left on default commands would silently boot the wrong app and
// still look green.
//
// This dispatcher picks the app by the one env var that already defines the
// service's identity: WHATSAPP_ACCOUNT_ID set => WhatsApp bridge, otherwise
// GOS server. Bridge services therefore need NO custom Build/Start commands
// on Railway. Never set WHATSAPP_ACCOUNT_ID on gos-server.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2];
const accountId = (process.env.WHATSAPP_ACCOUNT_ID || '').trim();
const role = accountId ? 'bridge' : 'server';

console.log(
  `[dispatch] phase=${phase} role=${role}` +
    (accountId ? ` (WHATSAPP_ACCOUNT_ID=${accountId})` : ' (WHATSAPP_ACCOUNT_ID not set)'),
);

if (phase === 'print-role') {
  console.log(role);
  process.exit(0);
}

function run(args, why) {
  console.log(`[dispatch] ${why}: npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`[dispatch] npm ${args.join(' ')} exited with ${res.status ?? 'signal'}`);
    process.exit(res.status ?? 1);
  }
}

if (role === 'bridge') {
  if (phase === 'install') {
    // bridge's own postinstall runs sync-schema + prisma generate
    run(['install', '--prefix', 'bridge'], 'install bridge deps');
  } else if (phase === 'build') {
    run(['run', 'generate', '--prefix', 'bridge'], 'refresh bridge prisma client');
  } else if (phase === 'start') {
    if (!existsSync(path.join(root, 'bridge', 'node_modules'))) {
      // install ran without WHATSAPP_ACCOUNT_ID (or was skipped) — recover here
      run(['install', '--prefix', 'bridge'], 'bridge deps missing at start, installing');
    }
    run(['start', '--prefix', 'bridge'], 'start WhatsApp bridge');
  } else {
    console.error(`[dispatch] unknown phase "${phase}"`);
    process.exit(1);
  }
} else {
  if (phase === 'install') {
    run(['install', '--prefix', 'server'], 'install server deps');
    run(['install', '--prefix', 'client'], 'install client deps');
  } else if (phase === 'build') {
    run(['run', 'build', '--prefix', 'client'], 'build client');
    run(['run', 'build', '--prefix', 'server'], 'build server');
  } else if (phase === 'start') {
    run(['start', '--prefix', 'server'], 'start GOS server');
  } else {
    console.error(`[dispatch] unknown phase "${phase}"`);
    process.exit(1);
  }
}
