import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ONE emoji picker. There used to be two — the chat composer mounted its own
// <emoji-picker> with its own Hebrew dictionary and its own dataset import,
// while the editors went through emojiPickerData.js — which meant two sets of
// categories, two loading behaviours and two things to fix. Reactions would
// have made it three.
//
// The rule: only EmojiPickerPanel.jsx creates the element or owns the catalog.
// Everything else renders that panel.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const OWNER = path.join('lib', 'EmojiPickerPanel.jsx');
const DATA = path.join('lib', 'emojiPickerData.js');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('only the shared panel mounts an <emoji-picker>', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel === OWNER) continue;
    const src = readFileSync(file, 'utf8');
    if (/createElement\(\s*['"]emoji-picker['"]\s*\)/.test(src)) offenders.push(`${rel}: creates <emoji-picker>`);
  }
  assert.deepEqual(offenders, [], 'a second emoji picker implementation appeared');
});

test('the catalog and its Hebrew dictionary have exactly one home', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel === OWNER || rel === DATA) continue;
    const src = readFileSync(file, 'utf8');
    // The dataset URL import and a local i18n dictionary are what a duplicate
    // implementation always brings with it.
    if (/emoji-picker-element-data/.test(src)) offenders.push(`${rel}: imports the emoji dataset directly`);
    if (/EMOJI_I18N_HE\s*=/.test(src)) offenders.push(`${rel}: declares its own emoji dictionary`);
  }
  assert.deepEqual(offenders, [], 'the emoji catalog was duplicated');
});

test('every emoji surface renders the shared panel', () => {
  // The three places a person picks an emoji today.
  const SURFACES = [
    path.join('editor', 'EmojiButton.jsx'),
    path.join('admin', 'whatsapp', 'ChatComposer.jsx'),
    path.join('admin', 'whatsapp', 'MessageBubble.jsx'),
  ];
  for (const rel of SURFACES) {
    const src = readFileSync(path.join(SRC, rel), 'utf8');
    assert.match(src, /<EmojiPickerPanel/, `${rel} renders the shared picker`);
  }
});
