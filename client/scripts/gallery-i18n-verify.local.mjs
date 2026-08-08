// Real-Chrome bilingual verification of the PUBLIC gallery.
//
// Drives the live production page in BOTH languages and asserts what a visitor
// actually sees — not the dictionary, not the bundle. The core check is the one
// the audit was about: when the page is in English there must be NO Hebrew
// system text left on screen.
//
// Usage: node scripts/gallery-i18n-verify.local.mjs <token> [token2]
import { chromium } from 'playwright-core';

const ORIGIN = process.env.ORIGIN || 'https://app.grafitiyul.co.il';
const [tok, tok2] = process.argv.slice(2);
if (!tok) {
  console.error('usage: node gallery-i18n-verify.local.mjs <token> [emptyToken]');
  process.exit(1);
}

const HEBREW = /[֐-׿]/;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fails = [];
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails.push(label);
};

/** Visible text of the page, excluding the language-switch button itself. */
async function visibleText() {
  return page.evaluate(() => {
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) {
        const s = n.textContent.trim();
        if (s) out.push(s);
        return;
      }
      if (n.nodeType !== 1 || skip.has(n.tagName)) return;
      const st = window.getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      // The language switch deliberately shows the OTHER language's name.
      if (n.dataset?.langSwitch === '1') return;
      for (const c of n.childNodes) walk(c);
    };
    walk(document.body);
    return out;
  });
}

async function openGallery(token, lang) {
  await page.goto(`${ORIGIN}/g/${token}`, { waitUntil: 'networkidle' });
  if (lang === 'en') {
    // Click the real switch a visitor uses — not a query parameter.
    const btn = page.locator('button', { hasText: 'English' }).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(1200);
    }
  }
  await page.waitForTimeout(400);
}

// ── Gallery WITH media ──────────────────────────────────────────────────────
console.log('\n=== HEBREW — gallery with media ===');
await openGallery(tok, 'he');
let text = (await visibleText()).join(' | ');
ok('title shows the Hebrew value', text.includes('תמונות מהסדנה'));
ok('subtitle shows the Hebrew value', text.includes('יולי 2026'));
ok('page direction is RTL', (await page.getAttribute('body > div', 'dir')) === 'rtl'
  || (await page.locator('[dir=rtl]').count()) > 0);
ok('upload action is in Hebrew', /העלאת/.test(text));
ok('item count is in Hebrew', /תמונות וסרטונים/.test(text));
ok('internal name never appears', !text.includes('QA CLAUDE'), 'operator label must not leak');

console.log('\n=== ENGLISH — gallery with media ===');
await openGallery(tok, 'en');
text = (await visibleText()).join(' | ');
ok('title shows the English value', text.includes('Workshop Photos'));
ok('subtitle shows the English value', text.includes('July 2026'));
ok('upload action is in English', /Upload photos and videos/.test(text));
ok('item count is in English', /photos and videos/.test(text));
ok('internal name never appears', !text.includes('QA CLAUDE'));

// THE headline assertion of this whole audit.
const strayHe = (await visibleText()).filter((s) => HEBREW.test(s));
ok('NO Hebrew system text remains on the English page', strayHe.length === 0,
  strayHe.length ? JSON.stringify(strayHe.slice(0, 8)) : '');

// ── Lightbox / caption ──────────────────────────────────────────────────────
console.log('\n=== ENGLISH — lightbox + caption ===');
const tile = page.locator('main button').first();
if (await tile.count()) {
  await tile.click();
  await page.waitForTimeout(700);
  const lb = (await visibleText()).join(' | ');
  ok('lightbox opened', (await page.locator('[role=dialog]').count()) > 0);
  ok('caption shows the ENGLISH caption', lb.includes('Painting on the wall'));
  ok('caption does NOT fall back to Hebrew', !lb.includes('ציור על הקיר'));
  const lbHe = (await visibleText()).filter((s) => HEBREW.test(s));
  ok('no Hebrew left in the English lightbox', lbHe.length === 0,
    lbHe.length ? JSON.stringify(lbHe.slice(0, 6)) : '');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

console.log('\n=== HEBREW — lightbox caption ===');
await openGallery(tok, 'he');
const tileHe = page.locator('main button').first();
if (await tileHe.count()) {
  await tileHe.click();
  await page.waitForTimeout(700);
  const lb = (await visibleText()).join(' | ');
  ok('caption shows the HEBREW caption', lb.includes('ציור על הקיר'));
  await page.keyboard.press('Escape');
}

// ── Empty, view-only gallery ────────────────────────────────────────────────
if (tok2) {
  console.log('\n=== HEBREW — empty, view-only gallery ===');
  await openGallery(tok2, 'he');
  text = (await visibleText()).join(' | ');
  ok('empty state in Hebrew', /הגלריה עדיין ריקה/.test(text));
  ok('no upload action (permission off)', !/העלאת תמונות וסרטונים/.test(text));

  console.log('\n=== ENGLISH — empty, view-only gallery ===');
  await openGallery(tok2, 'en');
  text = (await visibleText()).join(' | ');
  ok('empty state in English', /still empty/i.test(text));
  ok('no upload action (permission off)', !/Upload photos and videos/.test(text));
  const emptyHe = (await visibleText()).filter((s) => HEBREW.test(s));
  ok('NO Hebrew on the English empty page', emptyHe.length === 0,
    emptyHe.length ? JSON.stringify(emptyHe.slice(0, 8)) : '');
}

// ── Disabled / unknown link ─────────────────────────────────────────────────
console.log('\n=== unknown link (both languages) ===');
await page.goto(`${ORIGIN}/g/definitelynotarealtoken`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
text = (await visibleText()).join(' | ');
ok('unavailable state renders (Hebrew default)', /הגלריה אינה זמינה/.test(text));

await browser.close();
console.log(`\n${fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fails.length}`}`);
if (fails.length) {
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
