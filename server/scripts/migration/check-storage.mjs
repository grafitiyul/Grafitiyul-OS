// Phase 2B step 1 — verify snapshot bucket connectivity + readyForExtraction.
// READ/WRITE only to the throwaway `_connectivity/` probe key; never touches
// snapshots/. Run: railway run --service Grafitiyul-OS node scripts/migration/check-storage.mjs
import { migrationConfigStatus } from '../../src/migration/config.js';
import { checkConnectivity } from '../../src/migration/r2.js';

// Which DB URL keys are present on THIS service env (names only — no values).
const dbKeys = Object.keys(process.env).filter((k) => /^DATABASE(_PUBLIC)?_URL$/.test(k)).sort();

const cfg = migrationConfigStatus();
console.log('migrationConfigStatus:', JSON.stringify(cfg, null, 2));
console.log('DB url keys present on service:', dbKeys.join(', ') || '(none)');

console.log('\nchecking R2 connectivity (probe round-trip under _connectivity/) …');
const conn = await checkConnectivity();
console.log('connectivity:', JSON.stringify(conn, null, 2));

const ok = cfg.readyForExtraction && conn.ok;
console.log(`\nVERDICT: ${ok ? 'STORAGE READY' : 'NOT READY'}`);
process.exit(ok ? 0 : 1);
