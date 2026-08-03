import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, renderReport, renderReportSample, renderReportBoth, reportByNumber, reportsInGroup } from './registry.js';
import { statusIcon, dayLabel, cityChip, hebrewWeekday } from './guideReports.js';
import { coordinationSendMs, GUIDE_SEND_HOUR, SUMMARY_REMINDERS } from './tourSweeps.js';
import { israelLocalToMs } from '../communication/windows.js';

// ── the status/label rules the owner specified ───────────────────────────────

test('status icons: ✅ done at any distance, then 🔴 / 🔵 / 🟡 by days away', () => {
  for (const d of [0, 1, 2, 3, 4]) assert.equal(statusIcon(true, d), '✅');
  assert.equal(statusIcon(false, 0), '🔴');
  assert.equal(statusIcon(false, 1), '🔴');
  assert.equal(statusIcon(false, 2), '🔵');
  assert.equal(statusIcon(false, 3), '🔵');
  assert.equal(statusIcon(false, 4), '🟡');
});

test('there is deliberately no green bucket', () => {
  const icons = new Set([0, 1, 2, 3, 4].flatMap((d) => [statusIcon(true, d), statusIcon(false, d)]));
  assert.ok(!icons.has('🟢'));
  assert.deepEqual([...icons].sort(), ['✅', '🔴', '🔵', '🟡'].sort());
});

test('date labels: היום, מחר, then the Hebrew weekday name', () => {
  assert.equal(dayLabel(0, '2026-08-02'), 'היום');
  assert.equal(dayLabel(1, '2026-08-03'), 'מחר');
  assert.equal(dayLabel(2, '2026-08-04'), 'שלישי');
  assert.equal(dayLabel(3, '2026-08-05'), 'רביעי');
  assert.equal(dayLabel(4, '2026-08-06'), 'חמישי');
  assert.equal(hebrewWeekday('2026-08-01'), 'שבת');
});

test('the city shows in bold ONLY when it is not the home location', () => {
  // cityChip's own contract stays `cityName` — callers map their He/En pair
  // into it per language.
  assert.equal(cityChip({ cityName: 'ירושלים', locationId: 'l2', homeLocationId: 'l1' }), '*ירושלים*');
  assert.equal(cityChip({ cityName: 'תל אביב', locationId: 'l1', homeLocationId: 'l1' }), null);
  // No home location configured → show the city rather than wrongly hide it.
  assert.equal(cityChip({ cityName: 'חיפה', locationId: 'l2', homeLocationId: null }), '*חיפה*');
  assert.equal(cityChip({ cityName: null }), null);
});

// ── #11 the digest ───────────────────────────────────────────────────────────

test('#11 is one continuous list, one line per call, with the overdue section after a rule', () => {
  const text = renderReport(11, {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideDigest: {
      coordination: [
        { done: false, daysAway: 0, tourDate: '2026-08-02', customerName: 'משפחת כהן', participants: 4, productNameHe: 'סיור גרפיטי' },
        { done: false, daysAway: 1, tourDate: '2026-08-03', customerName: 'חברת ABC', participants: 18, productNameHe: 'סיור קולינרי', cityNameHe: 'ירושלים', locationId: 'l2', homeLocationId: 'l1' },
        { done: true, daysAway: 4, tourDate: '2026-08-06', customerName: 'רות לוי', participants: 2, productNameHe: 'סדנת גרפיטי' },
      ],
      missingSummaries: [{ tourDate: '2026-07-30', customerName: 'עיריית תל אביב', productNameHe: 'סיור וסדנת גרפיטי' }],
    },
  });
  const rows = text.split('\n');
  assert.equal(rows[0], '☎️ סטטוס שיחות התיאום לימים הקרובים');
  assert.equal(rows[2], '🔴 היום | משפחת כהן (4) | סיור גרפיטי');
  assert.equal(rows[3], '🔴 מחר | חברת ABC (18) | *ירושלים* | סיור קולינרי');
  assert.equal(rows[4], '✅ חמישי | רות לוי (2) | סדנת גרפיטי');
  assert.ok(text.includes('────────────────'));
  assert.ok(text.includes('📝 סיכומי סיור שטרם הושלמו'));
  assert.ok(text.includes('30/07/2026 | עיריית תל אביב | סיור וסדנת גרפיטי'));
  // No portal link at the bottom — explicit owner requirement.
  assert.ok(!/https?:\/\//.test(text));
});

test('#11 is TRUE chronological order — ✅ keeps its place, never pushed down', () => {
  const text = renderReport(11, {
    guideDigest: {
      coordination: [
        // Arrives deliberately unsorted, with the DONE call nearest in time.
        { done: false, daysAway: 1, tourDate: '2026-08-03', tourStartMs: 200, customerName: 'חברת ABC', participants: 18, productNameHe: 'סיור קולינרי' },
        { done: false, daysAway: 3, tourDate: '2026-08-05', tourStartMs: 300, customerName: 'רות לוי', participants: 2, productNameHe: 'סדנת גרפיטי' },
        { done: true, daysAway: 0, tourDate: '2026-08-02', tourStartMs: 100, customerName: 'משפחת כהן', participants: 4, productNameHe: 'סיור גרפיטי' },
      ],
      missingSummaries: [],
    },
  });
  const rows = text.split('\n');
  assert.equal(rows[2], '✅ היום | משפחת כהן (4) | סיור גרפיטי');
  assert.equal(rows[3], '🔴 מחר | חברת ABC (18) | סיור קולינרי');
  assert.equal(rows[4], '🔵 רביעי | רות לוי (2) | סדנת גרפיטי');
});

test('#11 gives every pending summary its own direct form link', () => {
  const text = renderReport(11, {
    guideDigest: {
      coordination: [],
      missingSummaries: [
        { tourDate: '2026-07-30', tourStartMs: 1, customerName: 'עיריית תל אביב', productNameHe: 'סיור וסדנת גרפיטי', formUrl: 'https://x/f/SUM1' },
        { tourDate: '2026-07-31', tourStartMs: 2, customerName: 'רות לוי', productNameHe: 'סיור גרפיטי', formUrl: 'https://x/f/SUM2' },
      ],
    },
  });
  assert.match(text, /30\/07\/2026 \| עיריית תל אביב \| סיור וסדנת גרפיטי\nhttps:\/\/x\/f\/SUM1/);
  assert.match(text, /31\/07\/2026 \| רות לוי \| סיור גרפיטי\nhttps:\/\/x\/f\/SUM2/);
  // Two entries, two DIFFERENT links, one blank line between entries.
  assert.match(text, /SUM1\n\n31\/07\/2026/);
});

test('#11 English uses the English data wherever it exists', () => {
  const en = reportByNumber(11).renderEn({
    guideDigest: {
      coordination: [
        { done: false, daysAway: 2, tourDate: '2026-08-04', tourStartMs: 1, customerName: 'חברת ABC', participants: 18, productNameHe: 'סיור קולינרי', productNameEn: 'Culinary Tour', cityNameHe: 'ירושלים', cityNameEn: 'Jerusalem', locationId: 'l2', homeLocationId: 'l1' },
      ],
      missingSummaries: [
        { tourDate: '2026-07-30', tourStartMs: 0, customerName: 'עיריית תל אביב', productNameHe: 'סיור וסדנת גרפיטי', productNameEn: 'Graffiti Tour & Workshop', formUrl: 'https://x/f/SUM1' },
      ],
    },
  });
  assert.match(en, /☎️ Coordination-call status for the days ahead/);
  assert.match(en, /🔵 Tuesday \| חברת ABC \(18\) \| \*Jerusalem\* \| Culinary Tour/);
  assert.match(en, /📝 Tour summaries still missing/);
  assert.match(en, /30\/07\/2026 \| עיריית תל אביב \| Graffiti Tour & Workshop\nhttps:\/\/x\/f\/SUM1/);
});

test('#11 omits the overdue section entirely when nothing is overdue', () => {
  const text = renderReport(11, {
    guideDigest: {
      coordination: [{ done: true, daysAway: 0, tourDate: '2026-08-02', customerName: 'א', participants: 1, productNameHe: 'ב' }],
      missingSummaries: [],
    },
  });
  assert.ok(!text.includes('────────────────'));
  assert.ok(!text.includes('סיכומי סיור שטרם הושלמו'));
});

// ── #12 / #13 — one family, per booking ──────────────────────────────────────

const COORD_NOTICE = {
  contactName: 'דנה לוי', orgName: 'עיריית תל אביב',
  productNameHe: 'סיור וסדנת גרפיטי', productNameEn: 'Graffiti Tour & Workshop',
  cityNameHe: 'ירושלים', cityNameEn: 'Jerusalem', cityIsHome: false,
  participants: 24, tourDate: '2026-08-04', tourTime: '10:00',
  formUrl: 'https://x/f/SCOPEDTOKEN',
};

test('#12 is the exact owner layout: 👤 | 📅 | 🎨 with city away from home', () => {
  assert.equal(renderReport(12, { guideNotice: COORD_NOTICE }), [
    '📟 זמן לשיחת תיאום!',
    '',
    '👤 דנה לוי | עיריית תל אביב',
    '📅 04/08/2026 | 10:00',
    '🎨 סיור וסדנת גרפיטי | ירושלים | 24 משתתפים',
    '',
    'טופס שיחת תיאום:',
    'https://x/f/SCOPEDTOKEN',
  ].join('\n'));
});

test('#12 at the home location drops the city; no organization drops the pipe', () => {
  const text = renderReport(12, {
    guideNotice: { ...COORD_NOTICE, orgName: null, cityIsHome: true },
  });
  assert.match(text, /👤 דנה לוי\n/);
  assert.match(text, /🎨 סיור וסדנת גרפיטי \| 24 משתתפים/);
  assert.ok(!text.includes('ירושלים'));
});

test('#12 and #13 are the same family: identical skeleton, only the title differs', () => {
  const ctx = { guideNotice: COORD_NOTICE };
  const strip = (t) => t.split('\n').slice(1).join('\n');
  assert.equal(strip(renderReport(12, ctx)), strip(renderReport(13, ctx)));
  assert.ok(renderReport(13, ctx).startsWith('➕ הצטרף משתתף חדש לסיור פתוח'));
});

test('#12/#13 English mirrors the Hebrew structure and uses English data', () => {
  for (const n of [12, 13]) {
    const he = renderReport(n, { guideNotice: COORD_NOTICE });
    const en = reportByNumber(n).renderEn({ guideNotice: COORD_NOTICE });
    assert.equal(en.split('\n').length, he.split('\n').length, `#${n} same line count`);
    assert.match(en, /👤 דנה לוי \| עיריית תל אביב/, 'stored names stay as stored');
    assert.match(en, /🎨 Graffiti Tour & Workshop \| Jerusalem \| 24 participants/);
    assert.match(en, /Coordination Call Form:\nhttps:\/\/x\/f\/SCOPEDTOKEN/);
  }
});

test('#13 carries THIS booking only: its customer, its count, its form', () => {
  const text = renderReport(13, {
    guideNotice: {
      contactName: 'משפחת כהן', orgName: null, participants: 2,
      productNameHe: 'סיור גרפיטי', cityNameHe: 'תל אביב', cityIsHome: true,
      tourDate: '2026-08-04', tourTime: '10:00', formUrl: 'https://x/f/BOOKINGFORM',
    },
  });
  assert.match(text, /👤 משפחת כהן\n/);
  assert.match(text, /🎨 סיור גרפיטי \| 2 משתתפים/);
  assert.ok(text.endsWith('טופס שיחת תיאום:\nhttps://x/f/BOOKINGFORM'));
});

test('#14 is greeting-first, one tight block, then photo + summary sections', () => {
  const ctx = {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideNotice: {
      customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00',
      formUrl: 'https://x/f/FORM', photoUploadUrl: 'https://x/g/GALLERY',
    },
  };
  // The exact layout the owner specified (2026-08-03): no blank lines inside
  // the opening block, one blank line before each link section.
  assert.equal(renderReport(14, ctx), [
    'היי יואב',
    '👋 הגיע הזמן למלא סיכום סיור',
    'מקווים שהיה סיור מוצלח עם עיריית תל אביב.',
    '📅 04/08/2026 | 10:00',
    '',
    '📸 לינק להעלאת תמונות:',
    'https://x/g/GALLERY',
    '',
    '📝 לינק לסיכום סיור:',
    'https://x/f/FORM',
  ].join('\n'));
});

test('#15/#16 drop the greeting and keep their reminder wording in the tight block', () => {
  const ctx = {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideNotice: {
      customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00',
      formUrl: 'https://x/f/FORM', photoUploadUrl: 'https://x/g/GALLERY',
    },
  };
  assert.equal(renderReport(15, ctx), [
    '⏰ תזכורת למילוי סיכום סיור',
    '',
    'עדיין לא קיבלנו את סיכום הסיור של עיריית תל אביב.',
    'יאללה, עכשיו כשזה עדיין חם 😊',
    '📅 04/08/2026 | 10:00',
    '',
    '📸 לינק להעלאת תמונות:',
    'https://x/g/GALLERY',
    '',
    '📝 לינק לסיכום סיור:',
    'https://x/f/FORM',
  ].join('\n'));
  assert.equal(renderReport(16, ctx), [
    '⚠️ סיכום הסיור עדיין ממתין',
    '',
    'עדיין לא קיבלנו את סיכום הסיור של עיריית תל אביב.',
    'בלי הסיכום - הסיור עוד לא באמת הסתיים 🙏',
    '📅 04/08/2026 | 10:00',
    '',
    '📸 לינק להעלאת תמונות:',
    'https://x/g/GALLERY',
    '',
    '📝 לינק לסיכום סיור:',
    'https://x/f/FORM',
  ].join('\n'));
  for (const n of [15, 16]) assert.ok(!renderReport(n, ctx).includes('היי'), `#${n} has no greeting`);
});

test('the English ladder mirrors the Hebrew structure line for line', () => {
  const ctx = {
    recipient: { name: 'Yoav Cohen', firstName: 'Yoav' },
    guideNotice: {
      customerName: 'Tel Aviv Municipality', tourDate: '2026-08-04', tourTime: '10:00',
      formUrl: 'https://x/f/FORM', photoUploadUrl: 'https://x/g/GALLERY',
    },
  };
  for (const n of [14, 15, 16]) {
    const he = renderReport(n, ctx);
    const en = reportByNumber(n).renderEn(ctx);
    // Same skeleton: identical line count, blank lines and links in the same
    // positions — a manager comparing the two sees ONE message.
    const heLines = he.split('\n');
    const enLines = en.split('\n');
    assert.equal(enLines.length, heLines.length, `#${n} same line count`);
    heLines.forEach((l, i) => {
      if (l === '' || l.startsWith('📅') || l.startsWith('https://')) {
        assert.equal(enLines[i], l, `#${n} line ${i} structural`);
      }
    });
    assert.ok(en.includes('📸 Photo upload link:'), `#${n} en photo section`);
    assert.ok(en.includes('📝 Tour summary link:'), `#${n} en summary section`);
  }
});

test('without a photo link the section is omitted entirely — never a dead link or blank gap', () => {
  const ctx = {
    guideNotice: { customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00', formUrl: 'https://x/f/FORM' },
  };
  for (const n of [14, 15, 16]) {
    const text = renderReport(n, ctx);
    assert.ok(!text.includes('📸'), `#${n} omits the photo section`);
    assert.ok(!text.includes('\n\n\n'), `#${n} has no double gap`);
    assert.ok(text.endsWith('📝 לינק לסיכום סיור:\nhttps://x/f/FORM'), `#${n} still carries the form`);
  }
});

test('a guide with no known first name is still greeted, never with "undefined"', () => {
  const text = renderReport(14, { guideNotice: { customerName: 'א', formUrl: 'https://x' } });
  assert.match(text, /היי מדריך/);
});

// ── scheduling contract ──────────────────────────────────────────────────────

test('#12 is due at 08:00 two days before, walked earlier off blocked days', () => {
  // A Monday tour → D-2 is Saturday → the send moves to Friday 08:00.
  const r = coordinationSendMs('2026-08-03', new Map());
  assert.equal(r.date, '2026-07-31');
  assert.equal(r.movedDays, 1);
  assert.equal(r.ms, israelLocalToMs('2026-07-31', GUIDE_SEND_HOUR * 60));
});

test('the summary ladder is 0h / 3h / 6h after the tour ENDS', () => {
  assert.deepEqual(SUMMARY_REMINDERS, [
    { number: 14, afterHours: 0 },
    { number: 15, afterHours: 3 },
    { number: 16, afterHours: 6 },
  ]);
});

// ── catalog wiring ───────────────────────────────────────────────────────────

test('each workflow owns only its own guide notifications', () => {
  // The coordination-call flow keeps #11–#13; the summary ladder (#14–#16) is
  // surfaced by the סיכום סיור settings page, not by שיחת תיאום.
  assert.deepEqual(reportsInGroup('coordination').map((r) => r.number), [11, 12, 13]);
  assert.deepEqual(reportsInGroup('tour_summary').map((r) => r.number), [14, 15, 16]);

  for (const r of [...reportsInGroup('coordination'), ...reportsInGroup('tour_summary')]) {
    assert.equal(r.audience, 'guides', `#${r.number} addresses a guide`);
    assert.ok(r.triggerHe?.length > 10);
  }
  // The office reports stay where they are. #23/#24 are customer-audience but
  // still belong on the Manager Reports screen: the operator configures and
  // previews them there, they simply address a customer rather than the office.
  assert.deepEqual(reportsInGroup('office').map((r) => r.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.equal(reportByNumber(1).audience, undefined, 'office reports keep the group destination');
});

// ── the activation floor ─────────────────────────────────────────────────────

test('a notification never reports an event from before it was switched on', async () => {
  const { isDue } = await import('./tourSweeps.js');
  const now = 1_000_000_000_000;
  const hourAgo = now - 3_600_000;
  // Due and recent, no floor → fires.
  assert.equal(isDue(hourAgo, now, null), true);
  // The report was enabled AFTER the event was due → never fires.
  assert.equal(isDue(hourAgo, now, now - 60_000), false);
  // Enabled before it was due → fires.
  assert.equal(isDue(hourAgo, now, now - 7_200_000), true);
  // Not yet due, and stale, both stay false regardless of the floor.
  assert.equal(isDue(now + 1, now, null), false);
  assert.equal(isDue(now - 4 * 86_400_000, now, null), false);
  assert.equal(isDue(null, now, null), false);
});

test('#11 says so out loud when there are no upcoming coordination calls', () => {
  const text = renderReport(11, {
    guideDigest: { coordination: [], missingSummaries: [{ tourDate: '2026-07-30', customerName: 'א', productNameHe: 'ב' }] },
  });
  assert.match(text, /אין שיחות תיאום לימים הקרובים\./);
  // …and never opens with a blank gap before the separator.
  assert.ok(!text.includes('\n\n\n'));
});

test('#12 with no headcount simply drops the count segment — never a dash or a gap', () => {
  const text = renderReport(12, {
    guideNotice: { ...COORD_NOTICE, participants: null },
  });
  assert.match(text, /🎨 סיור וסדנת גרפיטי \| ירושלים\n/);
  assert.ok(!text.includes('\n\n\n'));
});

// ── SECURITY REGRESSION GUARD ────────────────────────────────────────────────
// Messages #12-#16 once linked guides to /p/<portalToken>/tour/<id>, which is
// the whole-portal token with a path appended: truncate the path and you have
// the entire portal. This test exists so that link shape can never come back.

test('NO report, in EITHER language, may contain a portal link', () => {
  // Widened deliberately. The original guard covered guide-audience reports in
  // Hebrew only, which left two ways for the shape to come back: a customer or
  // office report, and an English renderer nobody was checking.
  assert.ok(REPORTS.filter((r) => r.audience === 'guides').length >= 5, 'the guide family exists');

  for (const r of REPORTS) {
    const both = renderReportBoth(r.number);
    for (const [lang, text] of [['he', both.he], ['en', both.en]]) {
      if (!text) continue;
      // The portal surface is /p/<token>. A form link is /f/<token>.
      assert.equal(/\/p\/[A-Za-z0-9_-]+/.test(text), false,
        `#${r.number} (${lang}) contains a guide-portal link:\n${text}`);
      assert.equal(text.includes('/tour/'), false,
        `#${r.number} (${lang}) contains a portal tour deep link:\n${text}`);
    }
  }
});

test('every form-invitation message carries a FORM-scoped link', () => {
  // The replacement must actually be PRESENT — a message with no link would
  // pass the portal guard above while being useless. #11 is excluded: it is a
  // daily status list, not an invitation to fill anything.
  for (const number of [12, 13, 14, 15, 16]) {
    const text = renderReportSample(number);
    assert.ok(/\/f\/[A-Za-z0-9_-]+/.test(text) || text.includes('—'),
      `#${number} has neither a form link nor an honest dash:\n${text}`);
  }
});
