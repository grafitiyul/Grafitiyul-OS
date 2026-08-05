// Real-browser paste diagnosis rig. Drives system Chrome against the dev
// fixture (client/paste-fixture.html): performs REAL selection→Ctrl+C→Ctrl+V
// so the payload is Chrome's actual clipboard serialization, then dumps every
// pipeline stage. Also verifies the CollapsibleNote one-click save.
// Usage: node scripts/paste-rig.mjs [port]
import { chromium } from 'playwright-core';

const port = process.argv[2] || '5199';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text());
});
await page.goto(`http://localhost:${port}/paste-fixture.html`);
await page.waitForSelector('#gmail-divs');

const SHAPES = ['gmail-divs', 'gmail-brs', 'gmail-trailing-brs', 'gmail-nbsp-wbr'];
const dumps = [];

for (const id of SHAPES) {
  await page.evaluate((elId) => {
    const el = document.getElementById(elId);
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, id);
  await page.keyboard.press('Control+c');

  await page.click('#composer .rt-editor-prose');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);

  const cap = await page.evaluate(() => window.__cap.pastes.at(-1));
  const editorHtml = await page.evaluate(() => window.__editorHtml());
  const sanitized = await page.evaluate((h) => window.__sanitize(h), cap?.html || '');

  const compact = (h) =>
    String(h ?? '')
      .replace(/\s*style="[^"]*"/g, '')
      .replace(/\s*class="[^"]*"/g, '')
      .replace(/\n/g, '\\n');

  console.log(`\n===== ${id} =====`);
  console.log('CLIP html (no styles):', compact(cap?.html));
  console.log('CLIP text/plain      :', JSON.stringify(cap?.plain));
  console.log('SANITIZED            :', compact(sanitized));
  console.log('EDITOR doc           :', compact(editorHtml));

  await page.click('#save-note');
  await page.waitForTimeout(100);
  console.log('NOTECARD             :', compact(await page.evaluate(() => window.__displayHtml())));

  dumps.push({ id, clipHtml: cap?.html, clipPlain: cap?.plain, sanitized, editorHtml });
}

// ── CollapsibleNote one-click save ──────────────────────────────────────────
console.log('\n===== customer-info one-click save =====');
try {
  // Open programmatically (opening isn't under test — the שמור click is; the
  // rig page's tall composer makes coordinate-clicks on this row flaky).
  await page.evaluate(() => document.querySelector('#customer-info [role="button"]').click());
  await page.waitForSelector('#customer-info .rt-editor-prose', { timeout: 5000 });
  await page.click('#customer-info .rt-editor-prose');
  await page.keyboard.type('תוספת חדשה ');
  await page.waitForTimeout(500); // collapsible expansion settled
  const before = await page.evaluate(() => window.__writes || 0);
  await page.click('#customer-info button:text("שמור")', { timeout: 5000 });
  await page.waitForTimeout(800); // > the 150ms simulated latency
  const stillOpen = await page.evaluate(
    () => !!document.querySelector('#customer-info .rt-editor-prose'),
  );
  const writes = (await page.evaluate(() => window.__writes || 0)) - before;
  const savedShown = await page.evaluate(
    () => document.querySelector('#customer-info .gos-prose')?.textContent || '',
  );
  console.log('after ONE click:', { editorStillOpen: stillOpen, serverWrites: writes });
  console.log('read-state text:', JSON.stringify(savedShown));
} catch (err) {
  console.log('customer-info step FAILED:', err.message.split('\n')[0]);
  console.log(
    'DOM:',
    (await page.evaluate(() => document.getElementById('customer-info')?.innerHTML || ''))
      .replace(/\s*(style|class)="[^"]*"/g, '')
      .slice(0, 1500),
  );
}

const { writeFileSync } = await import('node:fs');
writeFileSync(new URL('./paste-rig-dumps.json', import.meta.url), JSON.stringify(dumps, null, 2));
console.log('\nFull dumps: client/scripts/paste-rig-dumps.json');

await browser.close();
