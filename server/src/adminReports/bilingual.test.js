// Bilingual manager reports — the two languages must stay ONE report.
//
// The failure this guards against is drift: someone edits the Hebrew wording,
// adds a field, and the English renderer quietly keeps sending the old set of
// facts. Nothing crashes, nothing logs, and the English recipients simply get
// less information than the Hebrew ones for months.
//
// So the contract is tested structurally rather than by eyeballing wording:
// both renderers must consume the SAME context, and every fact one reports the
// other must report too.

import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, hasEnglish, renderReportBoth, assertBilingualIntegrity } from './registry.js';

const bilingual = () => REPORTS.filter((r) => r.nameEn);

// A `labelHe` / `labelEn` pair is ONE fact carried in two languages (a
// logistics finding's caption, say) and is SUPPOSED to differ between the two
// reports, so it is collected separately.
//
// Deliberately narrow. `nameHe`, `firstNameHe`, `meetingPointHe` and friends
// also end in "He", but they are business DATA: a customer really is named
// דנה, and an English report showing her Hebrew name is correct, not drift.
// Treating every *He key as a label made this test demand that English reports
// hide real customer names.
const isTranslated = (key) => key === 'labelHe' || key === 'labelEn';

/** Every language-NEUTRAL leaf value — the facts both reports must show. */
function leafValues(value, out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) { for (const v of value) leafValues(v, out); return out; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!isTranslated(k)) leafValues(v, out);
    return out;
  }
  const s = String(value).trim();
  if (s.length > 2) out.push(s);
  return out;
}

/** Every {he, en} translation pair in the context, at any depth. */
function translationPairs(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const v of value) translationPairs(v, out); return out; }
  for (const [k, v] of Object.entries(value)) {
    if (k === 'labelHe' && typeof v === 'string' && typeof value.labelEn === 'string') {
      out.push({ he: v, en: value.labelEn });
    }
    translationPairs(v, out);
  }
  return out;
}

test('a half-translated report cannot load — the server refuses it', () => {
  // Claims English, cannot render it: the exact drift this guard exists for.
  assert.throws(
    () => assertBilingualIntegrity([{ number: 99, nameHe: 'א', nameEn: 'A', render: () => 'x' }]),
    /no renderEn/,
  );
  // An English BODY with a Hebrew subject line would arrive looking broken.
  assert.throws(
    () => assertBilingualIntegrity([{
      number: 99, nameHe: 'א', nameEn: 'A', render: () => 'x', renderEn: () => 'y', renderSubject: () => 's',
    }]),
    /no English subject/,
  );
  // Honestly Hebrew-only reports are untouched — this is a claim-based rule.
  assert.doesNotThrow(() => assertBilingualIntegrity([{ number: 99, nameHe: 'א', render: () => 'x' }]));
});

test('a report that claims to be bilingual can actually render in English', () => {
  // The registry throws at import if this is violated, so reaching this line
  // already proves it. Asserting it here names the rule where a reader looks.
  for (const r of bilingual()) {
    assert.equal(typeof r.renderEn, 'function', `#${r.number} renderEn`);
    if (typeof r.renderSubject === 'function') {
      assert.equal(typeof r.renderSubjectEn, 'function', `#${r.number} renderSubjectEn`);
    }
    assert.ok(hasEnglish(r), `#${r.number} is reported as bilingual to the settings screen`);
  }
});

test('both languages report the SAME facts — neither can quietly drop a field', () => {
  for (const r of bilingual()) {
    const { he, en } = renderReportBoth(r.number);
    assert.ok(he && en, `#${r.number} renders in both languages`);

    // A value the Hebrew shows and the English does not is drift: someone added
    // a field to one renderer only.
    for (const v of new Set(leafValues(r.sample()))) {
      const inHe = he.includes(v);
      const inEn = en.includes(v);
      if (inHe && !inEn) {
        assert.fail(`#${r.number}: "${v}" appears in the Hebrew report but not in the English one`);
      }
      if (inEn && !inHe) {
        assert.fail(`#${r.number}: "${v}" appears in the English report but not in the Hebrew one`);
      }
    }

    // A translated fact must appear in BOTH reports, each in its own language —
    // an English report showing the Hebrew label is drift too.
    for (const { he: labelHe, en: labelEn } of translationPairs(r.sample())) {
      if (!he.includes(labelHe)) continue; // this report does not show that fact
      assert.ok(en.includes(labelEn), `#${r.number}: "${labelHe}" has no English counterpart in the report`);
      assert.ok(!en.includes(labelHe), `#${r.number}: the English report shows the Hebrew label "${labelHe}"`);
    }
  }
});

test('the two languages are genuinely different text, not a copy', () => {
  for (const r of bilingual()) {
    const { he, en } = renderReportBoth(r.number);
    assert.notEqual(he, en, `#${r.number} English is not just the Hebrew again`);
    // An English report must not still be carrying Hebrew prose. Values may be
    // Hebrew (a guide's name is a guide's name); the report's own words must not.
    // Longest value first, or removing a short value that is a substring of a
    // longer one leaves a fragment behind and reads as untranslated wording.
    const sampleValues = [...new Set([
      ...leafValues(r.sample()),
      ...translationPairs(r.sample()).map((p) => p.he),
    ])].sort((a, b) => b.length - a.length);
    const strippedEn = sampleValues.reduce((s, v) => s.split(v).join(''), en);
    assert.ok(
      !/[֐-׿]/.test(strippedEn),
      `#${r.number} English still contains Hebrew wording: ${strippedEn}`,
    );
  }
});

test('neither language leaks a placeholder or an undefined', () => {
  for (const r of bilingual()) {
    const { he, en, subjectHe, subjectEn } = renderReportBoth(r.number);
    for (const [label, text] of [['he', he], ['en', en], ['subjectHe', subjectHe], ['subjectEn', subjectEn]]) {
      if (!text) continue;
      assert.ok(!/\{\{|undefined|NaN/.test(text), `#${r.number} ${label}: ${text}`);
    }
  }
});
