import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard: the Operations Control card flows must use the system
// ConfirmDialog / PromptDialog — never native browser dialogs. Fails if
// window.confirm/alert/prompt (a real CALL) is reintroduced in the scoped files.
// Extend SCOPED as more admin tour/schedule/woo flows are converted.

const SCOPED = ['src/admin/control/IssueCard.jsx'];
const NATIVE = /window\.(confirm|alert|prompt)\s*\(/;

for (const file of SCOPED) {
  test(`no native browser dialog in ${file}`, () => {
    const src = readFileSync(file, 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => NATIVE.test(line));
    assert.equal(
      offenders.length,
      0,
      `native dialog call(s) found: ${offenders.map((o) => `L${o.n}`).join(', ')} — use ConfirmDialog/PromptDialog`,
    );
  });
}
