import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHebcalItems, isCholHamoed } from './hebcal.js';

const items = [
  { title: 'Erev Pesach', hebrew: 'ערב פסח', date: '2026-04-01', category: 'holiday', subcat: 'major' },
  { title: 'Candle lighting', date: '2026-04-01T18:45:00+03:00', category: 'candles' },
  { title: 'Pesach I', hebrew: 'פסח א׳', date: '2026-04-02', category: 'holiday', subcat: 'major', yomtov: true },
  { title: "Pesach III (CH''M)", hebrew: 'פסח ג׳ (חוה״מ)', date: '2026-04-04', category: 'holiday', subcat: 'major', yomtov: false },
  { title: "Pesach IV (CH''M)", hebrew: 'פסח ד׳ (חוה״מ)', date: '2026-04-05', category: 'holiday', subcat: 'major', yomtov: false },
  { title: 'Rosh Chodesh', date: '2026-04-18', category: 'roshchodesh' },
];

test('isCholHamoed matches the Hebcal "(CH…" marker', () => {
  assert.equal(isCholHamoed("Pesach III (CH''M)"), true);
  assert.equal(isCholHamoed('Pesach I'), false);
  assert.equal(isCholHamoed('Chanukah'), false);
});

test('Chol HaMoed becomes a MARKER, never a pricing holiday row', () => {
  const { rows, markers } = parseHebcalItems(items);
  // No CH"M in pricing rows
  assert.equal(rows.some((r) => /\(CH/.test(r.sourceName)), false);
  // Pricing rows still contain Erev + the yom tov
  assert.ok(rows.find((r) => r.type === 'erev_chag' && r.sourceName === 'Erev Pesach'));
  assert.ok(rows.find((r) => r.type === 'chag' && r.sourceName === 'Pesach I'));
  // Markers contain the two CH"M days, keyed chol_hamoed, single-day ranges
  assert.equal(markers.length, 2);
  const m = markers.find((x) => x.startDate === '2026-04-04');
  assert.equal(m.markerKey, 'chol_hamoed');
  assert.equal(m.endDate, '2026-04-04');
  assert.equal(m.externalId, "2026-04-04|Pesach III (CH''M)");
});

test('Erev keeps its candle-lighting start time', () => {
  const { rows } = parseHebcalItems(items);
  const erev = rows.find((r) => r.sourceName === 'Erev Pesach');
  assert.equal(erev.allDay, false);
  assert.equal(erev.startMinute, 18 * 60 + 45); // 18:45
});
