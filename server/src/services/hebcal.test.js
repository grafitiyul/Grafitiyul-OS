import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHebcalItems, isCholHamoed, isHanukkah } from './hebcal.js';

const items = [
  { title: 'Erev Pesach', hebrew: 'ערב פסח', date: '2026-04-01', category: 'holiday', subcat: 'major' },
  { title: 'Candle lighting', date: '2026-04-01T18:45:00+03:00', category: 'candles' },
  { title: 'Pesach I', hebrew: 'פסח א׳', date: '2026-04-02', category: 'holiday', subcat: 'major', yomtov: true },
  { title: "Pesach III (CH''M)", hebrew: 'פסח ג׳ (חוה״מ)', date: '2026-04-04', category: 'holiday', subcat: 'major', yomtov: false },
  { title: "Pesach IV (CH''M)", hebrew: 'פסח ד׳ (חוה״מ)', date: '2026-04-05', category: 'holiday', subcat: 'major', yomtov: false },
  { title: 'Chanukah: 1 Candle', hebrew: 'חנוכה: א׳ נר', date: '2026-12-14', category: 'holiday', subcat: 'major' },
  { title: 'Chanukah: 2 Candles', hebrew: 'חנוכה: ב׳ נרות', date: '2026-12-15', category: 'holiday', subcat: 'major' },
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
  const chm = markers.filter((x) => x.markerKey === 'chol_hamoed');
  assert.equal(chm.length, 2);
  const m = markers.find((x) => x.startDate === '2026-04-04');
  assert.equal(m.markerKey, 'chol_hamoed');
  assert.equal(m.endDate, '2026-04-04');
  assert.equal(m.externalId, "2026-04-04|Pesach III (CH''M)");
});

test('isHanukkah matches Hebcal Chanukah titles', () => {
  assert.equal(isHanukkah('Chanukah: 1 Candle'), true);
  assert.equal(isHanukkah('Chanukah: 8 Candles'), true);
  assert.equal(isHanukkah('Pesach I'), false);
});

test('Hanukkah becomes MARKERS (one per day), never a pricing holiday', () => {
  const { rows, markers } = parseHebcalItems(items);
  // No Hanukkah in pricing rows (not חג/ערב חג/other)
  assert.equal(rows.some((r) => isHanukkah(r.sourceName)), false);
  // Markers include both Hanukkah days, keyed 'hanukkah', named per day
  const hk = markers.filter((m) => m.markerKey === 'hanukkah');
  assert.equal(hk.length, 2);
  assert.equal(hk[0].nameHe, 'חנוכה — יום 1');
  assert.equal(hk[0].startDate, '2026-12-14');
  assert.equal(hk[0].endDate, '2026-12-14');
  assert.equal(hk[1].nameHe, 'חנוכה — יום 2');
  assert.equal(hk[0].externalId, '2026-12-14|Chanukah: 1 Candle');
});

test('Erev keeps its candle-lighting start time', () => {
  const { rows } = parseHebcalItems(items);
  const erev = rows.find((r) => r.sourceName === 'Erev Pesach');
  assert.equal(erev.allDay, false);
  assert.equal(erev.startMinute, 18 * 60 + 45); // 18:45
});
